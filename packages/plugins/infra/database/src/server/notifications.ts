import { Client } from 'pg'
import { Cause, Context, Effect, Layer, Queue, Redacted, Schema, Stream } from 'effect'
import { sql } from 'kysely'
import { entityManager, kyselyOf, query } from './orm.ts'
import { DatabaseConfig } from './config.ts'

// PostgreSQL LISTEN/NOTIFY as a transport, and nothing above one.
//
// This module does not know what an event is. A plugin that wants to tell
// other processes "something you may have cached has changed" sends an opaque
// payload down a channel it names, and reads the same channel back as a
// stream of payloads. What the payload means, who may hear about it and what
// anybody does on hearing it are all the sender's business - the same split
// as the rest of this plugin, which carries tables without knowing what a
// review is.
//
// The two directions deliberately use opposite connections:
//
// - `pgNotify` rides the caller's own transaction connection, because that is
//   the whole point: PostgreSQL holds a NOTIFY issued inside a transaction
//   and delivers it only after COMMIT - and never on ROLLBACK. A listener
//   therefore cannot observe an announcement before the state it announces is
//   readable, which is the race every hand-rolled "write then publish"
//   arrangement gets wrong.
// - `listen` holds a dedicated session connection, because LISTEN is
//   session-scoped: a registration on a pooled connection dies silently the
//   moment the pool hands the connection to somebody else.

/** the transport failed underneath a listener: connect, LISTEN, or mid-stream */
export class DatabaseListenFailed extends Schema.TaggedError<DatabaseListenFailed>()(
  'DatabaseListenFailed',
  { channel: Schema.String, cause: Schema.Defect() },
) {}

/**
 * Announce on `channel`, on the connection the surrounding transaction holds.
 *
 * Call this inside the same `transaction(...)` as the write it announces;
 * the database then couples delivery to that transaction's fate. Called
 * outside any transaction it still works - the statement autocommits and the
 * notification goes out at once.
 */
export const pgNotify = Effect.fn('Database.pgNotify')(function* (
  channel: string,
  payload: string,
) {
  const em = yield* entityManager()
  const db = kyselyOf(em)
  yield* query(() => sql`select pg_notify(${channel}, ${payload})`.execute(db))
})

export class DatabaseNotifications extends Context.Service<
  DatabaseNotifications,
  {
    /**
     * Every payload announced on `channel`, from a dedicated session
     * connection, for as long as the stream is consumed.
     *
     * Best-effort by design: a payload announced while the connection is
     * down is gone. Consumers own their recovery - retry the stream, and on
     * every (re)subscription treat the world as unknown and re-read it.
     */
    readonly listen: (channel: string) => Stream.Stream<string, DatabaseListenFailed>
  }
>()('@qualy/plugin-database/DatabaseNotifications') {
  static readonly layer: Layer.Layer<DatabaseNotifications, never, DatabaseConfig> = Layer.effect(
    DatabaseNotifications,
    Effect.gen(function* () {
      const config = yield* DatabaseConfig
      const url = Redacted.value(config.url)

      const listen = (channel: string): Stream.Stream<string, DatabaseListenFailed> =>
        Stream.callback<string, DatabaseListenFailed>(
          Effect.fn('DatabaseNotifications.listen')(function* (queue) {
            const fail = (cause: unknown) =>
              Queue.failCauseUnsafe(queue, Cause.fail(new DatabaseListenFailed({ channel, cause })))
            const client = yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: async () => {
                  const client = new Client({ connectionString: url })
                  await client.connect()
                  return client
                },
                catch: (cause) => new DatabaseListenFailed({ channel, cause }),
              }),
              (client) => Effect.promise(() => client.end()).pipe(Effect.ignore),
            )
            client.on('notification', (message) => {
              if (message.channel === channel) Queue.offerUnsafe(queue, message.payload ?? '')
            })
            // a dead session must fail the stream, not strand it: the
            // consumer's retry is the only reconnect there is
            client.on('error', fail)
            client.on('end', () => fail(new Error('listen session ended')))
            // LISTEN takes no parameters; the channel is a code-owned
            // constant, quoted as an identifier all the same
            yield* Effect.tryPromise({
              try: () => client.query(`listen ${quoteIdentifier(channel)}`),
              catch: (cause) => new DatabaseListenFailed({ channel, cause }),
            })
          }),
        )

      return DatabaseNotifications.of({ listen })
    }),
  )
}

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`

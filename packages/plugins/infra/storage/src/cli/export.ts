import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Data, Effect } from 'effect'
import { CliRefused, type RuntimeCliContext } from '@qualy/plugin-kit/cli'
import { withDatabase } from '@qualy/plugin-database/server'
import { StorageBackends } from '../server/registry.ts'
import { attachmentsToExport, type ExportRow } from '../server/db.ts'
import type { BackendOpen } from '../server/backend.ts'

// `qualy storage export --to <dir> [--except <backend>]...`
//
// Every attachment, fetched the way a reader gets it - through the backend
// that wrote it, at the version it completed with - and written under
// <dir>/<backend>/<storage key>, with attachments.tsv beside them naming
// each file's attachment, tenant, version, size and fingerprint. What a
// store that keeps versions holds of an attachment is the version it
// completed with, not the newest write to its key, so a copy of the bucket
// would not be a backup of the attachments; this is. deploy/backup.sh runs it
// with `--except local`, whose files it archives from the volume whole.
//
// Each file is checked on the way: its size always, and its fingerprint
// where the fingerprint is one this process can compute (sha256). An
// attachment that cannot be fetched, or does not match, fails the command:
// a backup missing an attachment is not one to find out about later.

const PAGE = 500

/** one attachment that could not be fetched or written, and why */
class FetchFailed extends Data.TaggedError('FetchFailed')<{ readonly reason: string }> {}

const failedWith = (cause: unknown) =>
  new FetchFailed({ reason: cause instanceof Error ? cause.message : String(cause) })

const options = (args: readonly string[], name: string): string[] =>
  args.flatMap((arg, at) => (arg === `--${name}` && args[at + 1] ? [args[at + 1]!] : []))

/** the bytes an open hands over, whichever way the store hands them */
const bodyOf = (opened: BackendOpen): Effect.Effect<AsyncIterable<Uint8Array>, FetchFailed> =>
  opened.kind === 'stream'
    ? Effect.succeed(opened.body)
    : Effect.tryPromise({
        try: async () => {
          const response = await fetch(opened.url)
          if (!response.ok || response.body === null) {
            throw new Error(`the store answered ${String(response.status)}`)
          }
          return response.body
        },
        catch: failedWith,
      })

/** writes the body to the file, answering with its length and sha256 */
const written = (body: AsyncIterable<Uint8Array>, file: string) =>
  Effect.tryPromise({
    try: async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      const out = fs.createWriteStream(file, { flags: 'wx' })
      const hash = createHash('sha256')
      let size = 0n
      try {
        for await (const chunk of body) {
          hash.update(chunk)
          size += BigInt(chunk.byteLength)
          if (!out.write(chunk))
            await new Promise<void>((resolve) => out.once('drain', () => resolve()))
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          out.end((error?: Error | null) => (error ? reject(error) : resolve())),
        )
      }
      return { size, sha256: hash.digest('hex') }
    },
    catch: failedWith,
  })

const line = (row: ExportRow) =>
  [
    row.id,
    row.tenantId,
    row.backend,
    row.storageKey,
    row.storageVersion ?? '',
    row.size.toString(),
    row.integrityAlgorithm,
    row.integrityValue,
  ].join('\t')

export const run = (context: RuntimeCliContext) =>
  Effect.gen(function* () {
    const [to] = options(context.args, 'to')
    if (to === undefined) {
      return yield* Effect.fail(
        new CliRefused('usage: qualy storage export --to <dir> [--except <backend>]...', 2),
      )
    }
    const except = options(context.args, 'except')
    const backends = yield* StorageBackends
    const withDb = yield* withDatabase
    const manifest = path.join(to, 'attachments.tsv')
    yield* Effect.promise(() => fs.promises.mkdir(to, { recursive: true }))
    yield* Effect.promise(() =>
      fs.promises.writeFile(
        manifest,
        'id\ttenant\tbackend\tkey\tversion\tsize\talgorithm\tintegrity\n',
        { flag: 'wx' },
      ),
    )
    let after: string | undefined
    let count = 0
    let bytes = 0n
    for (;;) {
      const page = yield* withDb(attachmentsToExport({ except, after, limit: PAGE })).pipe(
        Effect.orDie,
      )
      for (const row of page) {
        const refused = (reason: string) =>
          new CliRefused(
            `storage: attachment ${row.id} (${row.backend} ${row.storageKey}): ${reason}`,
          )
        const backend = yield* backends
          .resolve(row.backend)
          .pipe(Effect.mapError((error) => refused(error.message)))
        const opened = yield* backend
          .open(
            { key: row.storageKey, revision: row.storageVersion },
            { filename: row.id, mime: 'application/octet-stream' },
          )
          .pipe(Effect.mapError((error) => refused(error.message)))
        const body = yield* bodyOf(opened).pipe(Effect.mapError((error) => refused(error.reason)))
        const file = path.join(to, row.backend, row.storageKey)
        const got = yield* written(body, file).pipe(
          Effect.mapError((error) => refused(error.reason)),
        )
        if (got.size !== row.size) {
          return yield* Effect.fail(
            refused(`${got.size.toString()} bytes arrived, ${row.size.toString()} were checked`),
          )
        }
        if (row.integrityAlgorithm === 'sha256' && got.sha256 !== row.integrityValue) {
          return yield* Effect.fail(refused('its sha256 is not the one it completed with'))
        }
        yield* Effect.promise(() => fs.promises.appendFile(manifest, `${line(row)}\n`))
        count += 1
        bytes += got.size
      }
      if (page.length < PAGE) break
      after = page[page.length - 1]!.id
    }
    yield* Effect.sync(() =>
      console.log(
        `storage: exported ${String(count)} attachment(s), ${bytes.toString()} bytes, to ${to}${
          except.length === 0 ? '' : ` (not ${except.join(', ')})`
        }`,
      ),
    )
  })

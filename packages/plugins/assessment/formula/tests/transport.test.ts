import { Cause, Data, Effect, Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { tameTransport } from '../src/server/transport.ts'

// The one edge every rpc client in this plugin hides behind.
//
// Two upstream defects mean the peer is unusable rather than that we are
// broken, and both have to arrive at a caller as its own outage error: a
// socket that failed mid-call, and an answer this host cannot decode - the
// shape a peer process left running across an upgrade produces. Everything
// else stays a defect, because taming a real bug into an outage is how a
// bug becomes a mystery.

class Unavailable extends Data.TaggedError('Unavailable') {}
class Refused extends Data.TaggedError('Refused') {}

const tamed = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runSyncExit(effect.pipe(tameTransport(() => new Unavailable())))

const tagOf = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isSuccess(exit)
    ? 'success'
    : ((Cause.squash(exit.cause) as { _tag?: string })._tag ?? 'defect')

describe('the shared transport edge', () => {
  it("reads a peer that cannot be reached as this caller's outage", () => {
    expect(tagOf(tamed(Effect.fail({ _tag: 'RpcClientError' })))).toBe('Unavailable')
    expect(tagOf(tamed(Effect.die({ _tag: 'SocketError' })))).toBe('Unavailable')
  })

  it('reads an answer it cannot decode as the same outage, not as a crash', () => {
    // what a runtime one generation behind actually produces: the client
    // raises the decode failure as a defect (its decodeExit is orDie), and
    // unhandled that reaches a page as a bare schema path
    const stale = Effect.runSyncExit(
      Schema.decodeUnknownEffect(Schema.Struct({ engineVersion: Schema.String }))({}),
    )
    const error = Exit.isFailure(stale) ? Cause.squash(stale.cause) : undefined
    expect(Schema.isSchemaError(error)).toBe(true)
    expect(tagOf(tamed(Effect.die(error)))).toBe('Unavailable')
  })

  it('lets a real defect fly, and a real error through', () => {
    // a bug tamed into an outage is a bug turned into a mystery
    expect(tagOf(tamed(Effect.die(new Error('a genuine bug'))))).toBe('defect')
    // and a failure the caller models itself is none of this edge's business
    expect(tagOf(tamed(Effect.fail(new Refused())))).toBe('Refused')
  })
})

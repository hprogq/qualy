import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { Assembled, BootHookFailed, assembledBarrier, assembledLayer } from '../src/assembled.ts'

// The barrier between "every layer is built" and "the port is bound".
//
// What it promises: hooks registered during layer construction all run, in
// registration order, before anything sequenced after the barrier - and a
// failing hook stops the build entirely, because an application whose boot
// work did not finish must not serve.

/** a layer that registers one hook, the way a plugin does */
const registering = (name: string, run: Effect.Effect<void, unknown>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const assembled = yield* Assembled
      yield* assembled.register({ name, run })
    }),
  )

describe('the assembled barrier', () => {
  it('runs every hook before anything built after the barrier', async () => {
    const order: string[] = []
    const plugins = Layer.mergeAll(
      registering(
        'first',
        Effect.sync(() => void order.push('first')),
      ),
      registering(
        'second',
        Effect.sync(() => void order.push('second')),
      ),
    )
    // the host's shape: the server layer is provided the barrier, which is
    // provided the plugins, all over one memoized registry
    const server = Layer.effectDiscard(Effect.sync(() => void order.push('serve')))
    const application = server.pipe(
      Layer.provide(assembledBarrier.pipe(Layer.provide(plugins))),
      Layer.provide(plugins),
      Layer.provideMerge(assembledLayer),
    )
    await Effect.runPromise(Effect.scoped(Layer.build(application)))
    expect(order.slice(-1)).toEqual(['serve'])
    expect(new Set(order.slice(0, -1))).toEqual(new Set(['first', 'second']))
  })

  it('stops the build, named, when a hook fails', async () => {
    // untagged on purpose: a hook's failure type is `unknown` by contract, and
    // the channel says so rather than carrying a global Error
    const plugins = registering(
      'rbac/permission-catalog',
      Effect.fail<unknown>(new Error('no database')),
    )
    let served = false
    const server = Layer.effectDiscard(Effect.sync(() => void (served = true)))
    const application = server.pipe(
      Layer.provide(assembledBarrier.pipe(Layer.provide(plugins))),
      Layer.provide(plugins),
      Layer.provideMerge(assembledLayer),
    )
    const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(application)))
    expect(Exit.isFailure(exit)).toBe(true)
    const cause = (exit as Extract<typeof exit, { _tag: 'Failure' }>).cause
    const failure = cause.reasons[0] as { error?: unknown }
    expect(failure.error).toBeInstanceOf(BootHookFailed)
    expect((failure.error as BootHookFailed).message).toContain('rbac/permission-catalog')
    // and the port never bound
    expect(served).toBe(false)
  })

  it('refuses two hooks with one name', async () => {
    const plugins = Layer.mergeAll(
      registering('mirror', Effect.void),
      registering('mirror', Effect.void),
    )
    const exit = await Effect.runPromiseExit(
      Effect.scoped(Layer.build(plugins.pipe(Layer.provideMerge(assembledLayer)))),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

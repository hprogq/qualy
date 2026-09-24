import { it } from '@effect/vitest'
import { Effect, Layer, References } from 'effect'
import { describe, expect } from 'vitest'
import { Assembled, BootHookFailed, assembledBarrier, assembledLayer } from '../src/assembled.ts'

// The barrier between "every layer is built" and "the port is bound".
//
// What it promises: hooks registered during layer construction all run, in
// registration order, before anything sequenced after the barrier - and a
// failing hook stops the build entirely, because an application whose boot
// work did not finish must not serve.
//
// Each case is an Effect rather than a promise around one: `it.effect` owns
// the scope, so the application below is released when the case ends rather
// than the instant it finished building. That is the shape a host has, and
// it is the shape a leaked finalizer would show up in.

/** a layer that registers one hook, the way a plugin does */
const registering = (name: string, run: Effect.Effect<void, unknown>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const assembled = yield* Assembled
      yield* assembled.register({ name, run })
    }),
  )

describe('the assembled barrier', () => {
  it.effect('runs every hook before anything built after the barrier', () =>
    Effect.gen(function* () {
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
      yield* Layer.build(application)
      expect(order.slice(-1)).toEqual(['serve'])
      expect(new Set(order.slice(0, -1))).toEqual(new Set(['first', 'second']))
    }),
  )

  it.effect('stops the build, named, when a hook fails', () =>
    Effect.gen(function* () {
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
      const exit = yield* Effect.exit(Layer.build(application))
      expect(exit._tag).toBe('Failure')
      const cause = (exit as Extract<typeof exit, { _tag: 'Failure' }>).cause
      const failure = cause.reasons[0] as { error?: unknown }
      expect(failure.error).toBeInstanceOf(BootHookFailed)
      expect((failure.error as BootHookFailed).message).toContain('rbac/permission-catalog')
      // and the port never bound
      expect(served).toBe(false)
    }),
  )

  it.effect('refuses two hooks with one name', () =>
    Effect.gen(function* () {
      const plugins = Layer.mergeAll(
        registering('mirror', Effect.void),
        registering('mirror', Effect.void),
      )
      const exit = yield* Effect.exit(Layer.build(plugins.pipe(Layer.provideMerge(assembledLayer))))
      expect(exit._tag).toBe('Failure')
    }),
  )

  // Whose work a hook is. The assembler annotates a plugin's build fiber
  // with its id, but the host runs the hooks on the barrier's own fiber -
  // so unless the annotation travels with the hook, everything a plugin
  // starts at boot logs as the application, and the per-source log level
  // keyed on that annotation cannot reach it.
  it.effect('runs a hook as the plugin that registered it', () =>
    Effect.gen(function* () {
      const seen: unknown[] = []
      // the assembler wraps a plugin's build in its own identity
      const plugin = Layer.effectDiscard(
        Effect.gen(function* () {
          const assembled = yield* Assembled
          yield* assembled.register({
            name: 'sweeper',
            run: Effect.gen(function* () {
              seen.push((yield* References.CurrentLogAnnotations)['source'])
            }),
          })
        }).pipe(Effect.annotateLogs({ source: '@qualy/plugin-sweeper' })),
      )
      const server = Layer.effectDiscard(Effect.void)
      const application = server.pipe(
        Layer.provide(assembledBarrier.pipe(Layer.provide(plugin))),
        Layer.provide(plugin),
        Layer.provideMerge(assembledLayer),
      )
      yield* Layer.build(application)
      expect(seen).toEqual(['@qualy/plugin-sweeper'])
    }),
  )
})

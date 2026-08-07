import { Context, Effect, Layer, Scope } from 'effect'

// The moment every plugin's layer has been built, made into something a
// plugin can act on.
//
// Some work is per-plugin but reads what every plugin said: rbac mirrors the
// permission catalog into its table, and the catalog is complete only once
// every contributor's layer has run. Under cordis that moment was
// `ctx.loader.await()`; in a static layer graph it is a barrier the host
// builds after the plugin layers and before the port binds - so a request can
// never observe a half-assembled application, which is also what lets a
// registry read at the barrier instead of forcing its reader below its
// writers.
//
// The registry shape is Readiness's, one door over: a plugin registers a hook
// while its own layer is built, with its services already bound, and the host
// runs whatever registered. The difference is when - a probe answers every
// readiness request, a boot hook runs exactly once, before serving.

export interface BootHook {
  /** what this hook completes, which is what a failure names */
  readonly name: string
  /**
   * The work, with its services already supplied.
   *
   * `R` is `never` for the same reason a readiness probe's is: the plugin
   * binds its own dependencies at registration, so the host never learns what
   * a hook needs. A failure stops the boot - an application whose catalog
   * could not be mirrored must not serve, and there is nothing above the host
   * to hand the error to.
   */
  readonly run: Effect.Effect<void, unknown>
}

export class Assembled extends Context.Service<
  Assembled,
  {
    /** adds a hook for as long as the registering layer lives */
    readonly register: (hook: BootHook) => Effect.Effect<void, never, Scope.Scope>
    /** every hook registered, in registration order */
    readonly hooks: Effect.Effect<readonly BootHook[]>
  }
>()('@qualy/api-kit/Assembled') {}

export const assembledLayer: Layer.Layer<Assembled> = Layer.sync(Assembled, () => {
  const hooks = new Map<string, BootHook>()
  return Assembled.of({
    register: (hook) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          // one name, one owner - same rule as every other registry here
          if (hooks.has(hook.name)) {
            throw new Error(`boot hook ${hook.name} is registered twice`)
          }
          hooks.set(hook.name, hook)
        }),
        () => Effect.sync(() => hooks.delete(hook.name)),
      ).pipe(Effect.orDie, Effect.asVoid),
    hooks: Effect.sync(() => [...hooks.values()]),
  })
})

export class BootHookFailed extends Error {
  readonly _tag = 'BootHookFailed'
  // a plain field, not a parameter property: strip-only node loads this
  // source when resolution imports descriptors, and refuses syntax with
  // runtime semantics
  readonly hook: string
  constructor(hook: string, cause: unknown) {
    super(`boot hook ${hook} failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    })
    this.hook = hook
  }
}

/**
 * Runs every registered hook, in registration order.
 *
 * Sequential rather than concurrent: hooks are rare, cheap and independent,
 * and a deterministic log order is worth more than the milliseconds. A hook
 * must not depend on another having run - the order across plugins is a
 * property of the build, not a contract.
 */
export const runBootHooks: Effect.Effect<void, BootHookFailed, Assembled> = Effect.gen(
  function* () {
    const assembled = yield* Assembled
    for (const hook of yield* assembled.hooks) {
      yield* Effect.logDebug(`boot hook: ${hook.name}`)
      yield* hook.run.pipe(Effect.mapError((cause) => new BootHookFailed(hook.name, cause)))
    }
  },
)

/**
 * The barrier itself, for a composition root to sequence the server after.
 *
 * `Layer.provide` builds its argument before the layer it feeds, whether or
 * not anything is consumed (upstream Layer.ts, provideWith: `flatMap` on the
 * dependency's build) - so `server.pipe(Layer.provide(assembledBarrier))`
 * means the port does not bind until every hook has run.
 */
export const assembledBarrier: Layer.Layer<never, BootHookFailed, Assembled> =
  Layer.effectDiscard(runBootHooks)

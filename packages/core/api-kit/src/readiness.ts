import { Context, Effect, Layer, Scope } from 'effect'

// What a plugin says about its own health, collected rather than named.
//
// Readiness asks "is this instance able to take traffic", and only the plugin
// that owns a resource can answer for it: the composition root reaching into a
// plugin to probe its connection would be the root holding a handle it has no
// business holding, and would name that plugin in an assembly that may not
// contain it.
//
// So the probe travels the other way. A plugin registers one while its own
// layer is built, where its services are in scope, and the host reads whatever
// registered. An assembly with nothing to probe answers ready with an empty
// list, which is the honest answer: ready has only ever claimed that what is
// loaded is healthy, never that the assembly is complete.
//
// This is the registry shape Effect uses for its own router - a service
// holding a mutable structure, a Layer to register into it, and consumption at
// request time. See HttpRouter.use in effect/unstable/http.

export interface ReadinessCheck {
  /** what is being probed, which is what a failing response logs */
  readonly name: string
  /**
   * The probe, with its services already supplied.
   *
   * `R` is `never` on purpose: a plugin binds its own dependencies while its
   * layer is built, so the registry never has to pipe requirements through and
   * the host never learns what a probe needs. A probe that still wanted a
   * service would push that service into the host's context, which is exactly
   * the coupling this exists to remove.
   */
  readonly probe: Effect.Effect<void, unknown>
}

export class Readiness extends Context.Service<
  Readiness,
  {
    /**
     * Adds a probe for as long as the registering layer lives.
     *
     * Scoped, so a plugin that goes away takes its probe with it rather than
     * leaving the host asking a resource nobody owns any more.
     */
    readonly register: (check: ReadinessCheck) => Effect.Effect<void, never, Scope.Scope>
    /** every probe registered, read per request rather than closed over */
    readonly checks: Effect.Effect<readonly ReadinessCheck[]>
  }
>()('@qualy/api-kit/Readiness') {}

/**
 * The registry itself.
 *
 * A Map in a closure rather than a field that gets reassigned: registration
 * mutates the container, and every reader holds the same one.
 */
export const readinessLayer: Layer.Layer<Readiness> = Layer.sync(Readiness, () => {
  const checks = new Map<string, ReadinessCheck>()
  return Readiness.of({
    register: (check) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          // Two plugins claiming one name would leave a failing probe reported
          // under the other's name, and a passing one hiding a failure. It is
          // a broken assembly rather than a condition anything can handle, so
          // the layer refuses to build.
          if (checks.has(check.name)) {
            throw new Error(`readiness check ${check.name} is registered twice`)
          }
          checks.set(check.name, check)
        }),
        () => Effect.sync(() => checks.delete(check.name)),
      ).pipe(Effect.orDie, Effect.asVoid),
    checks: Effect.sync(() => [...checks.values()]),
  })
})

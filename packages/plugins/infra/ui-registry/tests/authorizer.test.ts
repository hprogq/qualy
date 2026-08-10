import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { Context } from 'effect'
import { UiAuthorizer, denyAll } from '../src/server/authorizer.ts'

class ManifestProbe extends Context.Service<
  ManifestProbe,
  { readonly authorizer: typeof UiAuthorizer.Service }
>()('test/ManifestProbe') {}

// Why the authorizer is a required service and not a defaulted one.
//
// The alternative, a Context.Reference with a deny-everything default, is
// erased from the requirements channel. That reads as safe, because the
// default denies, but it means a wiring mistake can never be caught: an
// assembly that serves a manifest with no provider builds, boots, and shows
// every signed-in viewer nothing but public pages, with no error and no
// failing test.
//
// A required service turns that into a compile error, and this file proves it
// rather than asserting it. The negative case is the point: if the requirement
// were ever erased, the type assertion below would stop compiling, which is
// what keeps this decision from being quietly undone.

/** something that reads the authorizer, standing in for the manifest */
const manifestLayer = Layer.effect(
  ManifestProbe,
  Effect.gen(function* () {
    const authorizer = yield* UiAuthorizer
    return { authorizer }
  }),
)

describe('the ui authorizer', () => {
  it('will not let an assembly that needs it be launched without one', () => {
    // the entry point takes an Effect that needs nothing, so an unmet
    // requirement stops the build rather than the boot. the requirement is
    // still in this launch's type, and the assignment below is what says so:
    // erase it and the requirements become never, which nothing is assignable
    // to, so this line stops compiling
    const launched = Layer.launch(manifestLayer)
    const stillRequired: Effect.Services<typeof launched> = undefined as unknown as UiAuthorizer
    expect(stillRequired).toBeUndefined()
  })

  it('launches once a provider is supplied', async () => {
    const wired = manifestLayer.pipe(Layer.provide(denyAll))
    // and once provided the requirement is discharged, so this one IS runnable
    const runnable: Effect.Effect<never, never, never> = Layer.launch(wired)
    expect(runnable).toBeDefined()
    const probe = await Effect.runPromise(ManifestProbe.pipe(Effect.provide(wired)))
    expect(probe.authorizer).toBeDefined()
  })

  it('denies everything when absence is asked for explicitly', async () => {
    const codes = await Effect.runPromise(
      Effect.gen(function* () {
        const authorizer = yield* UiAuthorizer
        return yield* authorizer.permissionsFor({
          tenantId: 't',
          userId: 'u',
          sessionId: 's',
        })
      }).pipe(Effect.provide(denyAll)),
    )
    // the same outcome the missing slot used to produce, except written down
    expect([...codes]).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { Effect, Exit, Layer, Scope } from 'effect'
import { permissionOf } from '@qualy/ui-contract'
import { Ui, uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { UiContributions } from '@qualy/plugin-ui-registry/service'
import { calculatorAuthoringOptions } from '@qualy/plugin-assessment/surfaces'
import { FormulaSettings } from '../src/server/config.ts'
import { formulaAuthoringSurfaceLayer } from '../src/server/authoring-surface.ts'

// The chooser's option is decided while the plugin is built, from the
// manifest: a deployment with the writer off offers no formula to choose,
// and the option lives exactly as long as the layer that offered it. The
// editor seat is not in question here - it is static, so a question
// already bound keeps rendering its own editor either way.

const KEY = calculatorAuthoringOptions.key

const offered = (ui: Ui['Service']) =>
  Effect.map(ui.surfaces, (surfaces) =>
    surfaces.collections.filter((item) => item.collection.key === KEY),
  )

const under = (authoring: boolean) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ui = yield* Ui
      const scope = yield* Scope.make()
      yield* Layer.buildWithScope(
        formulaAuthoringSurfaceLayer.pipe(
          Layer.provide(Layer.succeed(FormulaSettings, FormulaSettings.of({ authoring }))),
          // the published view, which is what a contributor is handed
          Layer.provide(
            Layer.succeed(UiContributions, UiContributions.of({ contribute: ui.contribute })),
          ),
        ),
        scope,
      )
      const during = yield* offered(ui)
      yield* Scope.close(scope, Exit.void)
      const after = yield* offered(ui)
      return { during, after }
    }).pipe(Effect.provide(uiLayer)),
  )

describe('the formula option in the calculator chooser', () => {
  it('is not offered while authoring is off', async () => {
    const { during, after } = await under(false)
    expect(during).toEqual([])
    expect(after).toEqual([])
  })

  it('is offered while authoring is on, for as long as the plugin is built', async () => {
    const { during, after } = await under(true)
    expect(during).toHaveLength(1)
    expect(during[0]).toMatchObject({
      collection: { key: KEY },
      id: 'assessment-formula/calculator',
      value: { ref: 'formula@1', order: 20 },
      visibility: permissionOf('assessment.batch.manage'),
    })
    // the registration is scoped to the layer: gone when it is
    expect(after).toEqual([])
  })
})

describe('what a running assembly may contribute', () => {
  // The published capability is one method. A page, a layout or a slot added
  // at run time would be named by the server's manifest with no loader in any
  // bundle and no place in the release's browser contract - a screen the shell
  // resolves to nothing, on a release that believes it is intact. Those come
  // from a descriptor, where the build can see them.
  it('offers a collection item, and nothing that carries a renderer', () => {
    const view = UiContributions.of({ contribute: () => Effect.void })
    expect(Object.keys(view).sort()).toEqual(['contribute'])
  })
})

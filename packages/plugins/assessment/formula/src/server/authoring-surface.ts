import { Effect, Layer } from 'effect'
import { message } from '@qualy/i18n-contract'
import { permissionOf } from '@qualy/ui-contract'
import { UiContributions } from '@qualy/plugin-ui-registry/service'
import { calculatorAuthoringOptions } from '@qualy/plugin-assessment/surfaces'
import { FormulaSettings } from './config.ts'

// This plugin's arithmetic, offered in the question editor's chooser - or
// not, as the manifest decides while the plugin is being built.
//
// The option is the one surface that depends on a runtime value, so it is
// the one surface declared here rather than in the descriptor: with the
// writer closed the chooser simply has no formula to offer, and the core
// editor, seeing one arithmetic, shows no chooser at all. The editor seat
// beside it stays a static declaration on purpose - a question already
// bound to a formula keeps rendering its own editor whatever the switch
// says, and the browser build must find that component whatever the
// manifest says. Hiding the option is projection; the boundary is the
// calculator's refusal to compile a new binding.
//
// The line logged here reports the writer's state, and only that; the
// capability report a rolling deployment compares across instances is the
// boot audit's, not this file's.

export const formulaAuthoringSurfaceLayer: Layer.Layer<
  never,
  never,
  UiContributions | FormulaSettings
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* FormulaSettings
    yield* Effect.logInfo(
      `formula binding authoring ${settings.authoring ? 'enabled' : 'disabled'}`,
    )
    if (!settings.authoring) return
    const ui = yield* UiContributions
    yield* ui.contribute({
      collection: calculatorAuthoringOptions,
      id: 'assessment-formula/calculator',
      value: {
        ref: 'formula@1',
        label: message('assessment-formula/binding/calculator', 'A published formula'),
        order: 20,
      },
      visibility: permissionOf('assessment.batch.manage'),
    })
  }),
)

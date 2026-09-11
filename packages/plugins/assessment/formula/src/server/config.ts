import { Context, Effect, Layer, Schema } from 'effect'

// What the manifest says about this plugin.
//
// One switch, and it controls NEW assessment bindings only: whether a
// published formula version may be newly pointed at a question. It does not
// disable formula function authoring - writing, publishing, sharing and
// forking go on as before - and it does not touch historical execution: a
// question already bound to an exact version keeps being saved under it,
// scored by it and read at it. The switch exists for a reader-first rollout
// (docs/phase7-design.md §11): every instance learns to run formula plans
// before any instance is allowed to write one.
//
// A manifest that says nothing has the writer closed, and nothing else can
// open it - not an environment variable, not a request. Opening it is an
// edit to qualy.yml, a `qualy resolve`, and a committed lock.

export class FormulaSettings extends Context.Service<
  FormulaSettings,
  {
    /** whether a published version may be NEWLY bound to a question */
    readonly authoring: boolean
  }
>()('@qualy/plugin-assessment-formula/FormulaSettings') {}

export const FormulaManifestConfig = Schema.Struct({
  authoring: Schema.optional(Schema.Boolean),
})
export type FormulaManifestConfig = typeof FormulaManifestConfig.Type

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<FormulaSettings, Schema.SchemaError> =>
  Layer.effect(
    FormulaSettings,
    Effect.gen(function* () {
      const declared = yield* Schema.decodeUnknownEffect(FormulaManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
      return FormulaSettings.of({ authoring: declared.authoring ?? false })
    }),
  )

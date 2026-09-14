import { Context, Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'

// This capability's face in the descriptor model: what a plugin writes to say
// "I am where browser failures get reported".
//
// The same shape as storage backends, with one rule reversed. A deployment may
// keep attachments in two places at once, because something written to a disk
// last year still has to open. Browser reporting cannot be doubled: every
// vendor's sdk takes over `window.onerror`, `unhandledrejection`, fetch and
// history, and two of them at once means each failure reported twice, each
// sdk's patch wrapping the other's, and no way to tell which one a gap came
// from. So at most one provider, decided in the assembly rather than by
// whichever browser module evaluated last.

export interface RumProviderDeclaration {
  /** the word the runtime configuration names, and the browser half answers to */
  readonly code: string
}

/** every reporting provider this assembly's plugins declare */
export const RumProviderDeclarations = ExtensionPoint.make<RumProviderDeclaration>(
  '@qualy/plugin-rum/providers',
  { phase: 'prepare' },
)

/** what the assembly says exists, before anything has been built */
export class DeclaredRumProvider extends Context.Service<
  DeclaredRumProvider,
  (RumProviderDeclaration & { readonly pluginId: string }) | null
>()('@qualy/plugin-rum/DeclaredRumProvider') {}

export const Rum = {
  /** declares that this plugin reports browser failures somewhere */
  provider: (declaration: RumProviderDeclaration): PluginFeature =>
    Plugin.contribute(RumProviderDeclarations, declaration),

  /**
   * The owner's interpretation: none, or exactly one.
   *
   * A second provider is refused here, by name, while the assembly is being
   * described - not resolved by load order, and not left for someone to
   * notice in a month of doubled error counts. Turning reporting from one
   * vendor to another is therefore two lines in the manifest, and the
   * refusal is what makes the first of them mandatory.
   */
  owner: Plugin.provideExtension(RumProviderDeclarations, {
    compile: (contributions) => {
      if (contributions.length > 1) {
        const named = contributions.map((contribution) => contribution.pluginId).join(', ')
        throw new Error(
          `browser reporting takes one provider and this assembly declares ${String(contributions.length)}: ${named}. ` +
            'Disable all but one in the manifest.',
        )
      }
      const only = contributions[0]
      return Layer.succeed(
        DeclaredRumProvider,
        only === undefined ? null : { ...only.value, pluginId: only.pluginId },
      )
    },
  }),
}

import { Layer } from 'effect'
import type { UiSurfaces } from '@qualy/ui-contract'
import { ExtensionPoint, Plugin, type PluginDescriptor, type PluginFeature } from '@qualy/plugin-kit'
import { registerSurfaces, uiLayer, type Ui } from './server/registry.ts'

// The shell's face in the descriptor model.
//
// A page declaration is prepare-phase data: it runs no query and touches no
// service, so nothing about it belongs in a service layer - and taking it out
// of one is what dissolves the auth->Ui build edge that once forced a barrier
// between registration and reading.

/** every plugin's surface declarations, in plugin order */
export const UiSurfaceDeclarations = ExtensionPoint.make<UiSurfaces>(
  '@qualy/plugin-ui-registry/surfaces',
  { phase: 'prepare' },
)

export const ReactUi = {
  /** declares this plugin's pages, layouts, collections and slots */
  surfaces: (surfaces: UiSurfaces): PluginFeature =>
    Plugin.contribute(UiSurfaceDeclarations, surfaces),

  /**
   * The owner's interpretation: the registry, already populated.
   *
   * The registry service survives - the manifest reads it per request, and
   * duplicate ids still refuse the build - but contributors no longer reach
   * it: the assembler hands their declarations over before any service layer
   * exists, so requiring `Ui` stops being part of declaring a page.
   */
  provider: Plugin.provideExtension(UiSurfaceDeclarations, {
    compile: (contributions) =>
      Layer.mergeAll(Layer.empty, ...contributions.map(registerSurfaces)).pipe(
        Layer.provideMerge(uiLayer),
      ),
  }),
}

/**
 * The legacy bridge, until the descriptor assembler takes over the host
 * (docs/plugin-descriptor-plan.md, batch 5): the runtime-registration layer
 * this plugin's declarations used to be, derived from the descriptor so the
 * two shapes cannot drift. Precisely typed on purpose - the generated runtime
 * module still composes these, and its types are load-bearing until cutover.
 */
export const legacySurfaceLayer = (plugin: PluginDescriptor): Layer.Layer<never, never, Ui> =>
  Layer.mergeAll(
    Layer.empty,
    ...Plugin.contributionsOf(plugin, UiSurfaceDeclarations).map(registerSurfaces),
  )

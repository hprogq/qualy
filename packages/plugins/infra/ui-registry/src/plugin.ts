import { Layer } from 'effect'
import type { UiText } from '@qualy/i18n-contract'
import {
  definePage,
  reactComponent,
  type ClientComponentRef,
  type LayoutContractId,
  type LayoutDeclaration,
  type NamespacedId,
  type PageRef,
  type SlotDeclaration,
  type UiSurfaces,
  type UiVisibility,
} from '@qualy/ui-contract'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import { registerSurfaces, uiLayer } from './server/registry.ts'

// The shell's face in the descriptor model.
//
// A surface declaration is prepare-phase data: it runs no query and touches
// no service. The component is a ClientComponentRef - renderer, module,
// export - never a React value: importing one would drag the client module
// graph into every process that reads the descriptor, and a function does
// not serialise. The build turns references into real import() edges; the
// manifest projects them to registry keys; client code links by page id.

/** every plugin's surface declarations, in plugin order */
export const UiSurfaceDeclarations = ExtensionPoint.make<UiSurfaces>(
  '@qualy/plugin-ui-registry/surfaces',
  { phase: 'prepare' },
)

/**
 * The plugin's localisation module, by reference.
 *
 * An external channel: the interpreter is the browser BUILD, not the server
 * process - the collector imports the module, validates namespaces and ids,
 * and splices its catalogs into the virtual aggregate. The module itself
 * stays authored content (definePluginMessages + locale tables); only its
 * discovery moved from a ./client entry export onto the descriptor, which is
 * what let the entry file disappear.
 */
export const I18nCatalogs = ExtensionPoint.make<{ readonly module: string }>(
  '@qualy/plugin-ui-registry/i18n',
  { phase: 'external' },
)

export interface PageOptions {
  readonly id: NamespacedId
  readonly path: string
  readonly component: ClientComponentRef
  readonly layout: LayoutContractId
  readonly visibility: UiVisibility
  /** what a browser tab calls it; a page with a menu entry inherits its words */
  readonly title?: UiText
  readonly navigation?: {
    readonly label: UiText
    readonly icon?: string
    readonly order?: number
    readonly group?: NamespacedId
  }
}

/** the feature and the identity it declared, one value */
export type PageFeature = PluginFeature & { readonly page: PageRef }

export const Ui = {
  /** a React component module; the default export implements it */
  react: reactComponent,

  /**
   * One routable screen, whole: identity, framing, visibility, navigation
   * and the client module that implements it - a single declaration in the
   * descriptor, nothing else to keep in step.
   */
  page: (options: PageOptions): PageFeature => {
    const page = definePage({ id: options.id, path: options.path })
    const feature = Plugin.contribute(UiSurfaceDeclarations, {
      pages: [
        {
          page,
          component: options.component,
          layout: options.layout,
          visibility: options.visibility,
          ...(options.title === undefined ? {} : { title: options.title }),
          ...(options.navigation === undefined ? {} : { navigation: options.navigation }),
        },
      ],
    })
    return { ...feature, page }
  },

  /** an implementation of a layout contract, which only a layout plugin ships */
  layout: (declaration: LayoutDeclaration): PluginFeature =>
    Plugin.contribute(UiSurfaceDeclarations, { layouts: [declaration] }),

  /** a renderer for a named slot */
  slot: (declaration: SlotDeclaration): PluginFeature =>
    Plugin.contribute(UiSurfaceDeclarations, { slots: [declaration] }),

  /** the bulk form, for collections and anything the sugar above does not say */
  surfaces: (surfaces: UiSurfaces): PluginFeature =>
    Plugin.contribute(UiSurfaceDeclarations, surfaces),

  /** names the module exporting `catalogs` (and optionally `errorMessages`) */
  i18n: (module: string): PluginFeature => Plugin.contribute(I18nCatalogs, { module }),

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
      Layer.mergeAll(
        Layer.empty,
        ...contributions.map((contribution) =>
          registerSurfaces(contribution.value, contribution.pluginId),
        ),
      ).pipe(Layer.provideMerge(uiLayer)),
  }),
}

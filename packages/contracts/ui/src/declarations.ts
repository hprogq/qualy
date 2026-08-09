import type { UiText } from '@qualy/i18n-contract'
import type { ClientComponentRef } from './components.ts'
import type { NamespacedId } from './ids.ts'
import type { LayoutContractId } from './surfaces.ts'
import type { PageRef } from './pages.ts'
import type { UiVisibility } from './visibility.ts'

// What a plugin contributes to the shell, said once and read without running.
//
// Under cordis every surface was pushed: a plugin called ctx.ui.addPage from
// its own constructor, so the registry had to be built before every
// contributor and complete after all of them. That is the same inversion the
// permission catalog and the login drivers already went through, and it has
// the same answer. A surface is a descriptor, not an effect: nothing here runs
// or reads a database, so the assembly can collect the declarations without
// constructing anything.
//
// The one genuine registration is the authorizer, which is a live function
// rbac supplies and the manifest calls per request. It stays a service.

/**
 * One routable screen.
 *
 * The page reference says which screen it is, the component implements it, and
 * the layout CONTRACT (never a concrete implementation) frames it. Visibility
 * is required: a surface cannot become public by forgetting a field.
 */
export interface PageDeclaration {
  readonly page: PageRef
  readonly component: ClientComponentRef
  readonly layout: LayoutContractId
  readonly visibility: UiVisibility
  /**
   * Sugar for the primary navigation entry most pages also want.
   *
   * It inherits the page's visibility and disappears with it, so a page and
   * its menu item cannot drift into disagreeing about who may see them.
   */
  readonly navigation?: {
    readonly label: UiText
    readonly icon?: string
    readonly order?: number
    readonly group?: NamespacedId
  }
}

/** a concrete implementation of a layout contract, shipped by a layout plugin */
export interface LayoutDeclaration {
  readonly contract: LayoutContractId
  readonly provider: NamespacedId
  readonly component: ClientComponentRef
}

export interface CollectionDeclaration {
  readonly key: string
  readonly id: NamespacedId
  readonly value: unknown
  readonly visibility: UiVisibility
  readonly order?: number
}

export interface SlotDeclaration {
  readonly key: string
  readonly id: NamespacedId
  readonly component: ClientComponentRef
  readonly visibility: UiVisibility
  readonly order?: number
}

/** everything one plugin adds to the shell */
export interface UiSurfaces {
  readonly pages?: readonly PageDeclaration[]
  readonly layouts?: readonly LayoutDeclaration[]
  readonly collections?: readonly CollectionDeclaration[]
  readonly slots?: readonly SlotDeclaration[]
}

/** declares a plugin's surfaces, typed at the declaration site */
export const defineSurfaces = (surfaces: UiSurfaces): UiSurfaces => surfaces

// the ui composition contract: stable ids, layout contracts and typed
// surface tokens. Business plugins and layout implementations both depend on
// this package and never on each other — replacing a layout implementation
// must not touch business plugins.

// every public logical id is namespaced: "org/tree", "admin-shell/v1",
// "notice/header-bell"
export type NamespacedId = `${string}/${string}`

export const NAMESPACED_ID = /^[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/i

// a semantic layout role with a versioned protocol; pages reference the
// contract, a layout plugin provides the implementation
export type LayoutContractId = NamespacedId

export const ADMIN_SHELL: LayoutContractId = 'admin-shell/v1'
export const BLANK_SHELL: LayoutContractId = 'blank-shell/v1'

// collection surfaces carry structured data rendered by the layout itself
// (navigation, breadcrumbs, ...); slot surfaces carry contributed renderers
export interface UiCollectionToken<T> {
  readonly kind: 'collection'
  readonly key: NamespacedId
  // phantom member so T survives type inference; never assigned
  readonly __item?: T
}

export interface UiSlotToken {
  readonly kind: 'slot'
  readonly key: NamespacedId
  readonly cardinality: 'one' | 'many'
}

export function defineUiCollection<T>(options: { key: NamespacedId }): UiCollectionToken<T> {
  return { kind: 'collection', key: options.key }
}

export function defineUiSlot(options: {
  key: NamespacedId
  cardinality: 'one' | 'many'
}): UiSlotToken {
  return { kind: 'slot', key: options.key, cardinality: options.cardinality }
}

// --- admin-shell/v1 surfaces ---

// primary navigation entries either reference a page by id (the registry
// resolves the path at manifest build time, so renaming a url never touches
// navigation) or carry an explicit path (external/manual links)
export interface NavigationItem {
  id: NamespacedId
  label: string
  pageId?: NamespacedId
  path?: string
  icon?: string
  order?: number
}

export const primaryNavigation = defineUiCollection<NavigationItem>({
  key: 'admin-shell/navigation-primary',
})

export const headerActions = defineUiSlot({
  key: 'admin-shell/header-actions',
  cardinality: 'many',
})

import { uiTextSchema, type UiText } from '@qualy/i18n-contract'
import { z } from 'zod'
import type { StandardSchemaV1 } from '@standard-schema/spec'

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
  // optional item validation, enforced by the registry at contribution
  // time so a malformed payload fails at its plugin, not in the browser
  readonly schema?: StandardSchemaV1
  // phantom member so T survives type inference; never assigned
  readonly __item?: T
}

export interface UiSlotToken {
  readonly kind: 'slot'
  readonly key: NamespacedId
  readonly cardinality: 'one' | 'many'
}

export function defineUiCollection<T>(options: {
  key: NamespacedId
  schema?: StandardSchemaV1
}): UiCollectionToken<T> {
  return { kind: 'collection', key: options.key, schema: options.schema }
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
  // never a display string: plugins name a translatable message, the layout
  // provider resolves it against the viewer's locale
  label: UiText
  pageId?: NamespacedId
  path?: string
  icon?: string
  order?: number
}

const navigationItemSchema = z.object({
  id: z.string().regex(NAMESPACED_ID),
  label: uiTextSchema,
  pageId: z.string().regex(NAMESPACED_ID).optional(),
  path: z.string().optional(),
  icon: z.string().optional(),
  order: z.number().optional(),
})

export const primaryNavigation = defineUiCollection<NavigationItem>({
  key: 'admin-shell/navigation-primary',
  schema: navigationItemSchema,
})

export const headerActions = defineUiSlot({
  key: 'admin-shell/header-actions',
  cardinality: 'many',
})

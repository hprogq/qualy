import { z } from 'zod'
import { uiTextSchema, type UiText } from '@qualy/i18n-contract'
import { NAMESPACED_ID, type NamespacedId } from './ids.ts'
import type { StandardSchemaV1 } from '@standard-schema/spec'

export type LayoutContractId = NamespacedId

export const ADMIN_SHELL: LayoutContractId = 'admin-shell/v1'
export const BLANK_SHELL: LayoutContractId = 'blank-shell/v1'

// collection surfaces carry structured data rendered by the layout itself
// (navigation, breadcrumbs, ...); slot surfaces carry contributed renderers
// a collection surface distinguishes what a plugin contributes from what
// the browser receives: the registry may resolve references (a navigation
// page id becomes the mounted path) before the item leaves the server
export interface UiCollectionToken<TContribution, TResolved = TContribution> {
  readonly kind: 'collection'
  readonly key: NamespacedId
  // optional item validation, enforced by the registry at contribution
  // time so a malformed payload fails at its plugin, not in the browser
  readonly schema?: StandardSchemaV1
  // phantom members so both types survive inference; never assigned
  readonly __item?: TContribution
  readonly __resolved?: TResolved
}

export interface UiSlotToken {
  readonly kind: 'slot'
  readonly key: NamespacedId
  readonly cardinality: 'one' | 'many'
}

export function defineUiCollection<TContribution, TResolved = TContribution>(options: {
  key: NamespacedId
  schema?: StandardSchemaV1
}): UiCollectionToken<TContribution, TResolved> {
  return { kind: 'collection', key: options.key, schema: options.schema }
}

export function defineUiSlot(options: {
  key: NamespacedId
  cardinality: 'one' | 'many'
}): UiSlotToken {
  return { kind: 'slot', key: options.key, cardinality: options.cardinality }
}

// --- admin-shell/v1 surfaces ---

// where a navigation entry leads. A page target names a page and the
// registry resolves it, so navigation never repeats a path and an entry
// whose page the viewer cannot see disappears with it. An external target
// leaves the app and never enters the router.
export type NavigationTarget =
  | { kind: 'page'; pageId: NamespacedId }
  | { kind: 'external'; href: string; newWindow?: boolean }

export interface NavigationItem {
  id: NamespacedId
  // never a display string: plugins name a translatable message, the layout
  // provider resolves it against the viewer's locale
  label: UiText
  target: NavigationTarget
  icon?: string
  order?: number
}

// what the browser receives: a page target has been resolved to the path
// the router mounts, so the shell never resolves ids itself
export type ResolvedNavigationTarget =
  | { kind: 'page'; pageId: NamespacedId; path: string }
  | { kind: 'external'; href: string; newWindow?: boolean }

export interface ResolvedNavigationItem extends Omit<NavigationItem, 'target'> {
  target: ResolvedNavigationTarget
}

// only same-document schemes may be linked; javascript: and data: are the
// classic injection vectors and never legitimate navigation
const EXTERNAL_HREF = /^(https?:\/\/|mailto:|tel:)/

const navigationItemSchema = z.object({
  id: z.string().regex(NAMESPACED_ID),
  label: uiTextSchema,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('page'), pageId: z.string().regex(NAMESPACED_ID) }),
    z.object({
      kind: z.literal('external'),
      href: z.string().regex(EXTERNAL_HREF, 'external links must be http(s), mailto or tel'),
      newWindow: z.boolean().optional(),
    }),
  ]),
  icon: z.string().optional(),
  order: z.number().optional(),
})

export const primaryNavigation = defineUiCollection<NavigationItem, ResolvedNavigationItem>({
  key: 'admin-shell/navigation-primary',
  schema: navigationItemSchema,
})

export const headerActions = defineUiSlot({
  key: 'admin-shell/header-actions',
  cardinality: 'many',
})

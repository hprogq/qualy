import { z } from 'zod'
import { uiTextSchema, type UiText } from '@qualy/i18n-contract'
import { NAMESPACED_ID, type NamespacedId } from './ids.ts'
import type { StandardSchemaV1 } from '@standard-schema/spec'

export type LayoutContractId = NamespacedId

/**
 * The shell every ordinary screen lives in: the applications across the top,
 * the sections of the current one under them, the page below.
 *
 * It was called the admin shell, which was never true - a student reading
 * their own result is in the same frame - and the name was quietly deciding
 * who the product was for.
 */
export const APP_SHELL: LayoutContractId = 'app-shell/v1'

/**
 * The shell for working inside one thing for a while: the same applications
 * across the top, then a bar naming what is being worked on and a rail of
 * everything that can be done to it.
 *
 * The distinction is not decoration. A rail of batch pages on a screen that
 * is not about a batch has nowhere to point, and a batch that is only ever a
 * path segment gives the reader nothing to hold on to.
 */
export const WORKSPACE_SHELL: LayoutContractId = 'workspace-shell/v1'
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

// --- app-shell/v1 and workspace-shell/v1 surfaces ---

// where a navigation entry leads. A page target names a page and the
// registry resolves it, so navigation never repeats a path and an entry
// whose page the viewer cannot see disappears with it. An external target
// leaves the app and never enters the router.
export type NavigationTarget =
  { kind: 'page'; pageId: NamespacedId } | { kind: 'external'; href: string; newWindow?: boolean }

// A sidebar section is registered, not enumerated: any plugin may declare
// one through the navigation-groups collection, and entries name it by its
// namespaced id - the same loose coupling page links use. An entry whose
// group nobody registered falls back to a loose top-level item, so a broken
// reference stays visible instead of vanishing.
export interface NavigationGroup {
  id: NamespacedId
  label: UiText
  order?: number
  // a group inside another group renders as a collapsible cluster under its
  // parent section; a top-level group is a plain section heading
  parent?: NamespacedId
  // an icon name from the layout's icon set, shown on cluster rows
  icon?: string
}

export interface NavigationItem {
  id: NamespacedId
  // never a display string: plugins name a translatable message, the layout
  // provider resolves it against the viewer's locale
  label: UiText
  target: NavigationTarget
  icon?: string
  order?: number
  // which sidebar section the entry sits in; absent means a loose top-level
  // entry above the sections
  group?: NamespacedId
  /**
   * An opaque workspace-capability token (namespaced, e.g.
   * 'assessment/review'). An entry carrying one renders only while the open
   * workspace publishes that token; the shell matches strings and knows
   * nothing else. The manifest already decided per-principal visibility -
   * this narrows it to "in the thing currently open". Absent means the
   * entry is capability-free and renders as before.
   */
  capability?: string
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
  group: z.string().regex(NAMESPACED_ID).optional(),
  capability: z.string().regex(NAMESPACED_ID).optional(),
})

const navigationGroupSchema = z.object({
  id: z.string().regex(NAMESPACED_ID),
  label: uiTextSchema,
  order: z.number().optional(),
  parent: z.string().regex(NAMESPACED_ID).optional(),
  icon: z.string().optional(),
})

/** what the whole product offers: applications, and the sections inside one */
export const primaryNavigation = defineUiCollection<NavigationItem, ResolvedNavigationItem>({
  key: 'app-shell/navigation-primary',
  schema: navigationItemSchema,
})

/**
 * Everything that can be done to the thing currently being worked on.
 *
 * A separate surface from the primary one because it answers a different
 * question - not "where in the product am I" but "what can I do here" - and
 * because its entries only mean anything while something is open: their paths
 * carry the parameters of the route the workspace is mounted at, which the
 * shell fills in from where the reader actually is.
 */
export const workspaceNavigation = defineUiCollection<NavigationItem, ResolvedNavigationItem>({
  key: 'workspace-shell/navigation',
  schema: navigationItemSchema,
})

/** the sections both navigations file their entries under */
export const navigationGroups = defineUiCollection<NavigationGroup>({
  key: 'app-shell/navigation-groups',
  schema: navigationGroupSchema,
})

/**
 * Collections whose entries name a page rather than a path.
 *
 * The registry resolves those to the path the router mounts, and drops an
 * entry whose page the viewer cannot see. Stated once here so a new
 * navigation surface cannot be added without the resolution following it.
 */
export const navigationCollections: readonly NamespacedId[] = [
  primaryNavigation.key,
  workspaceNavigation.key,
]

export const headerActions = defineUiSlot({
  key: 'app-shell/header-actions',
  cardinality: 'many',
})

// the end of the top bar: whoever owns sessions contributes the signed-in
// user card here, so the shell can place an account surface it knows nothing
// about
export const sidebarUser = defineUiSlot({
  key: 'app-shell/user-menu',
  cardinality: 'one',
})

/**
 * What is being worked on, said by whoever knows: the workspace shell renders
 * this above its rail and knows nothing about batches, courses or whatever
 * else a workspace turns out to be about.
 */
export const workspaceContext = defineUiSlot({
  key: 'workspace-shell/context',
  cardinality: 'one',
})

/**
 * A person, wherever a screen shows one.
 *
 * Any list that names people renders this instead of spelling out a name, so
 * that whoever owns people decides what a reader may learn about one and what
 * it takes to learn it. The context is what the naming screen already knows -
 * the identifier, and the name it was going to print anyway - so a table of a
 * hundred rows costs no requests until somebody asks about a row.
 *
 * Nothing is contributed here when the viewer may not read people, which is
 * what makes the plain name the fallback rather than a broken affordance.
 */
export const personCard = defineUiSlot({
  key: 'iam/person-card',
  cardinality: 'one',
})

/** what a screen hands the person card about the person it is naming */
export interface PersonCardContext {
  userId: string
  displayName: string
  businessNo?: string | null
}

/**
 * Choosing people, wherever a screen needs some.
 *
 * The plugin that owns people owns the picker: which people a reader may even
 * see is its question, not the asking screen's, and a screen that built its
 * own would be a second answer to it. What comes back is user ids - the
 * organizational tree is a way of finding people, never a thing that gets
 * selected on their behalf.
 */
export const peoplePicker = defineUiSlot({
  key: 'iam/people-picker',
  cardinality: 'one',
})

export interface PeoplePickerContext {
  /** the ids chosen so far; the picker is controlled by whoever opens it */
  value: readonly string[]
  onChange: (userIds: readonly string[]) => void
  /** at most one person, for the places that admit only one */
  single?: boolean
  /** people who cannot be chosen again, with the reason shown beside them */
  disabled?: readonly string[]
}

/**
 * Choosing a slice of the organization instead of naming people one by one.
 *
 * Units and kinds of people, which is a query - what it will do is the asking
 * screen's business, so it says how many people that would be and what the
 * button is called.
 */
export const peopleImportPicker = defineUiSlot({
  key: 'iam/people-import-picker',
  cardinality: 'one',
})

export interface PeopleImportContext {
  value: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] }
  onChange: (selection: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] }) => void
}

/**
 * Choosing one unit of the organization.
 *
 * The caller may pass the units it will accept - a batch offers the ones it
 * covers, not the whole tree - and gets the same tree rendering everywhere
 * either way.
 */
export const orgNodePicker = defineUiSlot({
  key: 'iam/org-node-picker',
  cardinality: 'one',
})

export interface OrgNodePickerContext {
  /** a set, because picking one unit and picking four is the same errand */
  value: readonly string[]
  onChange: (orgNodeIds: string[]) => void
  /**
   * One unit at a time, drawn without checkboxes.
   *
   * For pointing at a unit rather than collecting several - narrowing a list,
   * say. The room a checkbox takes is room a name does not have, and five
   * levels down a name is what is left of the row.
   */
  single?: boolean
  /**
   * As tall as the room it is in, rather than a box of its own size.
   *
   * For a picker standing beside something long - a filter next to a table -
   * where a short box leaves a column of nothing under it.
   */
  fill?: boolean
  /** shown as a toggle when given: this unit only, or everything under it */
  scope?: 'self' | 'subtree'
  onScopeChange?: (scope: 'self' | 'subtree') => void
  /** when absent, the picker offers everything the reader may administer */
  nodes?: readonly {
    id: string
    name: string
    parentId: string | null
    orgTypeId?: string
  }[]
  /**
   * Whether the supplied units are still on their way.
   *
   * An empty list and a list that has not arrived look identical, and the
   * second one drawn as the first is a box that grows into a tree and shoves
   * everything below it.
   */
  loading?: boolean
}

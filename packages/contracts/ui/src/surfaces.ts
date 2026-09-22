import { Schema } from 'effect'
import { UiTextSchema, type UiText } from '@qualy/i18n-contract'
import { NAMESPACED_ID, type NamespacedId } from './ids.ts'

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

/**
 * The shell for one person: the same applications across the top, then the
 * person - who they are, said by whoever owns people - and a rail of every
 * part of the product that has something to say about them, one page each.
 *
 * Its own contract rather than the workspace's because what is open is not a
 * place somebody works in for a while but a record somebody looks up. The
 * rail is registered, not enumerated: a plugin that keeps something per
 * person declares a page whose path carries `:userId` and files an entry
 * here, and a build without that plugin simply has no such entry.
 */
export const USER_DETAIL_SHELL: LayoutContractId = 'user-detail-shell/v1'
export const BLANK_SHELL: LayoutContractId = 'blank-shell/v1'

// collection surfaces carry structured data rendered by the layout itself
// (navigation, breadcrumbs, ...); slot surfaces carry contributed renderers
// a collection surface distinguishes what a plugin contributes from what
// the browser receives: the registry may resolve references (a navigation
// page id becomes the mounted path) before the item leaves the server
export interface UiCollectionToken<TContribution, TResolved = TContribution> {
  readonly kind: 'collection'
  readonly key: NamespacedId
  // The item's runtime schema, decoded by the registry when a plugin
  // contributes: a malformed item fails at its plugin, at boot, not in the
  // browser once the manifest has carried it there. A contribution names
  // the token, not the key, so the schema travels with it.
  //
  // Required. It was optional, and the one token that left it out was the one
  // a third-party plugin contributes to - so the single place where the item
  // comes from outside this repository was the single place nothing checked
  // what it looked like.
  readonly schema: Schema.Top
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
  schema: Schema.Top
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

const namespaced = Schema.String.check(Schema.isPattern(NAMESPACED_ID))

const navigationItemSchema = Schema.Struct({
  id: namespaced,
  label: UiTextSchema,
  target: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('page'), pageId: namespaced }),
    Schema.Struct({
      kind: Schema.Literal('external'),
      href: Schema.String.check(Schema.isPattern(EXTERNAL_HREF)),
      newWindow: Schema.optional(Schema.Boolean),
    }),
  ]),
  icon: Schema.optional(Schema.String),
  order: Schema.optional(Schema.Number),
  group: Schema.optional(namespaced),
  capability: Schema.optional(namespaced),
})

const navigationGroupSchema = Schema.Struct({
  id: namespaced,
  label: UiTextSchema,
  order: Schema.optional(Schema.Number),
  parent: Schema.optional(namespaced),
  icon: Schema.optional(Schema.String),
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

/**
 * The sections of one person's record.
 *
 * Entries name pages whose paths carry `:userId`, filled in by the shell from
 * where the reader is - the same arrangement as the workspace rail. Auth
 * files the person's own sections here; anything else that keeps something
 * per person (the rounds they took part in, what they were granted) files
 * its own, under a group of its own.
 */
export const userDetailNavigation = defineUiCollection<NavigationItem, ResolvedNavigationItem>({
  key: 'iam/user-detail-navigation',
  schema: navigationItemSchema,
})

/** the sections every navigation files its entries under */
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
  userDetailNavigation.key,
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
 * Who is signed in, at the head of the narrow shell's navigation drawer.
 *
 * The drawer is the shell's, the person is not: whoever owns sessions
 * contributes the identity block here, the same way the top bar's account
 * corner works, and a build without an identity owner simply has no header.
 */
export const drawerIdentity = defineUiSlot({
  key: 'app-shell/drawer-identity',
  cardinality: 'one',
})

/** account preferences on the drawer's foot: appearance, language */
export const drawerAccount = defineUiSlot({
  key: 'app-shell/drawer-account',
  cardinality: 'one',
})

/** the way out, standing at the end of the drawer's last row */
export const drawerSignOut = defineUiSlot({
  key: 'app-shell/drawer-sign-out',
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
 * A live count beside a rail entry.
 *
 * The number cannot come with the entry: navigation is a manifest projection
 * computed once per reader, and "how many are waiting for me" changes while
 * they work. So the shell renders a slot next to each entry and passes it the
 * entry's id; whoever owns that page answers for its own count and nothing
 * else, and an entry nobody answers for simply has no badge.
 */
export const workspaceNavigationBadge = defineUiSlot({
  key: 'workspace-shell/navigation-badge',
  cardinality: 'many',
})

/**
 * The same, beside a section of one person's record.
 *
 * Its own token rather than the workspace's: the two rails hold different
 * entries, and one slot for both would put a round's queue count beside
 * somebody's profile.
 */
export const userDetailNavigationBadge = defineUiSlot({
  key: 'user-detail-shell/navigation-badge',
  cardinality: 'many',
})

/** what the shell hands a badge: which rail entry it is standing beside */
export interface NavigationBadgeContext {
  readonly navigationId: string
}

/**
 * Who the open person is, said by whoever owns people.
 *
 * The user-detail shell renders this above its rail and knows nothing about
 * people: the contribution reads the person from the route it is mounted at,
 * the same way the pages beside it do. Nothing else is handed down - the one
 * thing every section shares is the id in the address, and a richer context
 * would be a second, unwritten contract about what a person is.
 */
export const userDetailHeader = defineUiSlot({
  key: 'iam/user-detail-header',
  cardinality: 'one',
})

/**
 * Explaining a grant that is confined to one object.
 *
 * Authorization knows such a grant names a `namespace/type/id` and nothing
 * more; only the plugin that owns that kind of object knows what it is
 * called, where it is administered and how the grant comes to be withdrawn.
 * A presenter is that plugin's answer, keyed by the kind it speaks for. The
 * screen that lists grants looks the kind up here and renders exactly the
 * one renderer it names - not every renderer in the slot - and falls back to
 * its own plain words when nobody has registered one.
 */
export interface ResourceGrantPresenter {
  id: NamespacedId
  namespace: string
  type: string
  /** the item id of this presenter's renderer in the resource-grant-renderer slot */
  renderer: NamespacedId
}

export const resourceGrantPresenters = defineUiCollection<ResourceGrantPresenter>({
  key: 'iam/resource-grant-presenters',
  schema: Schema.Struct({
    id: namespaced,
    namespace: Schema.String.check(Schema.isMinLength(1)),
    type: Schema.String.check(Schema.isMinLength(1)),
    renderer: namespaced,
  }),
})

/** where the renderers a presenter names are registered, by item id */
export const resourceGrantRenderer = defineUiSlot({
  key: 'iam/resource-grant-renderer',
  cardinality: 'many',
})

/** what the grants screen hands a renderer: the grant, as far as authorization knows it */
export interface ResourceGrantContext {
  readonly grant: {
    readonly id: string
    readonly roleName: string
    readonly resource: { readonly namespace: string; readonly type: string; readonly id: string }
    readonly validFrom: string | null
    readonly validUntil: string | null
  }
}

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
 * The picker's shell, with nobody in it.
 *
 * `peoplePicker` above answers two questions at once - what choosing people
 * looks like, and which people exist to be chosen - and the second one binds
 * it to the directory. A screen choosing within a narrower population than
 * the directory (this round's participants, say) needs the first answer and
 * must not take the second: its population is the one it may act on, which
 * is a smaller and differently-authorized set.
 *
 * So this surface is the drawing alone. It fetches nothing, decides nothing
 * about who may be seen, and is therefore visible to anyone signed in; the
 * screen that mounts it has already asked its own server for a page of
 * people it is allowed to show, and hands it over. Choosing here never
 * authorizes anything - what comes back is a list of ids that the write is
 * expected to prove all over again.
 */
export const peoplePickerView = defineUiSlot({
  key: 'iam/people-picker-view',
  cardinality: 'one',
})

export interface PeoplePickerViewContext {
  /** the units this reader may look in, however the caller found them */
  nodes: readonly { id: string; name: string; parentId: string | null }[]
  /** the tree is only part of what exists, and says so */
  nodesTruncated?: boolean
  /** the kinds of people the list may be narrowed to */
  userTypes: readonly { id: string; name: string }[]
  /** the page standing where the reader is looking, already authorized */
  rows: readonly {
    id: string
    displayName: string
    businessNo: string | null
    userTypeName: string | null
  }[]

  /** where the reader is looking, and how the caller is querying it */
  nodeId: string | null
  scope: 'self' | 'subtree'
  userTypeId: string
  /** the search the caller is querying on, not what is being typed */
  search: string

  /** the ids chosen so far, across every page the caller has served */
  value: readonly string[]
  /** at most one person, for the places that admit only one */
  single?: boolean
  /** people who cannot be chosen, and the word shown beside them */
  disabled?: readonly string[]
  disabledLabel?: string

  pending: boolean
  /** why the page could not be read, already in the reader's language */
  error?: string | null
  hasPrevious: boolean
  hasNext: boolean

  onNodeChange: (nodeId: string) => void
  onScopeChange: (scope: 'self' | 'subtree') => void
  onUserTypeChange: (userTypeId: string) => void
  /** the caller is told once the typing has settled, not per keystroke */
  onSearchChange: (search: string) => void
  onToggle: (userId: string) => void
  onPrevious: () => void
  onNext: () => void
  onRetry: () => void
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
/**
 * Where the users screen offers whatever else can be done with people as a
 * whole: an import, an export. Rendered beside its own create button; a
 * contribution gets the unit the reader is looking at, when there is one.
 */
export const usersPageActions = defineUiSlot({
  key: 'iam/users-actions',
  cardinality: 'many',
})

export interface UsersPageActionsContext {
  /** the unit the list is anchored at, or null while none is chosen */
  readonly anchorNodeId: string | null
}

export const orgNodePicker = defineUiSlot({
  key: 'iam/org-node-picker',
  cardinality: 'one',
})

/** a unit as the picker hands it back: what it is called, and where it sits */
export interface PickedOrgNode {
  readonly id: string
  readonly name: string
  /** the names from the top down, joined the way the product writes a path */
  readonly path: string
}

export interface OrgNodePickerContext {
  /** a set, because picking one unit and picking four is the same errand */
  value: readonly string[]
  /**
   * The chosen units, by id and named.
   *
   * The names come with them because only the picker knows them: a caller
   * outside the organization plugin holds an id and no way to read it back,
   * and a screen that has to echo what was chosen - "everyone goes under
   * 软件学院" - cannot do it from an id alone.
   */
  onChange: (orgNodeIds: string[], picked: readonly PickedOrgNode[]) => void
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
  /**
   * Units that are shown and cannot be chosen, each with why in a word.
   *
   * For choosing where something may go: the tree is only readable whole, so
   * a place that is not allowed stays in it, saying why it is not, rather
   * than leaving a hole where the reader expected to find it.
   */
  disabled?: Readonly<Record<string, string>>
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

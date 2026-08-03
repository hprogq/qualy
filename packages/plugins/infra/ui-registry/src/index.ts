import { implement } from '@orpc/server'
import { Context, Service } from 'cordis'
import {
  assertNamespacedId,
  isVisibleTo,
  uiVisibilitySchema,
  type LayoutContractId,
  type NamespacedId,
  type NavigationItem,
  type PageRef,
  type ResolvedNavigationItem,
  type UiCollectionToken,
  type UiSlotToken,
  type UiVisibility,
  type ViewerAccess,
} from '@qualy/ui-contract'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { uiTextSchema, type UiText } from '@qualy/i18n-contract'
import { primaryNavigation } from '@qualy/ui-contract'
import type { ApiContext, AuthPrincipal } from '@qualy/plugin-server'
import { uiContract } from './contract.ts'

declare module 'cordis' {
  interface Context {
    ui: UiRegistry
  }
}

// a page is one routable main content unit: the shared page reference says
// which screen it is, the component implements it and the layout CONTRACT
// (never a concrete implementation) frames it. Visibility is mandatory: a
// registration cannot become public by forgetting a field.
export interface PageDecl {
  page: PageRef
  component: string
  layout: LayoutContractId
  visibility: UiVisibility
  // sugar: most pages also register one primary navigation entry, which
  // inherits the page's visibility and disappears with it
  navigation?: { label: UiText; icon?: string; order?: number }
}

// a concrete implementation of a layout contract, shipped by a layout plugin
export interface LayoutProvider {
  contract: LayoutContractId
  provider: NamespacedId
  component: string
}

export interface CollectionContribution<T> {
  id: NamespacedId
  value: T
  visibility: UiVisibility
  order?: number
}

export interface SlotContribution {
  id: NamespacedId
  component: string
  visibility: UiVisibility
  order?: number
}

const assertId = assertNamespacedId

// payloads that travel through the manifest are validated where they are
// contributed: a plugin shipping a bare display string as a label fails at
// load time instead of surfacing untranslatable text in the browser
const assertShape = (schema: StandardSchemaV1, value: unknown, what: string) => {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) throw new Error(`${what}: async validation is not supported`)
  if (result.issues) {
    const detail = result.issues.map((issue) => issue.message).join('; ')
    throw new Error(`${what} is malformed: ${detail}`)
  }
}

const assertUiText = (value: UiText, what: string) => {
  assertShape(uiTextSchema, value, what)
}

// resolves which permission codes a viewer holds. rbac registers one; with
// no authorizer present every permission-gated surface stays invisible, so
// removing the authorization plugin hides capabilities rather than exposing
// them.
export type UiAuthorizer = (principal: AuthPrincipal) => Promise<Iterable<string>>

export default class UiRegistry extends Service {
  static inject = ['server']

  private pages = new Map<NamespacedId, PageDecl>()
  private pagePaths = new Map<string, NamespacedId>()
  private layouts = new Map<LayoutContractId, LayoutProvider>()
  private collections = new Map<string, Map<string, CollectionContribution<unknown>>>()
  private slots = new Map<string, Map<string, SlotContribution>>()
  // stable box: reassigning a service property from a caller-traceable
  // closure does not stick (see notes/cordis.md)
  private authorizerSlot: { resolve?: UiAuthorizer } = {}

  constructor(ctx: Context) {
    super(ctx, 'ui')
    const impl = implement(uiContract).$context<ApiContext>()
    ctx.server.contribute(
      'ui',
      impl.router({
        // anonymous callers are served on purpose: the login page and every
        // other public surface is discovered through this same manifest
        getManifest: impl.getManifest.handler(({ context }) => this.build(context.principal)),
      }),
    )
  }

  // single slot, revoked with the registrant's fiber: the authorization
  // plugin owns the mapping from principal to permission codes
  setAuthorizer(resolve: UiAuthorizer) {
    const slot = this.authorizerSlot
    return this.ctx.effect(() => {
      if (slot.resolve) throw new Error('ui authorizer already registered')
      slot.resolve = resolve
      return () => {
        if (slot.resolve === resolve) slot.resolve = undefined
      }
    }, 'ui-authorizer')
  }

  addPage(decl: PageDecl) {
    const { id, path } = decl.page
    assertId(decl.layout, 'layout contract')
    assertShape(uiVisibilitySchema, decl.visibility, `page ${id} visibility`)
    if (decl.navigation) assertUiText(decl.navigation.label, `page ${id} navigation label`)
    return this.ctx.effect(() => {
      if (this.pages.has(id)) throw new Error(`page id conflict: ${id}`)
      if (this.pagePaths.has(path)) throw new Error(`page path conflict: ${path}`)
      this.pages.set(id, decl)
      this.pagePaths.set(path, id)
      const disposeNav = decl.navigation
        ? this.registerContribution(this.collections, primaryNavigation.key, {
            id: `${id}/nav` as NamespacedId,
            order: decl.navigation.order,
            // the entry inherits the page's visibility: a protected page can
            // never grow a public navigation item
            visibility: decl.visibility,
            value: {
              id: `${id}/nav`,
              target: { kind: 'page', pageId: id },
              label: decl.navigation.label,
              icon: decl.navigation.icon,
              order: decl.navigation.order,
            } satisfies NavigationItem,
          })
        : undefined
      return () => {
        disposeNav?.()
        this.pages.delete(id)
        this.pagePaths.delete(path)
      }
    }, `page:${id}`)
  }

  // one active provider per layout contract; a second registration is a
  // configuration error (multi-provider selection is deferred until a second
  // layout implementation exists)
  registerLayout(layout: LayoutProvider) {
    assertId(layout.contract, 'layout contract')
    assertId(layout.provider, 'layout provider')
    return this.ctx.effect(() => {
      if (this.layouts.has(layout.contract)) {
        throw new Error(`layout provider conflict for ${layout.contract}`)
      }
      this.layouts.set(layout.contract, layout)
      return () => {
        this.layouts.delete(layout.contract)
      }
    }, `layout:${layout.contract}`)
  }

  // contributions are order-independent across plugins: the token itself is
  // the contract, unknown keys simply never render
  contribute<TContribution>(
    token: UiCollectionToken<TContribution, unknown>,
    contribution: CollectionContribution<TContribution>,
  ): void
  contribute(token: UiSlotToken, contribution: SlotContribution): void
  contribute(
    token: UiCollectionToken<unknown, unknown> | UiSlotToken,
    contribution: CollectionContribution<unknown> | SlotContribution,
  ) {
    assertId(contribution.id, 'contribution id')
    assertShape(uiVisibilitySchema, contribution.visibility, `contribution ${contribution.id} visibility`)
    if (token.kind === 'collection' && token.schema) {
      assertShape(
        token.schema,
        (contribution as CollectionContribution<unknown>).value,
        `contribution ${contribution.id}`,
      )
    }
    if (token.kind === 'collection') {
      return this.registerContribution(
        this.collections,
        token.key,
        contribution as CollectionContribution<unknown>,
      )
    }
    return this.ctx.effect(() => {
      const store = this.slots.get(token.key) ?? new Map<string, SlotContribution>()
      if (!this.slots.has(token.key)) this.slots.set(token.key, store)
      if (store.has(contribution.id)) {
        throw new Error(`slot contribution conflict: ${contribution.id}`)
      }
      if (token.cardinality === 'one' && store.size > 0) {
        throw new Error(`slot ${token.key} accepts a single contribution`)
      }
      store.set(contribution.id, contribution as SlotContribution)
      return () => {
        store.delete(contribution.id)
      }
    }, `slot:${token.key}:${contribution.id}`)
  }

  private registerContribution(
    target: Map<string, Map<string, CollectionContribution<unknown>>>,
    key: string,
    contribution: CollectionContribution<unknown>,
  ) {
    return this.ctx.effect(() => {
      const store = target.get(key) ?? new Map<string, CollectionContribution<unknown>>()
      if (!target.has(key)) target.set(key, store)
      if (store.has(contribution.id)) {
        throw new Error(`collection contribution conflict: ${contribution.id}`)
      }
      store.set(contribution.id, contribution)
      return () => {
        store.delete(contribution.id)
      }
    }, `collection:${key}:${contribution.id}`)
  }

  // the manifest is an authorized projection: one rbac profile lookup per
  // request decides which surfaces the viewer may DISCOVER. Hiding a page is
  // never authorization — every api call is authorized on its own — but a
  // viewer must not learn that a capability, its route or its component even
  // exists. Internal declarations (visibility, permission codes) never leave.
  private async build(principal?: AuthPrincipal) {
    const viewer = await this.viewerAccess(principal)
    const sorted = <T extends { order?: number; id: string }>(items: T[]) =>
      [...items].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id))

    const pages = [...this.pages.values()].filter((decl) => {
      if (!isVisibleTo(decl.visibility, viewer)) return false
      if (this.layouts.has(decl.layout)) return true
      this.ctx.logger.warn('page %s dropped: no provider for layout %s', decl.page.id, decl.layout)
      return false
    })
    const visiblePages = new Map(pages.map((decl) => [decl.page.id, decl]))

    const collections: Record<string, unknown[]> = {}
    for (const [key, store] of this.collections) {
      const items = sorted([...store.values()])
        .filter((entry) => isVisibleTo(entry.visibility, viewer))
        .map((entry) => entry.value)
        .map((value) => {
          if (key !== primaryNavigation.key) return value
          const item = value as NavigationItem
          if (item.target.kind === 'external') return item as ResolvedNavigationItem
          // a page target resolves to the path the router mounts, and drops
          // out entirely when the viewer cannot see that page
          const page = visiblePages.get(item.target.pageId)
          return page
            ? ({
                ...item,
                target: { kind: 'page', pageId: page.page.id, path: page.page.path },
              } satisfies ResolvedNavigationItem)
            : undefined
        })
        .filter((value) => value !== undefined)
      if (items.length > 0) collections[key] = items
    }

    const slots: Record<string, { id: string; component: string; order: number }[]> = {}
    for (const [key, store] of this.slots) {
      const items = sorted([...store.values()])
        .filter((entry) => isVisibleTo(entry.visibility, viewer))
        .map((entry) => ({ id: entry.id, component: entry.component, order: entry.order ?? 99 }))
      if (items.length > 0) slots[key] = items
    }

    // only the layouts the surviving pages actually need
    const usedLayouts = new Set(pages.map((decl) => decl.layout))
    return {
      layouts: [...this.layouts.values()]
        .filter((layout) => usedLayouts.has(layout.contract))
        .sort((a, b) => a.contract.localeCompare(b.contract)),
      pages: pages.map((decl) => ({
        id: decl.page.id,
        path: decl.page.path,
        component: decl.component,
        layout: decl.layout,
      })),
      collections,
      slots,
    }
  }

  // one authorizer call covers every permission-gated surface of a request;
  // an org-scope permission held at any anchor makes its page discoverable,
  // and that page's own api still decides which nodes the viewer may touch
  private async viewerAccess(principal?: AuthPrincipal): Promise<ViewerAccess> {
    if (!principal) return { authenticated: false, permissions: new Set() }
    const resolve = this.authorizerSlot.resolve
    // fail closed: without an authorizer a signed-in viewer still sees only
    // public and authenticated surfaces
    if (!resolve) return { authenticated: true, permissions: new Set() }
    return { authenticated: true, permissions: new Set(await resolve(principal)) }
  }
}

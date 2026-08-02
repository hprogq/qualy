import { implement } from '@orpc/server'
import { Context, Service } from 'cordis'
import {
  NAMESPACED_ID,
  type LayoutContractId,
  type NamespacedId,
  type NavigationItem,
  type UiCollectionToken,
  type UiSlotToken,
} from '@qualy/ui-contract'
import { primaryNavigation } from '@qualy/ui-contract'
import type { ApiContext } from '@qualy/plugin-server'
import { uiContract } from './contract.ts'

declare module 'cordis' {
  interface Context {
    ui: UiRegistry
  }
}

// a page is one routable main content unit: exactly one main component,
// rendered inside the layout CONTRACT it references (never a concrete
// layout implementation)
export interface PageDecl {
  id: NamespacedId
  path: string
  component: string
  layout: LayoutContractId
  public?: boolean
  permission?: string
  // sugar: most pages also register one primary navigation entry
  navigation?: { label: string; icon?: string; order?: number }
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
  order?: number
}

export interface SlotContribution {
  id: NamespacedId
  component: string
  order?: number
}

const assertId = (id: string, what: string) => {
  if (!NAMESPACED_ID.test(id)) {
    throw new Error(`${what} "${id}" must be a namespaced id like "plugin/name"`)
  }
}

export default class UiRegistry extends Service {
  static inject = ['server']

  private pages = new Map<NamespacedId, PageDecl>()
  private pagePaths = new Map<string, NamespacedId>()
  private layouts = new Map<LayoutContractId, LayoutProvider>()
  private collections = new Map<string, Map<string, CollectionContribution<unknown>>>()
  private slots = new Map<string, Map<string, SlotContribution>>()

  constructor(ctx: Context) {
    super(ctx, 'ui')
    const impl = implement(uiContract).$context<ApiContext>()
    ctx.server.contribute(
      'ui',
      impl.router({
        getManifest: impl.getManifest.handler(() => this.build()),
      }),
    )
  }

  addPage(page: PageDecl) {
    assertId(page.id, 'page id')
    assertId(page.layout, 'layout contract')
    return this.ctx.effect(() => {
      if (this.pages.has(page.id)) throw new Error(`page id conflict: ${page.id}`)
      if (this.pagePaths.has(page.path)) throw new Error(`page path conflict: ${page.path}`)
      this.pages.set(page.id, page)
      this.pagePaths.set(page.path, page.id)
      const disposeNav = page.navigation
        ? this.registerContribution(this.collections, primaryNavigation.key, {
            id: `${page.id}/nav` as NamespacedId,
            order: page.navigation.order,
            value: {
              id: `${page.id}/nav`,
              pageId: page.id,
              label: page.navigation.label,
              icon: page.navigation.icon,
              order: page.navigation.order,
            } satisfies NavigationItem,
          })
        : undefined
      return () => {
        disposeNav?.()
        this.pages.delete(page.id)
        this.pagePaths.delete(page.path)
      }
    }, `page:${page.id}`)
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
  contribute<T>(token: UiCollectionToken<T>, contribution: CollectionContribution<T>): void
  contribute(token: UiSlotToken, contribution: SlotContribution): void
  contribute(
    token: UiCollectionToken<unknown> | UiSlotToken,
    contribution: CollectionContribution<unknown> | SlotContribution,
  ) {
    assertId(contribution.id, 'contribution id')
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

  // deterministic authorized projection: internal declarations (permission,
  // public) never leave the server; navigation items resolve page ids to
  // paths and silently drop entries whose page is absent
  private build() {
    const sorted = <T extends { order?: number; id: string }>(items: T[]) =>
      [...items].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id))

    const pages = [...this.pages.values()].filter((page) => {
      if (this.layouts.has(page.layout)) return true
      this.ctx.logger.warn('page %s dropped: no provider for layout %s', page.id, page.layout)
      return false
    })

    const collections: Record<string, unknown[]> = {}
    for (const [key, store] of this.collections) {
      const items = sorted([...store.values()])
        .map((entry) => entry.value)
        .map((value) => {
          if (key !== primaryNavigation.key) return value
          const item = value as NavigationItem
          if (!item.pageId) return item.path ? item : undefined
          const page = this.pages.get(item.pageId)
          return page ? { ...item, path: page.path } : undefined
        })
        .filter((value) => value !== undefined)
      if (items.length > 0) collections[key] = items
    }

    const slots: Record<string, { id: string; component: string; order: number }[]> = {}
    for (const [key, store] of this.slots) {
      const items = sorted([...store.values()]).map((entry) => ({
        id: entry.id,
        component: entry.component,
        order: entry.order ?? 99,
      }))
      if (items.length > 0) slots[key] = items
    }

    return {
      layouts: [...this.layouts.values()].sort((a, b) => a.contract.localeCompare(b.contract)),
      pages: pages.map((page) => ({
        id: page.id,
        path: page.path,
        component: page.component,
        layout: page.layout,
      })),
      collections,
      slots,
    }
  }
}

import { implement } from '@orpc/server'
import { Context, Service } from 'cordis'
import type { ApiContext } from '@qualy/plugin-server'
import { uiContract } from './contract.ts'

declare module 'cordis' {
  interface Context {
    ui: UiRegistry
  }
}

export interface PageDecl {
  path: string
  component: string
  layout: 'admin' | 'blank'
  public?: boolean
  permission?: string
  nav?: { label: string; icon?: string; order?: number }
}

export default class UiRegistry extends Service {
  static inject = ['server']

  private pages = new Map<string, PageDecl>()

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
    return this.ctx.effect(() => {
      if (this.pages.has(page.path)) throw new Error(`page path conflict: ${page.path}`)
      this.pages.set(page.path, page)
      return () => {
        this.pages.delete(page.path)
      }
    }, `page:${page.path}`)
  }

  // pages keep registration order (Map insertion order is deterministic),
  // nav is additionally sorted by order then path so output stays diff-stable
  private build() {
    const visible = [...this.pages.values()] // RBAC filtering lands in P1
    return {
      pages: visible.map(({ nav, ...page }) => page),
      nav: visible
        .filter((page) => page.nav)
        .map((page) => ({ path: page.path, ...page.nav! }))
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.path.localeCompare(b.path)),
    }
  }
}

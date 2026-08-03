import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { literal, message } from '@qualy/i18n-contract'
import { headerActions, primaryNavigation } from '@qualy/ui-contract'
import Server from '@qualy/plugin-server'
import UiRegistry, { type PageDecl } from '../src/index.ts'

const page: PageDecl = {
  id: 'demo/page',
  path: '/demo',
  component: 'demo/DemoPage',
  layout: 'admin-shell/v1',
}

describe('plugin-ui-registry', () => {
  it('composes layouts, pages, navigation and slots with full revocation', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    await ctx.plugin(UiRegistry)
    const manifestUrl = `http://127.0.0.1:${ctx.server.port}/api/ui/manifest`
    const manifest = async () =>
      (await (await fetch(manifestUrl)).json()) as {
        layouts: { contract: string; component: string }[]
        pages: { id: string; path: string }[]
        collections: Record<string, { id: string; path?: string }[]>
        slots: Record<string, { id: string; component: string }[]>
      }

    // a page without an active layout provider never reaches the manifest
    const orphan = ctx.plugin({
      name: 'orphan',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.addPage({
          ...page,
          navigation: { label: message('demo/navigation/demo', 'Demo'), order: 1 },
        })
      },
    })
    await orphan
    expect((await manifest()).pages).toEqual([])

    const layout = ctx.plugin({
      name: 'layout',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.registerLayout({
          contract: 'admin-shell/v1',
          provider: 'test/admin',
          component: 'test/AdminShell',
        })
      },
    })
    await layout
    const withLayout = await manifest()
    expect(withLayout.layouts).toEqual([
      { contract: 'admin-shell/v1', provider: 'test/admin', component: 'test/AdminShell' },
    ])
    expect(withLayout.pages.map((entry) => entry.id)).toEqual(['demo/page'])
    // the navigation sugar resolved the page id to its path
    expect(withLayout.collections[primaryNavigation.key]).toEqual([
      {
        id: 'demo/page/nav',
        pageId: 'demo/page',
        // manifests carry a message reference, never a display string
        label: { kind: 'message', id: 'demo/navigation/demo', defaultMessage: 'Demo' },
        order: 1,
        path: '/demo',
      },
    ])

    // internal declarations never leave the server
    const raw = withLayout.pages[0] as Record<string, unknown>
    expect(raw.permission).toBeUndefined()
    expect(raw.public).toBeUndefined()

    // duplicate ids and paths fail loudly
    const conflicting = ctx.plugin({
      name: 'conflict',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.addPage({ ...page, id: 'other/page' })
      },
    })
    await expect(Promise.resolve(conflicting)).rejects.toThrow('page path conflict')

    // slot contributions order deterministically and revoke with their fiber
    const slots = ctx.plugin({
      name: 'slots',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.contribute(headerActions, {
          id: 'demo/second',
          component: 'demo/Second',
          order: 200,
        })
        child.ui.contribute(headerActions, {
          id: 'demo/first',
          component: 'demo/First',
          order: 100,
        })
      },
    })
    await slots
    expect((await manifest()).slots[headerActions.key]!.map((item) => item.id)).toEqual([
      'demo/first',
      'demo/second',
    ])
    await slots.dispose()
    expect((await manifest()).slots[headerActions.key]).toBeUndefined()

    await orphan.dispose()
    const empty = await manifest()
    expect(empty.pages).toEqual([])
    expect(empty.collections[primaryNavigation.key]).toBeUndefined()

    await serverFiber.dispose()
  })

  it('rejects malformed ids and layout provider conflicts', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    await ctx.plugin(UiRegistry)

    const badId = ctx.plugin({
      name: 'bad-id',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.addPage({ ...page, id: 'NoNamespace' as never })
      },
    })
    await expect(Promise.resolve(badId)).rejects.toThrow('namespaced id')

    await ctx.plugin({
      name: 'layout-a',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.registerLayout({
          contract: 'admin-shell/v1',
          provider: 'a/admin',
          component: 'a/AdminShell',
        })
      },
    })
    const second = ctx.plugin({
      name: 'layout-b',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.registerLayout({
          contract: 'admin-shell/v1',
          provider: 'b/admin',
          component: 'b/AdminShell',
        })
      },
    })
    await expect(Promise.resolve(second)).rejects.toThrow('layout provider conflict')

    await serverFiber.dispose()
  })

  it('rejects malformed collection contributions at registration time', async () => {
    const ctx = new Context()
    await ctx.plugin(Server, { port: 0 })
    await ctx.plugin(UiRegistry)
    // a bare display string as a navigation label never reaches the browser
    const bareLabel = ctx.plugin({
      name: 'bad-label',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.contribute(primaryNavigation, {
          id: 'bad/nav',
          value: { id: 'bad/nav', label: 'Plain text' as never, path: '/bad' },
        })
      },
    })
    await expect(Promise.resolve(bareLabel)).rejects.toThrow('malformed')
    // an unnamespaced message id is refused the same way
    const badId = ctx.plugin({
      name: 'bad-id',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.contribute(primaryNavigation, {
          id: 'bad2/nav',
          value: {
            id: 'bad2/nav',
            label: { kind: 'message', id: 'nonamespace', defaultMessage: 'x' },
            path: '/bad2',
          },
        })
      },
    })
    await expect(Promise.resolve(badId)).rejects.toThrow('malformed')
    // business data passes through as literal text
    await ctx.plugin({
      name: 'good-literal',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.contribute(primaryNavigation, {
          id: 'good/nav',
          value: { id: 'good/nav', label: literal('大连外国语大学'), path: '/good' },
        })
      },
    })
    await ctx.fiber.dispose()
  })
})

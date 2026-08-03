import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { literal, message } from '@qualy/i18n-contract'
import {
  ADMIN_SHELL,
  AUTHENTICATED,
  BLANK_SHELL,
  definePage,
  headerActions,
  permissionOf,
  primaryNavigation,
  PUBLIC,
} from '@qualy/ui-contract'
import Server, { type AuthPrincipal } from '@qualy/plugin-server'
import UiRegistry, { type PageDecl } from '../src/index.ts'

const publicPage = definePage({ id: 'demo/public', path: '/demo' })
const memberPage = definePage({ id: 'demo/member', path: '/demo/member' })
const guardedPage = definePage({ id: 'demo/guarded', path: '/demo/guarded' })

const page: PageDecl = {
  page: publicPage,
  component: 'demo/DemoPage',
  layout: ADMIN_SHELL,
  visibility: PUBLIC,
}

interface ManifestShape {
  layouts: { contract: string; component: string }[]
  pages: { id: string; path: string; component: string; layout: string }[]
  collections: Record<string, { id: string; target?: unknown; label?: unknown }[]>
  slots: Record<string, { id: string; component: string }[]>
}

describe('plugin-ui-registry', () => {
  // the test principal is injected the same way the auth enricher does it
  const principalBox: { current?: AuthPrincipal } = {}
  const principal: AuthPrincipal = { tenantId: 't1', userId: 'u1', sessionId: 's1' }

  const startHost = async () => {
    const ctx = new Context()
    await ctx.plugin(Server, { port: 0 })
    await ctx.plugin(UiRegistry)
    await ctx.plugin({
      name: 'test-principal',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.enrich('test-principal', (context) => {
          context.principal = principalBox.current
        })
      },
    })
    const url = `http://127.0.0.1:${ctx.server.port}/api/app/manifest`
    const manifest = async (as?: AuthPrincipal): Promise<ManifestShape> => {
      principalBox.current = as
      try {
        return (await (await fetch(url)).json()) as ManifestShape
      } finally {
        principalBox.current = undefined
      }
    }
    return { ctx, manifest }
  }

  const withLayouts = (ctx: Context) =>
    ctx.plugin({
      name: 'layouts',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.registerLayout({
          contract: ADMIN_SHELL,
          provider: 'demo/admin',
          component: 'demo/AdminShell',
        })
        child.ui.registerLayout({
          contract: BLANK_SHELL,
          provider: 'demo/blank',
          component: 'demo/BlankShell',
        })
      },
    })

  it('composes layouts, pages, navigation and slots with full revocation', async () => {
    const { ctx, manifest } = await startHost()
    // a page whose layout has no provider never reaches the browser
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

    await withLayouts(ctx)
    const withLayout = await manifest()
    expect(withLayout.pages).toEqual([
      { id: 'demo/public', path: '/demo', component: 'demo/DemoPage', layout: ADMIN_SHELL },
    ])
    // navigation carries a resolved page target, never a copied path string
    expect(withLayout.collections[primaryNavigation.key]).toEqual([
      {
        id: 'demo/public/nav',
        label: { kind: 'message', id: 'demo/navigation/demo', defaultMessage: 'Demo' },
        order: 1,
        target: { kind: 'page', pageId: 'demo/public', path: '/demo' },
      },
    ])
    // only the layout an actual page needs is published
    expect(withLayout.layouts.map((layout) => layout.contract)).toEqual([ADMIN_SHELL])
    // internal declarations never leave the server
    expect(JSON.stringify(withLayout)).not.toContain('visibility')
    expect(JSON.stringify(withLayout)).not.toContain('permission')

    await orphan.dispose()
    const revoked = await manifest()
    expect(revoked.pages).toEqual([])
    expect(revoked.collections[primaryNavigation.key]).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('projects the manifest by visibility and viewer', async () => {
    const { ctx, manifest } = await startHost()
    await withLayouts(ctx)
    await ctx.plugin({
      name: 'surfaces',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.addPage({
          page: publicPage,
          component: 'demo/PublicPage',
          layout: BLANK_SHELL,
          visibility: PUBLIC,
        })
        child.ui.addPage({
          page: memberPage,
          component: 'demo/MemberPage',
          layout: ADMIN_SHELL,
          visibility: AUTHENTICATED,
          navigation: { label: message('demo/navigation/member', 'Member'), order: 2 },
        })
        child.ui.addPage({
          page: guardedPage,
          component: 'demo/GuardedPage',
          layout: ADMIN_SHELL,
          visibility: permissionOf('demo.thing.read'),
          navigation: { label: message('demo/navigation/guarded', 'Guarded'), order: 3 },
        })
        child.ui.contribute(headerActions, {
          id: 'demo/anon-action',
          component: 'demo/AnonAction',
          visibility: PUBLIC,
        })
        child.ui.contribute(headerActions, {
          id: 'demo/member-action',
          component: 'demo/MemberAction',
          visibility: AUTHENTICATED,
        })
      },
    })

    // anonymous: public only, and no trace of the protected surfaces
    const anonymous = await manifest()
    expect(anonymous.pages.map((entry) => entry.id)).toEqual(['demo/public'])
    expect(anonymous.collections[primaryNavigation.key]).toBeUndefined()
    expect(anonymous.slots[headerActions.key]?.map((item) => item.id)).toEqual(['demo/anon-action'])
    const anonymousJson = JSON.stringify(anonymous)
    expect(anonymousJson).not.toContain('demo/guarded')
    expect(anonymousJson).not.toContain('GuardedPage')

    // signed in without an authorizer: public plus authenticated, and a
    // permission-gated page stays hidden (fail closed)
    const member = await manifest(principal)
    expect(member.pages.map((entry) => entry.id).sort()).toEqual(['demo/member', 'demo/public'])
    expect((member.collections[primaryNavigation.key] ?? []).map((item) => item.id)).toEqual([
      'demo/member/nav',
    ])
    expect(member.slots[headerActions.key]?.map((item) => item.id)).toEqual([
      'demo/anon-action',
      'demo/member-action',
    ])

    // with an authorizer granting the code, the guarded page and its
    // navigation appear together
    const authorizer = ctx.plugin({
      name: 'authorizer',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.setAuthorizer(() => Promise.resolve(['demo.thing.read']))
      },
    })
    await authorizer
    const granted = await manifest(principal)
    expect(granted.pages.map((entry) => entry.id)).toContain('demo/guarded')
    expect((granted.collections[primaryNavigation.key] ?? []).map((item) => item.id)).toEqual([
      'demo/member/nav',
      'demo/guarded/nav',
    ])
    // the grant never leaks to an anonymous viewer
    expect((await manifest()).pages.map((entry) => entry.id)).toEqual(['demo/public'])

    // a second authorizer is a configuration error
    const second = ctx.plugin({
      name: 'authorizer-2',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.setAuthorizer(() => Promise.resolve([]))
      },
    })
    await expect(Promise.resolve(second)).rejects.toThrow('already registered')

    // removing the authorization plugin hides capabilities, never exposes
    await authorizer.dispose()
    expect((await manifest(principal)).pages.map((entry) => entry.id)).not.toContain('demo/guarded')
    await ctx.fiber.dispose()
  })

  it('rejects malformed declarations at registration time', async () => {
    const { ctx } = await startHost()
    await withLayouts(ctx)

    // a bare display string as a navigation label never reaches the browser
    const bareLabel = ctx.plugin({
      name: 'bad-label',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.contribute(primaryNavigation, {
          id: 'bad/nav',
          visibility: PUBLIC,
          value: {
            id: 'bad/nav',
            label: 'Plain text' as never,
            target: { kind: 'page', pageId: 'demo/public' },
          },
        })
      },
    })
    await expect(Promise.resolve(bareLabel)).rejects.toThrow('malformed')

    // a dangerous external scheme is refused
    const dangerous = ctx.plugin({
      name: 'bad-href',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.contribute(primaryNavigation, {
          id: 'bad2/nav',
          visibility: PUBLIC,
          value: {
            id: 'bad2/nav',
            label: literal('x'),
            target: { kind: 'external', href: 'javascript:alert(1)' },
          },
        })
      },
    })
    await expect(Promise.resolve(dangerous)).rejects.toThrow('malformed')

    await ctx.fiber.dispose()
  })

  it('validates page references where they are declared', () => {
    expect(() => definePage({ id: 'nonamespace' as never, path: '/x' })).toThrow('namespaced')
    expect(() => definePage({ id: 'demo/bad', path: 'relative' })).toThrow('must start with /')
    expect(() => definePage({ id: 'demo/bad', path: '//evil.example' })).toThrow(
      'protocol-relative',
    )
    expect(() => definePage({ id: 'demo/bad', path: '/x?y=1' })).toThrow('query or hash')
    expect(() => definePage({ id: 'demo/bad', path: '/x/' })).toThrow('must not end with /')
    expect(() => definePage({ id: 'demo/bad', path: '/a//b' })).toThrow('empty segment')
    // a valid reference is frozen: it is shared across plugins
    const ref = definePage({ id: 'demo/ok', path: '/ok' })
    expect(() => {
      ;(ref as { path: string }).path = '/hacked'
    }).toThrow()
  })
})

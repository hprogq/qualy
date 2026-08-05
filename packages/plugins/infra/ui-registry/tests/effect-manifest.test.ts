import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_SHELL,
  BLANK_SHELL,
  AUTHENTICATED,
  PUBLIC,
  defineSurfaces,
  definePage,
  headerActions,
  permissionOf,
  primaryNavigation,
} from '@qualy/ui-contract'
import { message } from '@qualy/i18n-contract'
import type { Principal } from '@qualy/rbac-contract'
import { UiAuthorizer } from '../src/effect/authorizer.ts'
import { UiCatalog, UiManifest, layer as manifestLayer } from '../src/effect/manifest.ts'

// The manifest is an authorized projection, and this is where that is stated.
//
// Hiding a page is never authorization: every api call is authorized on its
// own. What the projection guarantees is that a viewer does not learn a
// capability, its route or its component exists, and that internal
// declarations never leave. Both are silent when broken, which is why they are
// asserted rather than assumed.

const label = message('test/nav/item', 'Item')

const publicPage = definePage({ id: 'test/public', path: '/public' })
const memberPage = definePage({ id: 'test/member', path: '/member' })
const gatedPage = definePage({ id: 'test/gated', path: '/gated' })
const orphanPage = definePage({ id: 'test/orphan', path: '/orphan' })

const surfaces = [
  defineSurfaces({
    layouts: [
      { contract: ADMIN_SHELL, provider: 'test/admin', component: 'test/AdminShell' },
      { contract: BLANK_SHELL, provider: 'test/blank', component: 'test/BlankShell' },
    ],
  }),
  defineSurfaces({
    pages: [
      {
        page: publicPage,
        component: 'test/PublicPage',
        layout: BLANK_SHELL,
        visibility: PUBLIC,
        navigation: { label, order: 1 },
      },
      {
        page: memberPage,
        component: 'test/MemberPage',
        layout: ADMIN_SHELL,
        visibility: AUTHENTICATED,
        navigation: { label, order: 2 },
      },
      {
        page: gatedPage,
        component: 'test/GatedPage',
        layout: ADMIN_SHELL,
        visibility: permissionOf('test.thing.read'),
        navigation: { label, order: 3 },
      },
      // no provider ships this contract, so the page cannot be framed
      {
        page: orphanPage,
        component: 'test/OrphanPage',
        layout: 'nobody/ships-this',
        visibility: PUBLIC,
      },
    ],
    slots: [
      {
        key: headerActions.key,
        id: 'test/menu',
        component: 'test/Menu',
        visibility: AUTHENTICATED,
        order: 10,
      },
    ],
  }),
]

const viewer: Principal = { tenantId: 't', userId: 'u', sessionId: 's' }

const build = (principal: Principal | undefined, held: readonly string[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* UiManifest
      return yield* manifest.build(principal)
    }).pipe(
      Effect.provide(
        manifestLayer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Layer.succeed(UiCatalog, surfaces),
              Layer.succeed(UiAuthorizer, {
                permissionsFor: () => Effect.succeed(new Set(held)),
              }),
            ),
          ),
        ),
      ),
    ),
  )

describe('the manifest a viewer receives', () => {
  it('shows an anonymous visitor only the public surfaces', async () => {
    const manifest = await build(undefined, [])
    expect(manifest.pages.map((page) => page.id)).toEqual(['test/public'])
    // and only the layout that page needs: an unused shell is a component the
    // browser would fetch for nothing
    expect(manifest.layouts.map((layout) => layout.contract)).toEqual([BLANK_SHELL])
    expect(manifest.slots).toEqual({})
  })

  it('adds the authenticated surfaces once there is a viewer, and no more', async () => {
    const manifest = await build(viewer, [])
    expect(manifest.pages.map((page) => page.id).sort()).toEqual(['test/member', 'test/public'])
    // the gated page is absent entirely: not its id, not its path, not its
    // component. A viewer must not learn the capability exists.
    expect(JSON.stringify(manifest)).not.toContain('Gated')
    expect(JSON.stringify(manifest)).not.toContain('/gated')
    expect(manifest.slots[headerActions.key]).toEqual([
      { id: 'test/menu', component: 'test/Menu', order: 10 },
    ])
  })

  it('adds a gated surface exactly when the viewer holds its code', async () => {
    const manifest = await build(viewer, ['test.thing.read'])
    expect(manifest.pages.map((page) => page.id).sort()).toEqual([
      'test/gated',
      'test/member',
      'test/public',
    ])
  })

  it('never lets an internal declaration out', async () => {
    const manifest = await build(viewer, ['test.thing.read'])
    // visibility and permission codes are how the projection is decided, not
    // something the browser is told
    expect(JSON.stringify(manifest)).not.toContain('visibility')
    expect(JSON.stringify(manifest)).not.toContain('test.thing.read')
  })

  it('drops a page whose layout contract nobody provides', async () => {
    const manifest = await build(undefined, [])
    // it is public, so visibility kept it; the missing shell is what removed it
    expect(manifest.pages.map((page) => page.id)).not.toContain('test/orphan')
  })

  it('resolves navigation to paths, and drops entries for pages it hid', async () => {
    const anonymous = await build(undefined, [])
    expect(anonymous.collections[primaryNavigation.key]).toEqual([
      {
        id: 'test/public',
        label,
        target: { kind: 'page', pageId: 'test/public', path: '/public' },
        icon: undefined,
        order: 1,
      },
    ])
    // the member and gated entries are not merely unlabelled: they are gone,
    // because an entry inherits its page's visibility
    const member = await build(viewer, [])
    expect(
      (member.collections[primaryNavigation.key] as { id: string }[]).map((item) => item.id),
    ).toEqual(['test/public', 'test/member'])
  })
})

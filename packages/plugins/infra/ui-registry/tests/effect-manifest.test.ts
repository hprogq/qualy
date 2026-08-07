import { NodeHttpServer } from '@effect/platform-node'
import { Cause, Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ADMIN_SHELL,
  AUTHENTICATED,
  BLANK_SHELL,
  PUBLIC,
  definePage,
  defineSurfaces,
  headerActions,
  permissionOf,
  primaryNavigation,
  type UiSurfaces,
} from '@qualy/ui-contract'
import { message } from '@qualy/i18n-contract'
import type { Principal } from '@qualy/rbac-contract'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { CurrentViewer, Viewer } from '@qualy/plugin-auth/server/session-contract'
import { appApiHandlers } from '../src/server/index.ts'
import { UiAuthorizer } from '../src/server/authorizer.ts'
import { UiManifest, layer as manifestLayer } from '../src/server/manifest.ts'
import { registerSurfaces, uiLayer } from '../src/server/registry.ts'
import { appApiGroup } from '../src/api.ts'

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

/** one plugin's worth of surfaces, since the registry takes them one at a time */
const merged = (all: readonly UiSurfaces[]): UiSurfaces => ({
  pages: all.flatMap((surface) => surface.pages ?? []),
  layouts: all.flatMap((surface) => surface.layouts ?? []),
  collections: all.flatMap((surface) => surface.collections ?? []),
  slots: all.flatMap((surface) => surface.slots ?? []),
})

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
              registerSurfaces(merged(surfaces)).pipe(Layer.provideMerge(uiLayer)),
              Layer.succeed(UiAuthorizer, {
                permissionsFor: () => Effect.succeed(new Set(held)),
              }),
            ),
          ),
        ),
      ),
    ),
  )

// The endpoint served for real, because the encoder is where the failure was.
//
// A projection assertion cannot see it: toEqual ignores a key whose value is
// undefined and JSON.stringify drops it. The response encoder does neither. A
// navigation entry with no icon carried `icon: undefined`, which is not a JSON
// value, and the running process answered 400 while every test stayed green.

const port = 3193
// the plugin's own api and the plugin's own handler. A handler written here
// would prove that the projection works, which the tests below already do,
// and would say nothing about how the endpoint gets a principal - which is
// exactly what was wrong.
const api = HttpApi.make(QUALY_API_ID).add(appApiGroup).prefix(QUALY_API_PREFIX)
const handlers = appApiHandlers

let scope: Scope.Scope

beforeAll(async () => {
  // the authorizer goes in at the application level, not into the manifest
  // layer: it is a per-request requirement, which is the whole point of
  // reading it per request rather than capturing it at construction
  const application = HttpRouter.serve(
    HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)),
  ).pipe(
    Layer.provide(
      manifestLayer.pipe(
        Layer.provide(registerSurfaces(merged(surfaces)).pipe(Layer.provideMerge(uiLayer))),
      ),
    ),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(UiAuthorizer, {
          permissionsFor: () => Effect.succeed(new Set(['test.thing.read'])),
        }),
        // the endpoint says who is asking through this middleware; a stub that
        // always reports the same viewer is enough to prove the wiring
        Layer.succeed(
          Viewer,
          Viewer.of({
            session: (httpEffect) =>
              Effect.provideService(httpEffect, CurrentViewer, { principal: viewer }),
          }),
        ),
      ),
    ),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

describe('the manifest over the wire', () => {
  it('sees who is asking, not just that someone asked', async () => {
    // The endpoint is served to anonymous visitors on purpose, and declaring
    // no middleware to allow that looked equivalent to declaring an optional
    // one. It is not: nothing provides a principal unless a middleware does,
    // so a signed-in administrator was handed the anonymous manifest and saw
    // no administration pages at all. Only a request can show this - the
    // projection is given a principal directly in every other test here.
    const response = await fetch(`http://127.0.0.1:${port}/api/app/manifest`)
    const body = (await response.json()) as { pages: { id: string }[] }
    expect(body.pages.map((page) => page.id)).toContain('test/gated')
  })

  it('encodes as the response schema it declares', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/app/manifest`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      pages: { id: string }[]
      collections: Record<string, { id: string; icon?: string }[]>
    }
    expect(body.pages.map((page) => page.id).sort()).toEqual([
      'test/gated',
      'test/member',
      'test/public',
    ])
    // the entry with no icon is the one that used to fail: it must arrive
    // without the key rather than with an undefined one
    const navigation = body.collections['admin-shell/navigation-primary']!
    expect(navigation.every((item) => !('icon' in item))).toBe(true)
  })
})

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
    // strict, so an absent icon is an absent key rather than an undefined one
    expect(anonymous.collections[primaryNavigation.key]).toStrictEqual([
      {
        id: 'test/public/nav',
        label,
        target: { kind: 'page', pageId: 'test/public', path: '/public' },
        order: 1,
      },
    ])
    // the member and gated entries are not merely unlabelled: they are gone,
    // because an entry inherits its page's visibility
    const member = await build(viewer, [])
    expect(
      (member.collections[primaryNavigation.key] as { id: string }[]).map((item) => item.id),
    ).toEqual(['test/public/nav', 'test/member/nav'])
  })
})

// The three claims a generated catalog used to reject before anything ran.
// They are rejected at boot now, which is where they were always going to be
// caught: a registration is a line of code, and no generator sees it.
describe('a claim made twice', () => {
  const page = definePage({ id: 'probe/page', path: '/probe' })
  const other = definePage({ id: 'probe/other', path: '/probe' })
  const build = (surfaces: UiSurfaces) =>
    Effect.runPromiseExit(
      Effect.scoped(Layer.build(registerSurfaces(surfaces).pipe(Layer.provideMerge(uiLayer)))),
    )

  it('refuses one page id claimed by two registrations', async () => {
    const declaration = { page, component: 'probe/P', layout: ADMIN_SHELL, visibility: PUBLIC }
    const exit = await build({ pages: [declaration, declaration] })
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('names both plugins when they claim one page id', async () => {
    // the assembler tells the registry who declared what; the refusal must
    // say which two plugins collided, not just which id
    const declaration = { page, component: 'probe/P', layout: ADMIN_SHELL, visibility: PUBLIC }
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Layer.build(
          Layer.mergeAll(
            registerSurfaces({ pages: [declaration] }, '@fake/plugin-first'),
            registerSurfaces({ pages: [declaration] }, '@fake/plugin-second'),
          ).pipe(Layer.provideMerge(uiLayer)),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
    expect(String(defect)).toMatch(
      /page probe\/page is declared by both @fake\/plugin-(first|second) and @fake\/plugin-(first|second)/,
    )
  })

  it('refuses one path claimed by two pages', async () => {
    const exit = await build({
      pages: [
        { page, component: 'probe/P', layout: ADMIN_SHELL, visibility: PUBLIC },
        { page: other, component: 'probe/O', layout: ADMIN_SHELL, visibility: PUBLIC },
      ],
    })
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('refuses one layout contract claimed by two providers', async () => {
    const exit = await build({
      layouts: [
        { contract: ADMIN_SHELL, provider: 'a/shell', component: 'a/Shell' },
        { contract: ADMIN_SHELL, provider: 'b/shell', component: 'b/Shell' },
      ],
    })
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

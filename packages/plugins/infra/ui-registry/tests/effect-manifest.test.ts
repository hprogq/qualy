import { NodeHttpServer } from '@effect/platform-node'
import { Cause, Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { it } from '@effect/vitest'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import {
  APP_SHELL,
  AUTHENTICATED,
  BLANK_SHELL,
  PUBLIC,
  definePage,
  defineSurfaces,
  headerActions,
  navigationGroups,
  permissionOf,
  primaryNavigation,
  type UiSurfaces,
  reactComponent,
} from '@qualy/ui-contract'
import { message } from '@qualy/i18n-contract'
import type { Principal } from '@qualy/rbac-contract'
import { Api } from '@qualy/api-kit/plugin'
import { CurrentViewer, Viewer } from '@qualy/auth-contract/session'
import { appApiHandlers } from '../src/server/index.ts'
import { UiAuthorizer } from '../src/server/authorizer.ts'
import { UiManifest, layer as manifestLayer } from '../src/server/manifest.ts'
import { registerSurfaces, uiLayer } from '../src/server/registry.ts'
import { appApiGroup } from '@qualy/app-contract'

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
      {
        contract: APP_SHELL,
        component: reactComponent('./client/AdminShell'),
      },
      {
        contract: BLANK_SHELL,
        component: reactComponent('./client/BlankShell'),
      },
    ],
  }),
  defineSurfaces({
    pages: [
      {
        page: publicPage,
        component: reactComponent('./client/PublicPage'),
        layout: BLANK_SHELL,
        visibility: PUBLIC,
        navigation: { label, order: 1 },
      },
      {
        page: memberPage,
        component: reactComponent('./client/MemberPage'),
        layout: APP_SHELL,
        visibility: AUTHENTICATED,
        navigation: { label, order: 2 },
      },
      {
        page: gatedPage,
        component: reactComponent('./client/GatedPage'),
        layout: APP_SHELL,
        visibility: permissionOf('test.thing.read'),
        navigation: { label, order: 3, group: 'test/restricted' },
      },
      // no provider ships this contract, so the page cannot be framed
      {
        page: orphanPage,
        component: reactComponent('./client/OrphanPage'),
        layout: 'nobody/ships-this',
        visibility: PUBLIC,
      },
    ],
    collections: [
      // a section the gated page files under, and one nothing files under
      {
        collection: navigationGroups,
        id: 'test/restricted',
        value: { id: 'test/restricted', label, order: 1 },
        visibility: AUTHENTICATED,
      },
      {
        collection: navigationGroups,
        id: 'test/empty',
        value: { id: 'test/empty', label, order: 2 },
        visibility: AUTHENTICATED,
      },
    ],
    slots: [
      {
        key: headerActions.key,
        id: 'test/menu',
        component: reactComponent('./client/Menu'),
        visibility: AUTHENTICATED,
        order: 10,
      },
    ],
  }),
]

const viewer: Principal = { tenantId: 't', userId: 'u', sessionId: 's' }

/**
 * A loud owner and loud module names, so the disclosure case has something to
 * fail on. The fixture's implementation identity is deliberately nothing like
 * its product identity: the pages are `test/public`, `test/member`, and what
 * implements them is this package and files called `PublicPage.tsx`.
 */
const OWNER = '@fixture/qualy-public-surface-probe'

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
              registerSurfaces(merged(surfaces), OWNER).pipe(Layer.provideMerge(uiLayer)),
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
const api = Api.local(appApiGroup)
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
          Viewer.of((httpEffect) =>
            Effect.provideService(httpEffect, CurrentViewer, { principal: viewer }),
          ),
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

  it('leaves out a section nothing files under', async () => {
    const held = await build(viewer, ['test.thing.read'])
    const denied = await build(viewer, [])
    const groups = (manifest: typeof held) =>
      (manifest.collections['app-shell/navigation-groups'] ?? []).map(
        (group) => (group as { id: string }).id,
      )

    // the reader who can see the gated page gets the section it sits in
    expect(groups(held)).toEqual(['test/restricted'])
    // and the one who cannot gets neither the page nor a heading with
    // nothing under it - the name alone says what they are kept out of
    expect(groups(denied)).toEqual([])
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
    const navigation = body.collections['app-shell/navigation-primary']!
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
    // renderer. A viewer must not learn the capability exists.
    expect(JSON.stringify(manifest)).not.toContain('Gated')
    expect(JSON.stringify(manifest)).not.toContain('/gated')
    // a contribution is its id under its slot, and that is all
    expect(manifest.slots[headerActions.key]).toEqual([{ id: 'test/menu', order: 10 }])
  })

  it('names product surfaces and never what implements them, whoever is asking', async () => {
    // three viewers, because the projection differs for each and the rule
    // does not: anonymous, an ordinary member, somebody holding the code
    for (const manifest of [
      await build(undefined, []),
      await build(viewer, []),
      await build(viewer, ['test.thing.read']),
    ]) {
      const wire = JSON.stringify(manifest)
      // who ships it
      expect(wire).not.toContain(OWNER)
      expect(wire).not.toContain('fixture')
      // which file renders it, and the directory it sits in
      expect(wire).not.toContain('./client/')
      expect(wire).not.toContain('.tsx')
      for (const source of ['PublicPage', 'MemberPage', 'AdminShell', 'BlankShell', 'Menu']) {
        expect(wire, source).not.toContain(source)
      }
      // and the rule that was always here: a permission code is how the
      // server decides, never something the browser is told
      expect(wire).not.toContain('test.thing.read')
      // what it does carry is the product's own vocabulary
      expect(wire).toContain('test/public')
    }
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

  it('refuses a malformed collection item at its plugin, before any manifest carries it', async () => {
    // the token carries the item's schema and the registry judges the item
    // as it is contributed: a navigation entry pointing nowhere, or with a
    // key nobody declared, stops the boot naming the collection, the item
    // and the plugin - not the browser, later, with nothing to name
    const malformed = defineSurfaces({
      collections: [
        {
          collection: primaryNavigation,
          id: 'test/broken',
          value: { id: 'test/broken', label, target: { kind: 'page' }, extra: true },
          visibility: PUBLIC,
        },
      ],
    })
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Layer.build(
          registerSurfaces(malformed, '@qualy/plugin-test').pipe(Layer.provideMerge(uiLayer)),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const said = Cause.pretty(exit.cause)
      expect(said).toContain('collection app-shell/navigation-primary item test/broken')
      expect(said).toContain('@qualy/plugin-test')
    }
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
  // the scope is the test's now: `it.effect` opens one per case and closes
  // it after, so a registry that refuses half way through is released where
  // it was built rather than inside the assertion that caught it
  const build = (surfaces: UiSurfaces) =>
    Effect.exit(Layer.build(registerSurfaces(surfaces).pipe(Layer.provideMerge(uiLayer))))

  it.effect('refuses one page id claimed by two registrations', () =>
    Effect.gen(function* () {
      const declaration = {
        page,
        component: reactComponent('./client/P'),
        layout: APP_SHELL,
        visibility: PUBLIC,
      }
      const exit = yield* build({ pages: [declaration, declaration] })
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect('names both plugins when they claim one page id', () =>
    Effect.gen(function* () {
      // the assembler tells the registry who declared what; the refusal must
      // say which two plugins collided, not just which id
      const declaration = {
        page,
        component: reactComponent('./client/P'),
        layout: APP_SHELL,
        visibility: PUBLIC,
      }
      const exit = yield* Effect.exit(
        Layer.build(
          Layer.mergeAll(
            registerSurfaces({ pages: [declaration] }, '@fake/plugin-first'),
            registerSurfaces({ pages: [declaration] }, '@fake/plugin-second'),
          ).pipe(Layer.provideMerge(uiLayer)),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(String(defect)).toMatch(
        /page probe\/page is declared by both @fake\/plugin-(first|second) and @fake\/plugin-(first|second)/,
      )
    }),
  )

  it.effect('refuses one path claimed by two pages', () =>
    Effect.gen(function* () {
      const exit = yield* build({
        pages: [
          {
            page,
            component: reactComponent('./client/P'),
            layout: APP_SHELL,
            visibility: PUBLIC,
          },
          {
            page: other,
            component: reactComponent('./client/O'),
            layout: APP_SHELL,
            visibility: PUBLIC,
          },
        ],
      })
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect('refuses one layout contract claimed twice', () =>
    Effect.gen(function* () {
      const exit = yield* build({
        layouts: [
          { contract: APP_SHELL, component: reactComponent('./client/Shell') },
          { contract: APP_SHELL, component: reactComponent('./client/Other') },
        ],
      })
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect('refuses one id claimed twice under the same slot, and allows it across slots', () =>
    Effect.gen(function* () {
      const item = (key: string) => ({
        key,
        id: 'test/thing' as const,
        component: reactComponent('./client/Thing'),
        visibility: PUBLIC,
      })
      // the browser resolves a renderer by slot AND id, so the pair is the
      // claim; the same id under another slot is a different seat
      expect(Exit.isFailure(yield* build({ slots: [item('a/one'), item('a/one')] }))).toBe(true)
      expect(Exit.isFailure(yield* build({ slots: [item('a/one'), item('b/two')] }))).toBe(false)
    }),
  )
})

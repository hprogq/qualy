import { lazy, Suspense, type ReactNode } from 'react'
import { Outlet, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { layoutComponents, slotComponents } from 'virtual:qualy/plugins'
import { usePageTitle } from '@qualy/web-runtime'
import { Screen } from '@qualy/ui/screen'
import { PageLoading } from '@qualy/ui/spinner'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// The two shells, against a manifest rather than against props: what the top
// bar shows, which application counts as open, and what the workspace rail
// does with an entry whose path names a parameter. All three used to be
// decided by hand at each call site, which is exactly where a navigation goes
// quietly wrong - an entry pointing at ":batchId" is a link that 404s, and an
// application whose pages the viewer cannot open is a tab leading nowhere.

const AppShell = (await layoutComponents['app-shell/v1']!()).default
const WorkspaceShell = (await layoutComponents['workspace-shell/v1']!()).default
const UserDetailShell = (await layoutComponents['user-detail-shell/v1']!()).default
const AccountShell = (await layoutComponents['account-shell/v1']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '66666666-6666-4666-8666-666666666666'

/** what a computed colour reads as when nothing is drawn */
const BLANK = 'rgba(0, 0, 0, 0)'

const text = (value: string) => ({ kind: 'literal' as const, value })

const manifest = () => ({
  ...emptyManifest(),
  collections: {
    'app-shell/navigation-groups': [
      { id: 'app/assessment', label: text('测评'), order: 10, icon: 'list-checks' },
      { id: 'app/organization', label: text('组织与权限'), order: 40, icon: 'users' },
      { id: 'batch/admin', label: text('批次管理'), order: 30 },
      { id: 'assessment/user-detail', label: text('测评'), order: 20 },
    ],
    'app-shell/navigation-primary': [
      {
        id: 'nav/batches',
        label: text('全部测评'),
        target: { kind: 'page', pageId: 'assessment/batches', path: '/assessment/batches' },
        group: 'app/assessment',
        order: 10,
      },
      {
        id: 'nav/users',
        label: text('用户管理'),
        target: { kind: 'page', pageId: 'auth/users', path: '/organization/users' },
        group: 'app/organization',
        order: 20,
      },
      {
        id: 'nav/roles',
        label: text('角色管理'),
        target: { kind: 'page', pageId: 'rbac/roles', path: '/organization/roles' },
        group: 'app/organization',
        order: 30,
      },
    ],
    'workspace-shell/navigation': [
      {
        id: 'rail/phases',
        label: text('阶段安排'),
        target: {
          kind: 'page',
          pageId: 'assessment/batch-phases',
          path: '/assessment/batches/:batchId/phases',
        },
        group: 'batch/admin',
        order: 10,
      },
      {
        id: 'rail/review',
        label: text('审核'),
        target: {
          kind: 'page',
          pageId: 'assessment/batch-reviews',
          path: '/assessment/batches/:batchId/reviews',
        },
        group: 'batch/admin',
        order: 15,
        capability: 'assessment/review',
      },
      {
        id: 'rail/review',
        label: text('审核'),
        target: {
          kind: 'page',
          pageId: 'assessment/batch-reviews',
          path: '/assessment/batches/:batchId/reviews',
        },
        group: 'batch/admin',
        order: 15,
        capability: 'assessment/review',
      },
      {
        id: 'rail/entries',
        label: text('参评名单'),
        icon: 'users',
        target: {
          kind: 'page',
          pageId: 'assessment/batch-entries',
          path: '/assessment/batches/:batchId/entries',
        },
        group: 'batch/admin',
        order: 12,
      },
      {
        id: 'rail/elsewhere',
        label: text('别处'),
        target: {
          kind: 'page',
          pageId: 'other/page',
          path: '/other/:otherId/thing',
        },
        group: 'batch/admin',
        order: 20,
      },
    ],
    'iam/user-detail-navigation': [
      {
        id: 'auth/user-detail/profile',
        label: text('基本资料'),
        target: { kind: 'page', pageId: 'auth/user-detail', path: '/organization/users/:userId' },
        order: 0,
      },
      {
        id: 'auth/user-detail/identities',
        label: text('登录方式'),
        target: {
          kind: 'page',
          pageId: 'auth/user-identities',
          path: '/organization/users/:userId/identities',
        },
        order: 20,
      },
      {
        id: 'assessment/user-batches/rail',
        label: text('参评批次'),
        target: {
          kind: 'page',
          pageId: 'assessment/user-batches',
          path: '/organization/users/:userId/assessment/batches',
        },
        group: 'assessment/user-detail',
        order: 10,
      },
    ],
  },
})

// The same manifest with nothing waiting on the open workspace's say-so.
//
// The rail and the bar at the foot both hold their places open until the
// workspace has published what this reader may do - the case above pins
// that - so a test about what the bar DOES with its entries has to be given
// a rail that is already settled.
const settledManifest = () => {
  const full = manifest()
  const rail = full.collections['workspace-shell/navigation']!
  return {
    ...full,
    collections: {
      ...full.collections,
      'workspace-shell/navigation': rail.filter(
        (entry) => (entry as { capability?: string }).capability === undefined,
      ),
    },
  }
}

// the same manifest with one application in it: the reader who can open
// only their own assessment, which is most of this product's readers
const oneAppManifest = () => {
  const full = manifest()
  const groups = full.collections['app-shell/navigation-groups']!
  const pages = full.collections['app-shell/navigation-primary']!
  return {
    ...full,
    collections: {
      ...full.collections,
      'app-shell/navigation-groups': groups.filter((group) => group.id !== 'app/organization'),
      'app-shell/navigation-primary': pages.filter((entry) => entry.group !== 'app/organization'),
    },
  }
}

// a page that hands the shell its name, the way a real one does
function NamedPage() {
  const heading = usePageTitle('用户管理')
  return (
    <div data-testid="named" style={{ height: 3000 }}>
      <h1 ref={heading}>用户管理</h1>
    </div>
  )
}

const shell = (element: React.ReactNode, path: string, route: string) =>
  renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
    routes: [{ path, element }],
    route,
  })

describe('the application shell', () => {
  it('stands the open application\'s sections down the side of a wide window, and in a row on a narrow one', async () => {
    await page.viewport(1440, 900)
    shell(<AppShell />, '/organization/users', '/organization/users')
    const side = page.getByTestId('side-nav')
    await expect.element(side).toBeVisible()
    await expect.element(side.getByRole('link', { name: '用户管理' })).toHaveAttribute('aria-current', 'page')
    await expect.element(side.getByRole('link', { name: '角色管理' })).toBeVisible()
    // one or the other carries the sections, never both
    await page.viewport(800, 900)
    await vi.waitFor(() => expect(document.querySelector('[data-testid="side-nav"]')).toBeNull())
    await expect.element(page.getByRole('link', { name: '角色管理' })).toBeVisible()
    await page.viewport(1280, 800)
  })

  it('shows one tab per application and the sections of the open one', async () => {
    shell(<AppShell />, '/organization/users', '/organization/users')

    // the brand leads the bar, named by its wordmark's title and nothing else
    await expect.element(page.getByRole('link', { name: 'Qualy' })).toBeVisible()
    expect(await page.getByRole('link', { name: 'Qualy' }).elements()).toHaveLength(1)
    // an application is a tab; its sections are a row of their own, and only
    // when there is more than one to choose between
    await expect.element(page.getByRole('link', { name: '组织与权限' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '测评' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '用户管理' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '角色管理' })).toBeVisible()
    // the open application is the one this location is inside
    await expect
      .element(page.getByRole('link', { name: '组织与权限' }))
      .toHaveAttribute('aria-current', 'page')
    // the assessment application has a single section, so no second row
    expect(await page.getByRole('link', { name: '全部测评' }).elements()).toHaveLength(0)
  })

  it('says when the page has moved under its bars, and only then', async () => {
    // the bars sit inside the scrolling element; a page taller than it
    // puts them to the test
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
      route: '/organization/users',
      children: (
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path="/organization/users"
              element={<div data-testid="tall" style={{ height: 3000 }} />}
            />
          </Route>
        </Routes>
      ),
    })
    await expect.element(page.getByTestId('tall')).toBeInTheDocument()
    const head = document.querySelector('[data-shell-head]')!
    await vi.waitFor(() => expect(head.hasAttribute('data-scrolled')).toBe(false))
    // and until it has, the bar draws no line at all: here the page is what
    // lies underneath, so the hairline is earned rather than stated. The
    // workspace shell, where a second bar lies underneath instead and never
    // moves, states it - the case further down.
    const bar = (await page.getByRole('link', { name: 'Qualy' }).element()).parentElement!
    expect(getComputedStyle(bar).borderBottomColor).toBe(BLANK)
    const main = document.querySelector('main')!
    main.scrollTo({ top: 400 })
    await vi.waitFor(() => expect(head.hasAttribute('data-scrolled')).toBe(true))
    await vi.waitFor(() => expect(getComputedStyle(bar).borderBottomColor).not.toBe(BLANK))
    // the bars are still where they were: stuck to the top of the scrollport
    expect(head.getBoundingClientRect().top).toBeCloseTo(main.getBoundingClientRect().top, 0)
    main.scrollTo({ top: 0 })
    await vi.waitFor(() => expect(head.hasAttribute('data-scrolled')).toBe(false))
  })

  it('draws the sections under the band a page arrives with, and nowhere while it is on its way', async () => {
    await page.viewport(390, 844)
    let release!: () => void
    const Banded = lazy(
      () =>
        new Promise<{ default: () => ReactNode }>((resolve) => {
          release = () =>
            resolve({
              default: () => (
                <Screen title="用户管理">
                  <div data-testid="banded-page" />
                </Screen>
              ),
            })
        }),
    )
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
      route: '/organization/users',
      children: (
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path="/organization/users"
              element={
                <Suspense fallback={<PageLoading />}>
                  <Banded />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      ),
    })
    await expect.element(page.getByRole('link', { name: 'Qualy' })).toBeVisible()
    // on its way: nobody knows yet where the sections go, so nobody draws them
    await expect.element(page.getByRole('status')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-testid="section-chips"]')).toHaveLength(0)
    release()
    await expect.element(page.getByTestId('banded-page')).toBeInTheDocument()
    // arrived: one row, under the band's own words
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-testid="section-chips"]')).toHaveLength(1),
    )
    const heading = page.getByRole('heading', { name: '用户管理' }).element()
    const chips = document.querySelector('[data-testid="section-chips"]')!
    expect(chips.getBoundingClientRect().top).toBeGreaterThan(
      heading.getBoundingClientRect().bottom,
    )
    await page.viewport(1280, 800)
  })

  it('holds its scrollbar\u2019s room whether or not the page is long, so pages do not shift', async () => {
    shell(<AppShell />, '/organization/users', '/organization/users')
    await expect.element(page.getByRole('link', { name: 'Qualy' })).toBeVisible()
    expect(getComputedStyle(document.querySelector('main')!).scrollbarGutter).toBe('stable')
  })

  it('carries the applications at the foot as well, and only where there are two', async () => {
    shell(<AppShell />, '/organization/users', '/organization/users')
    await expect.element(page.getByRole('link', { name: 'Qualy' })).toBeVisible()
    const foot = document.querySelector('[data-shell-bottom]')
    expect(foot).not.toBeNull()
    // the same applications as the bar at the top, in the same order
    expect([...foot!.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/assessment/batches',
      '/organization/users',
    ])
  })

  it('leaves the foot bare for a reader with one application', async () => {
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(oneAppManifest()) } }),
      routes: [{ path: '/assessment/batches', element: <AppShell /> }],
      route: '/assessment/batches',
    })
    await expect.element(page.getByRole('link', { name: 'Qualy' })).toBeVisible()
    expect(document.querySelector('[data-shell-bottom]')).toBeNull()
  })

  it("says the page's own name once its heading has gone under the bars", async () => {
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
      route: '/organization/users',
      children: (
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/organization/users" element={<NamedPage />} />
          </Route>
        </Routes>
      ),
    })
    await expect.element(page.getByTestId('named')).toBeInTheDocument()
    // while the heading is in view the bar says nothing: two names, one screen
    await vi.waitFor(() => expect(document.querySelector('[data-shell-title]')).toBeNull())
    const main = document.querySelector('main')!
    main.scrollTo({ top: 400 })
    await vi.waitFor(() =>
      expect(document.querySelector('[data-shell-title]')?.textContent).toBe('用户管理'),
    )
    main.scrollTo({ top: 0 })
    await vi.waitFor(() => expect(document.querySelector('[data-shell-title]')).toBeNull())
  })

  it('sends an application tab to its first page', async () => {
    shell(<AppShell />, '/organization/users', '/organization/users')
    await expect
      .element(page.getByRole('link', { name: '测评' }))
      .toHaveAttribute('href', '/assessment/batches')
  })
})

describe('the workspace shell', () => {
  it('fills the rail entries with the parameters of the route it is mounted at', async () => {
    // the rail is a column on a desktop and a drawer on a phone, and this
    // case is about the column
    await page.viewport(1280, 800)
    shell(
      <WorkspaceShell />,
      '/assessment/batches/:batchId/phases',
      `/assessment/batches/${BATCH_ID}/phases`,
    )

    await expect
      .element(page.getByRole('link', { name: '阶段安排' }))
      .toHaveAttribute('href', `/assessment/batches/${BATCH_ID}/phases`)
    // an entry this route cannot address is not shown pointing at a literal
    // ":otherId"
    expect(await page.getByRole('link', { name: '别处' }).elements()).toHaveLength(0)
    // an entry gated on a workspace capability stays hidden while nothing
    // has published one: unloaded is not "unfiltered"
    expect(await page.getByRole('link', { name: '审核' }).elements()).toHaveLength(0)
    // an entry gated on a workspace capability stays hidden while nothing
    // has published one: unloaded is not "unfiltered"
    expect(await page.getByRole('link', { name: '审核' }).elements()).toHaveLength(0)
    // the applications stay above it: a workspace is somewhere inside the
    // product, not a place the product disappears from
    await expect.element(page.getByRole('link', { name: '组织与权限' })).toBeVisible()
  })

  it('rules its top bar off from the bar stacked under it', async () => {
    // The bar draws no line at rest, because in the shell it was written
    // for what lies under it is the page, and the page passing beneath is
    // what earns one - the case above. Here nothing ever passes beneath:
    // the context bar is in the flow and never moves. Two bars on the same
    // ground with no rule between them read as one band, which is the
    // defect this pins.
    //
    // Which grey is not asserted, only that there is one: the weight is the
    // theme's business and may move.
    await page.viewport(1280, 800)
    shell(
      <WorkspaceShell />,
      '/assessment/batches/:batchId/phases',
      `/assessment/batches/${BATCH_ID}/phases`,
    )
    const brand = page.getByRole('link', { name: 'Qualy' })
    await expect.element(brand).toBeVisible()
    expect(getComputedStyle((await brand.element()).parentElement!).borderBottomColor).not.toBe(
      BLANK,
    )
  })

  it('hands the bar at the foot of a phone to the open workspace\u2019s own sections', async () => {
    await page.viewport(390, 844)
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(settledManifest()) } }),
      routes: [{ path: '/assessment/batches/:batchId/phases', element: <WorkspaceShell /> }],
      route: `/assessment/batches/${BATCH_ID}/phases`,
    })

    // for as long as the reader is inside a batch, every move is a move
    // between its sections - so that is what the easiest place on the
    // screen holds, and the modules are not there at all
    const foot = page.getByTestId('bottom-bar')
    await expect.element(foot).toBeVisible()
    await expect.element(foot.getByRole('link', { name: '阶段安排' })).toBeVisible()
    expect(foot.getByRole('link', { name: '测评' }).elements()).toHaveLength(0)

    // the bar at the top is gone with them: a phone inside a batch spends
    // its head on the batch, not on the product's own mark
    expect(page.getByRole('link', { name: 'Qualy' }).elements()).toHaveLength(0)

    // and the rail beside the page is folded away, because there is no
    // room beside a page this narrow: the same entry is reachable once,
    // at the foot, not twice
    expect(
      page
        .getByRole('link', { name: '阶段安排' })
        .elements()
        .filter((el) => el.checkVisibility()),
    ).toHaveLength(1)
  })

  it('keeps as many sections as fit across the foot and opens the rest behind one cell', async () => {
    // A batch has more sections than a phone has cells. The bar keeps the
    // first few in the rail's own order and hands the remainder to the last
    // cell, which is lit while what is open is one of them - or the bar
    // would read as though the reader were nowhere.
    await page.viewport(390, 844)
    const many = () => {
      const full = settledManifest()
      const rail = full.collections['workspace-shell/navigation']!
      return {
        ...full,
        collections: {
          ...full.collections,
          'workspace-shell/navigation': [
            ...rail,
            ...['settings', 'staff', 'items', 'results'].map((name, index) => ({
              id: `rail/${name}`,
              label: text(name),
              target: {
                kind: 'page' as const,
                pageId: `assessment/batch-${name}`,
                path: `/assessment/batches/:batchId/${name}`,
              },
              group: 'batch/admin',
              order: 30 + index,
            })),
          ],
        },
      }
    }
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(many()) } }),
      routes: [{ path: '/assessment/batches/:batchId/results', element: <WorkspaceShell /> }],
      route: `/assessment/batches/${BATCH_ID}/results`,
    })

    const foot = page.getByTestId('bottom-bar')
    await expect.element(foot).toBeVisible()
    // four of the six, then the way to the rest
    expect(foot.getByRole('link').elements()).toHaveLength(4)
    const more = page.getByTestId('bottom-more')
    await expect.element(more).toBeVisible()
    // what is open is behind it, so it carries the ink
    expect(getComputedStyle(await more.element()).fontWeight).toBe('500')

    // and it opens the drawer holding every section plus the way out
    await more.click()
    const sheet = page.getByRole('dialog')
    await expect.element(sheet).toBeVisible()
    await expect.element(sheet.getByRole('link', { name: 'results' })).toBeVisible()
    await expect.element(sheet.getByTestId('drawer-modules')).toBeVisible()
  })

  it('leaves a person\u2019s sections a row under the banner, and the modules at the foot', async () => {
    await page.viewport(390, 844)
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
      routes: [{ path: '/organization/users/:userId/identities', element: <UserDetailShell /> }],
      route: `/organization/users/${USER_ID}/identities`,
    })

    // a record is parts of one thing read across, not a place to live in
    const chips = page.getByTestId('person-chips')
    await expect.element(chips).toBeVisible()
    await expect.element(chips.getByRole('link', { name: '基本资料' })).toBeVisible()
    // so reading somebody's file is not somewhere the product disappears from
    await expect
      .element(page.getByTestId('bottom-bar').getByRole('link', { name: '测评' }))
      .toBeVisible()
  })

  it('keeps the control that closes the rail inside the rail, and offers it back', async () => {
    await page.viewport(1280, 800)
    shell(
      <WorkspaceShell />,
      '/assessment/batches/:batchId/phases',
      `/assessment/batches/${BATCH_ID}/phases`,
    )

    // the rail has arrived before anything is counted
    await expect.element(page.getByRole('link', { name: '阶段安排' })).toBeVisible()

    // one control, in the rail, while the rail is there to be closed
    const toggle = page.getByRole('button', { name: '收起或展开侧边栏' })
    expect(toggle.elements()).toHaveLength(1)
    await toggle.click()

    // the entries are out of reach - not merely faded, or the keyboard would
    // still walk into them - but the control is not: a rail that closed over
    // its own handle would send somebody back up to the bar to find it
    expect(page.getByRole('link', { name: '阶段安排' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '收起或展开侧边栏' }).elements()).toHaveLength(1)
    await page.getByRole('button', { name: '收起或展开侧边栏' }).click()
    await expect.element(page.getByRole('link', { name: '阶段安排' })).toBeVisible()
  })
})

// --- the press, heard before the address moves --------------------------------

/** a page whose code arrives when the test says so */
const slowPage = () => {
  let release!: () => void
  const Page = lazy(
    () =>
      new Promise<{ default: () => ReactNode }>((resolve) => {
        release = () => resolve({ default: () => <main data-testid="page-entries" /> })
      }),
  )
  return { Page, release: () => release() }
}

describe('the user-detail shell', () => {
  it('fills the rail with the person of the route, sections and all, under the banner slot', async () => {
    await page.viewport(1280, 800)
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...manifest(),
              slots: { 'iam/user-detail-header': [{ id: 'auth/user-detail-header', order: 0 }] },
            }),
        },
        identity: {
          getUser: () =>
            Effect.succeed({
              user: {
                id: USER_ID,
                businessNo: '2023123456',
                email: null,
                emailVerifiedAt: null,
                displayName: '郭航旗',
                status: 'active',
                version: 1,
                userType: { id: 'ut-1', code: 'student', name: '学生' },
                primaryOrgNode: { id: 'n-1', name: '软件学院' },
                manageable: false,
              },
              orgPath: [
                { id: 'n-0', name: '示例大学', orgTypeName: '学校' },
                { id: 'n-1', name: '软件学院', orgTypeName: '学院' },
              ],
              placement: { mode: 'unrestricted' },
              roles: [],
              lastSignInAt: null,
            }),
          // the banner's edit form reads these once opened; the fake client
          // has to know the endpoint for the query to be composed at all
          getUserOptions: () => Effect.succeed({ truncated: false, nodes: [], userTypes: [] }),
        },
      } as never),
      registry: {
        slots: {
          'iam/user-detail-header': {
            'auth/user-detail-header': lazy(
              () =>
                slotComponents['iam/user-detail-header']![
                  'auth/user-detail-header'
                ]!() as Promise<never>,
            ),
          },
        },
      },
      routes: [{ path: '/organization/users/:userId/identities', element: <UserDetailShell /> }],
      route: `/organization/users/${USER_ID}/identities`,
    })
    // the person's own sections stand loose above the ones other plugins
    // file under a group of their own, every path filled with the person
    await expect
      .element(page.getByRole('link', { name: '基本资料' }))
      .toHaveAttribute('href', `/organization/users/${USER_ID}`)
    await expect
      .element(page.getByRole('link', { name: '参评批次' }))
      .toHaveAttribute('href', `/organization/users/${USER_ID}/assessment/batches`)
    // filed under the section its plugin registered, whose label the rail draws
    const filed = await page.getByRole('link', { name: '参评批次' }).element()
    expect(filed.closest('section')?.querySelector('p')?.textContent).toBe('测评')
    // the banner is whoever owns people saying who this is
    await expect.element(page.getByTestId('user-detail-header')).toBeVisible()
    await expect.element(page.getByText('郭航旗', { exact: false })).toBeVisible()
    // the applications stay above it: a person is somewhere inside the product
    await expect.element(page.getByRole('link', { name: '组织与权限' })).toBeVisible()
    // the banner and the page under it start at one edge, on a window wider
    // than the measure as well as on one that is not
    const edgeOf = async (testId: string) =>
      (await page.getByTestId(testId).element()).getBoundingClientRect().left
    for (const width of [1440, 1100]) {
      await page.viewport(width, 800)
      await vi.waitFor(async () =>
        expect(await edgeOf('person-sections')).toBeCloseTo(await edgeOf('user-detail-header'), 0),
      )
    }
  })
})

describe('the account shell', () => {
  it('holds the banner at the height it will have, while who is signed in is on the way', async () => {
    await page.viewport(390, 844)
    const me = {
      id: USER_ID,
      displayName: '张三',
      businessNo: '20990001',
      email: null,
      emailVerified: false,
      userType: { id: 'ut', name: '学生' },
      unit: { id: 'n', name: '示例学院' },
      passwordStatus: 'unset',
    }
    let arrive!: () => void
    const header = lazy(
      () =>
        new Promise<{ default: () => ReactNode }>((resolve) => {
          arrive = () =>
            void (
              slotComponents['account-shell/header']!['auth/account-header']!() as Promise<{
                default: () => ReactNode
              }>
            ).then(resolve)
        }),
    )
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...manifest(),
              slots: { 'account-shell/header': [{ id: 'auth/account-header', order: 0 }] },
            }),
        },
        self: { getSelf: () => Effect.succeed(me) },
      } as never),
      registry: { slots: { 'account-shell/header': { 'auth/account-header': header } } },
      routes: [{ path: '/account', element: <AccountShell /> }],
      route: '/account',
    })
    const outline = page.getByTestId('self-bones')
    await expect.element(outline).toBeInTheDocument()
    const held = outline.element().getBoundingClientRect()
    arrive()
    await expect.element(page.getByRole('heading', { name: '张三' })).toBeVisible()
    const shown = page.getByTestId('account-header').element().getBoundingClientRect()
    // the outline stood where the header now stands, at its height: nothing
    // under the banner moves when the person arrives
    expect(shown.top).toBeCloseTo(held.top, 0)
    expect(Math.abs(shown.height - held.height)).toBeLessThanOrEqual(2)
    await page.viewport(1280, 800)
  })
})

describe('a record\u2019s section', () => {
  it('has the room under the banner to fill, so a failure stands in its middle', async () => {
    await page.viewport(1280, 800)
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
      route: '/account',
      children: (
        <Routes>
          <Route element={<AccountShell />}>
            <Route
              path="/account"
              element={<div data-testid="section" style={{ flexGrow: 1 }} />}
            />
          </Route>
        </Routes>
      ),
    })
    const section = page.getByTestId('section')
    await expect.element(section).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(section.element().getBoundingClientRect().height).toBeGreaterThan(300),
    )
  })
})

describe('a press on the rail', () => {
  it('lights the entry at once and marks it busy after a beat, while the open page stays', async () => {
    await page.viewport(1280, 800)
    const slow = slowPage()
    // the same tree at both addresses, so the boundary the next page
    // suspends in is the one the open page already fills: that is what
    // holds the open page up, in the product and here
    const screen = (content: ReactNode) => (
      <>
        <WorkspaceShell />
        <Suspense fallback={<div data-testid="page-fallback" />}>{content}</Suspense>
      </>
    )
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
      routes: [
        {
          path: '/assessment/batches/:batchId/phases',
          element: screen(<main data-testid="page-phases" />),
        },
        { path: '/assessment/batches/:batchId/entries', element: screen(<slow.Page />) },
      ],
      route: `/assessment/batches/${BATCH_ID}/phases`,
    })
    await expect.element(page.getByTestId('page-phases')).toBeInTheDocument()

    const entry = page.getByRole('link', { name: '参评名单' })
    await entry.click()
    // heard: pending before the address has moved, the open page still up
    await expect.element(entry).toHaveAttribute('data-pending', '')
    await expect.element(entry).toHaveAttribute('aria-busy', 'true')
    await expect.element(page.getByTestId('page-phases')).toBeInTheDocument()
    expect(await page.getByTestId('page-fallback').elements()).toHaveLength(0)
    // and after a beat, busy: the loader stands in the icon's seat
    await expect.element(entry).toHaveAttribute('data-indicating', '')
    expect(entry.element().querySelector('[data-seg]')).not.toBeNull()

    slow.release()
    await expect.element(page.getByTestId('page-entries')).toBeInTheDocument()
    await expect.element(entry).toHaveAttribute('aria-current', 'page')
    await expect.element(entry).not.toHaveAttribute('data-pending')
    await expect.element(entry).not.toHaveAttribute('aria-busy')
    // the loader leaves one commit later than the attributes: `indicating` is
    // cleared by the effect that observes `pending` falling, not by the render
    // that dropped it. So this waits, as its siblings do.
    await expect.poll(() => entry.element().querySelector('[data-seg]')).toBeNull()
  })

  /** the application shell over the users page, with one more page whose code is slow */
  const shellWithSlow = (slowPath: string) => {
    const slow = slowPage()
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
      route: '/organization/users',
      children: (
        <Routes>
          <Route element={<AppShell />}>
            <Route
              element={
                <Suspense fallback={<div data-testid="page-fallback" />}>
                  <Outlet />
                </Suspense>
              }
            >
              <Route path="/organization/users" element={<main data-testid="page-users" />} />
              <Route path={slowPath} element={<slow.Page />} />
            </Route>
          </Route>
        </Routes>
      ),
    })
    return slow
  }

  it('keeps the open section lit and runs a light over the pressed one until it arrives', async () => {
    await page.viewport(390, 844)
    const slow = shellWithSlow('/organization/roles')
    await expect.element(page.getByTestId('page-users')).toBeInTheDocument()
    const open = page.getByTestId('section-chip').filter({ hasText: '用户管理' })
    const pressed = page.getByTestId('section-chip').filter({ hasText: '角色管理' })
    await pressed.click()
    await expect.element(pressed).toHaveAttribute('data-pending', '')
    // one page is open, and the row says so: the pressed chip is not filled in
    await expect.element(open).toHaveAttribute('aria-current', 'page')
    await expect.element(pressed).not.toHaveAttribute('aria-current')
    const ground = (chip: typeof open) => getComputedStyle(chip.element()).backgroundColor
    expect(ground(pressed)).not.toBe(ground(open))
    slow.release()
    await expect.element(page.getByTestId('page-entries')).toBeInTheDocument()
    await expect.element(pressed).toHaveAttribute('aria-current', 'page')
    await expect.element(pressed).not.toHaveAttribute('data-pending')
    await page.viewport(1280, 800)
  })

  it('answers a press at the foot at once, and puts the loader in its mark after a beat', async () => {
    await page.viewport(390, 844)
    const slow = shellWithSlow('/assessment/batches')
    await expect.element(page.getByTestId('page-users')).toBeInTheDocument()
    const cell = page.getByTestId('bottom-bar').getByRole('link', { name: '测评' })
    await cell.click()
    await expect.element(cell).toHaveAttribute('data-pending', '')
    await expect.element(page.getByTestId('page-users')).toBeInTheDocument()
    await expect.element(cell).toHaveAttribute('data-indicating', '')
    expect(cell.element().querySelector('[data-seg]')).not.toBeNull()
    slow.release()
    await expect.element(page.getByTestId('page-entries')).toBeInTheDocument()
    await expect.element(cell).toHaveAttribute('aria-current', 'page')
    await expect.poll(() => cell.element().querySelector('[data-seg]')).toBeNull()
    await page.viewport(1280, 800)
  })

  it('keeps the open application lit at the top while the pressed one is on its way', async () => {
    await page.viewport(1280, 800)
    const slow = shellWithSlow('/assessment/batches')
    await expect.element(page.getByTestId('page-users')).toBeInTheDocument()
    const bar = page.getByTestId('top-bar-apps')
    const pressed = bar.getByRole('link', { name: '测评' })
    await pressed.click()
    await expect.element(pressed).toHaveAttribute('data-pending', '')
    await expect
      .element(bar.getByRole('link', { name: '组织与权限' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(pressed).not.toHaveAttribute('aria-current')
    slow.release()
    await expect.element(page.getByTestId('page-entries')).toBeInTheDocument()
    await expect.element(pressed).toHaveAttribute('aria-current', 'page')
  })

  it('fetches the rail pages while idle, and a bar link on hover', async () => {
    await page.viewport(1280, 800)
    const preloads = {
      phases: vi.fn(() => Promise.resolve()),
      entries: vi.fn(() => Promise.resolve()),
      users: vi.fn(() => Promise.resolve()),
    }
    const registered = (preload: () => Promise<void>) =>
      Object.assign(
        lazy(() => Promise.resolve({ default: () => null })),
        { preload },
      )
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...manifest(),
              pages: [
                {
                  id: 'assessment/batch-phases',
                  path: '/assessment/batches/:batchId/phases',
                  layout: 'workspace-shell/v1',
                },
                {
                  id: 'assessment/batch-entries',
                  path: '/assessment/batches/:batchId/entries',
                  layout: 'workspace-shell/v1',
                },
                {
                  id: 'auth/users',
                  path: '/organization/users',
                  layout: 'app-shell/v1',
                },
              ],
            }),
        },
      }),
      registry: {
        pages: {
          'assessment/batch-phases': registered(preloads.phases),
          'assessment/batch-entries': registered(preloads.entries),
          'auth/users': registered(preloads.users),
        },
      },
      routes: [{ path: '/assessment/batches/:batchId/phases', element: <WorkspaceShell /> }],
      route: `/assessment/batches/${BATCH_ID}/phases`,
    })
    await expect.element(page.getByRole('link', { name: '参评名单' })).toBeVisible()
    // the rail's pages, fetched once the shell has painted
    await vi.waitFor(() => {
      expect(preloads.phases).toHaveBeenCalled()
      expect(preloads.entries).toHaveBeenCalled()
    })
    // an application's first page is nobody's rail entry: fetched when
    // the tab is pointed at
    expect(preloads.users).not.toHaveBeenCalled()
    await page.getByRole('link', { name: '组织与权限' }).hover()
    await vi.waitFor(() => expect(preloads.users).toHaveBeenCalled())
  })
})

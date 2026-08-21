import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// The two shells, against a manifest rather than against props: what the top
// bar shows, which application counts as open, and what the workspace rail
// does with an entry whose path names a parameter. All three used to be
// decided by hand at each call site, which is exactly where a navigation goes
// quietly wrong - an entry pointing at ":batchId" is a link that 404s, and an
// application whose pages the viewer cannot open is a tab leading nowhere.

const AppShell = (await components['layout-default/AppShell']!()).default
const WorkspaceShell = (await components['layout-default/WorkspaceShell']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'

const text = (value: string) => ({ kind: 'literal' as const, value })

const manifest = () => ({
  ...emptyManifest(),
  collections: {
    'app-shell/navigation-groups': [
      { id: 'app/assessment', label: text('测评'), order: 10, icon: 'list-checks' },
      { id: 'app/organization', label: text('组织与权限'), order: 40, icon: 'users' },
      { id: 'batch/admin', label: text('批次管理'), order: 30 },
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
  },
})

const shell = (element: React.ReactNode, path: string, route: string) =>
  renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
    routes: [{ path, element }],
    route,
  })

describe('the application shell', () => {
  it('shows one tab per application and the sections of the open one', async () => {
    shell(<AppShell />, '/organization/users', '/organization/users')

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

  it('folds the top bar away on a phone and hands navigation to the capsule', async () => {
    await page.viewport(390, 844)
    shell(
      <WorkspaceShell />,
      '/assessment/batches/:batchId/phases',
      `/assessment/batches/${BATCH_ID}/phases`,
    )

    // the application bar is folded, not merely shrunk: its links are out of
    // reach, and the rail beside the page is folded with it
    await expect.element(page.getByRole('button', { name: '导航' })).toBeVisible()
    expect(
      page
        .getByRole('link', { name: '组织与权限' })
        .elements()
        .filter((el) => el.checkVisibility()),
    ).toHaveLength(0)
    expect(
      page
        .getByRole('link', { name: '阶段安排' })
        .elements()
        .filter((el) => el.checkVisibility()),
    ).toHaveLength(0)

    // the capsule opens the drawer: the workspace's own pages first, the
    // applications the folded bar carried at the foot
    await page.getByRole('button', { name: '导航' }).click()
    await expect.element(page.getByRole('link', { name: '阶段安排' })).toBeVisible()
    await expect.element(page.getByTestId('drawer-modules')).toBeVisible()
    await expect.element(page.getByRole('link', { name: '测评' })).toBeVisible()

    // closing consumes the history entry the drawer stands on: the escape
    // key here is the phone's back gesture in this harness
    await page
      .getByRole('link', { name: '阶段安排' })
      .element()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect.element(page.getByRole('button', { name: '导航' })).toBeVisible()
    expect(
      page
        .getByRole('link', { name: '阶段安排' })
        .elements()
        .filter((el) => el.checkVisibility()),
    ).toHaveLength(0)
  })

  it('seats the person at the drawer head and the account at its foot', async () => {
    await page.viewport(390, 844)
    let sessionCalls = 0
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...manifest(),
              slots: {
                'app-shell/drawer-identity': [
                  { id: 'auth/drawer-identity', component: 'auth/DrawerIdentity', order: 0 },
                ],
                'app-shell/drawer-account': [
                  { id: 'auth/drawer-account', component: 'auth/DrawerAccount', order: 0 },
                ],
                'app-shell/drawer-sign-out': [
                  { id: 'auth/drawer-sign-out', component: 'auth/DrawerSignOut', order: 0 },
                ],
              },
            }),
        },
        auth: {
          getSession: () => {
            sessionCalls += 1
            return Effect.succeed({
              user: {
                id: '99999999-9999-4999-8999-999999999999',
                displayName: '林知远',
                businessNo: '2023214015',
                userType: { id: 't-1', code: 'student', name: '本科生' },
                primaryOrgNode: {
                  id: 'n-5',
                  code: null,
                  name: '软件工程 2302 班',
                  orgType: { id: 'ot-4', code: 'class', name: '班级' },
                  lineage: [
                    { id: 'n-1', name: 'YY 大学', typeName: '学校' },
                    { id: 'n-2', name: '软件学院', typeName: '学院' },
                    { id: 'n-3', name: '软件工程', typeName: '专业' },
                    { id: 'n-4', name: '2023 级', typeName: '年级' },
                    { id: 'n-5', name: '软件工程 2302 班', typeName: '班级' },
                  ],
                },
                tenant: { id: 'tn-1', slug: 'main', name: '本部' },
              },
            })
          },
        },
      } as never),
      registry: {
        'auth/DrawerIdentity': lazy(() => components['auth/DrawerIdentity']!() as Promise<never>),
        'auth/DrawerAccount': lazy(() => components['auth/DrawerAccount']!() as Promise<never>),
        'auth/DrawerSignOut': lazy(() => components['auth/DrawerSignOut']!() as Promise<never>),
      },
      routes: [
        {
          path: '/assessment/batches/:batchId/phases',
          element: <WorkspaceShell />,
        },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/phases`,
    })

    // the seats are warmed before the first tap: the identity is already
    // mounted out of sight, so opening the drawer assembles nothing
    await expect.poll(() => page.getByText('林知远').elements().length).toBeGreaterThan(0)

    await page.getByRole('button', { name: '导航' }).click()

    // the head says who, and where they stand - the node's own name, not
    // the whole ancestry (queries scoped to the drawer: the warm copy is
    // still standing out of sight)
    const drawer = page.getByRole('dialog')
    await expect.element(drawer.getByText('林知远')).toBeVisible()
    await expect.element(drawer.getByText('软件工程 2302 班')).toBeVisible()
    expect(page.getByText('2023 级', { exact: false }).elements()).toHaveLength(0)

    // the ancestry waits behind a tap and arrives as one written line
    await page.getByRole('button', { name: /软件工程 2302 班/ }).click()
    await expect.element(drawer.getByText(/软件学院 \/ 软件工程 \/ 2023 级/)).toBeVisible()
    // and folds back to the plain name
    await page.getByRole('button', { name: /软件学院/ }).click()
    expect(page.getByText('2023 级', { exact: false }).elements()).toHaveLength(0)

    // the foot carries the preferences and the way out, and the module row
    // wears each module's own mark
    await expect.element(page.getByRole('button', { name: '退出登录' })).toBeVisible()
    await expect.element(drawer.getByTestId('drawer-account')).toBeVisible()
    const moduleLink = page.getByRole('link', { name: '测评' }).element()
    expect(moduleLink.querySelector('svg')).not.toBeNull()

    // one identity, told once: the folded top bar's account corner asked at
    // page entry, and the drawer reads that answer instead of asking again -
    // however many times it opens. A real Escape, not a synthetic event: the
    // drawer closes through the same path a person's key takes, and the
    // reopen waits for the dialog to actually be gone - an exit animation
    // interrupted mid-flight leaves the page aria-hidden, where no role
    // query can see the bar it is asking for.
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => page.getByRole('dialog').elements().length, { timeout: 10_000 }).toBe(0)
    // the dialog leaving the DOM is not the end of it: radix lifts the
    // page's aria-hidden in a passive effect, and on a loaded machine that
    // cleanup trails the unmount - so poll until the bar is back in the
    // accessibility tree instead of giving it one second to reappear
    await expect
      .poll(() => page.getByRole('button', { name: '导航' }).elements().length, {
        timeout: 10_000,
      })
      .toBe(1)
    await page.getByRole('button', { name: '导航' }).click()
    await expect.element(page.getByRole('dialog').getByText('林知远')).toBeVisible()
    expect(sessionCalls).toBe(1)
  })

  it('navigating from the drawer lands with the drawer closed', async () => {
    await page.viewport(390, 844)
    shell(
      <WorkspaceShell />,
      '/assessment/batches/:batchId/phases',
      `/assessment/batches/${BATCH_ID}/phases`,
    )

    await page.getByRole('button', { name: '导航' }).click()
    await page.getByRole('link', { name: '阶段安排' }).click()
    // the destination stands clear; the drawer went with the navigation
    await expect.element(page.getByRole('button', { name: '导航' })).toBeVisible()
    expect(
      page
        .getByRole('link', { name: '阶段安排' })
        .elements()
        .filter((el) => el.checkVisibility()),
    ).toHaveLength(0)
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

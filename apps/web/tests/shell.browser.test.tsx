import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
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
      { id: 'app/assessment', label: text('测评'), order: 10 },
      { id: 'app/organization', label: text('组织与权限'), order: 40 },
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
    // the applications stay above it: a workspace is somewhere inside the
    // product, not a place the product disappears from
    await expect.element(page.getByRole('link', { name: '组织与权限' })).toBeVisible()
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

    // the entries are gone but the control is not: a rail that closed over
    // its own handle would send somebody back up to the bar to find it
    expect(page.getByRole('link', { name: '阶段安排' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '收起或展开侧边栏' }).elements()).toHaveLength(1)
    await page.getByRole('button', { name: '收起或展开侧边栏' }).click()
    await expect.element(page.getByRole('link', { name: '阶段安排' })).toBeVisible()
  })
})

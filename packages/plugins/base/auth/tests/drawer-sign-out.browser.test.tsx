import DrawerSignOut from '../src/client/DrawerSignOut.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The way out of a session, where the host puts it: at the end of the
// drawer's last row, or alone on a screen that has nothing else to offer,
// where it is that screen's one action and drawn as the others are.

const session = {
  user: {
    id: 'u',
    displayName: '张三',
    businessNo: '20990001',
    userType: { id: 't', code: 'student', name: '学生' },
    primaryOrgNode: {
      id: 'n',
      name: '示例学院',
      orgType: { id: 'k', name: '学院' },
      lineage: [{ id: 'n', name: '示例学院', typeName: '学院' }],
    },
    tenant: { id: 'tn', slug: 'demo', name: '示例大学' },
  },
}

const mount = async (standalone: boolean) => {
  const end = vi.fn(() => Effect.succeed(undefined))
  await renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      auth: { getSession: () => Effect.succeed(session), endSession: end },
    }),
    children: <DrawerSignOut {...(standalone ? { context: { standalone: true } } : {})} />,
  })
  return { end }
}

describe('the way out of a session', () => {
  it('is a quiet line at the drawer’s foot', async () => {
    await mount(false)
    const way = page.getByRole('button', { name: '退出登录' })
    await expect.element(way).toBeVisible()
    expect(way.element().getAttribute('data-slot')).toBeNull()
  })

  it('is the screen’s action when it stands alone, and still ends the session', async () => {
    const { end } = await mount(true)
    const way = page.getByRole('button', { name: '退出登录' })
    await expect.element(way).toHaveAttribute('data-slot', 'button')
    await expect.element(way).toHaveAttribute('data-variant', 'default')
    await way.click()
    await vi.waitFor(() => expect(end).toHaveBeenCalledTimes(1))
  })
})

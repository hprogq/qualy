import UserMenu from '../src/client/UserMenu.tsx'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The account corner's menu keeps its width however long a unit is named:
// the name gives way at its end, the menu does not grow across the bar.

const LONG = '外国语言文学与跨文化交际研究院国际中文教育与汉语国际推广联合培养中心'

describe('the account menu', () => {
  it('cuts a long unit name short instead of widening', async () => {
    renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        auth: {
          getSession: () =>
            Effect.succeed({
              user: {
                id: 'u',
                displayName: '张三',
                businessNo: '20990001',
                userType: { id: 't', code: 'student', name: '学生' },
                primaryOrgNode: {
                  id: 'n',
                  name: LONG,
                  orgType: { id: 'k', name: '中心' },
                  lineage: [
                    { id: 'r', name: '示例大学', typeName: '学校' },
                    { id: 'n', name: LONG, typeName: '中心' },
                  ],
                },
                tenant: { id: 'tn', slug: 'demo', name: '示例大学' },
              },
            }),
        },
      }),
      route: '/',
      children: <UserMenu />,
    })
    await page.getByRole('button', { name: /张三/ }).click()
    const step = page.getByTitle(LONG)
    await expect.element(step).toBeVisible()
    const menu = step.element().closest('[data-slot="dropdown-menu-content"]')!
    expect(menu.getBoundingClientRect().width).toBeLessThanOrEqual(16 * 16 + 1)
    const name = step.element() as HTMLElement
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
  })
})

import { useState } from 'react'
import OrgNodePicker from '../src/client/iam/OrgNodePicker.tsx'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The tree people point at, in the two shapes it is asked for: one unit as a
// filter, and a set of units as an answer.
//
// What is pinned here is the part that reads as a defect rather than as a
// preference - that pointing at a branch never takes its children off the
// screen, and that one choice is not restated underneath the tree it was
// made in.

const ROOT = '22222222-2222-4222-8222-222222222201'
const id = (n: number) => `22222222-2222-4222-8222-2222222223${String(n).padStart(2, '0')}`
const TYPE = (n: number) => `33333333-3333-4333-8333-3333333333${String(n).padStart(2, '0')}`

const nodes = [
  { orgNodeId: ROOT, name: '示例大学', parentId: null, orgTypeId: TYPE(1) },
  { orgNodeId: id(1), name: '软件学院', parentId: ROOT, orgTypeId: TYPE(2) },
  { orgNodeId: id(2), name: '软件工程', parentId: id(1), orgTypeId: TYPE(3) },
  { orgNodeId: id(3), name: '软件工程 2301 班', parentId: id(2), orgTypeId: TYPE(4) },
  { orgNodeId: id(4), name: '软件工程 2302 班', parentId: id(2), orgTypeId: TYPE(4) },
]

const world = () => ({
  app: { getManifest: () => Effect.succeed(emptyManifest()) },
  identity: {
    getUserOptions: () =>
      Effect.succeed({
        truncated: false,
        nodes,
        orgTypes: [
          { id: TYPE(1), name: '学校' },
          { id: TYPE(2), name: '学院' },
          { id: TYPE(3), name: '专业' },
          { id: TYPE(4), name: '班级' },
        ],
        userTypes: [],
      }),
  },
})

function Harness({ single }: { single: boolean }) {
  const [value, setValue] = useState<readonly string[]>([])
  return <OrgNodePicker context={{ single, value, onChange: setValue }} />
}

describe('the unit picker', () => {
  // Pointing at a branch used to fold it: the row was one button that both
  // chose the unit and toggled it, so looking into a college took the
  // college's classes off the screen.
  it('unfolds a branch when it is chosen, and never folds one', async () => {
    await renderScreen({ client: fakeClient(world()), children: <Harness single /> })

    const major = page.getByRole('button', { name: '软件工程 专业', exact: true })
    await expect.element(major).toBeVisible()
    // deep enough to start folded, so this is the press that opens it
    expect(page.getByRole('button', { name: /软件工程 2301 班/ }).elements()).toHaveLength(0)

    await major.click()
    await expect.element(page.getByRole('button', { name: /软件工程 2301 班/ })).toBeVisible()
    // and again: a second press on a unit already chosen leaves what is
    // under it exactly where it was
    await major.click()
    await expect.element(page.getByRole('button', { name: /软件工程 2301 班/ })).toBeVisible()

    // the twistie is what folds
    await page.getByRole('button', { name: '展开或收起 软件工程' }).click()
    await expect
      .poll(async () => page.getByRole('button', { name: /软件工程 2301 班/ }).elements().length)
      .toBe(0)
  })

  it('says one chosen unit once, and a set of them underneath', async () => {
    await renderScreen({ client: fakeClient(world()), children: <Harness single /> })

    const college = page.getByRole('button', { name: '软件学院 学院', exact: true })
    await expect.element(college).toBeVisible()
    await college.click()
    // the row it was made on says it; nothing restates it below the tree,
    // because a single choice needs no list and no second way to undo it
    await expect.element(college).toHaveAttribute('aria-current', 'true')
    expect(page.getByTestId('chosen-units').elements()).toHaveLength(0)

    // pressing the chosen row again is how it is let go
    await college.click()
    await expect.element(college).toHaveAttribute('aria-current', 'false')
  })

  it('summarises a set of units, which one unit does not need', async () => {
    await renderScreen({ client: fakeClient(world()), children: <Harness single={false} /> })

    const box = page.getByRole('checkbox', { name: '软件学院', exact: false })
    await expect.element(box).toBeVisible()
    await box.click()
    // a set can run past what the tree shows, so it is worth a summary
    await expect.element(page.getByTestId('chosen-units')).toBeVisible()
  })
})

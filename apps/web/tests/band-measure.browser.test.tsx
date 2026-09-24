import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { BandAction, BandActions, Card, CardHead, Screen, Segmented } from '@qualy/ui/screen'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// Every band the same height, so the row of sections hanging under it does
// not move when the reader crosses from one page of an application to the
// next.
//
// The two things that used to make one band taller than another are a page
// with no description and a page whose actions wrapped on to a second row.
// Both are pinned here, at a phone's width, where the room is tightest and
// the wrapping happened.

const band = () => document.querySelector('[data-slot="page-container"]')!.parentElement!

const draw = (
  title: string,
  description: string | undefined,
  actions: React.ReactNode,
  titleAside?: React.ReactNode,
) =>
  renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
    route: '/x',
    children: (
      <Screen
        title={title}
        description={description}
        size="broad"
        actions={actions}
        titleAside={titleAside}
      >
        <Card>
          <CardHead title="内容" />
        </Card>
      </Screen>
    ),
  })

const one = (label: string) => (
  <BandActions
    moreLabel="更多操作"
    primary={
      <BandAction variant="primary" onSelect={() => undefined}>
        {label}
      </BandAction>
    }
  />
)

const several = (label: string) => (
  <BandActions
    moreLabel="更多操作"
    primary={
      <BandAction variant="primary" onSelect={() => undefined}>
        {label}
      </BandAction>
    }
    rest={
      <>
        <BandAction onSelect={() => undefined}>查找用户</BandAction>
        <BandAction onSelect={() => undefined}>导入记录</BandAction>
        <BandAction variant="outline" onSelect={() => undefined}>
          导入用户
        </BandAction>
      </>
    }
  />
)

// a page whose name has a view switch beside it: the shape that used to
// push the band taller than the rest
const switcher = (
  <Segmented
    label="视图"
    value="structure"
    onChange={() => undefined}
    options={[
      { value: 'structure', label: '组织结构' },
      { value: 'types', label: '组织类型' },
    ]}
  />
)

const shapes: [string, string | undefined, React.ReactNode, React.ReactNode?][] = [
  ['组织架构', '名称与上下级。', one('新建组织')],
  ['用户', '按组织管理。', several('新建用户')],
  ['角色', '谁能做什么。', one('新建角色')],
  ['用户类型', '谁站在哪里。', one('新建用户类型')],
  // the one this was really about: a page with no description, and no actions
  ['审计日志', undefined, null],
  ['组织架构', '名称与上下级。', one('新建组织'), switcher],
]

describe('the band every page of an application opens on', () => {
  it.each([
    ['a phone', 390],
    ['a tablet', 820],
  ])('is the same height on %s whatever the page puts in it', async (_name, width) => {
    await page.viewport(width, 900)
    const heights: number[] = []
    for (const [title, description, actions, aside] of shapes) {
      await draw(title, description, actions, aside)
      await expect.element(page.getByRole('heading', { name: title }).first()).toBeVisible()
      heights.push(band().getBoundingClientRect().height)
    }
    // said as the run rather than as a count, so a failure names the shapes
    // that disagreed and by how much
    // Compared as a set: the run is what a failure should print, so the
    // shapes that disagreed and by how much are in the message.
    expect(new Set(heights.map((height) => Math.round(height))).size).toBe(1)
    await page.viewport(1280, 800)
  })
})

import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
// the real stylesheet, because one assertion here is about visibility
// classes: the add key must not hide behind a hover
import '../src/app.css'

// The review chain as its author composes it: every step must be named and
// staffed before the question can be saved, and the chain itself has to say
// which step is unfinished; steps are added, reordered and removed with
// controls that are on show rather than discovered by hovering.

const ItemSettingsPage = (await components['assessment/ItemSettingsPage']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PAPER_ID = '22222222-2222-4222-8222-222222222222'
const ORG_TYPE_ID = '33333333-3333-4333-8333-333333333333'
const ROLE_ID = '44444444-4444-4444-8444-444444444444'

const PAGES = [{ id: 'assessment/batch-items', path: '/assessment/batches/:batchId/items' }].map(
  (entry) => ({ ...entry, component: entry.id, layout: 'admin' }),
)

const batch = () => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: false, manage: true },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'draft',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
})

const open = () =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              {
                id: PAPER_ID,
                parentGroupId: null,
                name: '综合素质测评',
                cap: null,
                floor: null,
                sortOrder: 0,
                itemCount: 0,
              },
            ],
            version: 1,
            capabilities: { canManage: true },
          }),
        listItems: () => Effect.succeed({ items: [], capabilities: { canManage: true } }),
        itemOptions: () =>
          Effect.succeed({
            orgTypes: [{ id: ORG_TYPE_ID, code: 'class', name: '班级' }],
            roles: [{ id: ROLE_ID, name: '审核员' }],
          }),
        reviewAlerts: () => Effect.succeed({ groups: [] }),
        reviewCoverage: () => Effect.succeed({ nodes: [] }),
      },
    } as never),
    routes: [
      {
        path: '/assessment/batches/:batchId/items',
        element: <ItemSettingsPage />,
      },
    ] as never,
    route: `/assessment/batches/${BATCH_ID}/items`,
  })

/** into the editor of a question being composed, chain on screen */
const composeQuestion = async () => {
  open()
  await page.getByRole('button', { name: '新建' }).click()
  await page.getByRole('menuitem', { name: '新建项目' }).click()
  await expect.element(page.getByTestId('chain-step').first()).toBeVisible()
}

describe('composing the review chain', () => {
  it('marks the unnamed step unfinished instead of dressing it in a default name', async () => {
    await composeQuestion()

    // the fresh step has neither name nor reviewers: the chain says so
    const step = page.getByTestId('chain-step').first()
    await expect.element(step).toHaveAttribute('data-step-complete', 'false')

    // naming it and choosing its reviewers is what completes it
    await step.getByRole('button').first().click()
    const sheet = page.getByRole('dialog')
    const name = sheet.getByRole('textbox', { name: '环节名称' })
    // the name is required, and the field says so before anybody saves
    await expect.element(name).toHaveAttribute('aria-required')
    await name.fill('班委初审')
    await sheet.getByRole('checkbox', { name: '审核员' }).click()
    await sheet.getByRole('button', { name: '关闭' }).click()

    await expect.element(step).toHaveAttribute('data-step-complete', 'true')
    await expect.element(page.getByText('班委初审')).toBeVisible()
  })

  it('keeps the add key on show, and the sole ordinary step deletable-looking but held', async () => {
    await composeQuestion()

    // the way steps are added must be visible before anybody hovers: the
    // gap keys exist and are painted, not parked at opacity zero
    const adds = page.getByRole('button', { name: '添加审核步骤' }).elements()
    expect(adds.length).toBeGreaterThanOrEqual(2)
    for (const key of adds) {
      expect(getComputedStyle(key).opacity).toBe('1')
    }

    // the one step the ordinary route must keep: its remove key stands,
    // disabled, rather than vanishing and leaving nothing to explain
    const step = page.getByTestId('chain-step').first()
    await expect.element(step.getByRole('button', { name: '删除步骤' })).toBeDisabled()
    // and with a single step there is nowhere to move it
    await expect.element(step.getByRole('button', { name: '前移' })).toBeDisabled()
    await expect.element(step.getByRole('button', { name: '后移' })).toBeDisabled()
  })

  it('adds where the press pointed, reorders with the arrows, and frees the delete key', async () => {
    await composeQuestion()

    // name the step that is already there
    const first = page.getByTestId('chain-step').first()
    await first.getByRole('button').first().click()
    const sheet = () => page.getByRole('dialog')
    await sheet().getByRole('textbox', { name: '环节名称' }).fill('班委初审')
    await sheet().getByRole('checkbox', { name: '审核员' }).click()
    await sheet().getByRole('button', { name: '关闭' }).click()

    // one more after it, named through the sheet the add opens; the
    // locator click waits out the closing panel's animation
    await page.getByRole('button', { name: '添加审核步骤' }).nth(1).click()
    await sheet().getByRole('textbox', { name: '环节名称' }).fill('专业复审')
    await sheet().getByRole('checkbox', { name: '审核员' }).click()
    await sheet().getByRole('button', { name: '关闭' }).click()

    const titlesNow = () =>
      page
        .getByTestId('chain-step')
        .elements()
        .map((node) => node.textContent ?? '')
    expect(titlesNow()[0]).toContain('班委初审')
    expect(titlesNow()[1]).toContain('专业复审')

    // the arrows swap neighbours; order is the chain's whole meaning
    await page.getByTestId('chain-step').first().getByRole('button', { name: '后移' }).click()
    expect(titlesNow()[0]).toContain('专业复审')
    expect(titlesNow()[1]).toContain('班委初审')

    // two steps on the ordinary route: both removable now, and removing
    // one puts the sole survivor back under guard
    await page.getByTestId('chain-step').first().getByRole('button', { name: '删除步骤' }).click()
    expect(page.getByTestId('chain-step').elements()).toHaveLength(1)
    await expect
      .element(page.getByTestId('chain-step').getByRole('button', { name: '删除步骤' }))
      .toBeDisabled()
  })
})

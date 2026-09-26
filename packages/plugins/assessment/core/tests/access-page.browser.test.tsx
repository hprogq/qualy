import BatchAccessPage from '../src/client/BatchAccessPage.tsx'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { AccessAdjustDialog } from '../src/client/access/AccessAdjustDialog.tsx'
import { AccessSyncDialog } from '../src/client/access/AccessSyncDialog.tsx'
import zh from '../src/client/locales/zh-CN.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// How one round's staff reads at the widths people actually use: a role and
// where it is held, never one squeezing the other out; a name that runs
// long shortened the same way on every row; the grid's marks explained; and
// the dialogs answering in full sentences rather than with a name repeated
// or a bare "none".

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ROLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NODE_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_NODE = '56555555-5555-4555-8555-555555555555'

const LONG_ROLE = '学院综合素质测评工作领导小组副组长'
const CLASS_A = '计算机科学与技术2203班'
const CLASS_B = '计算机科学与技术2204班'
const LONG_NAME = '欧阳娜娜提木·买买提艾力江·阿不都热合曼'
/** one word with nowhere to break, in the language whose button is widest */
const LATIN_NAME = 'Abdulrahmanmuhammadalmaktoumhussainibrahimalfarsi'

let counter = 0
const uuid = () => {
  counter += 1
  return `aaaaaaaa-aaaa-4aaa-8aaa-${counter.toString(16).padStart(12, '0')}`
}

const source = (over: Record<string, unknown> = {}) => ({
  sourceId: uuid(),
  assignmentId: uuid(),
  roleId: ROLE_ID,
  roleName: '班级综测负责人',
  origin: 'inherited' as const,
  orgNodeId: NODE_ID,
  orgNodeName: CLASS_A,
  coverage: 'subtree' as const,
  accepted: ['assessment.review.process'],
  current: ['assessment.review.process'],
  active: true,
  lapse: null,
  removable: false,
  ...over,
})

const subject = (over: Record<string, unknown> = {}) => ({
  userId: uuid(),
  displayName: '王审核',
  businessNo: 'T0001',
  sources: [source()],
  denied: [],
  effective: ['assessment.review.process'],
  manageable: true,
  ...over,
})

/** the round a staff page is about, and the people on it */
const batch = {
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: false, manage: true, redetermine: false },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
}

/** a long role over a long unit, one role in two classes, and a lapsed long name */
const hostile = () => [
  subject({
    displayName: '张明远',
    sources: [source({ roleName: LONG_ROLE, orgNodeName: CLASS_A })],
  }),
  subject({
    displayName: '李思远',
    sources: [
      source({ orgNodeName: CLASS_A }),
      source({
        orgNodeId: OTHER_NODE,
        orgNodeName: CLASS_B,
        origin: 'explicit',
        removable: true,
        accepted: ['assessment.review.process', 'assessment.ranking.view'],
        current: ['assessment.review.process', 'assessment.ranking.view'],
      }),
    ],
    denied: ['assessment.ranking.view'],
  }),
  subject({
    displayName: LONG_NAME,
    sources: [source({ active: false, lapse: 'revoked', current: [] })],
    effective: [],
  }),
]

const open = (staff: readonly unknown[], locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
  renderScreen({
    locale,
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: [
              {
                id: 'assessment/batch-access',
                path: '/assessment/batches/:batchId/access',
                layout: 'admin',
              },
            ],
          }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch }),
        listAccess: () =>
          Effect.succeed({
            staff,
            total: staff.length,
            page: 1,
            pageSize: 25,
            roles: [{ id: ROLE_ID, name: '班级综测负责人', count: staff.length }],
          }),
        previewAccessSync: () =>
          Effect.succeed({ items: [], nextCursor: null, pendingTotal: 0, lapsedTotal: 0 }),
        staffOptions: () => Effect.succeed({ nodes: [], roles: [] }),
        listScopeOptions: () => Effect.succeed({ nodes: [] }),
        listUserTypeOptions: () => Effect.succeed({ userTypes: [] }),
        listParticipantCandidates: () =>
          Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
      },
    }),
    routes: [{ path: '/assessment/batches/:batchId/access', element: <BatchAccessPage /> }],
    route: `/assessment/batches/${BATCH_ID}/access`,
  })

/** an element is drawn whole: nothing of it is cut off by its own box */
const whole = (element: Element) => element.scrollWidth <= element.clientWidth + 1

/** a control's words fit inside it, however its box was squeezed */
const wordsFit = (element: Element) => {
  const words = document.createRange()
  words.selectNodeContents(element)
  const style = getComputedStyle(element)
  const room =
    element.getBoundingClientRect().width -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight)
  return words.getBoundingClientRect().width <= room + 1
}

const atWidth = async (width: number, body: () => Promise<void>) => {
  await page.viewport(width, 900)
  try {
    await body()
  } finally {
    await page.viewport(1280, 800)
  }
}

describe('where each role is held', () => {
  // The role kept its width and the unit gave up all of its own: at a
  // desk's width a unit came down to a character or two, and one role in
  // two classes read as the same line twice.
  for (const width of [1100, 1440, 1920]) {
    it(`keeps the unit whole under a long role at ${String(width)} wide`, async () => {
      await atWidth(width, async () => {
        await open(hostile())
        const units = page.getByTestId('access-source-unit')
        await expect.element(units.first()).toBeVisible()
        for (const unit of units.elements()) expect(whole(unit)).toBe(true)
        const texts = units.elements().map((unit) => unit.textContent)
        // the same role, told apart by where it is held
        expect(texts).toContain(CLASS_A)
        expect(texts).toContain(CLASS_B)
      })
    })
  }

  it('says the whole institution, and a unit the reader does not manage, in words', async () => {
    await open([
      subject({ sources: [source({ orgNodeId: null, orgNodeName: null })] }),
      subject({ sources: [source({ orgNodeName: null })] }),
    ])
    const lines = page.getByTestId('access-source')
    await expect.element(lines.first()).toBeVisible()
    expect(lines.elements().map((line) => line.getAttribute('data-where'))).toEqual([
      'everywhere',
      'beyond',
    ])
    for (const unit of page.getByTestId('access-source-unit').elements()) {
      expect(unit.textContent).not.toBe('')
    }
  })
})

describe('a name that runs long', () => {
  // A lapsed row was dimmed through an inline wrapper, which let the name
  // run out of its cell and be cut off mid-character, where every other row
  // ends in an ellipsis.
  for (const width of [834, 1100, 1440, 1920]) {
    it(`shortens a lapsed person's name inside their cell at ${String(width)} wide`, async () => {
      await atWidth(width, async () => {
        await open(hostile())
        const name = page.getByText(LONG_NAME)
        await expect.element(name).toBeVisible()
        const row = name.element().closest('[data-testid="access-subject"]')!
        expect(row.getAttribute('data-idle')).toBe('true')
        const sources = row.querySelector('ul')!.getBoundingClientRect()
        const box = name.element().getBoundingClientRect()
        // it ends where its cell does, rather than under the next column
        expect(box.right).toBeLessThanOrEqual(sources.left)
        expect(getComputedStyle(name.element()).textOverflow).toBe('ellipsis')
      })
    })
  }

  it('keeps the adjust button whole beside a long name on a phone', async () => {
    await atWidth(390, async () => {
      await open([subject({ displayName: LATIN_NAME, businessNo: 'T2023000123456' })], 'en-US')
      const adjust = page.getByRole('button', { name: 'Adjust' })
      await expect.element(adjust).toBeVisible()
      expect(wordsFit(adjust.element())).toBe(true)
      // inside the card, not running off its edge behind the name it lost to
      const card = adjust.element().closest('[data-testid="access-subject"]')!
      expect(adjust.element().getBoundingClientRect().right).toBeLessThanOrEqual(
        card.getBoundingClientRect().right,
      )
    })
  })
})

describe('the filters on a phone', () => {
  // Three choices shared one line and cut their own values off mid-word.
  it('shows each choice whole in the longer language', async () => {
    await atWidth(390, async () => {
      await open(hostile(), 'en-US')
      await expect.element(page.getByTestId('access-staff')).toBeVisible()
      for (const id of [
        'access-filter-role',
        'access-filter-permission',
        'access-filter-standing',
      ]) {
        const value = page.getByTestId(id).element().querySelector('[data-slot="select-value"]')!
        expect(whole(value)).toBe(true)
      }
    })
  })
})

describe('the grid of capabilities', () => {
  it('says what its marks mean, and reads a turned-off one as one phrase', async () => {
    await atWidth(1600, async () => {
      await open(hostile())
      const staff = page.getByTestId('access-staff')
      await expect.element(staff).toHaveAttribute('data-shape', 'matrix')
      const legend = page.getByTestId('access-legend')
      await expect.element(legend).toBeVisible()
      expect(
        [...legend.element().querySelectorAll('[data-mark]')].map((mark) =>
          mark.getAttribute('data-mark'),
        ),
      ).toEqual(['granted', 'withheld'])
      // a screen reader hears the capability and its state as one message,
      // not the two run together
      const withheld = staff
        .getByTestId('access-grant')
        .elements()
        .find((cell) => cell.getAttribute('data-state') === 'withheld')!
      expect(withheld.textContent).toBe(
        zh['assessment/access/permission-withheld'].replace(
          '{name}',
          zh['assessment/permission/ranking-view'],
        ),
      )
    })
  })

  it('names the unit when asking to take one of two appointments back', async () => {
    await open(hostile())
    await page.getByTestId('access-actions').click()
    await page.getByTestId('access-remove').click()
    const confirm = page.getByRole('alertdialog')
    await expect.element(confirm).toBeVisible()
    await expect.element(confirm.getByText(CLASS_B, { exact: false })).toBeVisible()
  })
})

describe('adjusting somebody with nothing left', () => {
  const dialog = (sources: readonly unknown[]) =>
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
      children: (
        <AccessAdjustDialog
          subject={subject({ displayName: '离任的老师', sources, effective: [] })}
          archived={false}
          open
          pending={false}
          onSave={() => {}}
          onReview={() => {}}
          onClose={() => {}}
        />
      ),
    })

  it('says why in the one way it lapsed, without naming them twice', async () => {
    await dialog([source({ active: false, lapse: 'expired', current: [] })])
    const blank = page.getByTestId('access-adjust-nothing')
    await expect.element(blank).toHaveAttribute('data-lapse', 'expired')
    // the dialog's own title already says whose permissions these are
    expect(blank.element().textContent).not.toContain('离任的老师')
  })

  it('says the several ways together when they differ', async () => {
    await dialog([
      source({ active: false, lapse: 'revoked', current: [] }),
      source({ active: false, lapse: 'inapplicable', current: [] }),
    ])
    await expect
      .element(page.getByTestId('access-adjust-nothing'))
      .toHaveAttribute('data-lapse', 'several')
  })
})

describe('the changes from the organization', () => {
  it('says where each change is held, even where the reader may not name the unit', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        assessment: {
          previewAccessSync: () =>
            Effect.succeed({
              items: [
                {
                  id: uuid(),
                  kind: 'new' as const,
                  userId: uuid(),
                  displayName: '新来的老师',
                  businessNo: 'T0002',
                  roleName: '学校综测督查组',
                  orgNodeId: NODE_ID,
                  orgNodeName: null,
                  permissions: ['assessment.review.process'],
                },
              ],
              nextCursor: null,
              pendingTotal: 1,
              lapsedTotal: 0,
            }),
        },
      }),
      children: (
        <AccessSyncDialog
          batchId={BATCH_ID}
          archived={false}
          open
          pending={false}
          onMerge={() => {}}
          onClose={() => {}}
        />
      ),
    })
    await expect
      .element(page.getByTestId('access-change-role'))
      .toHaveAttribute('data-where', 'beyond')
  })
})

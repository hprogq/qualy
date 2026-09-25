import MyResultPage from '../src/client/result/MyResultPage.tsx'
import { ResultLedger } from '../src/client/result/ResultLedger.tsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect, Stream } from 'effect'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The score page as its reader uses it: one column of account, an outline
// beside it at a desk and a row of chips over it on a phone, claims opened
// in place and followed to the filing page, and the page keeping current
// while the round moves. Business facts are read off data-* hooks; the
// copy is the catalog's business.

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222'

afterEach(() => page.viewport(414, 896))

const PAGES = [
  { id: 'assessment/batch-my-result', path: '/assessment/batches/:batchId/my-result' },
  { id: 'assessment/batch-my-entries', path: '/assessment/batches/:batchId/my-entries' },
].map((entry) => ({ ...entry, layout: 'admin' }))

const batch = {
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: false,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: true, review: false, record: false, manage: false, redetermine: false },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 1,
  currentPhaseId: null,
  currentPhaseName: '填报期',
  createdAt: '2026-02-01T00:00:00.000Z',
}

type Group = {
  groupId: string
  parentGroupId: string | null
  depth: number
  name: string
  itemsTotal: string
  childrenTotal: string
  raw: string
  final: string
  cap: string | null
  floor: string | null
}

const group = (
  groupId: string,
  name: string,
  figures: { final: string; raw?: string; cap?: string | null; parent?: string },
): Group => ({
  groupId,
  parentGroupId: figures.parent ?? null,
  depth: figures.parent === undefined ? 0 : 1,
  name,
  itemsTotal: figures.raw ?? figures.final,
  childrenTotal: '0.00',
  raw: figures.raw ?? figures.final,
  final: figures.final,
  cap: figures.cap ?? null,
  floor: null,
})

const FORM = {
  fields: [
    { id: 'name', key: 'name', type: 'text', label: '名称' },
    { id: 'level', key: 'level', type: 'text', label: '级别' },
  ],
}

const item = (
  id: string,
  scoreGroupId: string,
  title: string,
  over: {
    channels?: ('participant' | 'administrative')[]
    each?: string
    status?: string
    itemType?: string
  } = {},
) => ({
  id,
  batchId: BATCH_ID,
  itemType: over.itemType ?? 'evidence',
  title,
  scoreGroupId,
  maxEntries: null,
  sortOrder: 0,
  status: over.status ?? 'active',
  voidReason: null,
  currentRevision: {
    id: `${id}-rev`,
    revisionNo: 1,
    entryChannels: over.channels ?? (['participant'] as ('participant' | 'administrative')[]),
    formConfig: FORM,
    scoringConfig:
      over.each === undefined
        ? null
        : { calculator: { ref: 'fixed@1', config: { value: over.each } } },
    reviewPolicy: null,
    displayConfig: null,
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
})

const hidden = { state: 'hidden' as const, reason: null }

const entry = (
  id: string,
  itemId: string,
  status: string,
  over: { source?: string; name?: string; level?: string; supplement?: boolean } = {},
) => ({
  id,
  batchId: BATCH_ID,
  itemId,
  participantId: PARTICIPANT_ID,
  status,
  source: over.source ?? 'self',
  currentRevision: {
    id: `${id}-rev`,
    revisionNo: 1,
    itemRevisionId: `${itemId}-rev`,
    payload: { name: over.name ?? `${id} 名称`, level: over.level ?? '校级' },
    note: null,
    source: over.source ?? 'self',
    actorId: PARTICIPANT_ID,
    subjectId: PARTICIPANT_ID,
    attachments: [],
    createdAt: '2026-03-02T00:00:00.000Z',
  },
  currentReviewInstanceId: null,
  createdAt: '2026-03-02T00:00:00.000Z',
  supplement:
    over.supplement === true
      ? {
          requestId: `${id}-ask`,
          instanceId: `${id}-round`,
          requestNo: 1,
          instructions: '请补充证明',
          requirements: [],
          requestedByName: null,
          requestedAt: '2026-03-03T00:00:00.000Z',
        }
      : null,
  refusal: null,
  openRound: null,
  recognition:
    status === 'approved'
      ? {
          id: `${id}-rec`,
          source: over.source === 'record' ? 'record' : 'review',
          entryRevisionId: `${id}-rev`,
          fields: [],
          values: {},
          createdAt: '2026-03-10T02:00:00.000Z',
          actorName: null,
          byPanel: false,
        }
      : null,
  capabilities: { edit: hidden, submit: hidden, withdraw: hidden, appeal: hidden, abandon: hidden },
})

const counted = (entryId: string, itemId: string, value: string, label = 'label') => ({
  lineId: `entry:${entryId}`,
  kind: 'entry' as const,
  label,
  value,
  itemId,
  provenance: { entryId },
})

// The shape the design is drawn on: five top groups, groups inside groups,
// a limit that bites twice over, a question with dozens of claims, records
// the office made, one it took back, and a deduction.
const volunteering = Array.from({ length: 78 }, (_, index) => `vol-${String(index)}`)
const normal = () => {
  const groups: Group[] = [
    group('g1', '思想品德', { final: '0.00', cap: '10.00' }),
    group('g21', '学术与科研', { final: '18.00', cap: '25.00', parent: 'g2' }),
    group('g22', '课程学习', { final: '9.50', cap: '20.00', parent: 'g2' }),
    {
      ...group('g2', '学业与科研', { final: '27.50', cap: '45.00' }),
      itemsTotal: '0.00',
      childrenTotal: '27.50',
    },
    group('g31', '志愿服务', { final: '12.00', raw: '78.00', cap: '12.00', parent: 'g3' }),
    group('g32', '社会实践', { final: '12.00', cap: '12.00', parent: 'g3' }),
    {
      ...group('g3', '实践与志愿', { final: '20.00', raw: '24.00', cap: '20.00' }),
      itemsTotal: '0.00',
      childrenTotal: '24.00',
    },
    group('g4', '综合表现', { final: '4.00', cap: '25.00' }),
    group('g5', '纪律扣分', { final: '-2.00' }),
  ]
  const items = [
    item('q1', 'g1', '思想政治表现', { channels: ['administrative'] }),
    item('q2', 'g1', '集体活动参与', { each: '1' }),
    item('q3', 'g21', '学术竞赛获奖', { each: '6' }),
    item('q4', 'g21', '科研论文与专利', { each: '8' }),
    item('q6', 'g22', '学业基础分', { channels: ['administrative'] }),
    item('q7', 'g31', '志愿服务时长', { each: '1' }),
    item('q8', 'g32', '社会实践', { each: '3' }),
    item('q9', 'g4', '文体竞赛获奖', { each: '4' }),
    item('q11', 'g4', '校级荣誉称号', { itemType: 'constant', each: '2', channels: [] }),
    item('q13', 'g4', '学生干部任职（旧）', { status: 'voided' }),
    item('q10', 'g4', '创新创业训练', { each: '5' }),
    item('q14', 'g4', '体测加分', { channels: ['administrative'] }),
    item('q15', 'g5', '违纪扣分', { channels: ['administrative'] }),
    item('q16', 'g5', '宿舍卫生扣分', { channels: ['administrative'] }),
  ]
  const entries = [
    ...['a', 'b', 'c'].map((key) => entry(`q3-${key}`, 'q3', 'approved', { name: `竞赛${key}` })),
    ...['d', 'e', 'f', 'g'].map((key) => entry(`q3-${key}`, 'q3', 'in_review')),
    entry('q3-h', 'q3', 'needs_revision'),
    entry('q4-a', 'q4', 'in_review'),
    entry('q4-b', 'q4', 'in_review'),
    entry('q6-a', 'q6', 'approved', { source: 'record', name: '课程加权平均分 95.02', level: '' }),
    ...volunteering.map((id) =>
      entry(id, 'q7', 'approved', { name: '社区养老院陪护', level: '4 小时' }),
    ),
    ...['x', 'y', 'z'].map((key) => entry(`q7-${key}`, 'q7', 'in_review')),
    entry('q7-ask', 'q7', 'in_review', { supplement: true }),
    ...['a', 'b', 'c', 'd'].map((key) =>
      entry(`q8-${key}`, 'q8', 'approved', { name: `调研${key}` }),
    ),
    entry('q9-a', 'q9', 'draft'),
    // one refused, one its owner gave up after submitting it
    entry('q10-a', 'q10', 'rejected'),
    entry('q10-b', 'q10', 'voided'),
    entry('q14-a', 'q14', 'approved', { source: 'record', name: '体质健康测试良好', level: '' }),
    entry('q15-a', 'q15', 'approved', { source: 'record', name: '校级通报批评', level: '' }),
    entry('q16-a', 'q16', 'voided', { source: 'record', name: '宿舍检查不合格', level: '' }),
  ]
  const lines = [
    ...['a', 'b', 'c'].map((key) => counted(`q3-${key}`, 'q3', '6.00')),
    counted('q6-a', 'q6', '9.50'),
    ...volunteering.map((id) => counted(id, 'q7', '1.00')),
    {
      lineId: 'grp:g31:cap',
      kind: 'group-adjustment' as const,
      label: '志愿服务',
      value: '-66.00',
    },
    ...['a', 'b', 'c', 'd'].map((key) => counted(`q8-${key}`, 'q8', '3.00')),
    {
      lineId: 'grp:g3:cap',
      kind: 'group-adjustment' as const,
      label: '实践与志愿',
      value: '-4.00',
    },
    {
      lineId: 'derived:q11',
      kind: 'derived' as const,
      label: '校级荣誉称号',
      value: '2.00',
      itemId: 'q11',
    },
    {
      lineId: 'item:q13:voided',
      kind: 'item-voided' as const,
      label: '学生干部任职（旧）',
      value: '0.00',
      itemId: 'q13',
    },
    ...['q10-a', 'q10-b'].map((entryId) => ({
      lineId: `entry:${entryId}`,
      kind: 'excluded-evidence' as const,
      label: '创新创业训练',
      value: '0.00',
      itemId: 'q10',
      provenance: { entryId },
    })),
    counted('q14-a', 'q14', '2.00'),
    counted('q15-a', 'q15', '-2.00'),
    {
      lineId: 'entry:q16-a',
      kind: 'excluded-evidence' as const,
      label: '宿舍卫生扣分',
      value: '0.00',
      itemId: 'q16',
      revoked: true,
      provenance: { entryId: 'q16-a' },
    },
  ]
  return {
    result: { mode: 'provisional' as const, total: '49.50', groups, lines },
    items,
    entries,
  }
}

type Paper = ReturnType<typeof normal>

/** a round of `count` top groups, one question each, each capped */
const many = (count: number): Paper => {
  const groups = Array.from({ length: count }, (_, index) =>
    group(`m${String(index)}`, `分组${String(index + 1)}`, { final: '1.00', cap: '5.00' }),
  )
  return {
    result: {
      mode: 'provisional',
      total: `${String(count)}.00`,
      groups,
      lines: groups.map((one) => counted(`${one.groupId}-e`, `${one.groupId}-q`, '1.00')),
    },
    items: groups.map((one) => item(`${one.groupId}-q`, one.groupId, `${one.name}记录`)),
    entries: groups.map((one) => entry(`${one.groupId}-e`, `${one.groupId}-q`, 'approved')),
  }
}

const screen = (paper: Paper, over: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch }),
        getMyResult: () => Effect.succeed(paper.result),
        listItems: () => Effect.succeed({ items: paper.items, capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: paper.entries,
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
        ...over,
      },
    }),
    routes: [
      {
        path: '/assessment/batches/:batchId/my-result',
        // the shell's own scroller, which is what the bands and the
        // outline hold to
        element: (
          <div data-testid="scroller" style={{ height: '100dvh', overflowY: 'auto' }}>
            <MyResultPage />
          </div>
        ),
      },
      {
        path: '/assessment/batches/:batchId/my-entries',
        element: <p data-testid="entries-page" />,
      },
    ],
    route: `/assessment/batches/${BATCH_ID}/my-result`,
  })

const scroller = () => page.getByTestId('scroller').element() as HTMLElement
const sectionOf = (groupId: string) =>
  document.querySelector<HTMLElement>(`[data-testid="ledger-group"][data-group="${groupId}"]`)!
const itemRow = (itemId: string) =>
  document.querySelector<HTMLElement>(`[data-testid="ledger-item"][data-item="${itemId}"]`)!
const bandOf = (groupId: string) => sectionOf(groupId).firstElementChild as HTMLElement

describe('the score page at a desk', () => {
  it('draws one account with an outline that follows the reading and jumps', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    await expect
      .element(page.getByTestId('result-ledger'))
      .toHaveAttribute('data-layout', 'outline')
    const outline = page.getByTestId('outline-group')
    await expect.poll(() => outline.elements().length).toBe(5)
    expect(page.getByTestId('result-strip').elements()).toHaveLength(0)
    // the round's full marks divide into the groups that came to something
    await expect.element(page.getByTestId('result-shares')).toHaveAttribute('data-count', '3')

    await page
      .getByRole('button', { name: /学业与科研/ })
      .first()
      .click()
    // the group comes to the top of the reading, and the outline says which
    await expect
      .poll(() =>
        Math.abs(
          sectionOf('g2').getBoundingClientRect().top - scroller().getBoundingClientRect().top,
        ),
      )
      .toBeLessThan(2)
    await expect
      .element(page.getByTestId('outline-group').nth(1))
      .toHaveAttribute('aria-current', 'true')
    // and the reader's place moved with it, not only their eyes
    expect(document.activeElement).toBe(bandOf('g2'))

    // a group too near the end to reach the top is still the one asked for
    await page
      .getByRole('button', { name: /综合表现/ })
      .first()
      .click()
    await expect
      .element(page.getByTestId('outline-group').nth(3))
      .toHaveAttribute('aria-current', 'true')
    await new Promise((settle) => setTimeout(settle, 200))
    expect(page.getByTestId('outline-group').nth(3).element().getAttribute('aria-current')).toBe(
      'true',
    )
  })

  it('holds each top group’s band to the top while its rows pass under it', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const section = sectionOf('g2')
    scroller().scrollTop +=
      section.getBoundingClientRect().top - scroller().getBoundingClientRect().top + 120
    await expect
      .poll(() =>
        Math.abs(bandOf('g2').getBoundingClientRect().top - scroller().getBoundingClientRect().top),
      )
      .toBeLessThan(2)
    // the outline follows the reading, not only a press
    await expect
      .element(page.getByTestId('outline-group').nth(1))
      .toHaveAttribute('aria-current', 'true')
  })

  it('writes every limit that bit as its own line, with the difference', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const limits = page.getByTestId('group-adjustment').elements()
    expect(
      limits.map((one) => [one.getAttribute('data-rule'), one.getAttribute('data-delta')]),
    ).toEqual([
      ['cap', '-66.00'],
      ['cap', '-4.00'],
    ])
    await expect.element(page.getByTestId('result-moving')).toHaveAttribute('data-trimmed', '70.00')
  })

  it('says in the head what is still moving', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    const moving = page.getByTestId('result-moving')
    // four and two under review on research, three and one asked on volunteering
    await expect.element(moving).toHaveAttribute('data-pending', '10')
    await expect.element(moving).toHaveAttribute('data-drafts', '1')
  })
})

describe('the rows of the account', () => {
  it('opens a question with several claims in place, and a claim leads to its filing', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const row = itemRow('q8')
    const toggle = row.querySelector('button[aria-expanded]') as HTMLElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const fold = row.querySelector('[data-testid="ledger-lines"]') as HTMLElement
    // folded, its claims are out of reach
    expect(fold.hasAttribute('inert')).toBe(true)
    await userEvent.click(toggle)
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true')
    await expect.poll(() => fold.getAttribute('data-open')).toBe('true')
    const lines = [...fold.querySelectorAll<HTMLElement>('[data-testid="ledger-line"]')]
    expect(lines.map((one) => one.getAttribute('data-entry'))).toEqual([
      'q8-a',
      'q8-b',
      'q8-c',
      'q8-d',
    ])
    // the claim names itself from what was filed
    expect(lines[1]!.textContent).toContain('调研b')
    await userEvent.click(lines[1]!)
    await expect.element(page.getByTestId('entries-page')).toBeInTheDocument()
    expect(addressNow()).toContain('open=q8')
    expect(addressNow()).toContain('detail=q8-b')
  })

  it('opens and folds a question from the keyboard', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const row = itemRow('q8')
    const toggle = row.querySelector('button[aria-expanded]') as HTMLElement
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true')
    // the claims are now in reach of the keyboard
    const first = row.querySelector<HTMLElement>('[data-testid="ledger-line"]')!
    await userEvent.tab()
    expect(document.activeElement).toBe(first)
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('lists the first six claims and leads to the rest on the filing page', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const row = itemRow('q7')
    await userEvent.click(row.querySelector('button[aria-expanded]') as HTMLElement)
    const fold = row.querySelector('[data-testid="ledger-lines"]') as HTMLElement
    await expect.poll(() => fold.getAttribute('data-open')).toBe('true')
    expect(fold.querySelectorAll('[data-testid="ledger-line"]')).toHaveLength(6)
    const more = fold.querySelector('[data-testid="ledger-more"]') as HTMLElement
    expect(more.getAttribute('data-count')).toBe('78')
    await userEvent.click(more)
    await expect.element(page.getByTestId('entries-page')).toBeInTheDocument()
    expect(addressNow()).toContain('open=q7')
    expect(addressNow()).not.toContain('detail=')
  })

  it('takes a question with one claim straight to it', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const row = itemRow('q6')
    // no fold to open: the row is the claim
    expect(row.querySelector('[data-testid="ledger-lines"]')).toBeNull()
    const claim = row.querySelector('[data-testid="ledger-line"]') as HTMLElement
    expect(claim.getAttribute('data-entry')).toBe('q6-a')
    expect(row.getAttribute('data-value')).toBe('9.50')
    await userEvent.click(claim)
    await expect.element(page.getByTestId('entries-page')).toBeInTheDocument()
    expect(addressNow()).toContain('open=q6')
    expect(addressNow()).toContain('detail=q6-a')
  })

  it('keeps a record the office revoked on the account apart from a plain zero', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const revoked = itemRow('q16')
    expect(revoked.getAttribute('data-value')).toBe('0.00')
    const line = revoked.querySelector('[data-line-kind]') as HTMLElement
    expect(line.getAttribute('data-line-kind')).toBe('excluded-evidence')
    expect(line.getAttribute('data-revoked')).toBe('true')
    // nothing filed is a zero with no line behind it
    const silent = itemRow('q2')
    expect(silent.getAttribute('data-value')).toBe('0.00')
    expect(silent.querySelector('[data-line-kind]')).toBeNull()
    // a withdrawn question stays, marked as withdrawn
    expect(itemRow('q13').getAttribute('data-voided')).toBe('true')
  })

  it('tells a claim its owner gave up from one that was refused', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const row = itemRow('q10')
    expect(row.getAttribute('data-value')).toBe('0.00')
    await userEvent.click(row.querySelector('button[aria-expanded]') as HTMLElement)
    const lines = [...row.querySelectorAll<HTMLElement>('[data-testid="ledger-line"]')]
    expect(lines.map((one) => [one.getAttribute('data-entry'), one.dataset['standing']])).toEqual([
      ['q10-a', 'refused'],
      ['q10-b', 'abandoned'],
    ])
  })

  it('marks what waits on the reader, what is unsent, and what is only under review', async () => {
    await page.viewport(1440, 900)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const tag = (itemId: string) =>
      itemRow(itemId).querySelector('[data-tag]')?.getAttribute('data-tag') ?? null
    expect(tag('q3')).toBe('todo')
    expect(tag('q7')).toBe('todo')
    expect(tag('q9')).toBe('drafts')
    expect(tag('q4')).toBe('pending')
    expect(tag('q8')).toBeNull()
  })
})

describe('the score page on a phone', () => {
  it('folds the outline into chips pinned over the bands, and fits the screen', async () => {
    await page.viewport(390, 844)
    await screen(normal())
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    await expect.element(page.getByTestId('result-ledger')).toHaveAttribute('data-layout', 'strip')
    expect(page.getByTestId('result-outline').elements()).toHaveLength(0)
    // nothing runs off the side
    const seat = page.getByTestId('result-ledger').element() as HTMLElement
    expect(seat.scrollWidth).toBeLessThanOrEqual(seat.clientWidth + 1)
    expect(scroller().scrollWidth).toBeLessThanOrEqual(scroller().clientWidth + 1)

    const chipOf = (groupId: string) =>
      page
        .getByTestId('strip-group')
        .elements()
        .find((one) => one.getAttribute('data-group') === groupId) as HTMLElement
    await userEvent.click(chipOf('g2'))
    await expect.poll(() => chipOf('g2').getAttribute('aria-current')).toBe('true')
    // the chips hold to the top, and the band stands just under them
    const strip = page.getByTestId('result-strip').element()
    await expect
      .poll(() =>
        Math.abs(strip.getBoundingClientRect().top - scroller().getBoundingClientRect().top),
      )
      .toBeLessThan(2)
    await expect
      .poll(() =>
        Math.abs(bandOf('g2').getBoundingClientRect().top - strip.getBoundingClientRect().bottom),
      )
      .toBeLessThan(2)
    await userEvent.click(chipOf('g4'))
    await expect.poll(() => chipOf('g4').getAttribute('aria-current')).toBe('true')
  })
})

describe('rounds of other shapes', () => {
  it('draws one group with no outline, no chips and no bar', async () => {
    await page.viewport(1440, 900)
    await screen(many(1))
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    await expect.element(page.getByTestId('result-ledger')).toHaveAttribute('data-layout', 'single')
    expect(page.getByTestId('result-shares').elements()).toHaveLength(0)
  })

  it('lets dozens of groups scroll in the outline, with no bar to read', async () => {
    await page.viewport(1440, 900)
    await screen(many(24))
    await expect.poll(() => page.getByTestId('outline-group').elements().length).toBe(24)
    const outline = page.getByTestId('result-outline').element() as HTMLElement
    expect(outline.scrollHeight).toBeGreaterThan(outline.clientHeight)
    expect(page.getByTestId('result-shares').elements()).toHaveLength(0)
  })

  it('stands questions no group holds as rows of their own', async () => {
    await page.viewport(1440, 900)
    await screen({
      result: {
        mode: 'provisional',
        total: '3.00',
        groups: [],
        lines: [counted('flat-e', 'flat-q', '3.00')],
      },
      items: [
        item('flat-q', 'nowhere', '志愿培训完成'),
        item('flat-r', 'nowhere', '优秀志愿者称号'),
      ],
      entries: [entry('flat-e', 'flat-q', 'approved')],
    })
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('3.00')
    await expect.element(page.getByTestId('result-ledger')).toHaveAttribute('data-layout', 'single')
    // no band over them: there is nothing to group them under
    expect(sectionOf('ungrouped').querySelector('h2')).toBeNull()
    expect(itemRow('flat-q').getAttribute('data-value')).toBe('3.00')
    expect(itemRow('flat-r').getAttribute('data-value')).toBe('0.00')
  })

  it('offers the filing page when the round asks nothing yet', async () => {
    await page.viewport(1440, 900)
    await screen({
      result: { mode: 'provisional', total: '0.00', groups: [], lines: [] },
      items: [],
      entries: [],
    })
    await expect.element(page.getByTestId('result-empty')).toBeVisible()
    await page.getByTestId('result-empty').getByRole('button').click()
    await expect.element(page.getByTestId('entries-page')).toBeInTheDocument()
  })
})

describe('an account that cannot be computed', () => {
  it('says why an account over the ceiling will not compute, and offers no recalculation', async () => {
    const result = vi.fn(() =>
      Effect.fail(
        apiError('ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE', { evaluations: 612, limit: 500 }),
      ),
    )
    await screen(normal(), { getMyResult: result })
    const panel = page.getByTestId('result-unavailable')
    await expect.element(panel).toHaveAttribute('data-reason', 'too-large')
    expect(document.querySelector('[data-testid="result-total"]')).toBeNull()
    // asking again changes nothing, so the only way on is the filing page
    expect(panel.getByRole('button').elements()).toHaveLength(1)
    await panel.getByRole('button').click()
    await expect.element(page.getByTestId('entries-page')).toBeInTheDocument()
  })
})

describe('a round that moves while the page is open', () => {
  const wakeOnce = (
    kind: 'result-changed' | 'entries-changed' | 'item-changed' = 'result-changed',
  ) => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const wake = () =>
      Effect.succeed(
        Stream.concat(
          Stream.fromEffect(Effect.promise(() => gate).pipe(Effect.as({ kind }))),
          Stream.never,
        ),
      )
    return { wake, release: () => release() }
  }

  const filings = (entries: Paper['entries']) =>
    Effect.succeed({
      participantId: PARTICIPANT_ID,
      entries,
      nextCursor: null,
      attention: { unreadItemIds: [] },
    })

  it('reads the account again when the round says it moved', async () => {
    const paper = normal()
    let total = '49.50'
    const { wake, release } = wakeOnce()
    await screen(paper, {
      getMyResult: () => Effect.succeed({ ...paper.result, total }),
      watchBatch: wake,
    })
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    total = '55.50'
    release()
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('55.50')
  })

  it('keeps what it read when a later read fails, and says it may be behind', async () => {
    const paper = normal()
    let down = false
    const { wake, release } = wakeOnce()
    await screen(paper, {
      getMyResult: () =>
        down
          ? Effect.fail(apiError('ASSESSMENT_SCORING_UNAVAILABLE'))
          : Effect.succeed(paper.result),
      watchBatch: wake,
    })
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    down = true
    release()
    await expect.element(page.getByTestId('result-stale')).toBeVisible()
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    down = false
    await page.getByTestId('result-stale').getByRole('button').click()
    await expect.element(page.getByTestId('result-stale')).not.toBeInTheDocument()
  })

  it('keeps the account when a later read of the claims fails', async () => {
    const paper = normal()
    let down = false
    const { wake, release } = wakeOnce('entries-changed')
    await screen(paper, {
      listMyEntries: () =>
        down ? Effect.fail(apiError('ASSESSMENT_SCORING_UNAVAILABLE')) : filings(paper.entries),
      watchBatch: wake,
    })
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    down = true
    release()
    const stale = page.getByTestId('result-stale')
    await expect.element(stale).toHaveAttribute('data-reason', 'entries')
    // the account and every row of it are still there
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    expect(itemRow('q8').getAttribute('data-value')).toBe('12.00')
    down = false
    await stale.getByRole('button').click()
    await expect.element(stale).not.toBeInTheDocument()
  })

  it('keeps the account when a later read of the questions fails', async () => {
    const paper = normal()
    let down = false
    const { wake, release } = wakeOnce('item-changed')
    await screen(paper, {
      listItems: () =>
        down
          ? Effect.fail(apiError('ASSESSMENT_SCORING_UNAVAILABLE'))
          : Effect.succeed({ items: paper.items, capabilities: { canManage: false } }),
      watchBatch: wake,
    })
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    down = true
    release()
    await expect.element(page.getByTestId('result-stale')).toHaveAttribute('data-reason', 'entries')
    expect(itemRow('q8').getAttribute('data-value')).toBe('12.00')
  })

  it('says why an account that grew past the ceiling cannot be read again, and offers no recalculation', async () => {
    const paper = normal()
    let grown = false
    const { wake, release } = wakeOnce()
    await screen(paper, {
      getMyResult: () =>
        grown
          ? Effect.fail(
              apiError('ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE', { evaluations: 612, limit: 500 }),
            )
          : Effect.succeed(paper.result),
      watchBatch: wake,
    })
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    grown = true
    release()
    const stale = page.getByTestId('result-stale')
    await expect.element(stale).toHaveAttribute('data-reason', 'too-large')
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('49.50')
    // asking again would meet the same ceiling
    expect(stale.getByRole('button').elements()).toHaveLength(0)
  })

  it('reads the claims and the paper again with the account when there is no stream', async () => {
    // only the polling clock is faked; everything else keeps real time
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const paper = normal()
      let entries = paper.entries
      await screen(paper, { listMyEntries: () => filings(entries) })
      const moving = page.getByTestId('result-moving')
      await expect.element(moving).toHaveAttribute('data-pending', '10')
      // the two research claims are decided while nobody is pushing news
      entries = entries.map((one) => (one.itemId === 'q4' ? entry(one.id, 'q4', 'approved') : one))
      vi.advanceTimersByTime(30_000)
      await expect.element(moving).toHaveAttribute('data-pending', '8')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the ledger inside another page', () => {
  it('stands its bands under whatever that page already pins', async () => {
    await page.viewport(1440, 900)
    const paper = normal()
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      }),
      children: (
        <div data-testid="scroller" style={{ height: '100dvh', overflowY: 'auto' }}>
          <div
            data-testid="pinned"
            style={{ position: 'sticky', top: 0, zIndex: 10, height: 48, background: 'white' }}
          />
          <ResultLedger
            result={paper.result}
            items={paper.items}
            entries={paper.entries}
            reader="staff"
            stickyTop={48}
            onEntryOpen={() => {}}
          />
        </div>
      ),
    })
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    await page
      .getByRole('button', { name: /学业与科研/ })
      .first()
      .click()
    await expect
      .poll(() =>
        Math.abs(
          bandOf('g2').getBoundingClientRect().top -
            page.getByTestId('pinned').element().getBoundingClientRect().bottom,
        ),
      )
      .toBeLessThan(2)
  })

  it('lines up at the start of a page that lines its own content up there', async () => {
    await page.viewport(1440, 900)
    const paper = many(1)
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      }),
      children: (
        <ResultLedger
          result={paper.result}
          items={paper.items}
          entries={paper.entries}
          reader="staff"
          align="start"
        />
      ),
    })
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    const seat = page.getByTestId('result-ledger').element().getBoundingClientRect()
    const total = page.getByTestId('result-total').element().getBoundingClientRect()
    const band = sectionOf('m0').getBoundingClientRect()
    expect(Math.abs(total.left - seat.left)).toBeLessThan(4)
    expect(Math.abs(band.left - seat.left)).toBeLessThan(2)
  })
})

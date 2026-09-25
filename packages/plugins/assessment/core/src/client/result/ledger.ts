import { projectEntrySummary } from '../../entry/summary.ts'

// The account as rows: what the ledger draws, worked out away from the drawing.
//
// The scorer answers a flat list of groups and a flat list of lines. A reader
// needs something else: every question of the round in its place, whether or
// not it came to anything; each line joined back to the claim it was computed
// from, so it can say which claim that was; and every limit that bit written
// where it bit. That shaping lives here, pure, so a node test can hold it to
// the arithmetic and the two readers of the ledger (the participant and staff
// looking at them) draw the same answer.
//
// Amounts are carried as whole hundredths. The scorer already quantizes every
// line to two places (§16), so hundredths are exact here and a sum of them is
// the figure the scorer printed, never a float that is a cent out.

/** what the ledger needs of a claim: its status, and where it can say more */
export interface LedgerEntry {
  readonly status: string
  readonly id?: string
  readonly itemId?: string
  readonly source?: string
  readonly createdAt?: string
  readonly currentRevision?: { readonly payload: unknown; readonly createdAt: string } | null
  /** an open ask for more material on it */
  readonly supplement?: unknown
  /** a round running on it right now */
  readonly openRound?: { readonly origin: string } | null
  /** what it stands determined as, and when that was decided */
  readonly recognition?: { readonly createdAt: string } | null
}

/** what the ledger needs of a question */
export type LedgerItem = {
  id: string
  title: string
  scoreGroupId: string
  sortOrder: number
  status: string
  itemType?: string
  currentRevision: {
    entryChannels: readonly ('participant' | 'administrative')[]
    formConfig?: unknown
    displayConfig?: unknown
    scoringConfig?: unknown
  } | null
}

export type LedgerLineKind =
  | 'entry'
  | 'entry-not-counted'
  | 'excluded-evidence'
  | 'item-voided'
  | 'group-adjustment'
  | 'derived'

interface ResultGroup {
  readonly groupId: string
  readonly parentGroupId: string | null
  readonly depth: number
  readonly name: string
  readonly itemsTotal: string
  readonly childrenTotal: string
  readonly raw: string
  readonly final: string
  readonly cap: string | null
  readonly floor: string | null
}

interface ResultLine {
  readonly lineId: string
  readonly kind: string
  readonly label: string
  readonly value: string
  readonly itemId?: string | undefined
  /** on an excluded line: the office revoked the fact, nobody refused it */
  readonly revoked?: boolean | undefined
  readonly provenance?: { readonly entryId?: string | undefined } | undefined
}

/** the account as the scorer answered it, either door */
export interface LedgerResult {
  readonly mode: string
  readonly total: string
  readonly groups: readonly ResultGroup[]
  readonly lines: readonly ResultLine[]
}

/** an amount in whole hundredths */
export const centsOf = (value: string | number | null | undefined): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

/** whole hundredths back into the two places a ledger speaks with */
export const twoPlaces = (cents: number): string => (cents / 100).toFixed(2)

/**
 * What became of the claim behind one line, in the reader's words.
 *
 * The scorer writes one kind of line for every claim put to somebody and no
 * longer counted. Which of those it was is the claim's own story: decided
 * against (`refused`), given up by its owner after submitting it
 * (`abandoned`), or recorded by the office and taken back (`revoked`). Where
 * the claim is not in the reader's hands the line says only that it does not
 * count (`excluded`), rather than guessing at a decision nobody may have made.
 */
export type LedgerLineStanding =
  | 'approved'
  | 'recorded'
  | 'notCounted'
  | 'refused'
  | 'abandoned'
  | 'revoked'
  | 'excluded'
  | 'derived'
  | 'voided'

/** one line of the account, joined to the claim it came from when that is readable */
export interface LedgerLineView {
  readonly key: string
  readonly kind: LedgerLineKind
  readonly standing: LedgerLineStanding
  readonly cents: number
  readonly revoked: boolean
  /** the claim behind it; absent where this reader may not open it */
  readonly entryId: string | null
  /** what the claim says of itself, from its own payload */
  readonly lead: string | null
  readonly sub: string | null
  /** when it was decided, or else filed */
  readonly at: string | null
  /** the office recorded it; nobody filed it */
  readonly recorded: boolean
}

/** where one question's claims stand, counted */
export interface ItemFacts {
  /** approved by review and on the account, counted or not */
  readonly approved: number
  /** recorded by the office and on the account */
  readonly recorded: number
  /** approved, but the question's rule counted other claims instead */
  readonly notCounted: number
  /** settled, and being looked at again right now */
  readonly reconsidering: number
  readonly pending: number
  /** waiting on more material from the participant */
  readonly asked: number
  /** sent back to the participant to revise */
  readonly returned: number
  readonly refused: number
  /** submitted, then given up by the participant */
  readonly abandoned: number
  readonly revoked: number
  /** no longer counted, for a reason this reader cannot see */
  readonly excluded: number
  readonly drafts: number
}

export interface LedgerItemView {
  readonly kind: 'item'
  readonly id: string
  readonly title: string
  readonly depth: number
  /** what the question contributes to its group */
  readonly cents: number
  readonly voided: boolean
  /** granted to everybody on the roster: nothing to file */
  readonly derived: boolean
  /** the office records it and nobody files it */
  readonly recordedOnly: boolean
  /** what one approved claim is worth, where the question pays a flat amount */
  readonly each: string | null
  /** what everybody is granted, where the question grants a flat amount */
  readonly perPerson: string | null
  readonly facts: ItemFacts
  readonly lines: readonly LedgerLineView[]
}

export interface LedgerGroupView {
  readonly kind: 'group'
  readonly id: string
  readonly name: string
  /** "01", "01.2": how a reader would number it */
  readonly no: string
  readonly depth: number
  readonly cents: number
  readonly capCents: number | null
  /** reached its limit */
  readonly full: boolean
  /** claims inside it still under review or being looked at again */
  readonly pending: number
  /** how much its limit still has room for, where it is worth saying */
  readonly leftCents: number | null
}

/** a limit that bit, as its own line under what it held down */
export interface LedgerAdjustmentView {
  readonly kind: 'adjustment'
  readonly groupId: string
  readonly name: string
  readonly depth: number
  readonly rule: 'cap' | 'floor'
  readonly rawCents: number
  readonly limitCents: number
  /** negative for a cap, positive for a floor */
  readonly deltaCents: number
}

export type LedgerRow = LedgerGroupView | LedgerItemView | LedgerAdjustmentView

/** one top group and everything under it; `group` is null for questions no group holds */
export interface LedgerSection {
  readonly group: LedgerGroupView | null
  readonly rows: readonly LedgerRow[]
}

export interface LedgerShare {
  readonly id: string
  readonly name: string
  readonly cents: number
  /** percent of the round's full marks */
  readonly pct: number
}

export interface LedgerModel {
  readonly totalCents: number
  /** the round's full marks, when every top group declares one */
  readonly fullCents: number | null
  /** what limits held back, over every group */
  readonly trimmedCents: number
  /** claims still under review, or being looked at again */
  readonly pending: number
  readonly drafts: number
  readonly sections: readonly LedgerSection[]
  /** the top groups, for the outline */
  readonly tops: readonly LedgerGroupView[]
  /** how the total divides, where a bar of it can be read; null otherwise */
  readonly shares: readonly LedgerShare[] | null
  /** the round asks nothing and the account holds nothing */
  readonly empty: boolean
}

/** a composition bar stops being readable past this many parts */
const MOST_SHARES = 8

/**
 * The scorer answers each group after the ones inside it, so it arrives
 * child first. Read top down here; a group naming a parent that is not in
 * the response stands as its own root rather than dropping out.
 */
export const inTreeOrder = <Group extends { groupId: string; parentGroupId: string | null }>(
  groups: readonly Group[],
): Group[] => {
  const present = new Set(groups.map((group) => group.groupId))
  const childrenOf = new Map<string | null, Group[]>()
  for (const group of groups) {
    const parent =
      group.parentGroupId !== null && present.has(group.parentGroupId) ? group.parentGroupId : null
    const bucket = childrenOf.get(parent)
    if (bucket === undefined) childrenOf.set(parent, [group])
    else bucket.push(group)
  }
  const out: Group[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null) => {
    for (const group of childrenOf.get(parent) ?? []) {
      if (seen.has(group.groupId)) continue
      seen.add(group.groupId)
      out.push(group)
      walk(group.groupId)
    }
  }
  walk(null)
  return out
}

const RECORDED_SOURCES = new Set(['record', 'import'])

const isLive = (entry: LedgerEntry) => entry.status !== 'voided'

/** a settled claim that a round is looking at again */
const reconsidered = (entry: LedgerEntry) =>
  entry.openRound != null && (entry.status === 'approved' || entry.status === 'rejected')

/** still moving: under review, or being looked at again */
export const isMoving = (entry: LedgerEntry): boolean =>
  isLive(entry) && (entry.status === 'in_review' || entry.openRound != null)

/** a draft nobody has submitted */
export const isDraft = (entry: LedgerEntry): boolean =>
  entry.status === 'draft' && entry.openRound == null

/**
 * What a line says became of its claim. A line of a claim no longer counted
 * is read against the claim itself: the scorer writes the same line for a
 * refusal and for a claim its owner gave up after submitting it (§32.30).
 */
const standingOf = (
  kind: LedgerLineKind,
  revoked: boolean,
  recorded: boolean,
  entry: LedgerEntry | undefined,
): LedgerLineStanding => {
  switch (kind) {
    case 'entry':
      return recorded ? 'recorded' : 'approved'
    case 'entry-not-counted':
      return 'notCounted'
    case 'excluded-evidence':
      return revoked
        ? 'revoked'
        : entry?.status === 'voided'
          ? 'abandoned'
          : entry?.status === 'rejected'
            ? 'refused'
            : 'excluded'
    case 'item-voided':
      return 'voided'
    default:
      return 'derived'
  }
}

const scoringOf = (item: LedgerItem) =>
  item.currentRevision?.scoringConfig as
    | { calculator?: { config?: { value?: unknown } } }
    | null
    | undefined

/** the flat amount the question's rule names, if it names one */
const flatAmountOf = (item: LedgerItem): string | null => {
  const value = scoringOf(item)?.calculator?.config?.value
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

const LINE_KINDS: ReadonlySet<string> = new Set([
  'entry',
  'entry-not-counted',
  'excluded-evidence',
  'item-voided',
  'derived',
])

export const buildLedger = ({
  result,
  items,
  entries,
}: {
  result: LedgerResult
  items: readonly LedgerItem[]
  entries: readonly LedgerEntry[]
}): LedgerModel => {
  const groups = inTreeOrder(result.groups)
  const groupIds = new Set(groups.map((group) => group.groupId))
  const childrenOf = new Map<string | null, ResultGroup[]>()
  for (const group of groups) {
    const parent =
      group.parentGroupId !== null && groupIds.has(group.parentGroupId) ? group.parentGroupId : null
    const bucket = childrenOf.get(parent)
    if (bucket === undefined) childrenOf.set(parent, [group])
    else bucket.push(group)
  }

  // A question never published was never asked: the account leaves it out,
  // so the ledger does too.
  const asked = items.filter((item) => item.status !== 'draft')
  const known = new Map(asked.map((item) => [item.id, item]))

  // lines the scorer wrote under a question this reader was not handed stand
  // in their own right, named by the label frozen on the line, rather than
  // vanishing and leaving a total the rows do not add up to
  const linesOf = new Map<string, ResultLine[]>()
  const strangers = new Map<string, LedgerItem>()
  for (const line of result.lines) {
    if (!LINE_KINDS.has(line.kind) || line.itemId === undefined) continue
    const bucket = linesOf.get(line.itemId)
    if (bucket === undefined) linesOf.set(line.itemId, [line])
    else bucket.push(line)
    if (!known.has(line.itemId) && !strangers.has(line.itemId)) {
      strangers.set(line.itemId, {
        id: line.itemId,
        title: line.label,
        scoreGroupId: '',
        sortOrder: Number.MAX_SAFE_INTEGER,
        status: line.kind === 'item-voided' ? 'voided' : 'active',
        currentRevision: null,
      })
    }
  }

  const byId = new Map<string, LedgerEntry>()
  const claimsOf = new Map<string, LedgerEntry[]>()
  for (const entry of entries) {
    if (entry.id !== undefined) byId.set(entry.id, entry)
    if (entry.itemId === undefined || !isLive(entry)) continue
    const bucket = claimsOf.get(entry.itemId)
    if (bucket === undefined) claimsOf.set(entry.itemId, [entry])
    else bucket.push(entry)
  }

  const itemView = (item: LedgerItem, depth: number): LedgerItemView => {
    const lines = (linesOf.get(item.id) ?? []).map((line): LedgerLineView => {
      const entryId = line.provenance?.entryId ?? null
      const entry = entryId === null ? undefined : byId.get(entryId)
      const parts =
        entry === undefined
          ? []
          : projectEntrySummary({
              formConfig: item.currentRevision?.formConfig,
              displayConfig: item.currentRevision?.displayConfig,
              payload: entry.currentRevision?.payload,
            }).filter((part) => part.value !== '')
      const sub = parts
        .slice(1)
        .map((part) => part.value)
        .join(' ')
      const kind = line.kind as LedgerLineKind
      const revoked = line.revoked === true
      const recorded = entry?.source !== undefined && RECORDED_SOURCES.has(entry.source)
      return {
        key: line.lineId,
        kind,
        standing: standingOf(kind, revoked, recorded, entry),
        cents: centsOf(line.value),
        revoked,
        entryId,
        lead: parts[0]?.value ?? null,
        sub: sub === '' ? null : sub,
        at:
          entry === undefined
            ? null
            : (entry.recognition?.createdAt ??
              entry.currentRevision?.createdAt ??
              entry.createdAt ??
              null),
        recorded,
      }
    })
    let approved = 0
    let recorded = 0
    let notCounted = 0
    let refused = 0
    let abandoned = 0
    let revoked = 0
    let excluded = 0
    for (const line of lines) {
      if (line.standing === 'recorded') recorded += 1
      else if (line.standing === 'approved') approved += 1
      else if (line.standing === 'notCounted') {
        approved += 1
        notCounted += 1
      } else if (line.standing === 'refused') refused += 1
      else if (line.standing === 'abandoned') abandoned += 1
      else if (line.standing === 'revoked') revoked += 1
      else if (line.standing === 'excluded') excluded += 1
    }
    let reconsidering = 0
    let pending = 0
    let askedMore = 0
    let returned = 0
    let drafts = 0
    for (const claim of claimsOf.get(item.id) ?? []) {
      // one word per claim, in the order it matters to the reader: an open
      // ask first, then a round looking at a settled claim again, then the
      // plain states
      if (claim.supplement != null) askedMore += 1
      else if (reconsidered(claim)) reconsidering += 1
      else if (claim.status === 'in_review') pending += 1
      else if (claim.status === 'needs_revision') returned += 1
      else if (isDraft(claim)) drafts += 1
    }
    const channels = item.currentRevision?.entryChannels ?? []
    const derived = lines.some((line) => line.kind === 'derived')
    const flat = flatAmountOf(item)
    return {
      kind: 'item',
      id: item.id,
      title: item.title,
      depth,
      cents: lines.reduce((sum, line) => sum + line.cents, 0),
      voided: item.status === 'voided' || lines.some((line) => line.kind === 'item-voided'),
      derived,
      recordedOnly: channels.includes('administrative') && !channels.includes('participant'),
      each: !derived && item.itemType !== 'constant' ? flat : null,
      perPerson: derived || item.itemType === 'constant' ? flat : null,
      facts: {
        approved,
        recorded,
        notCounted,
        reconsidering,
        pending,
        asked: askedMore,
        returned,
        refused,
        abandoned,
        revoked,
        excluded,
        drafts,
      },
      lines,
    }
  }

  const itemsIn = (groupId: string): LedgerItem[] =>
    asked.filter((item) => item.scoreGroupId === groupId).sort((a, b) => a.sortOrder - b.sortOrder)

  // A group earns its place by holding a question, a line, or a figure: the
  // rest of the tree is structure nobody can put anything into, and a ledger
  // of empty bands reads as a ledger that lost its rows.
  const shown = new Map<string, boolean>()
  const holds = (group: ResultGroup): boolean => {
    const cached = shown.get(group.groupId)
    if (cached !== undefined) return cached
    const here =
      centsOf(group.final) !== 0 ||
      itemsIn(group.groupId).length > 0 ||
      (childrenOf.get(group.groupId) ?? []).map(holds).some(Boolean)
    shown.set(group.groupId, here)
    return here
  }

  const movingIn = (views: readonly LedgerRow[]): number =>
    views.reduce(
      (sum, row) =>
        row.kind === 'item'
          ? sum + row.facts.pending + row.facts.reconsidering + row.facts.asked
          : sum,
      0,
    )

  const groupView = (group: ResultGroup, no: string, depth: number, rows: readonly LedgerRow[]) => {
    const cents = centsOf(group.final)
    const capCents = group.cap === null ? null : centsOf(group.cap)
    const pending = movingIn(rows)
    const full = capCents !== null && capCents > 0 && cents >= capCents
    return {
      kind: 'group' as const,
      id: group.groupId,
      name: group.name,
      no,
      depth,
      cents,
      capCents,
      full,
      pending,
      // what the limit still has room for is worth saying only once the
      // group has started and nothing in it is still being decided
      leftCents: capCents !== null && !full && pending === 0 && cents > 0 ? capCents - cents : null,
    }
  }

  const adjustmentOf = (group: ResultGroup, depth: number): LedgerAdjustmentView | null => {
    const raw = centsOf(group.raw)
    const final = centsOf(group.final)
    if (raw === final) return null
    const rule = final < raw ? 'cap' : 'floor'
    const limit = rule === 'cap' ? group.cap : group.floor
    if (limit === null) return null
    return {
      kind: 'adjustment',
      groupId: group.groupId,
      name: group.name,
      depth,
      rule,
      rawCents: raw,
      limitCents: centsOf(limit),
      deltaCents: final - raw,
    }
  }

  /** a group's own rows: its questions, then the groups inside it, then its limit */
  const rowsUnder = (group: ResultGroup, no: string, depth: number): LedgerRow[] => {
    const rows: LedgerRow[] = itemsIn(group.groupId).map((item) => itemView(item, depth + 1))
    let index = 0
    for (const child of childrenOf.get(group.groupId) ?? []) {
      if (!holds(child)) continue
      index += 1
      const childNo = `${no}.${String(index)}`
      const inside = rowsUnder(child, childNo, depth + 1)
      rows.push(groupView(child, childNo, depth + 1, inside), ...inside)
    }
    const adjustment = adjustmentOf(group, depth + 1)
    if (adjustment !== null) rows.push(adjustment)
    return rows
  }

  const sections: LedgerSection[] = []
  const tops: LedgerGroupView[] = []
  let topIndex = 0
  for (const root of childrenOf.get(null) ?? []) {
    if (!holds(root)) continue
    topIndex += 1
    const no = String(topIndex).padStart(2, '0')
    const rows = rowsUnder(root, no, 0)
    const view = groupView(root, no, 0, rows)
    tops.push(view)
    sections.push({ group: view, rows })
  }

  // questions no group in the account holds: under a group the scorer did
  // not answer for, or known only by a line
  const loose = [
    ...asked.filter((item) => !groupIds.has(item.scoreGroupId)),
    ...strangers.values(),
  ].sort((a, b) => a.sortOrder - b.sortOrder)
  if (loose.length > 0) {
    sections.push({
      group: null,
      rows: loose.map((item) => itemView(item, tops.length > 0 ? 1 : 0)),
    })
  }

  // A group with no limit has no full mark to add - unless it can only take
  // away, as a group of deductions does, and then it adds nothing to the most
  // anyone can reach. A question outside every group has no limit at all.
  const fullCents =
    tops.length > 0 &&
    loose.length === 0 &&
    tops.every((top) => top.capCents !== null || top.cents <= 0)
      ? tops.reduce((sum, top) => sum + (top.capCents ?? 0), 0)
      : null
  const shares =
    fullCents !== null && fullCents > 0 && tops.length >= 2 && tops.length <= MOST_SHARES
      ? tops
          .filter((top) => top.cents > 0)
          .map((top) => ({
            id: top.id,
            name: top.name,
            cents: top.cents,
            pct: Math.min(100, (top.cents / fullCents) * 100),
          }))
      : null

  const trimmedCents = groups.reduce((sum, group) => {
    const raw = centsOf(group.raw)
    const final = centsOf(group.final)
    return sum + (raw > final ? raw - final : 0)
  }, 0)

  return {
    totalCents: centsOf(result.total),
    fullCents,
    trimmedCents,
    pending: entries.filter(isMoving).length,
    drafts: entries.filter(isDraft).length,
    sections,
    tops,
    shares,
    empty: sections.length === 0,
  }
}

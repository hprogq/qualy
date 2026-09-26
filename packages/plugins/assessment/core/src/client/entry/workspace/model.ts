import type { MessageDescriptor } from '@qualy/i18n-contract'
import { projectEntrySummary } from '../../../entry/summary.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { inZone } from '../../batch/zone.ts'
import {
  fieldsOf,
  recordedOnly,
  trimAmount,
  unitsOf,
  type EntryDto,
  type FilingGateDto,
  type ItemDto,
} from '../model.ts'
import { eachWorth, mayFile, roomLeft, type Standing, type StructureRow } from '../standing.ts'
import { filingHeldOf, type RoundState, type Said } from '../refusals.ts'
import {
  claimActOf,
  claimFilesOf,
  claimNoteOf,
  type ClaimAct,
  type ClaimNote,
} from '../claim-facts.ts'

// What the entries workspace draws, worked out away from the drawing.
//
// The rail, the question pane and the group pane all answer "what is this
// row" from here, so a question's number, its dot and the words on one claim
// are one answer however many places show them. Pure functions over the
// rows `standingRows` already builds; nothing here fetches or renders.

/** who is reading: the person who filed, or somebody checking their account */
export type Viewer = 'owner' | 'staff'

/** the paper as the workspace walks it */
export interface Outline {
  /** the one group holding the whole paper, when there is one: its numbers are the head's */
  readonly root: StructureRow | null
  /** every row under the root, depth counted from under it */
  readonly rows: readonly StructureRow[]
  /** sections numbered 01, 01.2, 01.2.1; questions numbered 1, 2, 3 across the paper */
  readonly numbers: ReadonlyMap<string, string>
  /** the questions in paper order, for stepping to the next one */
  readonly items: readonly StructureRow[]
  /** the sections at the top, for the bar across the head */
  readonly tops: readonly StructureRow[]
  /** a row by id */
  readonly byId: ReadonlyMap<string, StructureRow>
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * The paper as numbered rows. A single group holding everything is lifted
 * away: its figures are the head's own, and a root row over children saying
 * the same thing would say it twice.
 */
export const outlineOf = (all: readonly StructureRow[]): Outline => {
  const lifted =
    all.length > 0 && all[0]!.kind === 'group' && all.filter((row) => row.depth === 0).length === 1
      ? all[0]!
      : null
  const rows =
    lifted === null
      ? all
      : all.slice(1).map((row) => ({
          ...row,
          depth: row.depth - 1,
          trail: row.trail.slice(1),
          parentId: row.parentId === lifted.id ? null : row.parentId,
        }))
  const numbers = new Map<string, string>()
  const siblings = new Map<string | null, number>()
  let top = 0
  let question = 0
  for (const row of rows) {
    if (row.kind === 'item') {
      question += 1
      numbers.set(row.id, String(question))
    } else if (row.depth === 0) {
      top += 1
      numbers.set(row.id, pad2(top))
    } else {
      const at = (siblings.get(row.parentId) ?? 0) + 1
      siblings.set(row.parentId, at)
      numbers.set(row.id, `${numbers.get(row.parentId ?? '') ?? ''}.${String(at)}`)
    }
  }
  return {
    root: lifted,
    rows,
    numbers,
    items: rows.filter((row) => row.kind === 'item'),
    tops: rows.filter((row) => row.kind === 'group' && row.depth === 0),
    byId: new Map(rows.map((row) => [row.id, row])),
  }
}

/** the sections above a row, outermost first, as rows the reader can go to */
export const chainOf = (outline: Outline, row: StructureRow): readonly StructureRow[] => {
  const chain: StructureRow[] = []
  let at = row.parentId === null ? undefined : outline.byId.get(row.parentId)
  // a cycle cannot happen in a saved tree, but a bound keeps a bad one from
  // hanging the screen it is drawn on
  for (let depth = 0; at !== undefined && depth < 32; depth += 1) {
    chain.unshift(at)
    at = at.parentId === null ? undefined : outline.byId.get(at.parentId)
  }
  return chain
}

/**
 * Which way the reader went from one row to another, for the pane that
 * arrives: up to a section the row sits in is out, down into something a
 * section holds is in, and anything else is along the paper, forward or back.
 */
export const moveBetween = (
  outline: Outline,
  from: string | null,
  to: string | null,
): 'in' | 'out' | 'next' | 'previous' | 'none' => {
  if (from === null || to === null || from === to) return 'none'
  const was = outline.byId.get(from)
  const now = outline.byId.get(to)
  if (was === undefined || now === undefined) return 'none'
  if (chainOf(outline, was).some((row) => row.id === to)) return 'out'
  if (chainOf(outline, now).some((row) => row.id === from)) return 'in'
  const at = (id: string) => outline.rows.findIndex((row) => row.id === id)
  return at(to) > at(from) ? 'next' : 'previous'
}

/** the rows under a group, in paper order, depth still counted from the paper */
export const insideOf = (outline: Outline, group: StructureRow): readonly StructureRow[] => {
  const at = outline.rows.findIndex((row) => row.id === group.id)
  if (at < 0) return []
  const inside: StructureRow[] = []
  for (const row of outline.rows.slice(at + 1)) {
    if (row.depth <= group.depth) break
    inside.push(row)
  }
  return inside
}

/**
 * The dot beside a question, which says where it stands and nothing else:
 * amber waits on the reader, green counts, grey is moving or kept, a ring
 * ended without counting, and an outline has nothing claimed yet. News the
 * reader has not looked at is a mark of its own, never this dot.
 */
export type Dot = 'waits' | 'approved' | 'moving' | 'draft' | 'ring' | 'open' | 'quiet'

export const dotOf = (row: StructureRow): Dot => {
  switch (row.tag) {
    case 'supplement':
    case 'needs_revision':
      return 'waits'
    case 'approved':
      return 'approved'
    case 'in_review':
      return 'moving'
    case 'draft':
      return 'draft'
    case 'rejected':
    case 'partial':
      return 'ring'
    case 'recorded':
    case 'granted':
      return 'quiet'
    default:
      return 'open'
  }
}

/** the word a question's row says about where it stands, or nothing */
export const rowWordOf = (row: StructureRow): MessageDescriptor | null => {
  switch (row.tag) {
    case 'voided':
      return m.itemsStatusVoided
    case 'supplement':
      return m.entryStatusAwaitingSupplement
    case 'needs_revision':
      return m.entryStatusNeedsRevision
    case 'draft':
      return m.entryStatusDraft
    case 'in_review':
      return m.entryStatusInReview
    case 'rejected':
      return m.entryStatusRejected
    case 'partial':
      return m.rowPartialApproved
    case 'approved':
      return row.item !== undefined && recordedOnly(row.item)
        ? m.recordStandingSettled
        : m.entryStatusApproved
    case 'recorded':
      return m.entriesAwaitingRecord
    case 'granted':
      return m.rowGranted
    default:
      return null
  }
}

/** whether a row's word asks for the reader's hand */
export const urgentTag = (row: StructureRow): boolean =>
  row.tag === 'supplement' || row.tag === 'needs_revision'

/** amounts on the workspace speak with two decimals and a true minus sign */
export const two = (value: string | number): string => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return String(value)
  return parsed < 0 ? `−${(-parsed).toFixed(2)}` : parsed.toFixed(2)
}

/** a short amount for a row: 9.5, −2 */
export const short = (value: string): string => {
  const trimmed = trimAmount(value)
  return trimmed.startsWith('-') ? `−${trimmed.slice(1)}` : trimmed
}

/**
 * When something happened to a claim, on the batch's clock: the day as the
 * language names it and the time to the minute, never a bare "04/20".
 */
export const momentOf = (iso: string, locale: string, zone: string | undefined): string =>
  new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...inZone(zone),
  }).format(new Date(iso))

/** a settled claim with a round running on it is out with the reviewers again */
export const contested = (entry: EntryDto): boolean =>
  entry.openRound?.origin === 'appeal' || entry.openRound?.origin === 'reopen'

const administrative = (entry: EntryDto): boolean =>
  entry.source === 'record' || entry.source === 'import'

/** what a claim is doing, as the tests and the tags read it */
export const standingOf = (entry: EntryDto): string =>
  entry.supplement !== null ? 'awaiting_supplement' : contested(entry) ? 'contested' : entry.status

/** how one claim reads in a list */
export interface EntryLine {
  readonly lead: string
  readonly sub: string
  /** every value it was filed with, for finding it by search */
  readonly words: string
  readonly amount: string | null
  readonly amountWord: MessageDescriptor
  readonly amountTone: 'ink' | 'pending' | 'muted' | 'negative'
  /** the last thing that happened to it, and when */
  readonly at: string
  readonly act: ClaimAct
  readonly action: MessageDescriptor
  /** a reviewer's words the owner has to act on, carried on the row itself */
  readonly note: ClaimNote | null
  readonly files: number
}

/**
 * What last happened to a claim, in the words every list of claims uses.
 * Giving a claim up is its owner's act and is said as such; voiding is what
 * happens to a question, and revoking to a record the office took back.
 */
export const claimActWord: Readonly<Record<ClaimAct, MessageDescriptor>> = {
  asked: m.entriesActAsked,
  returned: m.entriesActReturned,
  refused: m.entriesActRejected,
  recorded: m.entriesActRecorded,
  approved: m.entriesActApproved,
  submitted: m.entriesActSubmitted,
  revoked: m.entriesActRevoked,
  abandoned: m.resultActAbandoned,
  saved: m.entriesActSaved,
}

const NUMERIC = new Set(['integer', 'decimal'])

/**
 * How the identity line puts its parts together, in the reader's language:
 * a field's name beside its figure, and one part after another. The line is
 * worked out here, the words for joining it are the catalog's.
 */
export interface LineWords {
  /** a field's name and the figure filed under it */
  readonly figure: (label: string, value: string) => string
  /** two parts of the line side by side */
  readonly join: (before: string, after: string) => string
}

export const entryLineOf = (
  entry: EntryDto,
  item: ItemDto,
  standing: Standing | null,
  words: LineWords,
): EntryLine => {
  const payload = (entry.currentRevision?.payload ?? {}) as Record<string, unknown>
  const formConfig = item.currentRevision?.formConfig
  const fields = fieldsOf(formConfig)
  const typeOf = new Map(
    fields.map((field) => [(field as { id?: string }).id ?? field.key, field.type] as const),
  )
  const line = standing?.lines.find((one) => one.provenance?.entryId === entry.id) ?? null
  const each = eachWorth(item)

  // the amount column: what it counts for now, or would once approved
  let amount: string | null = null
  let amountWord: MessageDescriptor = m.entryScoreIfApproved
  let amountTone: EntryLine['amountTone'] = 'pending'
  if (entry.status === 'voided') {
    amountWord = administrative(entry) ? m.recordStandingWithdrawn : m.entryStatusVoided
    amountTone = 'muted'
  } else if (item.status === 'voided' || entry.status === 'rejected') {
    amountWord = m.entriesAmountNotCounted
    amountTone = 'muted'
  } else if (entry.status === 'approved') {
    if (line !== null && line.kind !== 'entry') {
      amountWord = m.entriesAmountNotCounted
      amountTone = 'muted'
    } else {
      const value = line?.value ?? each ?? null
      const negative = value !== null && unitsOf(value) < 0
      amount = value === null ? null : two(value)
      amountWord = negative ? m.entriesAmountDeducted : m.entryScoreCounted
      amountTone = negative ? 'negative' : 'ink'
    }
  } else if (each !== undefined) {
    amount = two(each)
  }

  // the identity line (§32.74), with a figure that is also the amount said
  // once: in the amount column, not again as the title
  const parts = projectEntrySummary({
    formConfig,
    displayConfig: item.currentRevision?.displayConfig,
    payload,
  }).filter((part) => part.value !== '')
  const counted = entry.status === 'approved' && line?.kind === 'entry' ? line.value : null
  const numeric = (part: (typeof parts)[number]) => NUMERIC.has(typeOf.get(part.fieldId) ?? '')
  const texts = parts.filter((part) => !numeric(part)).map((part) => part.value)
  const figures = parts.filter(numeric)
  const kept = figures.filter(
    (part) => counted === null || unitsOf(part.value) !== unitsOf(counted),
  )
  const said = [...texts, ...kept.map((part) => words.figure(part.label, part.value))]
  if (said.length === 0) said.push(figures[0]?.label ?? item.title)

  // what last happened to it, the reviewer's words it carries and its files
  // are read the way every list of claims reads them, the account's included
  const { act, at } = claimActOf(entry)

  return {
    lead: said[0]!,
    sub: said.slice(1).reduce((line, part) => (line === '' ? part : words.join(line, part)), ''),
    words: [item.title, ...parts.map((part) => part.value)].join(' ').toLowerCase(),
    amount,
    amountWord,
    amountTone,
    at: at ?? entry.createdAt,
    act,
    action: claimActWord[act],
    note: claimNoteOf(entry),
    files: claimFilesOf(entry, formConfig),
  }
}

/**
 * The filters above one question's claims, in the order they are offered.
 *
 * Each counts what the head's cell of the same name counts, so a figure at
 * the head and the filter under it never disagree. The owner's head folds
 * appeals, and claims a reviewer has asked more of, into "in review", and
 * so does the owner's filter - a claim asked more of is also a to-do, so
 * the owner's filters may overlap. A staff reader's head gives
 * re-examinations and appeals a cell of their own, and so a filter of
 * their own.
 */
export type ChipKey =
  | 'all'
  | 'todo'
  | 'waiting'
  | 'in_review'
  | 'contested'
  | 'approved'
  | 'rejected'
  | 'voided'

export interface Chip {
  readonly key: ChipKey
  readonly label: MessageDescriptor
  readonly test: (entry: EntryDto) => boolean
  /** a chip whose count is the reader's own to act on */
  readonly urgent: boolean
}

const OWNER_TODO = new Set(['draft', 'needs_revision'])

export const chipsFor = (viewer: Viewer): readonly Chip[] => [
  {
    key: 'all',
    label: m.myEntriesFilterAll,
    test: (entry) => entry.status !== 'voided',
    urgent: false,
  },
  viewer === 'owner'
    ? {
        key: 'todo',
        label: m.myEntriesFilterTodo,
        test: (entry) => entry.supplement !== null || OWNER_TODO.has(entry.status),
        urgent: true,
      }
    : {
        key: 'waiting',
        label: m.entriesChipWaiting,
        test: (entry) => entry.supplement !== null || entry.status === 'needs_revision',
        urgent: false,
      },
  {
    key: 'in_review',
    label: m.entryStatusInReview,
    test: (entry) =>
      viewer === 'owner'
        ? entry.status === 'in_review' || contested(entry)
        : entry.status === 'in_review' && entry.supplement === null && !contested(entry),
    urgent: false,
  },
  ...(viewer === 'staff'
    ? [
        {
          key: 'contested' as const,
          label: m.entriesStatContested,
          test: contested,
          urgent: false,
        },
      ]
    : []),
  {
    key: 'approved',
    label: m.entryStatusApproved,
    test: (entry) => entry.status === 'approved' && !contested(entry),
    urgent: false,
  },
  {
    key: 'rejected',
    label: m.entryStatusRejected,
    test: (entry) => entry.status === 'rejected' && !contested(entry),
    urgent: false,
  },
  ...(viewer === 'staff'
    ? [
        {
          key: 'voided' as const,
          label: m.entryStatusVoided,
          test: (entry: EntryDto) => entry.status === 'voided',
          urgent: false,
        },
      ]
    : []),
]

/** the figures across the head: what is moving, as the reader needs it counted */
export interface HeadStat {
  readonly key: string
  readonly label: MessageDescriptor
  readonly count: number
  /** amber: waiting on the owner */
  readonly waits: boolean
}

export const headStatsOf = (viewer: Viewer, entries: readonly EntryDto[]): readonly HeadStat[] => {
  const live = entries.filter((entry) => entry.status !== 'voided')
  const count = (test: (entry: EntryDto) => boolean) => live.filter(test).length
  if (viewer === 'owner') {
    return [
      {
        key: 'in_review',
        label: m.entryStatusInReview,
        // the same claims the list's "in review" filter holds: a settled
        // claim under appeal or re-examination is out with the reviewers
        // again, and one a reviewer has asked more of is still in review
        // while it waits on the owner too
        count: count((e) => e.status === 'in_review' || contested(e)),
        waits: false,
      },
      {
        key: 'draft',
        label: m.entryStatusDraft,
        count: count((e) => e.status === 'draft'),
        waits: false,
      },
      {
        key: 'needs_revision',
        label: m.entryStatusNeedsRevision,
        count: count((e) => e.status === 'needs_revision'),
        waits: true,
      },
    ]
  }
  return [
    {
      key: 'approved',
      label: m.entryStatusApproved,
      count: count((e) => e.status === 'approved' && !contested(e)),
      waits: false,
    },
    {
      key: 'in_review',
      label: m.entryStatusInReview,
      count: count((e) => e.status === 'in_review' && e.supplement === null && !contested(e)),
      waits: false,
    },
    {
      key: 'supplement',
      label: m.entryStatusAwaitingSupplement,
      count: count((e) => e.supplement !== null),
      waits: true,
    },
    {
      key: 'needs_revision',
      label: m.entryStatusNeedsRevision,
      count: count((e) => e.status === 'needs_revision'),
      waits: true,
    },
    { key: 'contested', label: m.entriesStatContested, count: count(contested), waits: false },
    {
      key: 'rejected',
      label: m.entryStatusRejected,
      count: count((e) => e.status === 'rejected' && !contested(e)),
      waits: false,
    },
  ]
}

/**
 * What the head totals: the figure so far, and full marks.
 *
 * Full marks are the lifted root's own limit where it sets one, and
 * otherwise what the limited sections at the top add up to. A top section
 * with no limit - a deduction section, typically - adds nothing to them, so
 * it neither raises the figure nor takes the figure away (§32.72, amended).
 */
export const totalsOf = (
  outline: Outline,
  standing: Standing | null,
): { readonly got: string | null; readonly cap: number | null } => {
  const capOf = (row: StructureRow) =>
    row.cap === null || row.cap === undefined || row.cap === '' ? null : Number(row.cap)
  const caps = outline.tops.flatMap((row) => {
    const cap = capOf(row)
    return cap === null ? [] : [cap]
  })
  const summed = caps.length === 0 ? null : caps.reduce((sum, cap) => sum + cap, 0)
  if (outline.root !== null) {
    return {
      got: outline.root.right === '' ? (standing?.total ?? null) : outline.root.right,
      cap: capOf(outline.root) ?? summed,
    }
  }
  return { got: standing?.total ?? null, cap: summed }
}

// Why a stage holds an act - starting a claim among them - is said once,
// beside every other refusal, and the workspace reads it from there.
export { filingHeldOf, type RoundState, type Said }

/** what the owner may put into one question now, and what to say where they may not */
export interface Filing {
  /** filing belongs on this question at all, and the gate did not hide it */
  readonly mayAdd: boolean
  /** ...but the phase has shut it for now */
  readonly shut: boolean
  /** why it is shut, said about starting a claim */
  readonly why: Said | null
  /** the gate's reason code, for the data hook beside the sentence */
  readonly reason: string | null
  /** the gate's own state, for the key's data hook */
  readonly gate: string
  /** its places are used up */
  readonly full: boolean
  /** places left, where it sets a limit */
  readonly room: number | null
  /** a declaration files in one press, with nothing to fill in */
  readonly declared: boolean
  /** nobody files it: it lands by itself, or the office records it */
  readonly granted: boolean
  readonly recorded: boolean
  readonly voided: boolean
}

export const filingOf = (
  item: ItemDto,
  entries: readonly EntryDto[],
  gate: FilingGateDto | undefined,
  /** the round's stage, for saying which one shut filing */
  round: RoundState | null = null,
): Filing => {
  const live = entries.filter((entry) => entry.status !== 'voided')
  const granted = item.itemType === 'constant'
  const recorded = recordedOnly(item)
  const voided = item.status === 'voided'
  const declared = item.itemType === 'declaration'
  const room = roomLeft(item, live)
  const full = !granted && !recorded && !voided && room !== null && room <= 0
  // a declaration kept as a draft is the one to hand on, not a second one
  const declaredAlready = declared && live.some((entry) => entry.status === 'draft')
  // Structure first, then the phase: `mayFile` says filing belongs on this
  // question at all, the gate says whether this minute allows it. A shut
  // gate takes the key away and says why where the next claim would start -
  // a key that only turns into a refusal after the dialog is a trap, and a
  // greyed one says nothing but "not now".
  const mayAdd = !full && mayFile(item, live) && !declaredAlready && gate?.create.state !== 'hidden'
  const shut = gate !== undefined && gate.create.state === 'blocked'
  return {
    mayAdd,
    shut,
    why: shut ? filingHeldOf(gate.create.reason, round) : null,
    reason: shut ? gate.create.reason : null,
    gate: gate?.create.state ?? 'available',
    full,
    room,
    declared,
    granted,
    recorded,
    voided,
  }
}

/** the word a question has instead of a key, where nobody files into it */
export const badgeOf = (item: ItemDto, filing: Filing | null): MessageDescriptor | null =>
  item.status === 'voided'
    ? m.itemsStatusVoided
    : item.itemType === 'constant'
      ? m.paperEmptyGranted
      : recordedOnly(item)
        ? m.entriesRecordedByStaff
        : filing?.full === true
          ? m.myEntriesAddFull
          : null

/** a question the staff reader would call unsettled: something still moving on it */
export const movingOn = (entries: readonly EntryDto[]): boolean =>
  entries.some(
    (entry) =>
      entry.status === 'in_review' ||
      entry.status === 'needs_revision' ||
      entry.supplement !== null ||
      contested(entry),
  )

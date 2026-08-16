import type { ApiResult } from '@qualy/web-runtime/api'
import type { assessmentApi } from '../api.ts'

// What the review screens agree on: the queue row, the three ways it is
// laid out, and the run - the ordered slice of the queue a reviewer walks
// through one submission at a time.
//
// Grouping happens here rather than in the pages because the queue page and
// the workbench must walk the same order: "the next one" has to mean the
// same row in both, or finishing an item's list would land somewhere the
// list never showed.

export type InboxItemDto = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listReviewInbox'
>['items'][number]

export type ReviewDto = ApiResult<typeof assessmentApi, 'assessment', 'getReviewInstance'>['review']

/**
 * The slice of the queue a run walks: everything, one question's rows, or
 * one participant's. Carried in the address as `run`, so a reload and the
 * queue rail agree about which walk this is.
 */
export type RunScope =
  { kind: 'all' } | { kind: 'item'; itemId: string } | { kind: 'person'; businessNo: string }

export const readRunScope = (raw: string): RunScope => {
  if (raw.startsWith('item:')) return { kind: 'item', itemId: raw.slice('item:'.length) }
  if (raw.startsWith('person:')) return { kind: 'person', businessNo: raw.slice('person:'.length) }
  return { kind: 'all' }
}

export const writeRunScope = (scope: RunScope): string =>
  scope.kind === 'item'
    ? `item:${scope.itemId}`
    : scope.kind === 'person'
      ? `person:${scope.businessNo}`
      : ''

/** the queue in the order every screen walks it: oldest first, as served */
export const runRows = (rows: readonly InboxItemDto[], scope: RunScope): readonly InboxItemDto[] =>
  scope.kind === 'item'
    ? rows.filter((row) => row.itemId === scope.itemId)
    : scope.kind === 'person'
      ? rows.filter((row) => (row.businessNo ?? row.participantName) === scope.businessNo)
      : rows

/** one question's rows, keeping the queue's own order inside each group */
export interface ItemGroup {
  readonly itemId: string
  readonly itemTitle: string
  /** the labels of the first row's projected values, as the column head */
  readonly columns: readonly string[]
  readonly rows: readonly InboxItemDto[]
}

export const groupByItem = (rows: readonly InboxItemDto[]): readonly ItemGroup[] => {
  const groups = new Map<string, { itemTitle: string; rows: InboxItemDto[] }>()
  for (const row of rows) {
    const group = groups.get(row.itemId)
    if (group === undefined) groups.set(row.itemId, { itemTitle: row.itemTitle, rows: [row] })
    else group.rows.push(row)
  }
  return [...groups.entries()].map(([itemId, group]) => ({
    itemId,
    itemTitle: group.itemTitle,
    columns: (group.rows[0]?.values ?? []).map((pair) => pair.label),
    rows: group.rows,
  }))
}

/** newest day first, oldest row first inside a day: clearing from the top clears the backlog */
export interface DayGroup {
  readonly day: string
  readonly rows: readonly InboxItemDto[]
}

export const groupByDay = (rows: readonly InboxItemDto[]): readonly DayGroup[] => {
  const groups = new Map<string, InboxItemDto[]>()
  for (const row of rows) {
    const day = new Date(row.submittedAt).toLocaleDateString('en-CA')
    const group = groups.get(day)
    if (group === undefined) groups.set(day, [row])
    else group.push(row)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, dayRows]) => ({ day, rows: dayRows }))
}

/** one person's whole pile, so their duplicates sit next to each other */
export interface PersonGroup {
  readonly key: string
  readonly name: string
  readonly businessNo: string | null
  readonly unitName: string | null
  readonly rows: readonly InboxItemDto[]
}

export const groupByPerson = (rows: readonly InboxItemDto[]): readonly PersonGroup[] => {
  const groups = new Map<string, PersonGroup & { rows: InboxItemDto[] }>()
  for (const row of rows) {
    const key = row.businessNo ?? row.participantName
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, {
        key,
        name: row.participantName,
        businessNo: row.businessNo,
        unitName: row.unitName,
        rows: [row],
      })
    } else {
      group.rows.push(row)
    }
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** a text filter a reader types: matched against who and what, never status */
export const matchesSearch = (row: InboxItemDto, needle: string): boolean => {
  if (needle === '') return true
  const lowered = needle.toLowerCase()
  return (
    row.participantName.toLowerCase().includes(lowered) ||
    (row.businessNo ?? '').toLowerCase().includes(lowered) ||
    row.itemTitle.toLowerCase().includes(lowered) ||
    row.values.some((pair) => pair.value.toLowerCase().includes(lowered))
  )
}

/**
 * A row's answers on one line. Separated by an ideographic space rather than
 * a glyph: a punctuation mark between two field values reads as part of one
 * of them.
 */
export const summaryOf = (
  values: readonly { readonly label: string; readonly value: string }[],
): string =>
  values
    .map((pair) => pair.value)
    .filter((value) => value !== '')
    .join('\u3000')

export const rowSummary = (row: InboxItemDto): string => summaryOf(row.values)

/** when a moment happened, in the reader's clock, without seconds */
export const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export const clockLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

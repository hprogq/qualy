import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { fieldsOf } from '../entry/model.ts'

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

/** one ask this reviewer's step is waiting on somebody else for */
export type AwaitingDto = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listAwaitingSupplements'
>['items'][number]

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
/**
 * A record's clock: to the second, because trails and conclusions are
 * compared and cited, and with the year whenever it is not this one. The
 * queue keeps its own coarser day-aware clock - operating surfaces read at
 * a glance, records read exactly.
 */
export const timeLabel = (iso: string): string => {
  const then = new Date(iso)
  return then.toLocaleString(undefined, {
    ...(then.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const clockLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/**
 * A clock that admits which day it is.
 *
 * A bare 18:16 reads the same for today and for yesterday, and a queue
 * sorted by age turned that into two identical rows a day apart. Today
 * keeps the clock - the hour is what orders today's work; any other day
 * shows the day instead, because "which day" is then the whole answer and
 * an hour behind it is noise.
 */
export function useDayClock(): (iso: string) => string {
  const { format } = useI18n()
  return (iso: string) => {
    const at = new Date(iso)
    const floor = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate())
    const days = Math.round((floor(new Date()).getTime() - floor(at).getTime()) / 86_400_000)
    if (days <= 0) return clockLabel(iso)
    if (days === 1) return format(m.timeYesterday)
    return at.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
  }
}

/**
 * How long ago, in the reader's own words.
 *
 * "Two days" is what somebody deciding whether to chase a request actually
 * wants; a timestamp makes them do the subtraction. The exact instant is
 * still shown beside it, because a record has to say when.
 */
export function useHowLongAgo(): (iso: string) => string {
  const { format, locale } = useI18n()
  return (iso: string) => {
    const delta = new Date(iso).getTime() - Date.now()
    const abs = Math.abs(delta)
    if (abs < 60_000) return format(m.justNow)
    const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
      abs < 3_600_000
        ? ['minute', 60_000]
        : abs < 86_400_000
          ? ['hour', 3_600_000]
          : abs < 2_592_000_000
            ? ['day', 86_400_000]
            : ['month', 2_592_000_000]
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      Math.round(delta / size),
      unit,
    )
  }
}

/** one version of a filing, as the history endpoint answers it */
export interface HistoryRevision {
  id: string
  revisionNo: number
  payload: unknown
  formConfig: unknown
  note: string | null
  createdAt: string
}

/**
 * Everything that ever happened to one claim.
 *
 * Asked on the entry rather than on the round: the versions and the rounds
 * are one story, and the reviewer's standing to read it is the open round
 * they already hold.
 */
export function useEntryHistory(entryId: string, enabled: boolean) {
  const query = useApiQuery(assessmentApi)
  return useQuery({
    ...query.assessment.getEntryHistory.queryOptions({ params: { entryId } }),
    enabled,
    staleTime: 30_000,
  })
}

/**
 * One payload value as something two versions can be compared on.
 *
 * A file field's answer is the set of files it cites, so its comparable form
 * is that set: swapping one certificate for another is a change, and reading
 * it as "no value" made a version look untouched where the whole point of
 * the resubmission was the new photograph.
 */
export const valueOf = (raw: unknown): string =>
  typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(String).join(',') : ''

/** the attachments an answer cites, in the order they were filed */
export const idsOf = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.map((one) => String(one)) : []

/** one filing's answers, under the labels of the form it was written on */
export const valuesOf = (
  formConfig: unknown,
  payload: unknown,
): readonly { key: string; label: string; value: string; ids: readonly string[] }[] =>
  fieldsOf(formConfig).map((field) => {
    const record = (payload ?? {}) as Record<string, unknown>
    const raw = record[field.key]
    return {
      key: field.key,
      label: field.label,
      value: valueOf(raw),
      ids: field.type === 'attachment' ? idsOf(raw) : [],
    }
  })

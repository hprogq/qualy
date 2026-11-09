import { Effect } from 'effect'
import { fakeClient, type FakeClient } from './screen.tsx'
import type { QueuePage, QueueRequest } from '../../src/client/review/queue.ts'
import { dayKeyOf } from '../../src/client/batch/zone.ts'

/** Server-shaped replies for UI fixtures; filtering and paging happen before rows reach React. */
export function reviewPage(
  raw: Record<string, unknown>,
  request: QueueRequest & { batchId?: string } = {},
): QueuePage {
  const all = ((raw.items ?? []) as QueuePage['items'])
    .map((row) => ({
      ...row,
      participantId: row.participantId ?? row.businessNo ?? row.participantName,
      supplemented: row.supplemented ?? false,
    }))
    .filter(
      (row) =>
        (!request.batchId || row.batchId === request.batchId) &&
        !request.exclude?.includes(row.instanceId),
    )
  const needle = request.search?.toLowerCase() ?? ''
  const filtered = all.filter(
    (row) =>
      (!request.unitId || row.unitId === request.unitId) &&
      (!request.itemId || request.view === 'item' || row.itemId === request.itemId) &&
      (!request.person || request.view === 'person' || row.participantId === request.person) &&
      (!needle ||
        [
          row.participantName,
          row.businessNo ?? '',
          row.itemTitle,
          ...row.values.map((part) => part.value),
        ].some((value) => value.toLowerCase().includes(needle))),
  )
  const byDay =
    request.view === 'time' && (request.layout === 'overview' || request.day !== undefined)
  const person = request.view === 'person'
  // The fixtures' batches use Asia/Shanghai, as does the server when it groups their days.
  const keyOf = (row: QueuePage['items'][number]) =>
    byDay
      ? dayKeyOf(Date.parse(row.submittedAt), 'Asia/Shanghai')
      : person
        ? row.participantId
        : row.itemId
  const groups: QueuePage['groups'][number][] = []
  if (request.view === 'item' || person || byDay) {
    for (const row of filtered) {
      const key = keyOf(row)
      const found = groups.find((group) => group.key === key)
      if (found) groups[groups.indexOf(found)] = { ...found, count: found.count + 1 }
      else
        groups.push({
          key,
          name: byDay ? key : person ? row.participantName : row.itemTitle,
          count: 1,
          oldest: row.submittedAt,
          firstInstanceId: row.instanceId,
          businessNo: request.view === 'person' ? row.businessNo : null,
          unitName: request.view === 'person' ? row.unitName : null,
        })
    }
  }
  if (request.groupOrder === 'largest') groups.sort((a, b) => b.count - a.count)
  else if (byDay) groups.sort((a, b) => b.key.localeCompare(a.key))
  const groupPage = Math.min(
    Number(request.groupPage ?? 1),
    Math.max(1, Math.ceil(groups.length / 20)),
  )
  const shownGroups = groups.slice((groupPage - 1) * 20, groupPage * 20)
  const requested = byDay ? request.day : person ? request.person : request.itemId
  // as the server reads it: nothing named, an overview gives every group on
  // the page its oldest three rather than opening the first
  const overview = groups.length > 0 && request.layout === 'overview' && requested === undefined
  const selected = overview ? null : (requested ?? shownGroups[0]?.key ?? null)
  const scoped = overview
    ? filtered
    : groups.length > 0 && filtered.length > 3
      ? filtered.filter((row) => keyOf(row) === selected)
      : filtered
  const shownKeys = new Set(shownGroups.map((group) => group.key))
  const briefs = overview
    ? filtered.filter(
        (row) =>
          shownKeys.has(keyOf(row)) &&
          filtered.filter((other) => keyOf(other) === keyOf(row)).indexOf(row) < 3,
      )
    : null
  const pageSize = Number(request.limit ?? 20)
  const at = scoped.findIndex((row) => row.instanceId === request.focus)
  const page = Math.min(
    at >= 0 ? Math.floor(at / pageSize) + 1 : Number(request.page ?? 1),
    Math.max(1, Math.ceil(scoped.length / pageSize)),
  )
  return {
    items: briefs ?? scoped.slice((page - 1) * pageSize, page * pageSize),
    total: scoped.length,
    page,
    pageSize,
    queueTotal: all.length,
    filteredTotal: filtered.length,
    marks: {
      all: filtered.length,
      escalated: filtered.filter((row) => row.route === 'escalation').length,
      resubmitted: filtered.filter((row) => row.roundNo > 1).length,
      supplemented: filtered.filter((row) => row.supplemented === true).length,
    },
    groups: shownGroups,
    groupPage,
    groupTotal: groups.length,
    selected,
    itemOptions: [
      ...new Map(all.map((row) => [row.itemId, { id: row.itemId, name: row.itemTitle }])).values(),
    ],
    unitOptions: [
      ...new Map(
        all.flatMap((row) =>
          row.unitId === null
            ? []
            : [[row.unitId, { id: row.unitId, name: row.unitName ?? '' }] as const],
        ),
      ).values(),
    ],
    queueFirstId: all[0]?.instanceId ?? null,
    firstId: scoped[0]?.instanceId ?? null,
    previousId: at < 1 ? null : (scoped[at - 1]?.instanceId ?? null),
    nextId: at < 0 ? null : (scoped[at + 1]?.instanceId ?? null),
    handledToday: Number(raw.handledToday ?? 0),
    judging: raw.judging !== false,
  }
}

export function reviewClient(stubs: FakeClient): FakeClient {
  const methods = stubs.assessment
  if (!methods) return fakeClient(stubs)
  const list = methods.listReviewInbox as
    | ((input: {
        query: QueueRequest & { batchId?: string }
      }) => Effect.Effect<Record<string, unknown>, unknown>)
    | undefined
  const asked = methods.listAwaitingSupplements as
    | ((input: {
        query: QueueRequest & { batchId?: string }
      }) => Effect.Effect<Record<string, unknown>, unknown>)
    | undefined
  return fakeClient({
    ...stubs,
    assessment: {
      // the queue's dock reads the timeline; a screen that does not say one
      // has none, and the dock says the round opens no reviewing
      getTimeline: () => Effect.succeed({ timeline: [] }),
      ...methods,
      ...(list === undefined
        ? {}
        : {
            listReviewInbox: (input: { query: QueueRequest & { batchId?: string } }) =>
              list(input).pipe(
                Effect.map((result) =>
                  'total' in result ? result : reviewPage(result, input.query),
                ),
              ),
          }),
      ...(asked === undefined
        ? {}
        : {
            listAwaitingSupplements: (input: { query: QueueRequest & { batchId?: string } }) =>
              asked(input).pipe(
                Effect.map((result) => {
                  if ('total' in result) return result
                  const items = result.items as readonly { status: string }[]
                  const pageSize = Number(input.query.limit ?? 10)
                  const page = Math.min(
                    Number(input.query.page ?? 1),
                    Math.max(1, Math.ceil(items.length / pageSize)),
                  )
                  return {
                    items: items.slice((page - 1) * pageSize, page * pageSize),
                    total: items.length,
                    page,
                    pageSize,
                    answered: items.filter((row) => row.status === 'answered').length,
                  }
                }),
              ),
          }),
    },
  })
}

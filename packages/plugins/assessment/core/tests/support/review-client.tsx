import { Effect } from 'effect'
import { fakeClient, type FakeClient } from './screen.tsx'
import type { QueuePage, QueueRequest } from '../../src/client/review/queue.ts'

/** Server-shaped replies for UI fixtures; filtering and paging happen before rows reach React. */
export function reviewPage(
  raw: Record<string, unknown>,
  request: QueueRequest & { batchId?: string } = {},
): QueuePage {
  const all = ((raw.items ?? []) as QueuePage['items'])
    .map((row) => ({
      ...row,
      participantId: row.participantId ?? row.businessNo ?? row.participantName,
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
  const groups: QueuePage['groups'][number][] = []
  if (request.view === 'item' || request.view === 'person') {
    for (const row of filtered) {
      const key = request.view === 'person' ? row.participantId : row.itemId
      const found = groups.find((group) => group.key === key)
      if (found) groups[groups.indexOf(found)] = { ...found, count: found.count + 1 }
      else
        groups.push({
          key,
          name: request.view === 'person' ? row.participantName : row.itemTitle,
          count: 1,
          oldest: row.submittedAt,
          firstInstanceId: row.instanceId,
          businessNo: request.view === 'person' ? row.businessNo : null,
          unitName: request.view === 'person' ? row.unitName : null,
        })
    }
  }
  if (request.groupOrder === 'largest') groups.sort((a, b) => b.count - a.count)
  const groupPage = Math.min(
    Number(request.groupPage ?? 1),
    Math.max(1, Math.ceil(groups.length / 20)),
  )
  const shownGroups = groups.slice((groupPage - 1) * 20, groupPage * 20)
  const selected =
    (request.view === 'person' ? request.person : request.itemId) ?? shownGroups[0]?.key ?? null
  const scoped =
    groups.length > 0 && filtered.length > 3
      ? filtered.filter(
          (row) => (request.view === 'person' ? row.participantId : row.itemId) === selected,
        )
      : filtered
  const pageSize = Number(request.limit ?? 20)
  const at = scoped.findIndex((row) => row.instanceId === request.focus)
  const page = Math.min(
    at >= 0 ? Math.floor(at / pageSize) + 1 : Number(request.page ?? 1),
    Math.max(1, Math.ceil(scoped.length / pageSize)),
  )
  return {
    items: scoped.slice((page - 1) * pageSize, page * pageSize),
    total: scoped.length,
    page,
    pageSize,
    queueTotal: all.length,
    filteredTotal: filtered.length,
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

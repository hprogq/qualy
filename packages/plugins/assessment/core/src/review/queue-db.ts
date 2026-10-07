import { sql } from 'kysely'
import { likeContains, pageWindow } from '@qualy/api-kit/schema'
import { db } from '../server/db.ts'
import { awaitingQuery, inboxQuery, requirementsOf, type InboxRow } from './db.ts'

export interface InboxQuery {
  tenantId: string
  userId: string
  batchIds: readonly string[]
  page: number
  limit: number
  view?: 'item' | 'person' | 'time'
  itemId?: string
  person?: string
  unitId?: string
  search?: string
  groupPage: number
  groupOrder?: 'largest'
  focus?: string
  exclude?: readonly string[]
}

export interface QueueGroup {
  key: string
  name: string
  businessNo: string | null
  unitName: string | null
  count: number
  oldest: string
  firstInstanceId: string
}

/** Search the identifying values projected by projectEntrySummary, including choice labels. */
const summaryMatches = (pattern: string) => sql<boolean>`exists (
  select 1 from (
    select projected.value
    from jsonb_array_elements(coalesce(ir.form_config->'fields', '[]'::jsonb)) with ordinality fields(field, position)
    cross join lateral (
      select case jsonb_typeof(er.payload->(field->>'key'))
        when 'string' then case when field->>'type' = 'choice' then coalesce((
          select case when jsonb_typeof(option->'label') = 'string' then option->>'label' end
          from jsonb_array_elements(coalesce(field->'options', '[]'::jsonb)) option
          where option->>'value' = er.payload->>(field->>'key') limit 1
        ), btrim(er.payload->>(field->>'key'))) else btrim(er.payload->>(field->>'key')) end
        when 'number' then er.payload->>(field->>'key')
        when 'boolean' then er.payload->>(field->>'key')
        else '' end as value
    ) projected
    where coalesce(field->>'id', field->>'key') is not null
      and coalesce(field->>'type', '') not in ('attachment', 'boolean')
      and case when jsonb_array_length(coalesce(ir.display_config->'entrySummary'->'fieldIds', '[]'::jsonb)) > 0
        then coalesce(field->>'id', field->>'key') in (select jsonb_array_elements_text(ir.display_config->'entrySummary'->'fieldIds'))
        else projected.value <> '' end
    order by case when jsonb_array_length(coalesce(ir.display_config->'entrySummary'->'fieldIds', '[]'::jsonb)) > 0
      then (select ordinality from jsonb_array_elements_text(ir.display_config->'entrySummary'->'fieldIds') with ordinality configured(id, ordinality)
        where id = coalesce(field->>'id', field->>'key') limit 1) else position end
    limit 3
  ) summary where value ilike ${pattern}
)`

const msOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value ?? 0)

export const inboxNumberedPage = (input: InboxQuery) =>
  db.query(async (k) => {
    let authorized = inboxQuery(k, input)
    if (input.exclude !== undefined && input.exclude.length > 0)
      authorized = authorized.where('ri.id', 'not in', [...input.exclude])
    const count = async (query: typeof authorized) =>
      Number(
        (
          await query
            .clearSelect()
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow()
        ).count,
      )
    const queueTotal = await count(authorized)
    const queueFirst = await authorized
      .clearSelect()
      .select('ri.id')
      .orderBy('ri.createdAt')
      .orderBy('ri.id')
      .limit(1)
      .executeTakeFirst()
    const itemOptions = await authorized
      .clearSelect()
      .select(['e.itemId as id', 'i.title as name'])
      .distinct()
      .orderBy('i.title')
      .orderBy('e.itemId')
      .execute()
    const unitOptions = await authorized
      .clearSelect()
      .select(['un.id as id', 'un.name as name'])
      .where('un.id', 'is not', null)
      .distinct()
      .orderBy('un.name')
      .orderBy('un.id')
      .execute()
    let filtered = authorized
    if (input.unitId !== undefined) filtered = filtered.where('un.id', '=', input.unitId)
    if (input.search !== undefined && input.search.trim() !== '') {
      const pattern = likeContains(input.search.trim())
      filtered = filtered.where((eb) =>
        eb.or([
          eb('su.displayName', 'ilike', pattern),
          eb('su.businessNo', 'ilike', pattern),
          eb('i.title', 'ilike', pattern),
          summaryMatches(pattern),
        ]),
      )
    }
    if (input.view !== 'item' && input.itemId !== undefined)
      filtered = filtered.where('e.itemId', '=', input.itemId)
    if (input.view !== 'person' && input.person !== undefined)
      filtered = filtered.where('bp.id', '=', input.person)
    const filteredTotal = await count(filtered)
    const grouped = input.view === 'item' || input.view === 'person'
    const person = input.view === 'person'
    const groupedQuery = filtered
      .clearSelect()
      .select([
        person ? 'bp.id as key' : 'e.itemId as key',
        person ? 'su.displayName as name' : 'i.title as name',
        (person ? sql<string | null>`su.business_no` : sql<string | null>`null`).as('businessNo'),
        (person ? sql<string | null>`un.name` : sql<string | null>`null`).as('unitName'),
        sql<string>`count(*)`.as('count'),
        sql<string>`min(ri.created_at)::text`.as('oldest'),
        sql<string>`(array_agg(ri.id order by ri.created_at, ri.id))[1]::text`.as(
          'firstInstanceId',
        ),
      ])
      .groupBy(
        person ? ['bp.id', 'su.displayName', 'su.businessNo', 'un.name'] : ['e.itemId', 'i.title'],
      )
    const groupTotal = grouped
      ? Number(
          (
            await k
              .selectFrom(groupedQuery.as('groups'))
              .select((eb) => eb.fn.countAll<string>().as('count'))
              .executeTakeFirstOrThrow()
          ).count,
        )
      : 0
    const groupOrder =
      input.groupOrder === 'largest'
        ? sql`count(*) desc, min(ri.created_at)`
        : person
          ? sql`coalesce(su.business_no, su.display_name)`
          : sql`min(ri.created_at)`
    const groupKey = person ? sql`bp.id` : sql`e.item_id`
    const requested = person ? input.person : input.itemId
    const selectedPosition =
      !grouped || requested === undefined
        ? undefined
        : await k
            .selectFrom(
              groupedQuery
                .select(
                  sql<string>`row_number() over (order by ${groupOrder}, ${groupKey})`.as(
                    'position',
                  ),
                )
                .as('ranked'),
            )
            .select('position')
            .where('key', '=', requested)
            .executeTakeFirst()
    const groupWindow = pageWindow(
      selectedPosition === undefined
        ? input.groupPage
        : Math.floor((Number(selectedPosition.position) - 1) / 20) + 1,
      20,
      groupTotal,
    )
    const groups = grouped
      ? (
          await groupedQuery
            .orderBy(groupOrder)
            .orderBy(person ? 'bp.id' : 'e.itemId')
            .offset(groupWindow.offset)
            .limit(20)
            .execute()
        ).map((row): QueueGroup => ({
          ...row,
          count: Number(row.count),
          oldest: new Date(row.oldest).toISOString(),
        }))
      : []
    const selected = grouped
      ? selectedPosition === undefined
        ? groups[0]?.key
        : requested
      : undefined
    let scoped = filtered
    // A queue of at most three filings is shown whole; larger queues fetch only the open group.
    if (grouped && filteredTotal > 3 && selected !== undefined)
      scoped = scoped.where(person ? 'bp.id' : 'e.itemId', '=', selected)
    const total = await count(scoped)
    const anchor =
      input.focus === undefined
        ? undefined
        : await scoped
            .where('ri.id', '=', input.focus)
            .clearSelect()
            .select('ri.id')
            .select(sql<string>`ri.created_at::text`.as('at'))
            .executeTakeFirst()
    const before =
      anchor === undefined
        ? undefined
        : sql<boolean>`(ri.created_at, ri.id) < (${anchor.at}::timestamptz, ${anchor.id}::uuid)`
    const position = before === undefined ? 0 : await count(scoped.where(before))
    const window = pageWindow(
      anchor === undefined ? input.page : Math.floor(position / input.limit) + 1,
      input.limit,
      total,
    )
    const rows = await scoped
      .orderBy('ri.createdAt')
      .orderBy('ri.id')
      .offset(window.offset)
      .limit(input.limit)
      .execute()
    const previous =
      before === undefined
        ? undefined
        : await scoped
            .where(before)
            .clearSelect()
            .select('ri.id')
            .orderBy('ri.createdAt', 'desc')
            .orderBy('ri.id', 'desc')
            .limit(1)
            .executeTakeFirst()
    const next =
      anchor === undefined
        ? undefined
        : await scoped
            .where(
              sql<boolean>`(ri.created_at, ri.id) > (${anchor.at}::timestamptz, ${anchor.id}::uuid)`,
            )
            .clearSelect()
            .select('ri.id')
            .orderBy('ri.createdAt')
            .orderBy('ri.id')
            .limit(1)
            .executeTakeFirst()
    const first = await scoped
      .clearSelect()
      .select('ri.id')
      .orderBy('ri.createdAt')
      .orderBy('ri.id')
      .limit(1)
      .executeTakeFirst()
    return {
      items: rows.map((row): InboxRow => ({
        instanceId: row.instanceId,
        entryId: row.entryId,
        batchId: row.batchId,
        batchName: row.batchName,
        itemId: row.itemId,
        itemTitle: row.itemTitle,
        participantId: row.participantId,
        participantName: row.participantName,
        businessNo: row.businessNo,
        unitId: row.unitId,
        unitName: row.unitName,
        roundNo: row.roundNo,
        route: row.currentRoute as InboxRow['route'],
        payload: row.payload,
        formConfig: row.formConfig,
        displayConfig: row.displayConfig,
        attachmentCount: Number(row.attachmentCount ?? 0),
        submittedAt: msOf(row.submittedMs),
        submittedAtIso: row.submittedIso,
      })),
      total,
      page: window.page,
      pageSize: input.limit,
      queueTotal,
      filteredTotal,
      groups,
      groupTotal,
      groupPage: groupWindow.page,
      selected: selected ?? null,
      itemOptions,
      unitOptions: unitOptions.flatMap((one) =>
        one.id === null ? [] : [{ id: one.id, name: one.name ?? '' }],
      ),
      queueFirstId: queueFirst?.id ?? null,
      firstId: first?.id ?? null,
      previousId: previous?.id ?? null,
      nextId: next?.id ?? null,
    }
  })

export const awaitingNumberedPage = (input: {
  tenantId: string
  batchId: string
  userId: string
  page: number
  limit: number
}) =>
  db.query(async (k) => {
    const query = awaitingQuery(k, input)
    const counted = await query
      .clearSelect()
      .select((eb) => [
        eb.fn.countAll<string>().as('count'),
        sql<string>`count(*) filter (where sr.status = 'answered')`.as('answered'),
      ])
      .executeTakeFirstOrThrow()
    const total = Number(counted.count)
    const window = pageWindow(input.page, input.limit, total)
    const rows = await query
      .orderBy('sr.createdAt', 'desc')
      .orderBy('sr.id', 'desc')
      .offset(window.offset)
      .limit(input.limit)
      .execute()
    return {
      items: rows.map((row) => ({
        requestId: row.requestId,
        instanceId: row.instanceId,
        entryId: row.entryId,
        requestNo: row.requestNo,
        status: row.status as 'open' | 'answered',
        participantName: row.participantName,
        businessNo: row.businessNo,
        itemTitle: row.itemTitle,
        asks: (requirementsOf(row.requirements) ?? []).map((ask) => ask.label),
        requestedAt: msOf(row.requestedMs),
        answeredAt: row.answeredMs === null ? null : msOf(row.answeredMs),
      })),
      total,
      page: window.page,
      pageSize: input.limit,
      answered: Number(counted.answered),
    }
  })

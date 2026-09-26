import { Effect } from 'effect'
import { sql } from 'kysely'
import { db } from '../server/db.ts'
import { readEntryChannels } from '../item/channels.ts'
import { policyModeOf, readPolicy, routeLevels, type ReviewRoute } from './chain.ts'

// Who on the roster a question's review routes have nowhere to stand for.
//
// A route every step of which is a `roleAt` for a unit kind somebody sits
// under none of finds them nowhere: their submission is refused (and their
// appeal, on the escalation route), and no appointment mends it - it is the
// configuration and the roster disagreeing (ADR 0007's terminal-stage rule).
// The refusal at the write stays; this is the same finding made before
// anybody files, for the screens an administrator reads.
//
// Derived on read, never stored and never patrolled: the answer depends only
// on the roster's frozen lineages and the questions' current routes, and
// both change only by somebody writing them, so reading it now is always
// reading it right (the same reasoning as roster drift, §32.86).

/** one question's routes as far as reaching them goes: the unit kinds each one asks for */
export interface RouteDemand {
  readonly itemId: string
  readonly itemTitle: string
  readonly route: ReviewRoute
  /** the unit kinds its steps look for, in the route's order */
  readonly levels: readonly string[]
}

/** the roster, as how many people sit under each set of unit kinds */
export interface LevelGroup {
  /** the distinct unit kinds on their frozen lineage */
  readonly levels: readonly string[]
  readonly participants: number
}

/**
 * The routes of one question's current version that somebody on the roster
 * could have nowhere to stand on.
 *
 * A submission walks the ordinary route, so that route counts only where
 * participants file; an appeal walks the escalation route, which counts
 * wherever a claim can arise at all - filed or recorded. A question nobody
 * reviews (`mode: 'none'`) walks neither. A route with a step that finds its
 * person wherever they sit (`nearestRole`) reaches everybody and makes no
 * demand.
 */
export const demandsOf = (question: {
  readonly itemId: string
  readonly itemTitle: string
  readonly reviewPolicy: unknown
  readonly entryChannels: unknown
}): readonly RouteDemand[] => {
  if (question.reviewPolicy == null || policyModeOf(question.reviewPolicy) === 'none') return []
  const policy = readPolicy(question.reviewPolicy)
  const channels = readEntryChannels(question.entryChannels)
  const demands: RouteDemand[] = []
  const normal = channels.includes('participant') ? routeLevels(policy.normal) : null
  if (normal !== null) {
    demands.push({ ...named(question), route: 'normal', levels: normal })
  }
  const escalation =
    channels.length > 0 && policy.escalation.length > 0 ? routeLevels(policy.escalation) : null
  if (escalation !== null) {
    demands.push({ ...named(question), route: 'escalation', levels: escalation })
  }
  return demands
}

const named = (question: { readonly itemId: string; readonly itemTitle: string }) => ({
  itemId: question.itemId,
  itemTitle: question.itemTitle,
})

/** whether somebody under these unit kinds has somewhere to stand on the route */
const reaches = (demand: RouteDemand, levels: readonly string[]): boolean =>
  demand.levels.some((level) => levels.includes(level))

/**
 * Each demand with the number of people it finds nowhere, where there are
 * any, and how many distinct people that is across them, route by route.
 */
export const unreachableOf = (
  demands: readonly RouteDemand[],
  groups: readonly LevelGroup[],
): {
  readonly routes: readonly (RouteDemand & { readonly participants: number })[]
  readonly cannotSubmit: number
  readonly cannotAppeal: number
} => {
  const routes: (RouteDemand & { participants: number })[] = []
  for (const demand of demands) {
    const participants = groups
      .filter((group) => !reaches(demand, group.levels))
      .reduce((sum, group) => sum + group.participants, 0)
    if (participants > 0) routes.push({ ...demand, participants })
  }
  // everybody sits in exactly one group, so a group counted once is its
  // people counted once however many questions miss them
  const distinct = (route: ReviewRoute) =>
    groups
      .filter((group) => routes.some((one) => one.route === route && !reaches(one, group.levels)))
      .reduce((sum, group) => sum + group.participants, 0)
  return { routes, cannotSubmit: distinct('normal'), cannotAppeal: distinct('escalation') }
}

/**
 * How many questions somebody standing under these unit kinds could not
 * file: the ones whose ordinary route finds them nowhere.
 */
export const unfileableFor = (demands: readonly RouteDemand[], levels: readonly string[]): number =>
  demands.filter((demand) => demand.route === 'normal' && !reaches(demand, levels)).length

/**
 * What admitting these people leaves the roster with: how many of them some
 * question's ordinary route finds nowhere, and how many are system
 * accounts - kinds of person the round is not for, standing at the root,
 * where a route by class or grade finds nobody. Both are said, and neither
 * stops the admission (§32.93).
 */
export interface AdmissionWarnings {
  readonly cannotSubmit: number
  readonly systemAccounts: number
}

export const admissionWarningsOf = (
  demands: readonly RouteDemand[],
  groups: readonly (LevelGroup & { readonly system: number })[],
): AdmissionWarnings => ({
  cannotSubmit: unreachableOf(demands, groups).cannotSubmit,
  systemAccounts: groups.reduce((sum, group) => sum + group.system, 0),
})

/** the unit kinds on one frozen lineage, once each and in a stable order */
const lineageLevels = sql<string[]>`coalesce((
  select array_agg(distinct step.value->>'nodeTypeId' order by step.value->>'nodeTypeId')
    from jsonb_array_elements(${sql.ref('bp.anchor_lineage')}) as step
), '{}')`

/** the batch's members, counted by the set of unit kinds each sits under */
export const levelGroupsOf = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom((inner) =>
          inner
            .selectFrom('BatchParticipant as bp')
            .select(lineageLevels.as('levels'))
            .where('bp.tenantId', '=', tenantId)
            .where('bp.batchId', '=', batchId)
            .where('bp.status', '=', 'active')
            .as('member'),
        )
        .select(['member.levels', (eb) => eb.fn.countAll<string>().as('participants')])
        .groupBy('member.levels')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): LevelGroup => ({
          levels: (row.levels ?? []).map(String),
          participants: Number(row.participants),
        })),
      ),
    )

const warningGroups = (
  rows: readonly { levels: unknown; participants: unknown; system: unknown }[],
): (LevelGroup & { system: number })[] =>
  rows.map((row) => ({
    levels: ((row.levels ?? []) as unknown[]).map(String),
    participants: Number(row.participants),
    system: Number(row.system),
  }))

/**
 * Members just written to the roster, grouped as `levelGroupsOf` groups the
 * whole of it - by the unit kinds they were frozen under - with how many
 * in each group are of a system kind, as they were frozen too.
 */
export const admittedGroupsOf = (tenantId: string, participantIds: readonly string[]) =>
  participantIds.length === 0
    ? Effect.succeed([] as (LevelGroup & { system: number })[])
    : db
        .query((k) =>
          k
            .selectFrom((inner) =>
              inner
                .selectFrom('BatchParticipant as bp')
                .innerJoin('UserType as ut', (join) =>
                  join
                    .onRef('ut.tenantId', '=', 'bp.tenantId')
                    .onRef('ut.id', '=', 'bp.userTypeId'),
                )
                .select([lineageLevels.as('levels'), 'ut.isSystem as system'])
                .where('bp.tenantId', '=', tenantId)
                .where(sql<boolean>`${sql.ref('bp.id')} = any(${[...participantIds]}::uuid[])`)
                .as('member'),
            )
            .select([
              'member.levels',
              (eb) => eb.fn.countAll<string>().as('participants'),
              (eb) => eb.fn.countAll<string>().filterWhere('member.system', '=', true).as('system'),
            ])
            .groupBy('member.levels')
            .execute(),
        )
        .pipe(Effect.map(warningGroups))

/** the unit kinds above somebody's live placement, the unit included, once each */
const liveLevels = sql<string[]>`coalesce((
  select array_agg(distinct a.org_type_id::text order by a.org_type_id::text)
    from org_nodes a
   where a.tenant_id = ${sql.ref('n.tenant_id')} and a.path @> ${sql.ref('n.path')}
), '{}')`

/**
 * The same grouping for people not yet on the roster, by where the
 * organization has them now: what admitting them would leave it with.
 */
export const candidateGroupsOf = (tenantId: string, userIds: readonly string[]) =>
  userIds.length === 0
    ? Effect.succeed([] as (LevelGroup & { system: number })[])
    : db
        .query((k) =>
          k
            .selectFrom((inner) =>
              inner
                .selectFrom('User as u')
                .innerJoin('OrgNode as n', (join) =>
                  join
                    .onRef('n.tenantId', '=', 'u.tenantId')
                    .onRef('n.id', '=', 'u.primaryOrgNodeId'),
                )
                .innerJoin('UserType as ut', (join) =>
                  join.onRef('ut.tenantId', '=', 'u.tenantId').onRef('ut.id', '=', 'u.userTypeId'),
                )
                .select([liveLevels.as('levels'), 'ut.isSystem as system'])
                .where('u.tenantId', '=', tenantId)
                .where(sql<boolean>`${sql.ref('u.id')} = any(${[...userIds]}::uuid[])`)
                .as('member'),
            )
            .select([
              'member.levels',
              (eb) => eb.fn.countAll<string>().as('participants'),
              (eb) => eb.fn.countAll<string>().filterWhere('member.system', '=', true).as('system'),
            ])
            .groupBy('member.levels')
            .execute(),
        )
        .pipe(Effect.map(warningGroups))

/** every question the round is asking, in its own order, with its current routes */
export const routeDemandsOf = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentItem as i')
        .innerJoin('AssessmentItemRevision as r', (join) =>
          join.onRef('r.tenantId', '=', 'i.tenantId').onRef('r.id', '=', 'i.currentRevisionId'),
        )
        .select(['i.id', 'i.title', 'r.reviewPolicy', 'r.entryChannels'])
        .where('i.tenantId', '=', tenantId)
        .where('i.batchId', '=', batchId)
        .where('i.status', '=', 'active')
        .orderBy('i.sortOrder')
        .orderBy('i.id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.flatMap((row) =>
          demandsOf({
            itemId: row.id,
            itemTitle: row.title,
            reviewPolicy: row.reviewPolicy,
            entryChannels: row.entryChannels,
          }),
        ),
      ),
    )

/**
 * One question's demands, whatever state it is in - a question still being
 * composed is exactly where an administrator wants to know - or null when
 * the round has no such question. No current version is no demand.
 */
export const itemDemandsOf = (tenantId: string, batchId: string, itemId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentItem as i')
        .leftJoin('AssessmentItemRevision as r', (join) =>
          join.onRef('r.tenantId', '=', 'i.tenantId').onRef('r.id', '=', 'i.currentRevisionId'),
        )
        .select(['i.id', 'i.title', 'r.reviewPolicy', 'r.entryChannels'])
        .where('i.tenantId', '=', tenantId)
        .where('i.batchId', '=', batchId)
        .where('i.id', '=', itemId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : demandsOf({
              itemId: row.id,
              itemTitle: row.title,
              reviewPolicy: row.reviewPolicy,
              entryChannels: row.entryChannels,
            }),
      ),
    )

/** somebody on the roster whose lineage has none of these unit kinds */
const sitsUnderNone = (levels: readonly string[]) =>
  sql<boolean>`not exists (
    select 1 from jsonb_array_elements(${sql.ref('bp.anchor_lineage')}) as step
     where step.value->>'nodeTypeId' = any(${levels}::text[])
  )`

const unreachableMembers = (
  k: Parameters<Parameters<typeof db.query>[0]>[0],
  tenantId: string,
  batchId: string,
  levels: readonly string[],
) =>
  k
    .selectFrom('BatchParticipant as bp')
    .innerJoin('User as u', (join) =>
      join.onRef('u.id', '=', 'bp.userId').onRef('u.tenantId', '=', 'bp.tenantId'),
    )
    .where('bp.tenantId', '=', tenantId)
    .where('bp.batchId', '=', batchId)
    .where('bp.status', '=', 'active')
    .where(sitsUnderNone(levels))

/** how many members a route asking for these unit kinds finds nowhere */
export const unreachableTotal = (tenantId: string, batchId: string, levels: readonly string[]) =>
  db
    .query((k) =>
      unreachableMembers(k, tenantId, batchId, levels)
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => Number(row?.total ?? 0)))

/**
 * One page of them, by number and then by row: a total order, so a page
 * boundary never drops or repeats anybody.
 */
export const unreachablePage = (
  tenantId: string,
  batchId: string,
  levels: readonly string[],
  window: { offset: number; limit: number },
) =>
  db
    .query((k) =>
      unreachableMembers(k, tenantId, batchId, levels)
        .select(['bp.id', 'bp.userId', 'u.displayName', 'u.businessNo'])
        .select(
          // stored from the unit up, so read backwards: the root first
          sql<(string | null)[]>`coalesce((
            select array_agg(n.name order by step.at desc)
            from jsonb_array_elements(${sql.ref('bp.anchor_lineage')})
              with ordinality as step(element, at)
            left join org_nodes n
              on n.tenant_id = ${sql.ref('bp.tenant_id')}
              and n.id = (step.element->>'nodeId')::uuid
          ), '{}')`.as('unitPath'),
        )
        .orderBy('u.businessNo')
        .orderBy('bp.id')
        .offset(window.offset)
        .limit(window.limit)
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          participantId: row.id,
          userId: row.userId,
          displayName: row.displayName,
          businessNo: row.businessNo ?? null,
          unitPath: row.unitPath,
        })),
      ),
    )

import { Effect } from 'effect'
import {
  expressionBuilder,
  sql,
  type Expression,
  type ExpressionBuilder,
  type RawBuilder,
} from 'kysely'
import { jsonArrayFrom } from 'kysely/helpers/postgres'
import { db, type Schema } from '../server/db.ts'
import { readResolved, type ResolvedPolicy } from './chain.ts'

// The review rows and the one definition of who may judge them.
//
// Same conventions as the neighbouring modules: epoch milliseconds out,
// jsonb parsed, no floats.

const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

const msOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value ?? 0)

const uuidArray = (ids: readonly string[]) =>
  sql<readonly string[]>`${sql.val(`{${ids.join(',')}}`)}::uuid[]`

/** what the predicate is asked about; values or column references alike */
export interface ReviewerRefs {
  readonly tenantId: Expression<string>
  readonly batchId: Expression<string>
  readonly nodeId: Expression<string | null>
  /** a uuid[] expression: the stage's roles */
  readonly roleIds: Expression<readonly string[]>
  readonly userId: Expression<string>
  readonly subjectUserId: Expression<string>
  readonly actorId: Expression<string | null>
}

/**
 * The one definition of "may review this stage" (§11.3). Submit's arrival
 * check, the inbox and the decision endpoints all ask this same fragment,
 * so "the submit found a reviewer the inbox never shows" cannot be written.
 *
 * One assignment carries the whole answer. Standing: one of the stage's
 * roles anchored at exactly the stage's node - exact on purpose (§14,
 * §32.23): a grant anchored higher up does not reach down into the stage,
 * however wide its coverage, or a role mis-granted at the college would
 * quietly review every class below it. Coverage itself says nothing about
 * membership either way, so the ordinary subtree grant an administrator
 * writes at that unit is a member like any other - live, role active,
 * holder enabled, resource general or this batch. And
 * the batch accepted assessment.review.process from THAT assignment, not
 * merely from some assignment of theirs: acceptance names sources one by
 * one, so a new stage grant may not walk in on an older assignment's
 * acceptance - it becomes reviewable when it is itself accepted. Minus what
 * the batch took back, minus distance: neither the subject nor whoever
 * authored the revision under judgment.
 *
 * The phase gate is deliberately not in here: it answers "is this act open
 * this minute" and binds the acts (inbox, decisions), while this fragment
 * also answers submit's "does anyone exist to receive this" - asked during
 * an entry phase, when the review phase has usually not begun.
 */
const mayReview = (r: ReviewerRefs) => {
  const eb = expressionBuilder<Schema>()
  return eb.and([
    eb.exists(
      eb
        .selectFrom('RoleGrant as rg')
        .innerJoin('Role as ro', (join) =>
          join.onRef('ro.tenantId', '=', 'rg.tenantId').onRef('ro.id', '=', 'rg.roleId'),
        )
        .innerJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'rg.tenantId').onRef('u.id', '=', 'rg.userId'),
        )
        .innerJoin('BatchAccessSource as bas', (join) =>
          join
            .onRef('bas.tenantId', '=', 'rg.tenantId')
            .onRef('bas.roleAssignmentId', '=', 'rg.id')
            .on('bas.batchId', '=', r.batchId)
            .onRef('bas.subjectId', '=', 'rg.userId'),
        )
        .innerJoin('BatchAccessSourcePermission as sp', (join) =>
          join
            .onRef('sp.tenantId', '=', 'bas.tenantId')
            .onRef('sp.sourceId', '=', 'bas.id')
            .on('sp.permissionCode', '=', 'assessment.review.process'),
        )
        .select('rg.id')
        .where('rg.tenantId', '=', r.tenantId)
        .where('rg.userId', '=', r.userId)
        .where('rg.orgNodeId', '=', r.nodeId)
        .where((q) => q('rg.roleId', '=', q.fn.any(r.roleIds)))
        .where('rg.revokedAt', 'is', null)
        .where((q) =>
          q.or([q('rg.validFrom', 'is', null), q('rg.validFrom', '<=', sql<Date>`now()`)]),
        )
        .where((q) =>
          q.or([q('rg.validUntil', 'is', null), q('rg.validUntil', '>', sql<Date>`now()`)]),
        )
        .where('ro.status', '=', 'active')
        .where('u.enabled', '=', true)
        .where((q) =>
          q.or([
            q('ro.permissionMode', '=', 'all-active'),
            q.exists(
              q
                .selectFrom('RolePermission as rp')
                .innerJoin('Permission as pe', 'pe.id', 'rp.permissionId')
                .select('rp.roleId')
                .whereRef('rp.tenantId', '=', 'ro.tenantId')
                .whereRef('rp.roleId', '=', 'ro.id')
                .whereRef('pe.code', '=', 'sp.permissionCode'),
            ),
          ]),
        )
        .where((q) =>
          q.not(
            q.exists(
              q
                .selectFrom('BatchAccessDeny as dn')
                .select('dn.id')
                .whereRef('dn.tenantId', '=', 'bas.tenantId')
                .whereRef('dn.batchId', '=', 'bas.batchId')
                .whereRef('dn.subjectId', '=', 'bas.subjectId')
                .whereRef('dn.permissionCode', '=', 'sp.permissionCode'),
            ),
          ),
        )
        .where((q) =>
          q.or([
            q('rg.resourceNamespace', 'is', null),
            q.and([
              q('rg.resourceNamespace', '=', 'assessment'),
              q('rg.resourceType', '=', 'batch'),
              q('rg.resourceId', '=', r.batchId),
            ]),
          ]),
        ),
    ),
    eb(r.userId, '<>', r.subjectUserId),
    eb(r.actorId, 'is distinct from', r.userId),
  ])
}

/** what acting on one specific round adds to stage membership */
export interface RoundActorRefs extends ReviewerRefs {
  /** the instance's id, as a value or column reference */
  readonly instanceId: Expression<string>
  /** the route the round currently walks */
  readonly route: Expression<string>
}

/** the event kinds that count as a formal judgment by their actor */
const JUDGED_KINDS = ['approved', 'rejected', 'escalated', 'opinion-approved', 'opinion-rejected']

/**
 * Same-round independence (§32.66): once a round is in the escalation
 * process, no later step of it may be worked by somebody who already made
 * a formal judgment at an earlier step of THIS round - the班委 who
 * approved, the reviewer who escalated, the panel member who voted. The
 * ordinary route resolves people live and keeps no such memory, and an
 * appeal is a new round that starts clean: the prior round's deciders are
 * eligible again, on purpose.
 *
 * Two sources of "already judged", because panels record votes rather
 * than events: the round's formal events, and votes in any of its panels
 * that still count (a superseded panel's votes were about evidence that
 * has since changed, and voting again after a supplement is the point).
 */
const independentAt = (r: RoundActorRefs) => {
  const eb = expressionBuilder<Schema>()
  return eb.or([
    eb(r.route, '<>', 'escalation'),
    eb.not(
      eb.or([
        eb.exists(
          eb
            .selectFrom('ReviewEvent as xe')
            .select('xe.id')
            .where('xe.tenantId', '=', r.tenantId)
            .where('xe.reviewInstanceId', '=', r.instanceId)
            .where('xe.actorId', '=', r.userId)
            .where('xe.kind', 'in', JUDGED_KINDS),
        ),
        eb.exists(
          eb
            .selectFrom('ReviewVote as xv')
            .innerJoin('ReviewPanel as xp', (join) =>
              join.onRef('xp.tenantId', '=', 'xv.tenantId').onRef('xp.id', '=', 'xv.panelId'),
            )
            .select('xv.id')
            .where('xv.tenantId', '=', r.tenantId)
            .where('xp.reviewInstanceId', '=', r.instanceId)
            .where('xv.voterUserId', '=', r.userId)
            .where('xp.state', '<>', 'superseded'),
        ),
      ]),
    ),
  ])
}

/**
 * A sitting panel admits its own UNVOTED members and lets a newcomer fill
 * an empty seat; it never widens. The unvoted check lives here and cannot
 * be delegated: `independentAt` only turns voters away on the escalation
 * route (a normal route deliberately lets the same people sit again in a
 * later round), and a voted seat never ends - so without it a member who
 * had already cast their ballot kept mayActOn, kept the round in their
 * queue, and could still escalate the whole sitting away. A ballot spends
 * the seat: every further act belongs to the members still to vote, or to
 * whoever legitimately fills an empty chair. No open panel means the stage
 * is not a sitting at all (or the sitting has not been constituted yet),
 * and membership alone decides.
 */
const seatedOrSeatable = (r: {
  readonly tenantId: Expression<string>
  readonly instanceId: Expression<string>
  readonly userId: Expression<string>
}) => {
  const eb = expressionBuilder<Schema>()
  const openPanels = () =>
    eb
      .selectFrom('ReviewPanel as op')
      .where('op.tenantId', '=', r.tenantId)
      .where('op.reviewInstanceId', '=', r.instanceId)
      .where('op.state', '=', 'open')
  return eb.or([
    eb.not(eb.exists(openPanels().select('op.id'))),
    // an unvoted seat of one's own
    eb.exists(
      openPanels()
        .innerJoin('ReviewPanelAssignment as pa', (join) =>
          join.onRef('pa.tenantId', '=', 'op.tenantId').onRef('pa.panelId', '=', 'op.id'),
        )
        .select('pa.id')
        .where('pa.userId', '=', r.userId)
        .where('pa.endedAt', 'is', null)
        .where((q) =>
          q.not(
            q.exists(
              q
                .selectFrom('ReviewVote as sv')
                .select('sv.id')
                .whereRef('sv.tenantId', '=', 'pa.tenantId')
                .whereRef('sv.assignmentId', '=', 'pa.id'),
            ),
          ),
        ),
    ),
    // an empty chair, for somebody not already seated
    eb.exists(
      openPanels()
        .select('op.id')
        .where((q) =>
          q(
            q
              .selectFrom('ReviewPanelAssignment as pa2')
              .select((count) => count.fn.countAll<number>().as('n'))
              .whereRef('pa2.tenantId', '=', 'op.tenantId')
              .whereRef('pa2.panelId', '=', 'op.id')
              .where('pa2.endedAt', 'is', null),
            '<',
            q.ref('op.seatCount'),
          ),
        )
        .where((q) =>
          q.not(
            q.exists(
              q
                .selectFrom('ReviewPanelAssignment as pa3')
                .select('pa3.id')
                .whereRef('pa3.tenantId', '=', 'op.tenantId')
                .whereRef('pa3.panelId', '=', 'op.id')
                .where('pa3.userId', '=', r.userId)
                .where('pa3.endedAt', 'is', null),
            ),
          ),
        ),
    ),
  ])
}

/**
 * The rounds standing at a node the reader holds any live grant at.
 *
 * Implied by `mayReview` - a judge's grant sits at the round's own node, for
 * the same person, unrevoked - so adding it to a list changes no answer. What
 * it changes is where the list starts: from the reader's own nodes, through
 * the review index on (tenant, state, current node), instead of evaluating
 * the whole predicate over every open round of the batch before sorting and
 * paging. A reader with no grants anywhere reads nothing at all.
 */
export const atHeldNode = (
  tenantId: string,
  userId: string,
  /** the round's current node, wherever the query aliased it */
  currentNodeId: Expression<string | null>,
) => {
  const eb = expressionBuilder<Schema>()
  return eb(
    currentNodeId,
    '=',
    eb.fn.any(
      eb.fn<string[]>('array', [
        eb
          .selectFrom('RoleGrant as rg')
          .select('rg.orgNodeId')
          .where('rg.tenantId', '=', tenantId)
          .where('rg.userId', '=', userId)
          .where('rg.revokedAt', 'is', null)
          .where('rg.orgNodeId', 'is not', null),
      ]),
    ),
  )
}

/**
 * The whole of "may act on this round now": stage membership, same-round
 * independence, and a seat where the stage is a sitting. Every reader and
 * writer of a round's queue asks this one composition, so "the queue
 * shows what the decision refuses" cannot be written.
 */
export const mayActOn = (r: RoundActorRefs) =>
  expressionBuilder<Schema>().and([mayReview(r), independentAt(r), seatedOrSeatable(r)])

/** the stage's judges as submit must find them: enumerate, then hold each to the definition */
export const reviewersAt = (input: {
  tenantId: string
  batchId: string
  nodeId: string
  roleIds: readonly string[]
  subjectUserId: string
  actorId: string
  /**
   * Apply same-round independence against this round: whoever already made
   * a formal judgment at an earlier step of it is not counted. Passed only
   * when the stage being asked about is an escalation step of that round.
   */
  excludeJudgedOfInstanceId?: string
}) =>
  input.roleIds.length === 0
    ? Effect.succeed([] as readonly string[])
    : db
        .query((k) =>
          k
            .selectFrom('RoleGrant as rg0')
            .select('rg0.userId')
            .distinct()
            .where('rg0.tenantId', '=', input.tenantId)
            .where('rg0.orgNodeId', '=', input.nodeId)
            .where((eb) => eb('rg0.roleId', '=', eb.fn.any(uuidArray(input.roleIds))))
            .where('rg0.revokedAt', 'is', null)
            .where((eb) => {
              const refs = {
                tenantId: eb.val(input.tenantId),
                batchId: eb.val(input.batchId),
                nodeId: eb.val(input.nodeId),
                roleIds: uuidArray(input.roleIds),
                userId: eb.ref('rg0.userId'),
                subjectUserId: eb.val(input.subjectUserId),
                actorId: eb.val(input.actorId),
              }
              return input.excludeJudgedOfInstanceId === undefined
                ? mayReview(refs)
                : eb.and([
                    mayReview(refs),
                    independentAt({
                      ...refs,
                      instanceId: eb.val(input.excludeJudgedOfInstanceId),
                      route: eb.val('escalation'),
                    }),
                  ])
            })
            .execute(),
        )
        .pipe(Effect.map((rows) => rows.map((row) => String(row.userId))))

/**
 * The states in which a round still belongs to its stage's reviewers.
 *
 * This list is the reviewer's read-and-act boundary in one place: a
 * reviewer's reach is their unfinished duty, not their history, so the
 * moment a decision hands the round on or ends it, the stage they matched
 * stops answering for them. An open ask (`awaiting_supplement`) keeps the
 * round theirs, because their task has not ended; a stalled stage
 * (`blocked`) likewise still awaits somebody at it.
 */
export const OPEN_REVIEW_STATES = ['active', 'blocked', 'awaiting_supplement'] as const

/**
 * How many rounds of a batch are not over yet. Archiving asks this: once a
 * batch is read-only nobody can decide, answer or unblock a round, so one
 * left open would stay in review for good.
 */
export const openRoundCountOfBatch = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .select((eb) => eb.fn.countAll<string>().as('open'))
        .where('ri.tenantId', '=', tenantId)
        .where('e.batchId', '=', batchId)
        .where('ri.state', 'in', OPEN_REVIEW_STATES)
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => Number(row.open)))

/** whether the state still has reviewers at all, for the read predicates */
export const isOpenReviewState = (state: string): boolean =>
  (OPEN_REVIEW_STATES as readonly string[]).includes(state)

/** what the open-ask rule is asked about; values or column references alike */
export interface OpenAskRefs {
  readonly tenantId: Expression<string>
  readonly instanceId: Expression<string>
  /** the round's state, so the fragment can stay out of the way when no ask is out */
  readonly state: Expression<string>
  readonly userId: Expression<string>
}

/**
 * The one definition of the open-ask narrowing (§32.70). A stage is a
 * shared pool, but the ask one reviewer sent is their own unfinished
 * business: while the round waits for material only the asker still holds
 * it, and every eligible reviewer gets it back the moment the answer
 * returns the round to the pool.
 *
 * It sits beside mayActOn rather than inside it because acting and reading
 * part company here, and because the acts already answer for themselves
 * (decideReview refuses while an ask is open, cancelSupplement checks the
 * requester first). Every door that reads a round AS ITS REVIEWER asks this
 * fragment: the narrowing first landed on the round's own reader alone, and
 * the file and history doors went on serving the colleague it had refused.
 */
export const heldThroughOpenAsk = (r: OpenAskRefs) => {
  const eb = expressionBuilder<Schema>()
  return eb.or([
    eb(r.state, '<>', 'awaiting_supplement'),
    eb.exists(
      eb
        .selectFrom('ReviewSupplementRequest as ask')
        .select('ask.id')
        .where('ask.tenantId', '=', r.tenantId)
        .where('ask.reviewInstanceId', '=', r.instanceId)
        .where('ask.status', '=', 'open')
        .where('ask.requestedBy', '=', r.userId),
    ),
  ])
}

/** one round as the callers hold it in memory, for the per-row predicates */
export interface RoundRef {
  id: string
  batchId: string
  currentRoute: 'normal' | 'escalation'
  currentNodeId: string | null
  currentRoleIds: readonly string[]
  subjectUserId: string
  actorId: string
}

const refsOf = (tenantId: string, userId: string, instance: RoundRef): RoundActorRefs => {
  const eb = expressionBuilder<Schema>()
  return {
    tenantId: eb.val(tenantId),
    batchId: eb.val(instance.batchId),
    nodeId: eb.val(instance.currentNodeId),
    roleIds: uuidArray(instance.currentRoleIds),
    userId: eb.val(userId),
    subjectUserId: eb.val(instance.subjectUserId),
    actorId: eb.val(instance.actorId),
    instanceId: eb.val(instance.id),
    route: eb.val<string>(instance.currentRoute),
  }
}

/** the tables a queue row joins under the aliases every queue uses */
type QueueRow = ExpressionBuilder<
  Schema & {
    ri: Schema['ReviewInstance']
    e: Schema['Entry']
    bp: Schema['BatchParticipant']
    er: Schema['EntryRevision']
  },
  'ri' | 'e' | 'bp' | 'er'
>

/** the round a queue row names, as mayActOn asks about it */
const roundActor = (eb: QueueRow, tenantId: string, userId: string): RoundActorRefs => ({
  tenantId: eb.val(tenantId),
  batchId: eb.ref('e.batchId'),
  nodeId: eb.ref('ri.currentNodeId'),
  roleIds: eb.ref('ri.currentRoleIds'),
  userId: eb.val(userId),
  subjectUserId: eb.ref('bp.userId'),
  actorId: eb.ref('er.actorId'),
  instanceId: eb.ref('ri.id'),
  route: eb.ref('ri.currentRoute'),
})

/** one person against one instance's stage, for the decision endpoints */
export const userMayReview = (input: { tenantId: string; userId: string; instance: RoundRef }) =>
  input.instance.currentRoleIds.length === 0
    ? Effect.succeed(false)
    : db
        .query((k) =>
          k
            .selectNoFrom(mayActOn(refsOf(input.tenantId, input.userId, input.instance)).as('ok'))
            .executeTakeFirstOrThrow(),
        )
        .pipe(Effect.map((row) => Boolean(row.ok)))

/**
 * The same person against a round they mean only to READ. Matching the
 * stage is not enough while an ask is out (§32.70): the colleague still
 * belongs to the pool, but the round is not theirs to read until the
 * answer brings it back.
 */
export const userMayReadReview = (input: {
  tenantId: string
  userId: string
  instance: RoundRef & { state: string }
}) =>
  input.instance.currentRoleIds.length === 0
    ? Effect.succeed(false)
    : db
        .query((k) =>
          k
            .selectNoFrom((eb) =>
              eb
                .and([
                  mayActOn(refsOf(input.tenantId, input.userId, input.instance)),
                  heldThroughOpenAsk({
                    tenantId: eb.val(input.tenantId),
                    instanceId: eb.val(input.instance.id),
                    state: eb.val(input.instance.state),
                    userId: eb.val(input.userId),
                  }),
                ])
                .as('ok'),
            )
            .executeTakeFirstOrThrow(),
        )
        .pipe(Effect.map((row) => Boolean(row.ok)))

export interface ReviewInstanceDetailRow {
  id: string
  state: 'active' | 'blocked' | 'awaiting_supplement' | 'completed'
  outcome: string | null
  currentRoute: 'normal' | 'escalation'
  currentStageId: string
  effectivePolicy: ResolvedPolicy
  roundNo: number
  entryId: string
  revisionId: string
  /** the recognition contract this round determines under, frozen when it opened */
  recognitionRevisionId: string
  /** why this round exists, which decides what it inherits */
  origin: 'initial' | 'appeal' | 'reopen' | 'reroute'
  /** the decision being contested, when this round is an appeal */
  appealedInstanceId: string | null
  /** or the determination it contests, when no round produced that one */
  appealedRecognitionId: string | null
  /** or the revocation it contests, which wrote no determination */
  appealedEventId: string | null
  /** the round this one replaced, when a policy change opened it */
  supersedesInstanceId: string | null
  currentNodeId: string | null
  currentRoleIds: readonly string[]
  createdAt: number
  completedAt: number | null
  batchId: string
  batchStatus: string
  itemId: string
  itemTitle: string
  itemType: string
  participantId: string
  subjectUserId: string
  subjectName: string
  subjectBusinessNo: string | null
  /** the unit the participant stands in, by the live tree; null if it went */
  unitName: string | null
  /** their frozen lineage from the root down, named by the live tree; null where a unit went */
  unitPath: readonly (string | null)[]
  actorId: string
  itemRevisionId: string
  maxEntries: number | null
  scoreGroupId: string
  batchMaterialRange: string
  /** {reject?: string[], escalate?: string[]} as configured on the batch */
  batchReviewReasons: unknown
}

/**
 * Whether real review work has begun on these rounds, and where each came
 * from.
 *
 * "Begun" is a formal act by a reviewer - a decision, an escalation, an
 * opinion climbing a ladder, an ask for more material, or any ballot cast
 * in a sitting - and it survives re-routing: a continuation round carries
 * its predecessors' work along the `supersedes_instance_id` lineage, or a
 * policy edit would quietly re-open a door the work had closed. Arrival
 * noise (submitted, assignee-not-found, stage-skipped) is not work.
 */
const WORK_KINDS = [
  'approved',
  'rejected',
  'escalated',
  'opinion-approved',
  'opinion-rejected',
  'supplement-requested',
]

export const withdrawStandingsOf = (tenantId: string, instanceIds: readonly string[]) =>
  instanceIds.length === 0
    ? Effect.succeed(new Map<string, { origin: string; begun: boolean; open: boolean }>())
    : db
        .query((k) =>
          k
            // each round with every round it continues, back along supersedes
            .withRecursive('lineage(rootId, id)', (q) =>
              q
                .selectFrom('ReviewInstance as ri')
                .select(['ri.id as rootId', 'ri.id as id'])
                .where('ri.tenantId', '=', tenantId)
                .where((eb) => eb('ri.id', '=', eb.fn.any(uuidArray(instanceIds))))
                .unionAll(
                  q
                    .selectFrom('lineage as l')
                    .innerJoin('ReviewInstance as cur', (join) =>
                      join.on('cur.tenantId', '=', tenantId).onRef('cur.id', '=', 'l.id'),
                    )
                    .innerJoin('ReviewInstance as prior', (join) =>
                      join
                        .on('prior.tenantId', '=', tenantId)
                        .onRef('prior.id', '=', 'cur.supersedesInstanceId'),
                    )
                    .select(['l.rootId', 'prior.id as id']),
                ),
            )
            .selectFrom('ReviewInstance as ri')
            .select((eb) => [
              'ri.id as id',
              'ri.origin as origin',
              eb
                .or([
                  eb.exists(
                    eb
                      .selectFrom('ReviewEvent as ev')
                      .innerJoin('lineage as l', (join) =>
                        join
                          .onRef('l.rootId', '=', 'ri.id')
                          .onRef('l.id', '=', 'ev.reviewInstanceId'),
                      )
                      .select('ev.id')
                      .where('ev.tenantId', '=', tenantId)
                      .where('ev.kind', 'in', WORK_KINDS),
                  ),
                  eb.exists(
                    eb
                      .selectFrom('ReviewVote as v')
                      .innerJoin('ReviewPanel as pn', (join) =>
                        join
                          .onRef('pn.tenantId', '=', 'v.tenantId')
                          .onRef('pn.id', '=', 'v.panelId'),
                      )
                      .innerJoin('lineage as l2', (join) =>
                        join
                          .onRef('l2.rootId', '=', 'ri.id')
                          .onRef('l2.id', '=', 'pn.reviewInstanceId'),
                      )
                      .select('v.id')
                      .where('v.tenantId', '=', tenantId),
                  ),
                ])
                .$castTo<boolean>()
                .as('begun'),
              eb('ri.state', '<>', 'completed').$castTo<boolean>().as('open'),
            ])
            .where('ri.tenantId', '=', tenantId)
            .where((eb) => eb('ri.id', '=', eb.fn.any(uuidArray(instanceIds))))
            .execute(),
        )
        .pipe(
          Effect.map(
            (rows) =>
              new Map(
                rows.map((row) => [
                  row.id,
                  { origin: row.origin, begun: row.begun, open: row.open },
                ]),
              ),
          ),
        )

/** an instance with everything around it that reading or judging it needs */
export const instanceOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .innerJoin('AssessmentBatch as b', (join) =>
          join.onRef('b.tenantId', '=', 'e.tenantId').onRef('b.id', '=', 'e.batchId'),
        )
        .innerJoin('AssessmentItem as i', (join) =>
          join.onRef('i.tenantId', '=', 'e.tenantId').onRef('i.id', '=', 'e.itemId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .innerJoin('User as su', (join) =>
          join.onRef('su.tenantId', '=', 'bp.tenantId').onRef('su.id', '=', 'bp.userId'),
        )
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
        )
        .leftJoin('OrgNode as un', (join) =>
          join
            .onRef('un.tenantId', '=', 'bp.tenantId')
            .onRef('un.id', '=', 'bp.assessmentAnchorNodeId'),
        )
        .select([
          'ri.id',
          'ri.state',
          'ri.outcome',
          'ri.currentRoute',
          'ri.currentStageId',
          'ri.effectiveChain',
          'ri.roundNo',
          'ri.entryId',
          'ri.revisionId',
          'ri.recognitionRevisionId',
          // why this round exists, and what it stands on: a determination is
          // inherited from the round being revisited, never from whatever
          // the claim last happened to be recognised as
          'ri.origin',
          'ri.appealedInstanceId',
          'ri.appealedRecognitionId',
          'ri.appealedEventId',
          'ri.supersedesInstanceId',
          'ri.currentNodeId',
          'ri.currentRoleIds',
          'e.batchId',
          'b.status as batchStatus',
          'b.reviewReasons as batchReviewReasons',
          'e.itemId',
          'i.title as itemTitle',
          'i.itemType',
          'i.maxEntries',
          'i.scoreGroupId',
          'e.participantId',
          'bp.userId as subjectUserId',
          'su.displayName as subjectName',
          'su.businessNo as subjectBusinessNo',
          'un.name as unitName',
          'er.actorId',
          'er.itemRevisionId',
        ])
        .select((eb) => [
          eb.cast<string>('b.materialRange', 'text').as('batchMaterialRange'),
          // the lineage is stored from the unit up, so it is read backwards;
          // walking jsonb with its ordinality is PostgreSQL's own
          sql<(string | null)[]>`coalesce((
            select array_agg(n.name order by step.at desc)
            from jsonb_array_elements(${eb.ref('bp.anchorLineage')})
              with ordinality as step(element, at)
            left join org_nodes n
              on n.tenant_id = ${eb.ref('bp.tenantId')}
              and n.id = (step.element->>'nodeId')::uuid
          ), '{}')`.as('unitPath'),
          epoch('ri.created_at').as('createdMs'),
          epoch('ri.completed_at').as('completedMs'),
        ])
        .where('ri.tenantId', '=', tenantId)
        .where('ri.id', '=', instanceId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              id: row.id,
              state: row.state as ReviewInstanceDetailRow['state'],
              outcome: row.outcome,
              currentRoute: row.currentRoute as ReviewInstanceDetailRow['currentRoute'],
              currentStageId: row.currentStageId,
              // rounds opened before the split stored one list with a marker
              effectivePolicy: readResolved(row.effectiveChain),
              roundNo: row.roundNo,
              entryId: row.entryId,
              revisionId: row.revisionId,
              recognitionRevisionId: row.recognitionRevisionId,
              origin: row.origin as ReviewInstanceDetailRow['origin'],
              appealedInstanceId: row.appealedInstanceId,
              appealedRecognitionId: row.appealedRecognitionId,
              appealedEventId: row.appealedEventId,
              supersedesInstanceId: row.supersedesInstanceId,
              currentNodeId: row.currentNodeId,
              currentRoleIds: row.currentRoleIds,
              createdAt: msOf(row.createdMs),
              completedAt: row.completedMs == null ? null : msOf(row.completedMs),
              batchId: row.batchId,
              batchStatus: row.batchStatus,
              itemId: row.itemId,
              itemTitle: row.itemTitle,
              itemType: row.itemType,
              participantId: row.participantId,
              subjectUserId: row.subjectUserId,
              subjectName: row.subjectName,
              subjectBusinessNo: row.subjectBusinessNo,
              unitName: row.unitName,
              unitPath: row.unitPath,
              actorId: row.actorId,
              itemRevisionId: row.itemRevisionId,
              maxEntries: row.maxEntries,
              scoreGroupId: row.scoreGroupId,
              batchMaterialRange: String(row.batchMaterialRange),
              batchReviewReasons: row.batchReviewReasons ?? {},
            } satisfies ReviewInstanceDetailRow),
      ),
    )

export interface InboxRow {
  instanceId: string
  entryId: string
  batchId: string
  batchName: string
  itemId: string
  itemTitle: string
  participantId: string
  participantName: string
  businessNo: string | null
  unitId: string | null
  unitName: string | null
  roundNo: number
  route: 'normal' | 'escalation'
  /** the judged revision's answers, for the service to project into columns */
  payload: unknown
  /** the form those answers were filed under, for the labels */
  formConfig: unknown
  displayConfig: unknown
  attachmentCount: number
  submittedAt: number
  submittedAtIso: string
}

/** the batches that currently hold work in this tenant, for the gate to sort */
export const activeReviewBatches = (tenantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .select(['e.batchId'])
        .distinct()
        .where('ri.tenantId', '=', tenantId)
        .where('ri.state', '=', 'active')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.batchId)))

/**
 * How much is waiting for this reader in each of these rounds.
 *
 * The same composition the queue itself is drawn with - stage membership,
 * independence, a seat - counted rather than listed and grouped by round,
 * so a screen showing several rounds at once asks once instead of once per
 * round. A round with nothing waiting has no row: a caller reads a missing
 * round as nought, and tells that apart from "not a judge here" by asking
 * the round's own authority, which is a different question from this one.
 */
export const reviewsWaitingByBatchOf = (input: {
  tenantId: string
  userId: string
  batchIds: readonly string[]
}) =>
  input.batchIds.length === 0
    ? Effect.succeed([] as { batchId: string; waiting: number }[])
    : db
        .query((k) =>
          k
            .selectFrom('ReviewInstance as ri')
            .innerJoin('Entry as e', (join) =>
              join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
            )
            .innerJoin('BatchParticipant as bp', (join) =>
              join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
            )
            .innerJoin('EntryRevision as er', (join) =>
              join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
            )
            .select((eb) => ['e.batchId', eb.fn.countAll<string>().as('waiting')])
            .where('ri.tenantId', '=', input.tenantId)
            .where((eb) => eb('e.batchId', '=', eb.fn.any(uuidArray(input.batchIds))))
            .where('ri.state', '=', 'active')
            .where((eb) => atHeldNode(input.tenantId, input.userId, eb.ref('ri.currentNodeId')))
            .where((eb) => mayActOn(roundActor(eb, input.tenantId, input.userId)))
            .groupBy('e.batchId')
            .execute(),
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({ batchId: row.batchId, waiting: Number(row.waiting) })),
          ),
        )

/**
 * One reviewer's queue, oldest first: every active round whose stage the
 * caller may judge, in batches where judging is open now. Pull model - the
 * stage names roles, never a person, so nothing here is assigned, only
 * answered.
 */
export const inboxQuery = (
  k: Parameters<Parameters<typeof db.query>[0]>[0],
  input: {
    tenantId: string
    userId: string
    batchIds: readonly string[]
  },
) => {
  return k
    .selectFrom('ReviewInstance as ri')
    .innerJoin('Entry as e', (join) =>
      join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
    )
    .innerJoin('AssessmentBatch as b', (join) =>
      join.onRef('b.tenantId', '=', 'e.tenantId').onRef('b.id', '=', 'e.batchId'),
    )
    .innerJoin('AssessmentItem as i', (join) =>
      join.onRef('i.tenantId', '=', 'e.tenantId').onRef('i.id', '=', 'e.itemId'),
    )
    .innerJoin('BatchParticipant as bp', (join) =>
      join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
    )
    .innerJoin('User as su', (join) =>
      join.onRef('su.tenantId', '=', 'bp.tenantId').onRef('su.id', '=', 'bp.userId'),
    )
    .innerJoin('EntryRevision as er', (join) =>
      join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
    )
    .innerJoin('AssessmentItemRevision as ir', (join) =>
      join.onRef('ir.tenantId', '=', 'er.tenantId').onRef('ir.id', '=', 'er.itemRevisionId'),
    )
    .leftJoin('OrgNode as un', (join) =>
      join
        .onRef('un.tenantId', '=', 'bp.tenantId')
        .onRef('un.id', '=', 'bp.assessmentAnchorNodeId'),
    )
    .select([
      'ri.id as instanceId',
      'ri.entryId',
      'ri.roundNo',
      'ri.currentRoute',
      'e.batchId',
      'b.name as batchName',
      'e.itemId',
      'bp.id as participantId',
      'i.title as itemTitle',
      'su.displayName as participantName',
      'su.businessNo',
      'un.id as unitId',
      'un.name as unitName',
      'er.payload',
      'ir.formConfig',
      'ir.displayConfig',
    ])
    .select((eb) => [
      epoch('ri.created_at').as('submittedMs'),
      eb.cast<string>('ri.createdAt', 'text').as('submittedIso'),
      eb
        .selectFrom('EntryRevisionAttachment as era')
        .select((count) => count.fn.countAll<string>().as('n'))
        .whereRef('era.tenantId', '=', 'ri.tenantId')
        .whereRef('era.revisionId', '=', 'ri.revisionId')
        .as('attachmentCount'),
    ])
    .where('ri.tenantId', '=', input.tenantId)
    .where('ri.state', '=', 'active')
    .where((eb) =>
      input.batchIds.length === 0
        ? eb.lit(false)
        : eb('e.batchId', '=', eb.fn.any(uuidArray(input.batchIds))),
    )
    .where((eb) => atHeldNode(input.tenantId, input.userId, eb.ref('ri.currentNodeId')))
    .where((eb) => mayActOn(roundActor(eb, input.tenantId, input.userId)))
}

/**
 * The decision itself, first writer wins: the round closes exactly once,
 * and the loser of any race - a second reviewer, a withdrawal - is told the
 * round is no longer theirs to close rather than having their word appended
 * to a closed history.
 */
export const completeInstance = (input: {
  tenantId: string
  instanceId: string
  outcome: 'approved' | 'rejected'
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewInstance')
        .set({ state: 'completed', outcome: input.outcome, completedAt: sql`now()` })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.instanceId)
        .where('state', '=', 'active')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export interface ReviewEventRow {
  id: string
  kind: string
  /** where the round stood when this was said; null on round-level events */
  stageId: string | null
  actorId: string | null
  /** who did it, by name: an id in a trail explains nothing to a reader */
  actorName: string | null
  reason: string | null
  comment: string | null
  suggestedPayload: unknown
  createdAt: number
}

export const reviewEventsOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewEvent as re')
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 're.tenantId').onRef('u.id', '=', 're.actorId'),
        )
        .select([
          're.id',
          're.kind',
          're.stageId',
          're.actorId',
          're.reason',
          're.comment',
          're.suggestedPayload',
          'u.displayName as actorName',
        ])
        .select([epoch('re.created_at').as('createdMs')])
        .where('re.tenantId', '=', tenantId)
        .where('re.reviewInstanceId', '=', instanceId)
        .orderBy('re.createdAt')
        .orderBy('re.id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): ReviewEventRow => ({
          id: row.id,
          kind: row.kind,
          stageId: row.stageId,
          actorId: row.actorId,
          actorName: row.actorName,
          reason: row.reason,
          comment: row.comment,
          suggestedPayload: row.suggestedPayload ?? null,
          createdAt: msOf(row.createdMs),
        })),
      ),
    )

/**
 * The units of one level this round actually reaches, for a stage being
 * composed. Distinct because many participants share a unit, and drawn from
 * the frozen lineages rather than the live tree: the round judges people
 * where they stood when they joined it.
 */
export const stageNodesOf = (input: { tenantId: string; batchId: string; nodeTypeId: string }) =>
  db
    .query((k) =>
      sql<{ node_id: string; name: string }>`
        select distinct step.node_id, n.name
        from batch_participants bp
        cross join lateral (
          select (element->>'nodeId')::uuid as node_id, element->>'nodeTypeId' as node_type_id
          from jsonb_array_elements(bp.anchor_lineage) as element
        ) as step
        join org_nodes n on n.tenant_id = bp.tenant_id and n.id = step.node_id
        where bp.tenant_id = ${input.tenantId}
          and bp.batch_id = ${input.batchId}
          and bp.status = 'active'
          and step.node_type_id = ${input.nodeTypeId}
        order by n.name
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row) => ({ id: String(row.node_id), name: String(row.name) })),
      ),
    )

/**
 * The nearest holder of one role along a frozen lineage, walking outward
 * from where the participant stood. This is the selector for roles that
 * genuinely inherit - a counsellor granted over a whole faculty answers for
 * everyone under it - and it is why `nearestRole` exists beside `roleAt`
 * (§14): the anchor is wherever the holder actually is, not a level named
 * in the configuration.
 */
export const nearestRoleNode = (input: {
  tenantId: string
  batchId: string
  roleId: string
  lineage: readonly { nodeId: string }[]
}) =>
  input.lineage.length === 0
    ? Effect.succeed(null)
    : db
        .query((k) =>
          sql<{ node_id: string; ord: number }>`
            select steps.node_id, steps.ord
            from unnest(${sql.val(`{${input.lineage.map((step) => step.nodeId).join(',')}}`)}::uuid[])
              with ordinality as steps(node_id, ord)
            where exists (
              select 1
              from role_grants rg
              join roles ro on ro.tenant_id = rg.tenant_id and ro.id = rg.role_id
              join users u on u.tenant_id = rg.tenant_id and u.id = rg.user_id
              where rg.tenant_id = ${input.tenantId}
                and rg.org_node_id = steps.node_id
                and rg.role_id = ${input.roleId}
                and rg.revoked_at is null
                and (rg.valid_from is null or rg.valid_from <= now())
                and (rg.valid_until is null or rg.valid_until > now())
                and ro.status = 'active'
                and u.enabled
                and (
                  rg.resource_namespace is null
                  or (
                    rg.resource_namespace = 'assessment'
                    and rg.resource_type = 'batch'
                    and rg.resource_id = ${input.batchId}
                  )
                )
            )
            order by steps.ord
            limit 1
          `.execute(k),
        )
        .pipe(Effect.map(({ rows }) => (rows[0] ? String(rows[0].node_id) : null)))

/** names for the units and roles a chain snapshot refers to by id */
export const chainNames = (input: {
  tenantId: string
  nodeIds: readonly string[]
  roleIds: readonly string[]
}) =>
  Effect.gen(function* () {
    const nodes =
      input.nodeIds.length === 0
        ? []
        : yield* db.query((k) =>
            k
              .selectFrom('OrgNode')
              .select(['id', 'name'])
              .where('tenantId', '=', input.tenantId)
              .where('id', 'in', [...new Set(input.nodeIds)])
              .execute(),
          )
    const roles =
      input.roleIds.length === 0
        ? []
        : yield* db.query((k) =>
            k
              .selectFrom('Role')
              .select(['id', 'name'])
              .where('tenantId', '=', input.tenantId)
              .where('id', 'in', [...new Set(input.roleIds)])
              .execute(),
          )
    return {
      nodes: new Map(nodes.map((row) => [row.id, row.name])),
      roles: new Map(roles.map((row) => [row.id, row.name])),
    }
  })

export interface PatrolRow {
  id: string
  batchId: string
  state: 'active' | 'blocked'
  currentRoute: 'normal' | 'escalation'
  currentStageId: string
  /** the frozen routes, for reading the current stage's quorum */
  effectivePolicy: ResolvedPolicy
  currentNodeId: string | null
  currentRoleIds: readonly string[]
  subjectUserId: string
  actorId: string
  /** the participant's frozen lineage, for asking a vacant step again */
  lineage: readonly { nodeId: string; nodeTypeId: string }[]
}

/** every open round in a tenant, with what deciding its stage needs */
export const openInstances = (tenantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
        )
        .select([
          'ri.id',
          'ri.state',
          'ri.currentRoute',
          'ri.currentStageId',
          'ri.effectiveChain',
          'ri.currentNodeId',
          'ri.currentRoleIds',
          'e.batchId',
          'bp.userId as subjectUserId',
          'bp.anchorLineage',
          'er.actorId',
        ])
        .where('ri.tenantId', '=', tenantId)
        .where('ri.state', 'in', ['active', 'blocked'])
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): PatrolRow => ({
          id: row.id,
          batchId: row.batchId,
          state: row.state as PatrolRow['state'],
          currentRoute: row.currentRoute as PatrolRow['currentRoute'],
          currentStageId: row.currentStageId,
          effectivePolicy: readResolved(row.effectiveChain),
          currentNodeId: row.currentNodeId,
          currentRoleIds: row.currentRoleIds,
          subjectUserId: row.subjectUserId,
          actorId: row.actorId,
          lineage: (row.anchorLineage ?? []) as PatrolRow['lineage'],
        })),
      ),
    )

/** the patrol's one write: a round changes state only if it is still where it was read */
export const setInstanceState = (input: {
  tenantId: string
  instanceId: string
  from: 'active' | 'blocked'
  to: 'active' | 'blocked'
  /** why nobody can act, when blocking; cleared on release */
  blockedReason: string | null
  /**
   * the step the caller decided about, when it decided outside the round's
   * own lock. The patrol reads every open round once and then writes them
   * one at a time; a round that moved on in between would otherwise be
   * blocked over a staffing answer belonging to a step it has left.
   */
  at?: { route: string; stageId: string }
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewInstance')
        .set({
          state: input.to,
          blockedReason: input.to === 'blocked' ? input.blockedReason : null,
        })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.instanceId)
        .where('state', '=', input.from)
        .$if(input.at !== undefined, (query) =>
          query
            .where('currentRoute', '=', input.at!.route)
            .where('currentStageId', '=', input.at!.stageId),
        )
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** the rounds nobody can currently act on, grouped the way an alert panel reads them */
export const blockedGroups = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        // left, because a round stopped at a step that resolved to no unit
        // has no node to join to, and those are exactly the ones an
        // administrator most needs to see: a duty nobody anywhere holds
        .leftJoin('OrgNode as n', (join) =>
          join.onRef('n.tenantId', '=', 'ri.tenantId').onRef('n.id', '=', 'ri.currentNodeId'),
        )
        .select((eb) => [
          'ri.currentNodeId as nodeId',
          'n.name as nodeName',
          // the unit from the root down, as the organization names it
          // today: two classes called 1 are told apart by where they sit
          eb
            .selectFrom('OrgNode as a')
            .select((agg) =>
              agg.fn.agg<string[]>('array_agg', ['a.name']).orderBy('a.depth').as('p'),
            )
            .where('a.tenantId', '=', tenantId)
            // ltree containment, PostgreSQL's own operator
            .where((q) => sql<boolean>`${q.ref('a.path')} @> ${q.ref('n.path')}`)
            .as('unitPath'),
          'ri.currentRoleIds as roleIds',
          'ri.blockedReason as reason',
          eb.fn.countAll<string>().as('waiting'),
        ])
        .where('ri.tenantId', '=', tenantId)
        .where('e.batchId', '=', batchId)
        .where('ri.state', '=', 'blocked')
        .groupBy(['ri.currentNodeId', 'n.name', 'n.path', 'ri.currentRoleIds', 'ri.blockedReason'])
        // read from the root down, so the classes of one college stand
        // together and two classes of one name keep one order between them
        .orderBy('unitPath', (order) => order.asc().nullsFirst())
        .orderBy('nodeId')
        .orderBy('roleIds')
        .orderBy('reason')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          nodeId: row.nodeId === null ? null : String(row.nodeId),
          nodeName: row.nodeName === null ? null : String(row.nodeName),
          unitPath: (row.unitPath ?? []).map(String),
          roleIds: row.roleIds.map(String),
          // why these wait: a staffing gap and a conflict rule read differently
          reason: (row.reason ?? 'no-assignee') as
            | 'no-assignee'
            | 'no-independent-reviewer'
            | 'panel-seat-unfilled',
          waiting: Number(row.waiting),
        })),
      ),
    )

/** the tenants with open rounds at all, so the patrol visits nothing empty */
export const tenantsWithOpenRounds = db
  .query((k) =>
    k
      .selectFrom('ReviewInstance')
      .select(['tenantId'])
      .distinct()
      .where('state', 'in', ['active', 'blocked'])
      .execute(),
  )
  .pipe(Effect.map((rows) => rows.map((row) => row.tenantId)))

/**
 * The people a stage's roles are on right now, by name, for an explanation.
 * The round's own subject and author are required rather than optional: the
 * explanation answers the same question the queue and the decision endpoint
 * answer, and a stage that named somebody those two refuse would be
 * explaining a queue nobody has.
 */
export const holderNamesAt = (input: {
  tenantId: string
  batchId: string
  nodeId: string
  roleIds: readonly string[]
  subjectUserId: string
  actorId: string
}) =>
  Effect.gen(function* () {
    if (input.roleIds.length === 0) return [] as readonly string[]
    const ids = yield* reviewersAt({
      tenantId: input.tenantId,
      batchId: input.batchId,
      nodeId: input.nodeId,
      roleIds: input.roleIds,
      subjectUserId: input.subjectUserId,
      actorId: input.actorId,
    })
    if (ids.length === 0) return [] as readonly string[]
    const rows = yield* db.query((k) =>
      k
        .selectFrom('User')
        .select(['displayName'])
        .where('tenantId', '=', input.tenantId)
        .where('id', 'in', [...ids])
        .orderBy('displayName')
        .execute(),
    )
    const names: readonly string[] = rows.map((row) => row.displayName)
    return names
  })

/** one claim beside the judged one: what it says and where it stands */
export interface SiblingEntryRow {
  entryId: string
  status: string
  /** the latest revision's answers; null for a claim never yet written */
  payload: unknown
  /** the form those answers were filed under, for the labels */
  formConfig: unknown
  displayConfig: unknown
}

/**
 * Every claim this participant holds on this question, the judged one
 * included. Read from each entry's own latest revision - what the person
 * has said, not what some round froze - because the aside answers "what
 * else are they claiming here", which is a present-tense question.
 */
export const siblingEntries = (tenantId: string, itemId: string, participantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry as e')
        .leftJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'e.tenantId').onRef('er.id', '=', 'e.currentRevisionId'),
        )
        .leftJoin('AssessmentItemRevision as ir', (join) =>
          join.onRef('ir.tenantId', '=', 'er.tenantId').onRef('ir.id', '=', 'er.itemRevisionId'),
        )
        .select(['e.id as entryId', 'e.status', 'er.payload', 'ir.formConfig', 'ir.displayConfig'])
        .where('e.tenantId', '=', tenantId)
        .where('e.itemId', '=', itemId)
        .where('e.participantId', '=', participantId)
        // Only what has been handed in. A draft is the participant's own
        // desk: it has never been submitted, and a reviewer reading it would
        // be reading something nobody showed them. Voided claims left the
        // paper entirely.
        .where('e.status', 'not in', ['voided', 'draft'])
        .orderBy('e.createdAt')
        .orderBy('e.id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): SiblingEntryRow => ({
          entryId: row.entryId,
          status: row.status,
          payload: row.payload ?? null,
          formConfig: row.formConfig ?? null,
          displayConfig: row.displayConfig ?? null,
        })),
      ),
    )

/** one claim beside the judged one, whole: the version handed in and its form */
export interface SiblingFilingRow {
  entryId: string
  status: string
  itemType: string
  formConfig: unknown
  revisionNo: number
  payload: unknown
  note: string | null
  submittedAt: number
}

/**
 * A claim on the same question by the same participant, read whole for the
 * reviewer comparing it with the judged one. The version shown is the one
 * last handed in, never the owner's working copy, and only for claims the
 * sibling strip lists: drafts and voided claims answer nothing.
 */
export const siblingFilingOf = (input: {
  tenantId: string
  entryId: string
  itemId: string
  participantId: string
}) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry as e')
        .innerJoin('EntryRevision as er', (join) =>
          join
            .onRef('er.tenantId', '=', 'e.tenantId')
            .onRef('er.id', '=', 'e.lastSubmittedRevisionId'),
        )
        .innerJoin('AssessmentItem as i', (join) =>
          join.onRef('i.tenantId', '=', 'e.tenantId').onRef('i.id', '=', 'e.itemId'),
        )
        .leftJoin('AssessmentItemRevision as ir', (join) =>
          join.onRef('ir.tenantId', '=', 'er.tenantId').onRef('ir.id', '=', 'er.itemRevisionId'),
        )
        .select([
          'e.id as entryId',
          'e.status',
          'i.itemType',
          'ir.formConfig',
          'er.revisionNo',
          'er.payload',
          'er.note',
          epoch('er.created_at').as('createdMs'),
        ])
        .where('e.tenantId', '=', input.tenantId)
        .where('e.id', '=', input.entryId)
        .where('e.itemId', '=', input.itemId)
        .where('e.participantId', '=', input.participantId)
        .where('e.status', 'not in', ['voided', 'draft'])
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row): SiblingFilingRow | null =>
        row === undefined
          ? null
          : {
              entryId: row.entryId,
              status: row.status,
              itemType: row.itemType,
              formConfig: row.formConfig ?? null,
              revisionNo: row.revisionNo,
              payload: row.payload ?? null,
              note: row.note ?? null,
              submittedAt: msOf(row.createdMs),
            },
      ),
    )

/** how the round before this one ended, with the word that ended it */
/**
 * The version filed just before the judged one, with the form it answered.
 *
 * Served with the review rather than fetched after it: the workbench opens
 * with the comparison on, and a comparison that arrives a request later
 * flashes into a page the reviewer is already reading. Its own form, not the
 * judged one's - the question may have changed between versions.
 */
export const revisionBefore = (tenantId: string, entryId: string, beforeRevisionNo: number) =>
  db.query((k) =>
    k
      .selectFrom('EntryRevision as er')
      .innerJoin('AssessmentItemRevision as ir', (join) =>
        join.onRef('ir.tenantId', '=', 'er.tenantId').onRef('ir.id', '=', 'er.itemRevisionId'),
      )
      .select(['er.id', 'er.revisionNo', 'er.payload', 'ir.formConfig'])
      .where('er.tenantId', '=', tenantId)
      .where('er.entryId', '=', entryId)
      .where('er.revisionNo', '<', beforeRevisionNo)
      .orderBy('er.revisionNo', 'desc')
      .limit(1)
      .executeTakeFirst(),
  )

export interface PreviousConclusionRow {
  roundNo: number
  kind: string
  reason: string | null
  comment: string | null
  /** who said it, so a reader kept from judges' names still reads their own */
  actorId: string | null
  actorName: string | null
  createdAt: number
}

/**
 * Earlier rounds, one row per ROUND, never per event.
 *
 * This used to be an event query with a whitelist of "conclusion kinds",
 * and a round that ended a way the list did not name - a policy re-route,
 * most recently - vanished from the workbench whole: the summary skipped to
 * the round before it and presented that one's reasons as "the previous
 * round". The round is the unit a reviewer reasons about, so the question
 * is asked of review_instances: every earlier round exists exactly once
 * here, and its concluding word is whatever its last event was - a kind
 * nobody taught the display yet still shows up as a round that ended.
 */
const roundSummaries = (tenantId: string, entryId: string, beforeRound: number) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .leftJoinLateral(
          (eb) =>
            eb
              .selectFrom('ReviewEvent as re')
              .select(['re.kind', 're.reason', 're.comment', 're.actorId'])
              .whereRef('re.tenantId', '=', 'ri.tenantId')
              .whereRef('re.reviewInstanceId', '=', 'ri.id')
              .orderBy('re.createdAt', 'desc')
              .orderBy('re.id', 'desc')
              .limit(1)
              .as('last'),
          (join) => join.onTrue(),
        )
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'ri.tenantId').onRef('u.id', '=', 'last.actorId'),
        )
        .select([
          'ri.roundNo',
          'ri.outcome',
          'last.kind',
          'last.reason',
          'last.comment',
          'last.actorId',
          'u.displayName as actorName',
        ])
        .select([
          sql<
            number | null
          >`(extract(epoch from coalesce(ri.completed_at, ri.created_at)) * 1000)::float8`.as(
            'endedMs',
          ),
        ])
        .where('ri.tenantId', '=', tenantId)
        .where('ri.entryId', '=', entryId)
        .where('ri.roundNo', '<', beforeRound)
        .orderBy('ri.roundNo', 'desc')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): PreviousConclusionRow => ({
          roundNo: row.roundNo,
          // the last event is the concluding word; a round somehow bare of
          // events still reports how it ended rather than vanishing
          kind: row.kind ?? row.outcome ?? 'completed',
          reason: row.reason ?? null,
          comment: row.comment ?? null,
          actorId: row.actorId ?? null,
          actorName: row.actorName,
          createdAt: msOf(row.endedMs),
        })),
      ),
    )

/** the round just before this one - exactly the one, whatever ended it */
export const previousConclusion = (tenantId: string, entryId: string, beforeRound: number) =>
  roundSummaries(tenantId, entryId, beforeRound).pipe(Effect.map((rows) => rows[0] ?? null))

/**
 * How every earlier round of this claim ended, newest first: one line per
 * round - a reviewer looking at a fifth submission wants to know whether
 * the same thing has been asked for three times, and a round must never be
 * missing from that count because of how it happened to end.
 */
export const earlierConclusions = (tenantId: string, entryId: string, beforeRound: number) =>
  roundSummaries(tenantId, entryId, beforeRound).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        roundNo: row.roundNo,
        kind: row.kind,
        reason: row.reason,
        actorId: row.actorId,
        actorName: row.actorName,
        at: row.createdAt,
      })),
    ),
  )

/** the event kinds a day's work counts: every word a reviewer said on a round */
const DECIDING_KINDS = [
  'approved',
  'rejected',
  'escalated',
  'opinion-approved',
  'opinion-rejected',
  'comment',
  'recommend-approve',
  'recommend-reject',
]

/** midnight of today on a timezone's own calendar, as an instant */
const startOfDayIn = (timezone: string) =>
  sql<Date>`date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone}`

/**
 * Decisions this person recorded on this batch today, on the batch's own
 * calendar. "Today" is the batch timezone's day, not the server's: the
 * counter greets whoever sits down in the morning, and mornings are local.
 */
export const decisionsToday = (input: {
  tenantId: string
  batchId: string
  userId: string
  timezone: string
}) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewEvent as re')
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 're.tenantId').onRef('ri.id', '=', 're.reviewInstanceId'),
        )
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('re.tenantId', '=', input.tenantId)
        .where('e.batchId', '=', input.batchId)
        .where('re.actorId', '=', input.userId)
        .where('re.kind', 'in', DECIDING_KINDS)
        .where('re.createdAt', '>=', startOfDayIn(input.timezone))
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => Number(row.count)))

/**
 * Panel votes this person cast on this batch today - counted beside the
 * event-shaped decisions, because a vote deliberately writes no event of
 * its own until its sitting concludes, and thirty filings judged in a
 * morning must not greet their judge as zero.
 */
export const votesToday = (input: {
  tenantId: string
  batchId: string
  userId: string
  timezone: string
}) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewVote as v')
        .innerJoin('ReviewPanel as p', (join) =>
          join.onRef('p.tenantId', '=', 'v.tenantId').onRef('p.id', '=', 'v.panelId'),
        )
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 'p.tenantId').onRef('ri.id', '=', 'p.reviewInstanceId'),
        )
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('v.tenantId', '=', input.tenantId)
        .where('e.batchId', '=', input.batchId)
        .where('v.voterUserId', '=', input.userId)
        .where('v.createdAt', '>=', startOfDayIn(input.timezone))
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => Number(row.count)))

/** the group a question adds into, for the aside that says what it may total */
export const scoreGroupOf = (tenantId: string, groupId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ScoreGroup')
        .select((eb) => ['name', eb.cast<string | null>('cap', 'text').as('cap')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', groupId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : { name: row.name, cap: row.cap === null ? null : String(row.cap) },
      ),
    )

/**
 * Whether this person may judge some open round of this claim right now.
 *
 * The door to the claim's whole history: reading how a filing got here is
 * part of judging it, and the one definition of "may review" answers that
 * too. Open rounds only - having judged something last term is not standing
 * to read it today.
 */
/** one asked-for piece of a supplement: text or file, nothing else */
export interface SupplementRequirement {
  key: string
  label: string
  kind: 'text' | 'file'
  required: boolean
}

/**
 * The requirements list off the jsonb - FAIL-CLOSED. An element this build
 * cannot read poisons the whole list: "I do not understand this ask" must
 * never be read as "this ask does not exist", or a newer instance's
 * requirement kind silently vanishes from an older one's completeness
 * check and the request closes as answered around it. Readers show what
 * they can; the answering write refuses outright.
 */
export const requirementsOf = (value: unknown): readonly SupplementRequirement[] | null => {
  if (!Array.isArray(value)) return null
  const readable: SupplementRequirement[] = []
  for (const one of value) {
    const record = (one ?? {}) as Record<string, unknown>
    const kind = record['kind']
    if (
      typeof record['key'] !== 'string' ||
      typeof record['label'] !== 'string' ||
      (kind !== 'text' && kind !== 'file')
    ) {
      return null
    }
    readable.push({
      key: record['key'],
      label: record['label'],
      kind,
      required: record['required'] === true,
    })
  }
  return readable
}

export interface SupplementRow {
  id: string
  requestNo: number
  status: 'open' | 'answered' | 'cancelled' | 'superseded'
  instructions: string
  /** what this build can read of the ask; the write path refuses the rest */
  requirements: readonly SupplementRequirement[]
  requestedBy: string
  requestedByName: string | null
  requestedAt: number
  answeredAt: number | null
  cancelledAt: number | null
  response: {
    payload: unknown
    attachments: readonly { attachmentId: string; position: number }[]
    respondedAt: number
  } | null
}

/**
 * Every ask these rounds made, oldest first within each, with its answer.
 *
 * Batched over rounds because the claim's whole story asks for all of them
 * at once: a round at a time would put a query per round behind one screen.
 */
export const supplementsOfInstances = (tenantId: string, instanceIds: readonly string[]) =>
  Effect.gen(function* () {
    const byInstance = new Map<string, SupplementRow[]>()
    if (instanceIds.length === 0) return byInstance
    const requests = yield* db.query((k) =>
      k
        .selectFrom('ReviewSupplementRequest as sr')
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'sr.tenantId').onRef('u.id', '=', 'sr.requestedBy'),
        )
        .leftJoin('ReviewSupplementResponse as re', (join) =>
          join.onRef('re.tenantId', '=', 'sr.tenantId').onRef('re.requestId', '=', 'sr.id'),
        )
        .select([
          'sr.id',
          'sr.reviewInstanceId',
          'sr.requestNo',
          'sr.status',
          'sr.instructions',
          'sr.requirements',
          'sr.requestedBy',
          'u.displayName as requestedByName',
          're.id as responseId',
          're.payload as responsePayload',
        ])
        .select([
          epoch('sr.created_at').as('requestedMs'),
          epoch('sr.answered_at').as('answeredMs'),
          epoch('sr.cancelled_at').as('cancelledMs'),
          epoch('re.created_at').as('respondedMs'),
        ])
        .where('sr.tenantId', '=', tenantId)
        .where('sr.reviewInstanceId', 'in', [...instanceIds])
        .orderBy('sr.requestNo')
        .execute(),
    )
    const responseIds = requests.flatMap((row) => (row.responseId === null ? [] : [row.responseId]))
    const cited =
      responseIds.length === 0
        ? []
        : yield* db.query((k) =>
            k
              .selectFrom('ReviewSupplementAttachment')
              .select(['responseId', 'attachmentId', 'position'])
              .where('tenantId', '=', tenantId)
              .where('responseId', 'in', responseIds)
              .orderBy('position')
              .execute(),
          )
    for (const row of requests) {
      const bucket = byInstance.get(row.reviewInstanceId) ?? []
      bucket.push({
        id: row.id,
        requestNo: row.requestNo,
        status: row.status as SupplementRow['status'],
        instructions: row.instructions,
        requirements: requirementsOf(row.requirements) ?? [],
        requestedBy: row.requestedBy,
        requestedByName: row.requestedByName,
        requestedAt: msOf(row.requestedMs),
        answeredAt: row.answeredMs == null ? null : msOf(row.answeredMs),
        cancelledAt: row.cancelledMs == null ? null : msOf(row.cancelledMs),
        response:
          row.responseId === null
            ? null
            : {
                payload: row.responsePayload,
                attachments: cited
                  .filter((one) => one.responseId === row.responseId)
                  .map((one) => ({ attachmentId: one.attachmentId, position: one.position })),
                respondedAt: msOf(row.respondedMs),
              },
      })
      byInstance.set(row.reviewInstanceId, bucket)
    }
    return byInstance
  })

/** the same for one round, which is what the workbench reads */
export const supplementsOf = (tenantId: string, instanceId: string) =>
  supplementsOfInstances(tenantId, [instanceId]).pipe(
    Effect.map((byInstance) => byInstance.get(instanceId) ?? []),
  )

/** one request with the round it belongs to, for the answer and cancel doors */
export interface SupplementRequestRow {
  id: string
  reviewInstanceId: string
  requestNo: number
  status: 'open' | 'answered' | 'cancelled' | 'superseded'
  instructions: string
  /** null when this build cannot read the stored contract; answering refuses */
  requirements: readonly SupplementRequirement[] | null
  requestedBy: string
}

export const supplementRequestOf = (tenantId: string, requestId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementRequest')
        .select([
          'id',
          'reviewInstanceId',
          'requestNo',
          'status',
          'instructions',
          'requirements',
          'requestedBy',
        ])
        .where('tenantId', '=', tenantId)
        .where('id', '=', requestId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              id: row.id,
              reviewInstanceId: row.reviewInstanceId,
              requestNo: row.requestNo,
              status: row.status as SupplementRequestRow['status'],
              instructions: row.instructions,
              requirements: requirementsOf(row.requirements),
              requestedBy: row.requestedBy,
            } satisfies SupplementRequestRow),
      ),
    )

/** who is holding the open ask on this round, if anybody is */
export const openAskRequesterOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementRequest')
        .select('requestedBy')
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .where('status', '=', 'open')
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.requestedBy ?? null))

export const nextSupplementNo = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementRequest')
        .select((eb) => eb(eb.fn.coalesce(eb.fn.max('requestNo'), eb.lit(0)), '+', 1).as('next'))
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => Number(row.next)))

export const insertSupplementRequest = (input: {
  tenantId: string
  reviewInstanceId: string
  requestNo: number
  requestedBy: string
  instructions: string
  requirements: readonly SupplementRequirement[]
}) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        insert into review_supplement_requests
          (tenant_id, review_instance_id, request_no, requested_by, instructions, requirements)
        values (${input.tenantId}, ${input.reviewInstanceId}, ${input.requestNo},
                ${input.requestedBy}, ${input.instructions},
                ${sql.val(JSON.stringify(input.requirements))}::jsonb)
        returning id
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => String(rows[0]!.id)))

/**
 * The round pausing itself to ask, or picking work back up. Conditional on
 * the state it is leaving, so two reviewers pressing at once cannot both
 * succeed - the loser is told the round has moved.
 */
export const setInstanceSupplementState = (input: {
  tenantId: string
  instanceId: string
  from: 'active' | 'awaiting_supplement'
  to: 'active' | 'awaiting_supplement'
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewInstance')
        .set({ state: input.to })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.instanceId)
        .where('state', '=', input.from)
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** closes the ask, exactly once; the loser of a race writes nothing */
export const closeSupplementRequest = (input: {
  tenantId: string
  requestId: string
  outcome: 'answered' | 'cancelled'
  cancelledBy?: string
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewSupplementRequest')
        .set(
          input.outcome === 'answered'
            ? { status: 'answered', answeredAt: sql`now()` }
            : {
                status: 'cancelled',
                cancelledAt: sql`now()`,
                cancelledBy: input.cancelledBy ?? null,
              },
        )
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.requestId)
        .where('status', '=', 'open')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const insertSupplementResponse = (input: {
  tenantId: string
  requestId: string
  payload: unknown
  respondedBy: string
}) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        insert into review_supplement_responses (tenant_id, request_id, payload, responded_by)
        values (${input.tenantId}, ${input.requestId},
                ${sql.val(JSON.stringify(input.payload))}::jsonb, ${input.respondedBy})
        returning id
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => String(rows[0]!.id)))

export const insertSupplementAttachments = (input: {
  tenantId: string
  responseId: string
  attachmentIds: readonly string[]
}) =>
  input.attachmentIds.length === 0
    ? Effect.void
    : db.query((k) =>
        k
          .insertInto('ReviewSupplementAttachment')
          .values(
            input.attachmentIds.map(
              (attachmentId, position) =>
                ({
                  tenantId: input.tenantId,
                  responseId: input.responseId,
                  attachmentId,
                  position,
                }) as never,
            ),
          )
          .execute(),
      )

/** one outstanding ask, as the reviewer's own list of them reads it */
export interface AwaitingRow {
  requestId: string
  instanceId: string
  entryId: string
  requestNo: number
  /** open: still with the participant. answered: back here, not yet judged. */
  status: 'open' | 'answered'
  participantName: string
  businessNo: string | null
  itemTitle: string
  /** the labels of what was asked for, for the one line that says it */
  asks: readonly string[]
  requestedAt: number
  requestedAtIso: string
  answeredAt: number | null
}

/**
 * What this reviewer's step is waiting on somebody else for (§32.65 ⑤).
 *
 * Two kinds of row, and they are the same fact at two moments: an ask still
 * with the person who filed, and one they have answered - which puts the
 * round back in the ordinary queue, where it would otherwise arrive looking
 * like any other and give no sign that it is the answer to a question this
 * step asked.
 *
 * Standing is the same `mayReview` the queue asks, not "requests I made":
 * a step is held by whoever holds the role there, so a colleague's ask is
 * this reviewer's business too.
 */
/**
 * The reviewer branch of the overview (§32.73): the queue by score group,
 * and the reviewer's own answered asks with who answered - enough for the
 * desk to say a second line under each row, not a list endpoint.
 */
export const reviewerDeskOf = (input: { tenantId: string; batchId: string; userId: string }) =>
  db
    .query((k) => {
      const myRounds = () =>
        k
          .selectFrom('ReviewInstance as ri')
          .innerJoin('Entry as e', (join) =>
            join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
          )
          .innerJoin('AssessmentItem as i', (join) =>
            join.onRef('i.tenantId', '=', 'e.tenantId').onRef('i.id', '=', 'e.itemId'),
          )
          .innerJoin('BatchParticipant as bp', (join) =>
            join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
          )
          .innerJoin('EntryRevision as er', (join) =>
            join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
          )
          .where('ri.tenantId', '=', input.tenantId)
          .where('e.batchId', '=', input.batchId)
          .where((eb) => atHeldNode(input.tenantId, input.userId, eb.ref('ri.currentNodeId')))
          .where((eb) => mayActOn(roundActor(eb, input.tenantId, input.userId)))
      return k
        .selectNoFrom(() => [
          jsonArrayFrom(
            myRounds()
              .innerJoin('ScoreGroup as sg', (join) =>
                join.onRef('sg.tenantId', '=', 'i.tenantId').onRef('sg.id', '=', 'i.scoreGroupId'),
              )
              .select((eb) => ['sg.name', eb.cast<number>(eb.fn.countAll(), 'integer').as('count')])
              .where('ri.state', '=', 'active')
              .groupBy('sg.name')
              .orderBy('count', 'desc')
              .orderBy('sg.name'),
          ).as('queueGroups'),
          jsonArrayFrom(
            myRounds()
              .innerJoin('ReviewSupplementRequest as sr', (join) =>
                join
                  .onRef('sr.tenantId', '=', 'ri.tenantId')
                  .onRef('sr.reviewInstanceId', '=', 'ri.id'),
              )
              .innerJoin('User as su', (join) =>
                join.onRef('su.tenantId', '=', 'bp.tenantId').onRef('su.id', '=', 'bp.userId'),
              )
              .select(['su.displayName as who', 'i.title as itemTitle', 'sr.answeredAt'])
              .where('sr.requestedBy', '=', input.userId)
              .where('sr.status', '=', 'answered')
              .where('ri.state', 'in', ['active', 'blocked'])
              .orderBy('sr.answeredAt', 'desc'),
          ).as('answeredAsks'),
        ])
        .executeTakeFirstOrThrow()
    })
    .pipe(
      Effect.map((row) => ({
        pendingCount: row.queueGroups.reduce((sum, group) => sum + group.count, 0),
        answeredAskCount: row.answeredAsks.length,
        queueGroups: row.queueGroups.map((group) => ({ name: group.name, count: group.count })),
        answeredAsks: row.answeredAsks.map((ask) => ({ who: ask.who, itemTitle: ask.itemTitle })),
      })),
    )

export const awaitingQuery = (
  k: Parameters<Parameters<typeof db.query>[0]>[0],
  input: {
    tenantId: string
    userId: string
    batchId: string
  },
) => {
  return k
    .selectFrom('ReviewSupplementRequest as sr')
    .innerJoin('ReviewInstance as ri', (join) =>
      join.onRef('ri.tenantId', '=', 'sr.tenantId').onRef('ri.id', '=', 'sr.reviewInstanceId'),
    )
    .innerJoin('Entry as e', (join) =>
      join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
    )
    .innerJoin('AssessmentItem as i', (join) =>
      join.onRef('i.tenantId', '=', 'e.tenantId').onRef('i.id', '=', 'e.itemId'),
    )
    .innerJoin('BatchParticipant as bp', (join) =>
      join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
    )
    .innerJoin('User as su', (join) =>
      join.onRef('su.tenantId', '=', 'bp.tenantId').onRef('su.id', '=', 'bp.userId'),
    )
    .innerJoin('EntryRevision as er', (join) =>
      join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
    )
    .select([
      'sr.id as requestId',
      'sr.reviewInstanceId as instanceId',
      'ri.entryId',
      'sr.requestNo',
      'sr.status',
      'sr.requirements',
      'su.displayName as participantName',
      'su.businessNo',
      'i.title as itemTitle',
    ])
    .select((eb) => [
      epoch('sr.created_at').as('requestedMs'),
      eb.cast<string>('sr.createdAt', 'text').as('requestedIso'),
      epoch('sr.answered_at').as('answeredMs'),
    ])
    .where('sr.tenantId', '=', input.tenantId)
    .where('e.batchId', '=', input.batchId)
    .where((eb) =>
      eb.or([
        // an open ask is one reviewer's unfinished business, not the
        // stage's: only its sender is waiting on it (§32.70)
        eb.and([
          eb('sr.status', '=', 'open'),
          eb('ri.state', '=', 'awaiting_supplement'),
          eb('sr.requestedBy', '=', input.userId),
        ]),
        // answered, and the round it belongs to is back open here -
        // back in the shared pool, so every eligible reviewer sees it
        eb.and([eb('sr.status', '=', 'answered'), eb('ri.state', 'in', ['active', 'blocked'])]),
      ]),
    )
    .where((eb) => atHeldNode(input.tenantId, input.userId, eb.ref('ri.currentNodeId')))
    .where((eb) => mayActOn(roundActor(eb, input.tenantId, input.userId)))
}

export const supplementAttachmentHistory = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementAttachment as rsa')
        .innerJoin('ReviewSupplementResponse as re', (join) =>
          join.onRef('re.tenantId', '=', 'rsa.tenantId').onRef('re.id', '=', 'rsa.responseId'),
        )
        .innerJoin('ReviewSupplementRequest as sr', (join) =>
          join.onRef('sr.tenantId', '=', 're.tenantId').onRef('sr.id', '=', 're.requestId'),
        )
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 'sr.tenantId').onRef('ri.id', '=', 'sr.reviewInstanceId'),
        )
        .select(['rsa.attachmentId'])
        .where('rsa.tenantId', '=', tenantId)
        .where('ri.entryId', '=', entryId)
        .execute(),
    )
    .pipe(Effect.map((rows) => new Set(rows.map((row) => String(row.attachmentId)))))

/**
 * The one open ask on the round an entry is currently in, for the entry
 * screens: this is how the person who filed learns they are being asked.
 * Answerability is exactly this join - request open AND round still waiting -
 * so a round that was cancelled or re-routed under an open ask stops
 * offering it without anybody sweeping.
 */
export interface OpenSupplementRow {
  entryId: string
  requestId: string
  instanceId: string
  requestNo: number
  instructions: string
  requirements: readonly SupplementRequirement[]
  /** who asked, by name: the card says whose request this is */
  requestedByName: string | null
  requestedAt: number
}

export const openSupplementsOfEntries = (tenantId: string, entryIds: readonly string[]) =>
  entryIds.length === 0
    ? Effect.succeed([] as readonly OpenSupplementRow[])
    : db
        .query((k) =>
          k
            .selectFrom('ReviewSupplementRequest as sr')
            .innerJoin('ReviewInstance as ri', (join) =>
              join
                .onRef('ri.tenantId', '=', 'sr.tenantId')
                .onRef('ri.id', '=', 'sr.reviewInstanceId'),
            )
            .leftJoin('User as u', (join) =>
              join.onRef('u.tenantId', '=', 'sr.tenantId').onRef('u.id', '=', 'sr.requestedBy'),
            )
            .select([
              'ri.entryId',
              'sr.id as requestId',
              'sr.reviewInstanceId as instanceId',
              'sr.requestNo',
              'sr.instructions',
              'sr.requirements',
              'u.displayName as requestedByName',
            ])
            .select([epoch('sr.created_at').as('requestedMs')])
            .where('sr.tenantId', '=', tenantId)
            .where('sr.status', '=', 'open')
            .where('ri.state', '=', 'awaiting_supplement')
            .where('ri.entryId', 'in', [...entryIds])
            .execute(),
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row): OpenSupplementRow => ({
              entryId: row.entryId,
              requestId: row.requestId,
              instanceId: row.instanceId,
              requestNo: row.requestNo,
              instructions: row.instructions,
              requirements: requirementsOf(row.requirements) ?? [],
              requestedByName: row.requestedByName,
              requestedAt: msOf(row.requestedMs),
            })),
          ),
        )

/**
 * Whether any open round of this claim is this person's to READ, for the
 * entry-side doors. Same boundary as the round's own reader, open ask and
 * all: reading the claim's history is reading the round by another name.
 */
export const mayReviewEntry = (input: { tenantId: string; userId: string; entryId: string }) =>
  db
    .query((k) =>
      k
        .selectNoFrom((eb) =>
          eb
            .exists(
              eb
                .selectFrom('ReviewInstance as ri')
                .innerJoin('Entry as e', (join) =>
                  join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
                )
                .innerJoin('BatchParticipant as bp', (join) =>
                  join
                    .onRef('bp.tenantId', '=', 'e.tenantId')
                    .onRef('bp.id', '=', 'e.participantId'),
                )
                .innerJoin('EntryRevision as er', (join) =>
                  join
                    .onRef('er.tenantId', '=', 'ri.tenantId')
                    .onRef('er.id', '=', 'ri.revisionId'),
                )
                .select('ri.id')
                .where('ri.tenantId', '=', input.tenantId)
                .where('ri.entryId', '=', input.entryId)
                .where('ri.state', 'in', [...OPEN_REVIEW_STATES])
                .where((row) =>
                  heldThroughOpenAsk({
                    tenantId: row.ref('ri.tenantId'),
                    instanceId: row.ref('ri.id'),
                    state: row.ref('ri.state'),
                    userId: row.val(input.userId),
                  }),
                )
                .where((row) => mayActOn(roundActor(row, input.tenantId, input.userId))),
            )
            .as('ok'),
        )
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => Boolean(row.ok)))

// --- panels -----------------------------------------------------------------
//
// The sitting's rows and nothing else: who constitutes it, who took over a
// seat, who said what. The service owns the arithmetic (when it resolves,
// what a resolution means); these helpers own the races - every claim and
// every conclusion is conditional, and the partial unique indexes are the
// referee of last resort.

/** the round of this claim still running, if one is, taken under lock */
export const openRoundOf = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select(['id', 'origin'])
        .where('tenantId', '=', tenantId)
        .where('entryId', '=', entryId)
        .where('state', 'in', [...OPEN_REVIEW_STATES])
        .forUpdate()
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row === undefined ? null : { id: row.id, origin: row.origin })))

/** the round row itself, taken for update: panel votes serialize on it */
export const lockReviewInstance = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('id', '=', instanceId)
        .forUpdate()
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.length > 0))

export interface PanelRow {
  id: string
  reviewInstanceId: string
  route: 'normal' | 'escalation'
  stageId: string
  seatCount: number
  state: 'open' | 'resolved' | 'superseded'
  resolution: string | null
}

export const openPanelOf = (
  tenantId: string,
  instanceId: string,
  /** narrow to the sitting of one step, for a caller holding no lock */
  at?: { route: string; stageId: string },
) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewPanel')
        .select(['id', 'reviewInstanceId', 'route', 'stageId', 'seatCount', 'state', 'resolution'])
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .where('state', '=', 'open')
        .$if(at !== undefined, (query) =>
          query.where('route', '=', at!.route).where('stageId', '=', at!.stageId),
        )
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              id: row.id,
              reviewInstanceId: row.reviewInstanceId,
              route: row.route as PanelRow['route'],
              stageId: row.stageId,
              seatCount: row.seatCount,
              state: row.state as PanelRow['state'],
              resolution: row.resolution,
            } satisfies PanelRow),
      ),
    )

/**
 * Constitutes the sitting: one panel, one seat per member found eligible at
 * this moment. The seat count is frozen here and never changes; membership
 * afterwards is replacement, not growth (§32.66).
 */
export const createPanel = (input: {
  tenantId: string
  reviewInstanceId: string
  route: 'normal' | 'escalation'
  stageId: string
  members: readonly string[]
}) =>
  Effect.gen(function* () {
    const panel = yield* db.query((k) =>
      sql<{ id: string }>`
        insert into review_panels (tenant_id, review_instance_id, route, stage_id, seat_count)
        values (${input.tenantId}, ${input.reviewInstanceId}, ${input.route}, ${input.stageId},
                ${input.members.length})
        returning id
      `.execute(k),
    )
    const panelId = String(panel.rows[0]!.id)
    for (const [index, userId] of input.members.entries()) {
      yield* db.query((k) =>
        sql`
          insert into review_panel_assignments (tenant_id, panel_id, seat_no, user_id)
          values (${input.tenantId}, ${panelId}, ${index + 1}, ${userId})
        `.execute(k),
      )
    }
    return panelId
  })

export interface PanelSeatRow {
  assignmentId: string
  seatNo: number
  userId: string
  /** the vote this occupancy cast, if it has */
  voted: 'approve' | 'reject' | null
}

/** the live seats of one panel, with whether each has spoken */
export const livePanelSeats = (tenantId: string, panelId: string) =>
  db
    .query((k) =>
      sql<{ id: string; seat_no: number; user_id: string; decision: string | null }>`
        select pa.id, pa.seat_no, pa.user_id, v.decision
        from review_panel_assignments pa
        left join review_votes v on v.tenant_id = pa.tenant_id and v.assignment_id = pa.id
        where pa.tenant_id = ${tenantId} and pa.panel_id = ${panelId} and pa.ended_at is null
        order by pa.seat_no
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row): PanelSeatRow => ({
          assignmentId: String(row.id),
          seatNo: Number(row.seat_no),
          userId: String(row.user_id),
          voted: row.decision === null ? null : (String(row.decision) as 'approve' | 'reject'),
        })),
      ),
    )

/** ends an unvoted occupancy; a seat that has spoken is history and never ends */
export const endPanelAssignment = (input: {
  tenantId: string
  assignmentId: string
  reason: string
}) =>
  db
    .query((k) =>
      k
        // unaliased: the entity naming does not reach an aliased update target
        .updateTable('ReviewPanelAssignment')
        .set({ endedAt: sql<Date>`now()`, endedReason: input.reason })
        .where('ReviewPanelAssignment.tenantId', '=', input.tenantId)
        .where('ReviewPanelAssignment.id', '=', input.assignmentId)
        .where('ReviewPanelAssignment.endedAt', 'is', null)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('ReviewVote as v')
                .select('v.id')
                .whereRef('v.assignmentId', '=', 'ReviewPanelAssignment.id'),
            ),
          ),
        )
        .returning('ReviewPanelAssignment.id')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.length > 0))

/**
 * Takes an empty seat, atomically: the seat number is whichever of 1..count
 * has no live occupant, and the partial unique index turns the second of
 * two simultaneous claims away.
 */
export const claimPanelSeat = (input: { tenantId: string; panelId: string; userId: string }) =>
  db
    .query((k) =>
      sql<{ id: string; seat_no: number }>`
        insert into review_panel_assignments (tenant_id, panel_id, seat_no, user_id)
        select ${input.tenantId}, ${input.panelId}, free.seat_no, ${input.userId}
        from (
          select gs.seat_no
          from review_panels p
          cross join lateral generate_series(1, p.seat_count) as gs(seat_no)
          where p.tenant_id = ${input.tenantId} and p.id = ${input.panelId}
            and not exists (
              select 1 from review_panel_assignments pa
              where pa.panel_id = p.id and pa.seat_no = gs.seat_no and pa.ended_at is null
            )
          order by gs.seat_no
          limit 1
        ) as free
        returning id, seat_no
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.length === 0 ? null : { assignmentId: String(rows[0]!.id), seatNo: rows[0]!.seat_no },
      ),
    )

export const insertVote = (input: {
  tenantId: string
  panelId: string
  assignmentId: string
  voterUserId: string
  decision: 'approve' | 'reject'
  reason: string | null
  comment: string | null
  /** which determination this ballot was cast on; the sitting's frozen one */
  recognitionHash?: string | null
}) =>
  db.query((k) =>
    sql`
      insert into review_votes
        (tenant_id, panel_id, assignment_id, voter_user_id, decision, reason, comment, recognition_hash)
      values (${input.tenantId}, ${input.panelId}, ${input.assignmentId}, ${input.voterUserId},
              ${input.decision}, ${input.reason}, ${input.comment}, ${input.recognitionHash ?? null})
    `.execute(k),
  )

export interface PanelVoteRow {
  voterUserId: string
  voterName: string | null
  decision: 'approve' | 'reject'
  reason: string | null
  comment: string | null
  createdAt: number
}

export const votesOfPanel = (tenantId: string, panelId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewVote as v')
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'v.tenantId').onRef('u.id', '=', 'v.voterUserId'),
        )
        .select([
          'v.voterUserId',
          'u.displayName as voterName',
          'v.decision',
          'v.reason',
          'v.comment',
          epoch('v.created_at').as('createdMs'),
        ])
        .where('v.tenantId', '=', tenantId)
        .where('v.panelId', '=', panelId)
        .orderBy('v.createdAt')
        .orderBy('v.id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): PanelVoteRow => ({
          voterUserId: String(row.voterUserId),
          voterName: row.voterName,
          decision: String(row.decision) as PanelVoteRow['decision'],
          reason: row.reason,
          comment: row.comment,
          createdAt: Number(row.createdMs),
        })),
      ),
    )

/** the sitting concludes, exactly once; the loser of a race writes nothing */
export const resolvePanel = (input: {
  tenantId: string
  panelId: string
  /**
   * 'rejected' is the sitting held at the ladder's end, where a split has
   * nowhere to be handed to and is therefore the refusal itself
   */
  resolution: 'approved' | 'escalated' | 'rejected'
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewPanel')
        .set({ state: 'resolved', resolution: input.resolution, closedAt: sql`now()` })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.panelId)
        .where('state', '=', 'open')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/**
 * Dissolves whatever sitting the round still holds, without a resolution:
 * the round left (withdrawn, rerouted, returned) or its evidence changed
 * under the sitting (a supplement was answered). Votes stay readable; they
 * count for nothing.
 */
export const supersedeOpenPanels = (tenantId: string, instanceId: string) =>
  db.query((k) =>
    k
      .updateTable('ReviewPanel')
      .set({ state: 'superseded', closedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('reviewInstanceId', '=', instanceId)
      .where('state', '=', 'open')
      .execute(),
  )

export interface StageOpinionRow {
  stageId: string
  votes: readonly PanelVoteRow[]
}

/**
 * What the concluded sittings of this round said, per stage, for the next
 * judge: a split panel's whole value is that the辅导员 reads both sides.
 * Resolved panels only - an open sitting's votes are sealed from everybody,
 * its own members first (§32.66), and a superseded sitting judged evidence
 * that has since changed.
 */
export const resolvedPanelOpinions = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewPanel as p')
        .innerJoin('ReviewVote as v', (join) =>
          join.onRef('v.tenantId', '=', 'p.tenantId').onRef('v.panelId', '=', 'p.id'),
        )
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'v.tenantId').onRef('u.id', '=', 'v.voterUserId'),
        )
        .select([
          'p.stageId',
          'v.voterUserId',
          'u.displayName as voterName',
          'v.decision',
          'v.reason',
          'v.comment',
          epoch('v.created_at').as('createdMs'),
        ])
        .where('p.tenantId', '=', tenantId)
        .where('p.reviewInstanceId', '=', instanceId)
        .where('p.state', '=', 'resolved')
        .orderBy('p.createdAt')
        .orderBy('v.createdAt')
        .orderBy('v.id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) => {
        const byStage = new Map<string, PanelVoteRow[]>()
        for (const row of rows) {
          const bucket = byStage.get(String(row.stageId)) ?? []
          bucket.push({
            voterUserId: String(row.voterUserId),
            voterName: row.voterName,
            decision: String(row.decision) as PanelVoteRow['decision'],
            reason: row.reason,
            comment: row.comment,
            createdAt: Number(row.createdMs),
          })
          byStage.set(String(row.stageId), bucket)
        }
        return byStage
      }),
    )

/**
 * The last determination this round made, if any word in it has.
 *
 * How a later stage inherits what an earlier one decided: the reviewer above
 * opens on what the reviewer below determined, not on the student's original
 * claim, so a correction survives the climb.
 */
export const lastRecognitionOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewEvent')
        .select(['recognitionPayload'])
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .where('recognitionPayload', 'is not', null)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ((row as { recognitionPayload: Record<string, unknown> }).recognitionPayload ?? null),
      ),
    )

/**
 * What a claim currently stands on, for deciding whether it can be appealed.
 *
 * Read by entry rather than by round: an administrative record has no round,
 * and it is still a decision somebody may disagree with.
 */
export const appealContextOf = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry as e')
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .select([
          'e.id as entryId',
          'e.batchId',
          'e.itemId',
          'e.status',
          'e.source',
          'e.participantId',
          'e.currentRevisionId',
          'e.currentReviewInstanceId',
          'e.currentRecognitionId',
          'bp.userId as subjectUserId',
        ])
        .where('e.tenantId', '=', tenantId)
        .where('e.id', '=', entryId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) => {
        if (row === undefined) return null
        const one = row as Record<string, unknown>
        return {
          entryId: String(one['entryId']),
          batchId: String(one['batchId']),
          itemId: String(one['itemId']),
          status: String(one['status']),
          source: String(one['source']),
          participantId: String(one['participantId']),
          revisionId: one['currentRevisionId'] === null ? null : String(one['currentRevisionId']),
          currentReviewInstanceId:
            one['currentReviewInstanceId'] === null ? null : String(one['currentReviewInstanceId']),
          currentRecognitionId:
            one['currentRecognitionId'] === null ? null : String(one['currentRecognitionId']),
          subjectUserId: String(one['subjectUserId']),
        }
      }),
    )

/** who wrote one filing: the other half of not reviewing your own work */
export const revisionAuthorOf = (tenantId: string, revisionId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevision')
        .select(['actorId'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', revisionId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row === undefined ? null : { actorId: String(row.actorId) })))

/** how one round came to exist, for walking a chain of re-routes */
export const instanceLineageOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select(['supersedesInstanceId', 'appealedInstanceId', 'origin'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', instanceId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row ?? null))

/**
 * What one round determined, as the fact it wrote.
 *
 * The round's own determination, not the claim's current one: an appeal
 * inherits the decision it contests even if something later moved the
 * claim's pointer elsewhere.
 */
export const recognitionOfInstance = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRecognition')
        .select(['values'])
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row === undefined ? null : (row.values ?? null))))

/** the determination an open sitting has already frozen, if it has */
export const lockedProposalOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewPanel')
        .select(['recognitionPayload', 'recognitionHash'])
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .where('state', '=', 'open')
        .where('recognitionLockedAt', 'is not', null)
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined || (row as { recognitionHash: string | null }).recognitionHash === null
          ? null
          : {
              values:
                (row as { recognitionPayload: Record<string, unknown> }).recognitionPayload ?? {},
              hash: String((row as { recognitionHash: string }).recognitionHash),
            },
      ),
    )

/**
 * One filing's evidence, and the form it was written against.
 *
 * Both, because a determination seeded from it has to read the material the
 * way the round reads it: a filing written under an older form is carried
 * forward to the current one when it is submitted, and seeding from the raw
 * older payload would answer a different question than the reviewer is
 * looking at.
 */
export const revisionPayloadOf = (tenantId: string, revisionId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevision')
        .select(['payload', 'itemRevisionId'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', revisionId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? { payload: {}, itemRevisionId: null }
          : {
              payload: (row as { payload: unknown }).payload,
              itemRevisionId: String((row as { itemRevisionId: string }).itemRevisionId),
            },
      ),
    )

/**
 * Freeze what a sitting is voting on, if nobody has yet.
 *
 * The first ballot decides the text: three reviewers approving three
 * different determinations is not a decision anybody could act on. Written
 * with the lock condition in the statement, so two ballots racing produce
 * one frozen proposal rather than two.
 */
export const lockPanelRecognition = (input: {
  tenantId: string
  panelId: string
  values: Record<string, unknown>
  hash: string
  /** why it differs from what the sitting inherited, when it does */
  reason: string | null
}) =>
  db.query((k) =>
    k
      .updateTable('ReviewPanel')
      .set({
        recognitionPayload: sql`${JSON.stringify(input.values)}::jsonb`,
        recognitionHash: input.hash,
        recognitionReason: input.reason,
        recognitionLockedAt: sql`now()`,
      })
      .where('tenantId', '=', input.tenantId)
      .where('id', '=', input.panelId)
      .where('recognitionLockedAt', 'is', null)
      .execute(),
  )

/** what an open sitting has frozen, read inside the transaction that votes */
export const panelRecognitionOf = (tenantId: string, panelId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewPanel')
        .select(['recognitionPayload', 'recognitionHash', 'recognitionReason'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', panelId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined || (row as { recognitionHash: string | null }).recognitionHash === null
          ? null
          : {
              values:
                (row as { recognitionPayload: Record<string, unknown> }).recognitionPayload ?? {},
              hash: String((row as { recognitionHash: string }).recognitionHash),
              // the sitting's own explanation, carried to the word that ends
              // the round: "why provincial rather than national" is the part
              // of a determination a later reader actually needs
              reason: (row as { recognitionReason: string | null }).recognitionReason,
            },
      ),
    )

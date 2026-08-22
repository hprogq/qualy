import { Effect } from 'effect'
import { nearestRoleNode, reviewersAt } from './db.ts'

// The two routes of one item revision, resolved against one participant's
// frozen lineage (§14, §32.62). Both are resolved once, when a round opens,
// and snapshotted: what a round walks must not change under it because
// somebody edited the question or the organization moved afterwards.
//
// A stage resolves to a unit or to nothing. `roleAt` looks outward for the
// nearest unit of a named kind and reads the roles anchored exactly there;
// `nearestRole` looks outward for the nearest holder of one role, wherever
// they sit, which is what a counsellor-shaped role means. A stage that
// resolves to nothing is recorded as skipped with its reason and the route
// goes on - a level this person has no unit of cannot judge them, and the
// round is still well defined without it.
//
// The ordinary route and the escalation route are two lists that share
// nothing. They were one list with a marker in it, the stages past the marker
// being where an escalation went; that made the ordinary route a prefix of
// the other, which is not what either of them means. Escalating now leaves
// the ordinary route entirely, and an appeal opens on the escalation route
// without ever walking the ordinary one.
//
// Escalating is what this is: the reviewer standing here cannot settle it, so
// the matter goes to whoever can. It is not a finding about the person who
// filed it, which is what the word it replaced kept implying.

export type ReviewRoute = 'normal' | 'escalation'

export const REVIEW_ROUTES: readonly ReviewRoute[] = ['normal', 'escalation']

export interface PolicyStage {
  /**
   * This step's permanent name. Kept across edits so an in-flight round can
   * be told whether the step it is standing at still exists in a newer
   * policy - which is what decides whether it can carry on from where it is
   * or has to start over. Positions cannot answer that: inserting a step
   * ahead of the current one would silently move every round back a level.
   */
  readonly id: string
  /**
   * What the administrator calls this step - "班委初审", "辅导员终审" - for
   * every screen that walks the route. Optional because policies written
   * before names existed stay readable; the unit-and-roles composite is the
   * fallback, never the preferred spelling.
   */
  readonly label?: string
  readonly selector:
    | { readonly kind: 'roleAt'; readonly nodeTypeId: string; readonly roleIds: readonly string[] }
    | { readonly kind: 'nearestRole'; readonly roleId: string }
  /**
   * How many of the step's holders one judgment takes: `any` is one person
   * answering for the step, `all` is a panel of everyone eligible when the
   * round arrives (escalation middle steps only - see the validator).
   * `atLeast` is named by the grammar and still refused.
   */
  readonly quorum: { readonly type: 'any' | 'all' | 'atLeast'; readonly count?: number }
}

export interface ReviewPolicy {
  /** what a submission walks: approval at the last step counts it */
  readonly normal: readonly PolicyStage[]
  /** where an escalation goes, and the only route an appeal ever walks */
  readonly escalation: readonly PolicyStage[]
}

/** one stage as the round froze it: where it landed, or why it did not */
export interface ResolvedStage {
  readonly id: string
  /** the administrator's name for the step; null on policies written before names */
  readonly label: string | null
  readonly route: ReviewRoute
  /** where it sits in its own route, for reading the route back in order */
  readonly index: number
  readonly selector: PolicyStage['selector']
  readonly quorum: PolicyStage['quorum']
  readonly roleIds: readonly string[]
  readonly nodeId: string | null
  readonly skipped: 'no-such-level' | 'no-holder' | null
}

/** whether a round arriving at this stage sits a panel rather than one judge */
export const isPanelStage = (stage: ResolvedStage): boolean => stage.quorum.type === 'all'

export interface ResolvedPolicy {
  readonly normal: readonly ResolvedStage[]
  readonly escalation: readonly ResolvedStage[]
}

export const stageRoles = (selector: PolicyStage['selector']): readonly string[] =>
  selector.kind === 'roleAt' ? selector.roleIds : [selector.roleId]

/**
 * The name a step written before names had one answers to.
 *
 * Derived from its position in the single list that policy was: the one
 * thing that identified it then, and the same derivation the round rows were
 * backfilled with, so a round standing at step 2 of a legacy policy still
 * finds step 2 when the policy is read back.
 */
export const legacyStageId = (flatIndex: number): string => `legacy-${flatIndex}`

interface LegacyPolicy {
  /** the one list with a marker in it, before the routes were two */
  stages?: readonly (Omit<PolicyStage, 'id'> & { id?: string })[]
  normalTerminal?: number
  /** the escalation route while it was still called the doubt route */
  doubt?: { stages?: unknown }
}

/**
 * The stored configuration as two routes, whichever version wrote it.
 *
 * A policy written as one list with `normalTerminal` in it is read as the
 * split it always described: everything up to and including the marker is
 * the ordinary route, everything after it is the escalation route. One
 * written while that route was called `doubt` is read under its new name.
 * Nothing is rewritten - an item revision is immutable, and the reading is
 * stable, so the same stored bytes give the same two routes every time.
 */
/** whether a stored policy says "no review at all", explicitly */
export const policyModeOf = (stored: unknown): 'none' | 'workflow' =>
  typeof stored === 'object' && stored !== null && (stored as { mode?: unknown }).mode === 'none'
    ? 'none'
    : 'workflow'

export const readPolicy = (stored: unknown): ReviewPolicy => {
  if (typeof stored !== 'object' || stored === null) return { normal: [], escalation: [] }
  const held = stored as {
    normal?: { stages?: unknown }
    escalation?: { stages?: unknown }
  } & LegacyPolicy
  const other = held.escalation ?? held.doubt
  if (held.normal !== undefined || other !== undefined) {
    return {
      normal: Array.isArray(held.normal?.stages) ? (held.normal.stages as PolicyStage[]) : [],
      escalation: Array.isArray(other?.stages) ? (other.stages as PolicyStage[]) : [],
    }
  }
  const stages = Array.isArray(held.stages) ? held.stages : []
  const terminal = typeof held.normalTerminal === 'number' ? held.normalTerminal : 0
  const named = stages.map((stage, index) => ({ ...stage, id: stage.id ?? legacyStageId(index) }))
  return { normal: named.slice(0, terminal + 1), escalation: named.slice(terminal + 1) }
}

interface LegacyResolved {
  stages?: readonly (Omit<ResolvedStage, 'id' | 'label' | 'route'> & {
    id?: string
    label?: string | null
    route?: string
  })[]
  normalTerminal?: number
  /** rounds frozen while the escalation route was called the doubt route */
  doubt?: unknown
}

/** a round's frozen routes, read the same way, whichever names they were frozen under */
export const readResolved = (stored: unknown): ResolvedPolicy => {
  if (typeof stored !== 'object' || stored === null) return { normal: [], escalation: [] }
  const held = stored as { normal?: unknown; escalation?: unknown } & LegacyResolved
  const other = Array.isArray(held.escalation) ? held.escalation : held.doubt
  if (Array.isArray(held.normal) || Array.isArray(other)) {
    return {
      normal: Array.isArray(held.normal) ? renamed(held.normal) : [],
      escalation: Array.isArray(other) ? renamed(other) : [],
    }
  }
  const stages = Array.isArray(held.stages) ? held.stages : []
  const terminal = typeof held.normalTerminal === 'number' ? held.normalTerminal : 0
  const named = stages.map((stage, index): ResolvedStage => ({
    ...stage,
    id: stage.id ?? legacyStageId(index),
    label: stage.label ?? null,
    route: index > terminal ? 'escalation' : 'normal',
    index: index > terminal ? index - terminal - 1 : index,
  }))
  return {
    normal: named.filter((stage) => stage.route === 'normal'),
    escalation: named.filter((stage) => stage.route === 'escalation'),
  }
}

/** stages frozen under the old route name, answering to the new one */
const renamed = (stages: readonly unknown[]): readonly ResolvedStage[] =>
  stages.map((stage) => {
    const one = stage as Omit<ResolvedStage, 'route'> & { route: string }
    return {
      ...one,
      // rounds frozen before steps had names read back nameless
      label: one.label ?? null,
      route: one.route === 'normal' ? 'normal' : 'escalation',
    }
  })

const resolveRoute = (input: {
  tenantId: string
  batchId: string
  route: ReviewRoute
  stages: readonly PolicyStage[]
  lineage: readonly { nodeId: string; nodeTypeId: string }[]
}) =>
  Effect.gen(function* () {
    const resolved: ResolvedStage[] = []
    for (const [index, stage] of input.stages.entries()) {
      const roleIds = stageRoles(stage.selector)
      const label =
        typeof stage.label === 'string' && stage.label.trim() !== '' ? stage.label.trim() : null
      const common = {
        id: stage.id,
        label,
        route: input.route,
        index,
        selector: stage.selector,
        quorum: stage.quorum,
        roleIds,
      }
      if (stage.selector.kind === 'roleAt') {
        const nodeTypeId = stage.selector.nodeTypeId
        const step = input.lineage.find((candidate) => candidate.nodeTypeId === nodeTypeId)
        resolved.push({
          ...common,
          nodeId: step?.nodeId ?? null,
          skipped: step === undefined ? 'no-such-level' : null,
        })
        continue
      }
      const nodeId = yield* nearestRoleNode({
        tenantId: input.tenantId,
        batchId: input.batchId,
        roleId: stage.selector.roleId,
        lineage: input.lineage,
      })
      resolved.push({
        ...common,
        nodeId,
        // this selector finds a person rather than a level, so nothing found
        // means nobody holds the role anywhere above this participant
        skipped: nodeId === null ? 'no-holder' : null,
      })
    }
    return resolved as readonly ResolvedStage[]
  })

/**
 * Both routes, resolved once against this person's frozen lineage.
 *
 * The escalation route is resolved up front with the ordinary one, even
 * though most rounds never touch it: escalating must not re-resolve an
 * organization that has moved since the round opened (§14).
 */
export const resolvePolicy = (input: {
  tenantId: string
  batchId: string
  policy: ReviewPolicy
  lineage: readonly { nodeId: string; nodeTypeId: string }[]
}) =>
  Effect.gen(function* () {
    const normal = yield* resolveRoute({ ...input, route: 'normal', stages: input.policy.normal })
    const escalation = yield* resolveRoute({
      ...input,
      route: 'escalation',
      stages: input.policy.escalation,
    })
    return { normal, escalation } satisfies ResolvedPolicy
  })

export const routeOf = (policy: ResolvedPolicy, route: ReviewRoute): readonly ResolvedStage[] =>
  route === 'normal' ? policy.normal : policy.escalation

/** the stage a round is standing at, by the name it was recorded under */
export const stageById = (
  policy: ResolvedPolicy,
  route: ReviewRoute,
  stageId: string,
): ResolvedStage | null => routeOf(policy, route).find((stage) => stage.id === stageId) ?? null

/**
 * The first stage of a route a round can actually stand at, from `from`
 * onward: the first one that resolved to a unit. Stages that resolved to
 * nothing are stepped over rather than blocking - they are levels this
 * participant does not sit under.
 */
export const enterableFrom = (
  policy: ResolvedPolicy,
  route: ReviewRoute,
  from: number,
): ResolvedStage | null => {
  for (const stage of routeOf(policy, route)) {
    if (stage.index >= from && stage.nodeId !== null) return stage
  }
  return null
}

/** the next stage of the same route after this one, or nothing */
export const nextAfter = (policy: ResolvedPolicy, stage: ResolvedStage): ResolvedStage | null =>
  enterableFrom(policy, stage.route, stage.index + 1)

/** whether a round standing here has reached the end of its own route */
export const isRouteEnd = (policy: ResolvedPolicy, stage: ResolvedStage): boolean =>
  nextAfter(policy, stage) === null

/** whether escalating is possible at all: there is a route to escalate onto */
export const escalationOpen = (policy: ResolvedPolicy): boolean =>
  enterableFrom(policy, 'escalation', 0) !== null

/** who could act at one resolved stage today, excluding the filing's own people */
export const holdersOf = (input: {
  tenantId: string
  batchId: string
  stage: ResolvedStage
  subjectUserId: string
  actorId: string
}) =>
  input.stage.nodeId === null
    ? Effect.succeed([] as readonly string[])
    : reviewersAt({
        tenantId: input.tenantId,
        batchId: input.batchId,
        nodeId: input.stage.nodeId,
        roleIds: input.stage.roleIds,
        subjectUserId: input.subjectUserId,
        actorId: input.actorId,
      })

/** a subject nobody is, for asking about a stage rather than about a filing */
export const NOBODY = '00000000-0000-0000-0000-000000000000'

/**
 * What a round arriving at one specific stage finds (§32.66).
 *
 * Two questions in order, because their answers mean different things.
 * Membership - does anybody hold this step's roles here, accepted and all -
 * decides whether the step is staffed at all; a step with nobody is a
 * configuration gap the patrol owns (`no-assignee`), never something to
 * step over. Eligibility then takes out the filing's own people and, on an
 * escalation step, whoever already judged an earlier step of this round; a
 * staffed step where nobody eligible remains is a conflict doing its job
 * (`no-independent-reviewer`), which a route MAY step over where something
 * comes after it.
 */
export interface StageArrival {
  readonly state: 'active' | 'blocked'
  readonly blockedReason: 'no-assignee' | 'no-independent-reviewer' | null
  /** who can act, when anybody can: the panel constitution where one is due */
  readonly eligible: readonly string[]
}

/**
 * Membership answers already given, for a caller arriving at the same step
 * over and over inside one transaction.
 *
 * Membership is a question about a step - the batch, the unit, the roles -
 * and nothing a caller does between two arrivals changes it, so a hundred
 * rounds landing on one step asked the same authorization query a hundred
 * times. Eligibility is never memoized: it is about the filing, and differs
 * per round. The patrol keeps its own copy of this bargain for the same
 * reason.
 *
 * Scoped to one caller's run and thrown away with it: held any longer it
 * would be a cache of who may review, and appointing somebody has to take
 * effect at once.
 */
export interface StageStaffing {
  readonly answers: Map<string, readonly string[]>
}

export const stageStaffing = (): StageStaffing => ({ answers: new Map() })

export const stageArrival = (input: {
  tenantId: string
  batchId: string
  stage: ResolvedStage
  subjectUserId: string
  actorId: string
  /** apply same-round independence against this round's earlier judges */
  excludeJudgedOfInstanceId?: string
  /** membership answers to reuse across arrivals at the same step */
  staffing?: StageStaffing
}) =>
  Effect.gen(function* () {
    if (input.stage.nodeId === null) {
      return { state: 'blocked', blockedReason: 'no-assignee', eligible: [] } as const
    }
    const at = {
      tenantId: input.tenantId,
      batchId: input.batchId,
      nodeId: input.stage.nodeId,
      roleIds: input.stage.roleIds,
    }
    const key = `${input.batchId}:${input.stage.nodeId}:${[...input.stage.roleIds].sort().join(',')}`
    const known = input.staffing?.answers.get(key)
    const members = known ?? (yield* reviewersAt({ ...at, subjectUserId: NOBODY, actorId: NOBODY }))
    if (known === undefined) input.staffing?.answers.set(key, members)
    if (members.length === 0) {
      return { state: 'blocked', blockedReason: 'no-assignee', eligible: [] } as const
    }
    const eligible = yield* reviewersAt({
      ...at,
      subjectUserId: input.subjectUserId,
      actorId: input.actorId,
      ...(input.excludeJudgedOfInstanceId === undefined
        ? {}
        : { excludeJudgedOfInstanceId: input.excludeJudgedOfInstanceId }),
    })
    if (eligible.length === 0) {
      return { state: 'blocked', blockedReason: 'no-independent-reviewer', eligible: [] } as const
    }
    return { state: 'active', blockedReason: null, eligible } as const
  })

/** where a route entering from `from` actually lands, and what it stepped over */
export interface RouteArrival extends StageArrival {
  readonly stage: ResolvedStage
  /** staffed steps stepped over because only conflicted people held them */
  readonly skipped: readonly ResolvedStage[]
}

/**
 * Walks a route from `from` to the first step the round can stand at.
 *
 * `conflictSkip` is the escalation route's rule (§32.66): a middle step
 * whose every holder already judged this round is stepped over - the
 * conflict is the system's own doing and the route still has judges - while
 * a genuinely unstaffed step always blocks, because somebody configured
 * that duty and nobody is doing it. The ordinary route never skips: it
 * resolves people live, and blocked there means blocked.
 */
export const resolveArrival = (input: {
  tenantId: string
  batchId: string
  policy: ResolvedPolicy
  route: ReviewRoute
  from: number
  subjectUserId: string
  actorId: string
  excludeJudgedOfInstanceId?: string
  conflictSkip: boolean
}) =>
  Effect.gen(function* () {
    const skipped: ResolvedStage[] = []
    let at = input.from
    for (;;) {
      const stage = enterableFrom(input.policy, input.route, at)
      if (stage === null) return null
      const arrival = yield* stageArrival({
        tenantId: input.tenantId,
        batchId: input.batchId,
        stage,
        subjectUserId: input.subjectUserId,
        actorId: input.actorId,
        ...(input.excludeJudgedOfInstanceId === undefined
          ? {}
          : { excludeJudgedOfInstanceId: input.excludeJudgedOfInstanceId }),
      })
      if (
        arrival.state === 'blocked' &&
        arrival.blockedReason === 'no-independent-reviewer' &&
        input.conflictSkip &&
        enterableFrom(input.policy, input.route, stage.index + 1) !== null
      ) {
        skipped.push(stage)
        at = stage.index + 1
        continue
      }
      return { stage, ...arrival, skipped }
    }
  })

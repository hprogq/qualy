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
// The ordinary route and the doubt route are two lists that share nothing.
// They were one list with a marker in it, the stages past the marker being
// the doubt chain; that made the ordinary route a prefix of the doubt route,
// which is not what either of them means. Raising a doubt now leaves the
// ordinary route entirely, and an appeal opens on the doubt route without
// ever walking the ordinary one.

export type ReviewRoute = 'normal' | 'doubt'

export const REVIEW_ROUTES: readonly ReviewRoute[] = ['normal', 'doubt']

export interface PolicyStage {
  /**
   * This step's permanent name. Kept across edits so an in-flight round can
   * be told whether the step it is standing at still exists in a newer
   * policy - which is what decides whether it can carry on from where it is
   * or has to start over. Positions cannot answer that: inserting a step
   * ahead of the current one would silently move every round back a level.
   */
  readonly id: string
  readonly selector:
    | { readonly kind: 'roleAt'; readonly nodeTypeId: string; readonly roleIds: readonly string[] }
    | { readonly kind: 'nearestRole'; readonly roleId: string }
  readonly quorum: { readonly type: 'any' | 'all' | 'atLeast'; readonly count?: number }
}

export interface ReviewPolicy {
  /** what a submission walks: approval at the last step counts it */
  readonly normal: readonly PolicyStage[]
  /** where a doubt goes, and the only route an appeal ever walks */
  readonly doubt: readonly PolicyStage[]
}

/** one stage as the round froze it: where it landed, or why it did not */
export interface ResolvedStage {
  readonly id: string
  readonly route: ReviewRoute
  /** where it sits in its own route, for reading the route back in order */
  readonly index: number
  readonly selector: PolicyStage['selector']
  readonly quorum: PolicyStage['quorum']
  readonly roleIds: readonly string[]
  readonly nodeId: string | null
  readonly skipped: 'no-such-level' | 'no-holder' | null
}

export interface ResolvedPolicy {
  readonly normal: readonly ResolvedStage[]
  readonly doubt: readonly ResolvedStage[]
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
  stages?: readonly (Omit<PolicyStage, 'id'> & { id?: string })[]
  normalTerminal?: number
}

/**
 * The stored configuration as two routes, whichever version wrote it.
 *
 * A policy written as one list with `normalTerminal` in it is read as the
 * split it always described: everything up to and including the marker is
 * the ordinary route, everything after it is the doubt route. Nothing is
 * rewritten - an item revision is immutable, and the reading is stable, so
 * the same stored bytes give the same two routes every time.
 */
export const readPolicy = (stored: unknown): ReviewPolicy => {
  if (typeof stored !== 'object' || stored === null) return { normal: [], doubt: [] }
  const held = stored as {
    normal?: { stages?: unknown }
    doubt?: { stages?: unknown }
  } & LegacyPolicy
  if (held.normal !== undefined || held.doubt !== undefined) {
    return {
      normal: Array.isArray(held.normal?.stages) ? (held.normal.stages as PolicyStage[]) : [],
      doubt: Array.isArray(held.doubt?.stages) ? (held.doubt.stages as PolicyStage[]) : [],
    }
  }
  const stages = Array.isArray(held.stages) ? held.stages : []
  const terminal = typeof held.normalTerminal === 'number' ? held.normalTerminal : 0
  const named = stages.map((stage, index) => ({ ...stage, id: stage.id ?? legacyStageId(index) }))
  return { normal: named.slice(0, terminal + 1), doubt: named.slice(terminal + 1) }
}

interface LegacyResolved {
  stages?: readonly (Omit<ResolvedStage, 'id' | 'route'> & {
    id?: string
    route?: ReviewRoute
  })[]
  normalTerminal?: number
}

/** a round's frozen routes, read the same way, for rounds opened before the split */
export const readResolved = (stored: unknown): ResolvedPolicy => {
  if (typeof stored !== 'object' || stored === null) return { normal: [], doubt: [] }
  const held = stored as { normal?: unknown; doubt?: unknown } & LegacyResolved
  if (Array.isArray(held.normal) || Array.isArray(held.doubt)) {
    return {
      normal: Array.isArray(held.normal) ? (held.normal as readonly ResolvedStage[]) : [],
      doubt: Array.isArray(held.doubt) ? (held.doubt as readonly ResolvedStage[]) : [],
    }
  }
  const stages = Array.isArray(held.stages) ? held.stages : []
  const terminal = typeof held.normalTerminal === 'number' ? held.normalTerminal : 0
  const named = stages.map((stage, index): ResolvedStage => ({
    ...stage,
    id: stage.id ?? legacyStageId(index),
    route: index > terminal ? 'doubt' : 'normal',
    index: index > terminal ? index - terminal - 1 : index,
  }))
  return {
    normal: named.filter((stage) => stage.route === 'normal'),
    doubt: named.filter((stage) => stage.route === 'doubt'),
  }
}

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
      const common = {
        id: stage.id,
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
 * The doubt route is resolved up front with the ordinary one, even though
 * most rounds never touch it: raising a doubt must not re-resolve an
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
    const doubt = yield* resolveRoute({ ...input, route: 'doubt', stages: input.policy.doubt })
    return { normal, doubt } satisfies ResolvedPolicy
  })

export const routeOf = (policy: ResolvedPolicy, route: ReviewRoute): readonly ResolvedStage[] =>
  route === 'normal' ? policy.normal : policy.doubt

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

/** whether a doubt can still be raised: there is a route to raise it onto */
export const doubtOpen = (policy: ResolvedPolicy): boolean =>
  enterableFrom(policy, 'doubt', 0) !== null

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

import { Effect } from 'effect'
import { nearestRoleNode, reviewersAt } from './db.ts'

// The chain of one item revision, resolved against one participant's frozen
// lineage (§14). The whole chain is resolved once, when a round opens, and
// snapshotted: what a round walks must not change under it because somebody
// edited the question or the organization moved afterwards.
//
// A stage resolves to a unit or to nothing. `roleAt` looks outward for the
// nearest unit of a named kind and reads the roles anchored exactly there;
// `nearestRole` looks outward for the nearest holder of one role, wherever
// they sit, which is what a counsellor-shaped role means. A stage that
// resolves to nothing is recorded as skipped with its reason and the chain
// goes on - a level this person has no unit of cannot judge them, and the
// round is still well defined without it.

export interface PolicyStage {
  readonly selector:
    | { readonly kind: 'roleAt'; readonly nodeTypeId: string; readonly roleIds: readonly string[] }
    | { readonly kind: 'nearestRole'; readonly roleId: string }
  readonly quorum: { readonly type: 'any' | 'all' | 'atLeast'; readonly count?: number }
}

export interface ReviewPolicy {
  readonly stages: readonly PolicyStage[]
  readonly normalTerminal: number
}

/** one stage as the round froze it: where it landed, or why it did not */
export interface ResolvedStage {
  readonly index: number
  readonly selector: PolicyStage['selector']
  readonly quorum: PolicyStage['quorum']
  readonly roleIds: readonly string[]
  readonly nodeId: string | null
  readonly skipped: 'no-such-level' | 'no-holder' | null
}

export interface ResolvedChain {
  readonly stages: readonly ResolvedStage[]
  readonly normalTerminal: number
}

export const stageRoles = (selector: PolicyStage['selector']): readonly string[] =>
  selector.kind === 'roleAt' ? selector.roleIds : [selector.roleId]

/**
 * Resolves every stage against the lineage, in order. Reading the whole
 * chain at once is deliberate: the doubt stages beyond the ordinary terminal
 * are part of the same list, and an escalation must not have to re-resolve a
 * chain the organization has since changed.
 */
export const resolveChain = (input: {
  tenantId: string
  batchId: string
  policy: ReviewPolicy
  lineage: readonly { nodeId: string; nodeTypeId: string }[]
}) =>
  Effect.gen(function* () {
    const stages: ResolvedStage[] = []
    for (const [index, stage] of input.policy.stages.entries()) {
      const roleIds = stageRoles(stage.selector)
      if (stage.selector.kind === 'roleAt') {
        const nodeTypeId = stage.selector.nodeTypeId
        const step = input.lineage.find((candidate) => candidate.nodeTypeId === nodeTypeId)
        stages.push({
          index,
          selector: stage.selector,
          quorum: stage.quorum,
          roleIds,
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
      stages.push({
        index,
        selector: stage.selector,
        quorum: stage.quorum,
        roleIds,
        nodeId,
        // this selector finds a person rather than a level, so nothing found
        // means nobody holds the role anywhere above this participant
        skipped: nodeId === null ? 'no-holder' : null,
      })
    }
    return { stages, normalTerminal: input.policy.normalTerminal } satisfies ResolvedChain
  })

/**
 * The next stage a round can stand at, from `from` onward: the first one
 * that resolved to a unit. Stages that resolved to nothing are stepped over
 * rather than blocking the round - they are levels this participant does not
 * sit under.
 */
export const stageAt = (chain: ResolvedChain, from: number): ResolvedStage | null => {
  for (let index = from; index < chain.stages.length; index += 1) {
    const stage = chain.stages[index]!
    if (stage.nodeId !== null) return stage
  }
  return null
}

/** whether a round standing here has reached the end of the ordinary flow */
export const isTerminal = (chain: ResolvedChain, index: number): boolean =>
  stageAt(chain, index + 1) === null || index >= chain.normalTerminal

/** the last stage of the whole chain, where an escalated round can end */
export const isChainEnd = (chain: ResolvedChain, index: number): boolean =>
  stageAt(chain, index + 1) === null

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

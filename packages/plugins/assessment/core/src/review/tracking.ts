import { Effect } from 'effect'
import { db } from '../server/db.ts'
import { chainNames, livePanelSeats, openPanelOf } from './db.ts'
import { isPanelStage, stageArrival, stageStaffing, type ResolvedPolicy } from './chain.ts'

export interface ReviewRouteStage {
  readonly id: string
  readonly route: 'normal' | 'escalation'
  readonly label: string | null
  readonly nodeName: string | null
  readonly roleNames: readonly string[]
  readonly current: boolean
  readonly skipped: string | null
  readonly blockedReason: string | null
  readonly reviewers: readonly {
    readonly id: string
    readonly name: string
    readonly businessNo: string | null
  }[]
}

/** The same live membership, independence and panel seats used when a round advances. */
export const readReviewRoutes = (input: {
  readonly tenantId: string
  readonly batchId: string
  readonly policy: ResolvedPolicy
  readonly subjectUserId: string
  readonly actorId: string
  readonly current?: {
    readonly instanceId: string
    readonly route: 'normal' | 'escalation'
    readonly stageId: string
  }
}) =>
  Effect.gen(function* () {
    const configured = [...input.policy.normal, ...input.policy.escalation]
    const cursor = input.current
    const stages =
      cursor === undefined
        ? configured
        : configured.filter((stage) => stage.route === cursor.route && stage.id === cursor.stageId)
    const names = yield* chainNames({
      tenantId: input.tenantId,
      nodeIds: stages.flatMap((stage) => (stage.nodeId === null ? [] : [stage.nodeId])),
      roleIds: stages.flatMap((stage) => stage.roleIds),
    })
    const staffing = stageStaffing()
    const resolved = yield* Effect.forEach(stages, (stage) =>
      Effect.gen(function* () {
        const arrival = yield* stageArrival({
          ...input,
          stage,
          staffing,
          ...(input.current === undefined || stage.route !== 'escalation'
            ? {}
            : { excludeJudgedOfInstanceId: input.current.instanceId }),
        })
        const current = input.current?.route === stage.route && input.current.stageId === stage.id
        let eligible = arrival.eligible
        if (current && isPanelStage(stage)) {
          const panel = yield* openPanelOf(input.tenantId, input.current.instanceId, {
            route: stage.route,
            stageId: stage.id,
          })
          if (panel !== null) {
            const pending = (yield* livePanelSeats(input.tenantId, panel.id)).filter(
              (seat) => seat.voted === null,
            )
            eligible = eligible.filter((id) => pending.some((seat) => seat.userId === id))
          }
        }
        return { stage, current, eligible, blockedReason: arrival.blockedReason }
      }),
    )
    const ids = [...new Set(resolved.flatMap((one) => one.eligible))]
    const people =
      ids.length === 0
        ? []
        : yield* db.query((query) =>
            query
              .selectFrom('User')
              .select(['id', 'displayName', 'businessNo'])
              .where('tenantId', '=', input.tenantId)
              .where('id', 'in', ids)
              .orderBy('displayName')
              .execute(),
          )
    const peopleById = new Map(
      people.map((person) => [
        person.id,
        { id: person.id, name: person.displayName, businessNo: person.businessNo },
      ]),
    )
    return resolved.map(({ stage, current, eligible, blockedReason }): ReviewRouteStage => ({
      id: stage.id,
      route: stage.route,
      label: stage.label,
      nodeName: stage.nodeId === null ? null : (names.nodes.get(stage.nodeId) ?? null),
      roleNames: stage.roleIds.map((id) => names.roles.get(id) ?? id),
      current,
      skipped: stage.skipped,
      blockedReason: stage.skipped === null ? blockedReason : null,
      reviewers: eligible.flatMap((id) => {
        const person = peopleById.get(id)
        return person === undefined ? [] : [person]
      }),
    }))
  })

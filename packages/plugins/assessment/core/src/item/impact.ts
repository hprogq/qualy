import { createHash } from 'node:crypto'
import { readPolicy, readResolved, type ReviewRoute } from '../review/chain.ts'
import type { LiveEntryRow, OpenRoundRow } from './db.ts'

// What a configuration change would do to work already under way, and the
// vocabulary an administrator answers with (§32.62).
//
// The old rule was a hard gate: if the new form could not read one live
// entry, the save was refused and the only way forward was void-and-replace.
// That refused edits which cost nobody anything - reordering fields, deleting
// one, adding an optional one - and it left the genuinely disruptive edits
// with no way to say what should happen to the work in flight.
//
// So a save that would disturb something comes back with this instead: what
// it would disturb, counted, and a token saying which state was counted.
// The administrator answers, the save runs again with the answer, and the
// answer is checked against a freshly counted state before anything moves.

export type FormEffect = 'keep' | 'return'
export type ReviewEffect = 'keep' | 'reroute-blocked' | 'reroute-all'
/** what to do with a round whose current step is not in the new policy */
export type OrphanEffect = 'refuse' | 'restart-route'

export interface ChangeEffects {
  readonly impactToken: string
  readonly form?: { readonly inReview: FormEffect; readonly approved: FormEffect }
  readonly review?: {
    readonly open: ReviewEffect
    readonly missingCurrentStage: OrphanEffect
    /** where migrated rounds land; absent means their current step */
    readonly landing?: 'current-stage' | 'route-start'
  }
}

export interface ChangeImpact {
  /** what the caller must state it is editing, so two administrators cannot both */
  readonly currentRevisionId: string | null
  readonly impactToken: string
  readonly form: {
    readonly changed: boolean
    readonly inReview: { readonly total: number; readonly incompatible: number }
    readonly approved: { readonly total: number; readonly incompatible: number }
  }
  readonly review: {
    readonly changed: boolean
    readonly open: number
    readonly blocked: number
    /** rounds whose current step is in the new policy and can be resumed there */
    readonly sameStageMappable: number
    /** rounds whose current step the new policy no longer has */
    readonly stageRemoved: number
    /**
     * Mappable rounds whose walked-so-far differs under the new policy:
     * the steps before their current one are not the steps they actually
     * passed. Continuing from the current step never re-runs those, and an
     * administrator who just inserted one deserves to know it will not run.
     */
    readonly pastChanged: number
  }
}

/** which entries this change would leave the form unable to read */
export interface Incompatible {
  readonly entryId: string
  readonly status: 'in_review' | 'approved'
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The state the report was counted from, as one word.
 *
 * The dialog is open for as long as an administrator thinks, and reviewers
 * keep working while they do. Executing an answer against a state that has
 * moved would perform something nobody read: the token is what makes the
 * second pass notice.
 */
export const impactTokenOf = (input: {
  currentRevisionId: string | null
  live: readonly LiveEntryRow[]
  rounds: readonly OpenRoundRow[]
}): string => {
  const lines = [
    `revision:${input.currentRevisionId ?? ''}`,
    ...[...input.live]
      .map((row) => `entry:${row.entryId}:${row.status}:${row.entryRevisionId}`)
      .sort(),
    ...[...input.rounds]
      .map((row) => `round:${row.id}:${row.state}:${row.route}:${row.stageId}`)
      .sort(),
  ]
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 32)
}

/**
 * Whether a step a round is standing at survives into the new policy, and
 * whether the participant it was resolved for can stand there.
 *
 * Only identity answers this. Positions cannot: a step inserted ahead of the
 * current one would move every round back a level, silently.
 */
export const stageSurvives = (nextPolicy: unknown, route: ReviewRoute, stageId: string): boolean =>
  readPolicy(nextPolicy)[route].some((stage) => stage.id === stageId)

/** the step ids a route walks before one step, in order */
const prefixBefore = (ids: readonly string[], stageId: string): readonly string[] => {
  const at = ids.indexOf(stageId)
  return at === -1 ? ids : ids.slice(0, at)
}

/**
 * Whether a round's walked-so-far still reads the same under the new
 * policy: the step-id sequence before its current step, in its own frozen
 * route, against the same sequence in the new one. Identity again, never
 * position - reordering B and C changes the past even though both survive.
 */
export const pastSurvives = (
  round: { effectiveChain: unknown; route: ReviewRoute; stageId: string },
  nextPolicy: unknown,
): boolean => {
  const walked = prefixBefore(
    readResolved(round.effectiveChain)[round.route].map((stage) => stage.id),
    round.stageId,
  )
  const ahead = prefixBefore(
    readPolicy(nextPolicy)[round.route].map((stage) => stage.id),
    round.stageId,
  )
  return walked.length === ahead.length && walked.every((id, index) => id === ahead[index])
}

export const impactOf = (input: {
  currentRevisionId: string | null
  currentConfig: { formConfig: unknown; reviewPolicy: unknown } | null
  nextConfig: { formConfig: unknown; reviewPolicy: unknown }
  live: readonly LiveEntryRow[]
  rounds: readonly OpenRoundRow[]
  incompatible: readonly Incompatible[]
}): ChangeImpact => {
  const formChanged =
    input.currentConfig === null ||
    !sameJson(input.currentConfig.formConfig, input.nextConfig.formConfig)
  const reviewChanged =
    input.currentConfig === null ||
    !sameJson(input.currentConfig.reviewPolicy, input.nextConfig.reviewPolicy)
  const of = (status: 'in_review' | 'approved') => ({
    total: input.live.filter((row) => row.status === status).length,
    incompatible: input.incompatible.filter((row) => row.status === status).length,
  })
  const survives = (round: OpenRoundRow) =>
    stageSurvives(input.nextConfig.reviewPolicy, round.route, round.stageId)
  return {
    currentRevisionId: input.currentRevisionId,
    impactToken: impactTokenOf(input),
    form: { changed: formChanged, inReview: of('in_review'), approved: of('approved') },
    review: {
      changed: reviewChanged,
      open: input.rounds.length,
      blocked: input.rounds.filter((round) => round.state === 'blocked').length,
      sameStageMappable: reviewChanged ? input.rounds.filter(survives).length : 0,
      stageRemoved: reviewChanged ? input.rounds.filter((round) => !survives(round)).length : 0,
      pastChanged: reviewChanged
        ? input.rounds.filter(
            (round) => survives(round) && !pastSurvives(round, input.nextConfig.reviewPolicy),
          ).length
        : 0,
    },
  }
}

/**
 * Whether this change is one an administrator has to answer for.
 *
 * A form edit nothing trips over, or a policy edit with nothing in flight,
 * disturbs nobody and needs no dialog. Two separate questions, never one:
 * "what happens to the answers" and "what happens to the reviews" have
 * different right answers and merging them would force a guess on one of
 * them.
 */
export const decisionNeeded = (impact: ChangeImpact) => ({
  form:
    impact.form.changed &&
    impact.form.inReview.incompatible + impact.form.approved.incompatible > 0,
  review: impact.review.changed && impact.review.open > 0,
})

/** what an answer left unstated, if anything */
export const missingDecisions = (
  impact: ChangeImpact,
  effects: ChangeEffects | undefined,
): boolean => {
  const needed = decisionNeeded(impact)
  if (!needed.form && !needed.review) return false
  if (effects === undefined) return true
  if (needed.form && effects.form === undefined) return true
  if (needed.review && effects.review === undefined) return true
  return false
}

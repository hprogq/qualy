import { createHash } from 'node:crypto'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import { readPolicy, readResolved, type ReviewRoute } from '../review/chain.ts'
import type { ScoringPlan } from '../scoring/plan.ts'
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
  readonly scoring: ScoringImpact
}

/**
 * What the candidate arithmetic makes of what already stands determined.
 *
 * Counted by actually running it: every determination in force is scored
 * under the current rule and under the candidate, and the two amounts are
 * compared exactly. `changed` says whether the trial was owed at all - the
 * arithmetic a determination meets on its own moved - and the rest is
 * what the trial found. A determination the candidate refuses, or cannot
 * compute, is one the save may not make unscorable; an amount that
 * differs is one the administrator is told about. Nothing here models
 * how amounts fold into a subtotal: that is the aggregator's, and it
 * never sees a single determination.
 */
export interface ScoringImpact {
  readonly changed: boolean
  readonly approved: {
    readonly total: number
    /** scored under both rules, so the two amounts could be compared */
    readonly comparable: number
    readonly amountChanged: number
    /** the candidate rule refused these values */
    readonly refused: number
    /** the candidate program failed to compute them */
    readonly executionFailed: number
  }
  /** a granted question's own amount, tried the same way; null for a filed one */
  readonly derived: null | {
    readonly comparable: boolean
    readonly amountChanged: boolean
    readonly refused: boolean
    readonly executionFailed: boolean
  }
}

/** the trial nobody owed: the arithmetic a determination meets did not move */
export const unchangedScoring = (approvedTotal: number): ScoringImpact => ({
  changed: false,
  approved: {
    total: approvedTotal,
    comparable: 0,
    amountChanged: 0,
    refused: 0,
    executionFailed: 0,
  },
  derived: null,
})

/** which entries this change would leave the form unable to read */
export interface Incompatible {
  readonly entryId: string
  readonly status: 'in_review' | 'approved'
}

/**
 * Whether two configurations say the same thing.
 *
 * jsonb hands objects back with their keys re-sorted, and a browser sends
 * them in the order they were written, so a plain stringify called every
 * save a change - and every save of a running question opened a dialog
 * about work it would not have touched. Arrays keep their order, which is
 * meaning here: stage order and field order are the configuration.
 */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const sameJson = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null)

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
  live: readonly Pick<LiveEntryRow, 'entryId' | 'status' | 'entryRevisionId' | 'recognitionId'>[]
  rounds: readonly Pick<OpenRoundRow, 'id' | 'state' | 'route' | 'stageId'>[]
  /** which candidate the report was drawn for; see `candidateImpactHashOf` */
  candidateImpactHash: string
}): string => {
  const lines = [
    `revision:${input.currentRevisionId ?? ''}`,
    `candidate:${input.candidateImpactHash}`,
    // the determination too, not only the filing: a claim re-judged while
    // the dialog was open stands recognised as something else now, and a
    // confirmation given against the old answer would be carried out against
    // the new one
    ...[...input.live]
      .map(
        (row) =>
          `entry:${row.entryId}:${row.status}:${row.entryRevisionId}:${row.recognitionId ?? ''}`,
      )
      .sort(),
    ...[...input.rounds]
      .map((row) => `round:${row.id}:${row.state}:${row.route}:${row.stageId}`)
      .sort(),
  ]
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 32)
}

/**
 * Which candidate a report is about, so an answer is carried out only
 * against the configuration it was given for.
 *
 * The token used to bind the state a report was counted from and nothing
 * about the candidate: a screen could ask about one configuration and
 * confirm another. What it binds now is the administrator's own intent as
 * they keep re-sending it - the form, the policy, and the scoring
 * language BEFORE it is normalized, where a new recognition still goes by
 * the handle the screen gave it. The stored form would not do: identities
 * are minted afresh on every request until one is saved, so two requests
 * carrying the same draft would never agree. The calculator's resolved
 * contract comes along beside the intent, because the same intent can
 * resolve to a different program once the runtime behind it moves - and
 * that contract carries no minted identity.
 */
export const candidateImpactHashOf = (input: {
  formConfig: unknown
  reviewPolicy: unknown
  /** the scoring configuration exactly as submitted, handles and all */
  scoringIntent: unknown
  /** what the intent resolved to; null when it did not compile */
  calculatorContract: ScoringPlan['calculator'] | null
}): string =>
  hashCanonicalJson({
    formConfig: input.formConfig ?? null,
    reviewPolicy: input.reviewPolicy ?? null,
    scoringIntent: input.scoringIntent ?? null,
    calculatorContract: input.calculatorContract,
  })

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
  candidateImpactHash: string
  scoring: ScoringImpact
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
    scoring: input.scoring,
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
  // an acknowledgement rather than a choice: the amounts will change, and
  // there is nothing to pick - the current rule is the only rule there is
  // (assessment-design §32.62), so being told is the whole decision
  scoring:
    impact.scoring.changed &&
    (impact.scoring.approved.amountChanged > 0 || impact.scoring.derived?.amountChanged === true),
})

/** what an answer left unstated, if anything */
export const missingDecisions = (
  impact: ChangeImpact,
  effects: ChangeEffects | undefined,
): boolean => {
  const needed = decisionNeeded(impact)
  if (!needed.form && !needed.review && !needed.scoring) return false
  // the scoring acknowledgement is given by answering at all: a second
  // submission carrying the token has read the report
  if (effects === undefined) return true
  if (needed.form && effects.form === undefined) return true
  if (needed.review && effects.review === undefined) return true
  return false
}

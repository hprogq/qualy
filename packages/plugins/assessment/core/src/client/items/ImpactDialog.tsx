import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { FormDialog, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// What this save would do to work already under way, and the two questions
// an administrator answers about it.
//
// Two, never one. "What happens to the answers already filed" and "what
// happens to the reviews already running" have different right answers, and
// a single "apply the new configuration" would force a guess on whichever
// one was not being thought about.

const styles = stylex.create({
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  formQuestions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  reviewQuestions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  pastChangedNote: {
    fontSize: 12,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  scoring: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  scoringTitle: {
    fontSize: 13,
    fontWeight: 600,
  },
  scoringRows: {
    display: 'grid',
    gridTemplateColumns: 'auto max-content',
    columnGap: 16,
    rowGap: 4,
    fontSize: 13,
  },
  scoringCount: {
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'end',
  },
})

export interface ChangeImpact {
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
    readonly sameStageMappable: number
    readonly stageRemoved: number
    /** mappable rounds whose walked-so-far differs under the new policy */
    readonly pastChanged: number
  }
  /** what the new arithmetic makes of the determinations in force; read-only */
  readonly scoring: {
    readonly changed: boolean
    readonly approved: {
      readonly total: number
      readonly comparable: number
      readonly amountChanged: number
      readonly refused: number
      readonly executionFailed: number
      readonly baselineFailed: number
    }
    readonly derived: null | {
      readonly comparable: boolean
      readonly amountChanged: boolean
      readonly refused: boolean
      readonly executionFailed: boolean
      readonly baselineFailed: boolean
    }
  }
}

export interface ChangeEffects {
  impactToken: string
  form?: { inReview: 'keep' | 'return'; approved: 'keep' | 'return' }
  review?: {
    open: 'keep' | 'reroute-blocked' | 'reroute-all'
    missingCurrentStage: 'refuse' | 'restart-route'
    landing?: 'current-stage' | 'route-start'
  }
}

/** whether either question is actually being asked of this change */
const asking = (impact: ChangeImpact) => ({
  form:
    impact.form.changed &&
    impact.form.inReview.incompatible + impact.form.approved.incompatible > 0,
  review: impact.review.changed && impact.review.open > 0,
  // told, not asked: the amounts will change and there is nothing to pick.
  // Determinations the rule in force cannot score at all are told here too -
  // the same screen, and the person reading it is the one editing that rule.
  scoring:
    impact.scoring.changed &&
    (impact.scoring.approved.amountChanged > 0 ||
      impact.scoring.derived?.amountChanged === true ||
      impact.scoring.approved.baselineFailed > 0 ||
      impact.scoring.derived?.baselineFailed === true),
})

export function ImpactDialog({
  open,
  impact,
  busy,
  onConfirm,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  impact: ChangeImpact
  busy: boolean
  onConfirm: (effects: ChangeEffects) => void
  onClose: () => void
}) {
  const [inReview, setInReview] = useState<'keep' | 'return'>('keep')
  const [approved, setApproved] = useState<'keep' | 'return'>('keep')
  const [rounds, setRounds] = useState<'keep' | 'reroute-blocked' | 'reroute-all'>(
    impact.review.blocked > 0 ? 'reroute-blocked' : 'keep',
  )
  // where migrated rounds land: at the step they stand at, or back at the
  // start of their own route for a full re-review under the new policy
  const [landing, setLanding] = useState<'current-stage' | 'route-start'>('current-stage')
  // and separately, what happens to a round whose step the new policy no
  // longer has: guessing is exactly what step identities exist to prevent,
  // so the administrator says - stay on the old process, or start the route
  // over on the new one
  const [orphans, setOrphans] = useState<'refuse' | 'restart-route'>('refuse')
  const asked = asking(impact)

  return (
    <FormDialog
      open={open}
      size="wide"
      title={m.items_impactTitle()}
      description={m.items_impactHint()}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_cancel()}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              onConfirm({
                impactToken: impact.impactToken,
                ...(asked.form ? { form: { inReview, approved } } : {}),
                ...(asked.review
                  ? {
                      review: {
                        open: rounds,
                        landing,
                        missingCurrentStage: landing === 'route-start' ? 'restart-route' : orphans,
                      },
                    }
                  : {}),
              })
            }
          >
            {m.entry_save()}
          </Button>
        </div>
      }
    >
      <div {...stylex.props(styles.column)}>
        {asked.scoring && (
          <section
            {...stylex.props(styles.scoring)}
            data-testid="impact-scoring"
            data-approved={impact.scoring.approved.total}
            data-comparable={impact.scoring.approved.comparable}
            data-amount-changed={impact.scoring.approved.amountChanged}
            data-derived-changed={impact.scoring.derived?.amountChanged === true ? 'true' : 'false'}
            data-baseline-failed={impact.scoring.approved.baselineFailed}
          >
            <p {...stylex.props(styles.scoringTitle)}>{m.items_impactScoringTitle()}</p>
            {impact.scoring.approved.total > 0 && (
              <dl {...stylex.props(styles.scoringRows)}>
                <dt>{m.items_impactScoringApproved()}</dt>
                <dd {...stylex.props(styles.scoringCount)}>{impact.scoring.approved.total}</dd>
                <dt>{m.items_impactScoringComparable()}</dt>
                <dd {...stylex.props(styles.scoringCount)}>{impact.scoring.approved.comparable}</dd>
                <dt>{m.items_impactScoringAmountChanged()}</dt>
                <dd {...stylex.props(styles.scoringCount)}>
                  {impact.scoring.approved.amountChanged}
                </dd>
              </dl>
            )}
            {impact.scoring.derived?.amountChanged === true && (
              <p {...stylex.props(styles.pastChangedNote)}>{m.items_impactScoringDerived()}</p>
            )}
            {impact.scoring.approved.baselineFailed > 0 && (
              <p {...stylex.props(styles.pastChangedNote)} data-testid="impact-scoring-stuck">
                {m.items_impactScoringStuck({
                  count: impact.scoring.approved.baselineFailed,
                })}
              </p>
            )}
            <p {...stylex.props(styles.pastChangedNote)}>{m.items_impactScoringNote()}</p>
          </section>
        )}
        {asked.form && (
          <div {...stylex.props(styles.formQuestions)}>
            {impact.form.inReview.incompatible > 0 && (
              <RadioGroup
                name="in-review"
                variant="cards"
                legend={m.items_impactInReview({
                  count: impact.form.inReview.incompatible,
                  total: impact.form.inReview.total,
                })}
                selected={inReview}
                onChange={(next) => setInReview(next as 'keep' | 'return')}
                options={[
                  { value: 'keep', label: m.items_impactKeepEntries() },
                  { value: 'return', label: m.items_impactReturnEntries() },
                ]}
              />
            )}
            {impact.form.approved.incompatible > 0 && (
              <RadioGroup
                name="approved"
                variant="cards"
                legend={m.items_impactApproved({
                  count: impact.form.approved.incompatible,
                  total: impact.form.approved.total,
                })}
                selected={approved}
                onChange={(next) => setApproved(next as 'keep' | 'return')}
                options={[
                  { value: 'keep', label: m.items_impactKeepApproved() },
                  { value: 'return', label: m.items_impactReturnEntries() },
                ]}
              />
            )}
          </div>
        )}

        {asked.review && (
          <div {...stylex.props(styles.reviewQuestions)}>
            <RadioGroup
              name="rounds"
              variant="cards"
              legend={m.items_impactRounds({
                open: impact.review.open,
                blocked: impact.review.blocked,
              })}
              selected={rounds}
              onChange={(next) => setRounds(next as 'keep' | 'reroute-blocked' | 'reroute-all')}
              options={[
                { value: 'keep', label: m.items_impactRoundsKeep() },
                { value: 'reroute-blocked', label: m.items_impactRoundsBlocked() },
                { value: 'reroute-all', label: m.items_impactRoundsAll() },
              ]}
            />
            {rounds !== 'keep' && (
              <RadioGroup
                name="landing"
                variant="cards"
                legend={m.items_impactLanding()}
                selected={landing}
                onChange={(next) => setLanding(next as 'current-stage' | 'route-start')}
                options={[
                  { value: 'current-stage', label: m.items_impactLandingContinue() },
                  { value: 'route-start', label: m.items_impactLandingRestart() },
                ]}
              />
            )}
            {/* the steps already walked will not run again - said out loud
                exactly when the new process disagrees about what they were */}
            {rounds !== 'keep' && landing === 'current-stage' && impact.review.pastChanged > 0 && (
              <p {...stylex.props(styles.pastChangedNote)}>
                {m.items_impactPastChanged({ count: impact.review.pastChanged })}
              </p>
            )}
            {rounds !== 'keep' && landing === 'current-stage' && impact.review.stageRemoved > 0 && (
              <RadioGroup
                name="orphans"
                variant="cards"
                legend={m.items_impactStageGone({ count: impact.review.stageRemoved })}
                selected={orphans}
                onChange={(next) => setOrphans(next as 'refuse' | 'restart-route')}
                options={[
                  { value: 'refuse', label: m.items_impactOrphanKeep() },
                  { value: 'restart-route', label: m.items_impactOrphanRestart() },
                ]}
              />
            )}
          </div>
        )}
      </div>
    </FormDialog>
  )
}

import { useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { FormDialog, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from '../i18n.ts'

// What this save would do to work already under way, and the two questions
// an administrator answers about it.
//
// Two, never one. "What happens to the answers already filed" and "what
// happens to the reviews already running" have different right answers, and
// a single "apply the new configuration" would force a guess on whichever
// one was not being thought about.

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
  const { format } = useI18n()
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
      title={format(m.itemsImpactTitle)}
      description={format(m.itemsImpactHint)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
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
            {format(m.entrySave)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {asked.form && (
          <div className="flex flex-col gap-4">
            {impact.form.inReview.incompatible > 0 && (
              <RadioGroup
                name="in-review"
                variant="cards"
                legend={format(m.itemsImpactInReview, {
                  count: impact.form.inReview.incompatible,
                  total: impact.form.inReview.total,
                })}
                selected={inReview}
                onChange={(next) => setInReview(next as 'keep' | 'return')}
                options={[
                  { value: 'keep', label: format(m.itemsImpactKeepEntries) },
                  { value: 'return', label: format(m.itemsImpactReturnEntries) },
                ]}
              />
            )}
            {impact.form.approved.incompatible > 0 && (
              <RadioGroup
                name="approved"
                variant="cards"
                legend={format(m.itemsImpactApproved, {
                  count: impact.form.approved.incompatible,
                  total: impact.form.approved.total,
                })}
                selected={approved}
                onChange={(next) => setApproved(next as 'keep' | 'return')}
                options={[
                  { value: 'keep', label: format(m.itemsImpactKeepApproved) },
                  { value: 'return', label: format(m.itemsImpactReturnEntries) },
                ]}
              />
            )}
          </div>
        )}

        {asked.review && (
          <div className="flex flex-col gap-2">
            <RadioGroup
              name="rounds"
              variant="cards"
              legend={format(m.itemsImpactRounds, {
                open: impact.review.open,
                blocked: impact.review.blocked,
              })}
              selected={rounds}
              onChange={(next) => setRounds(next as 'keep' | 'reroute-blocked' | 'reroute-all')}
              options={[
                { value: 'keep', label: format(m.itemsImpactRoundsKeep) },
                { value: 'reroute-blocked', label: format(m.itemsImpactRoundsBlocked) },
                { value: 'reroute-all', label: format(m.itemsImpactRoundsAll) },
              ]}
            />
            {rounds !== 'keep' && (
              <RadioGroup
                name="landing"
                variant="cards"
                legend={format(m.itemsImpactLanding)}
                selected={landing}
                onChange={(next) => setLanding(next as 'current-stage' | 'route-start')}
                options={[
                  { value: 'current-stage', label: format(m.itemsImpactLandingContinue) },
                  { value: 'route-start', label: format(m.itemsImpactLandingRestart) },
                ]}
              />
            )}
            {/* the steps already walked will not run again - said out loud
                exactly when the new process disagrees about what they were */}
            {rounds !== 'keep' && landing === 'current-stage' && impact.review.pastChanged > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {format(m.itemsImpactPastChanged, { count: impact.review.pastChanged })}
              </p>
            )}
            {rounds !== 'keep' && landing === 'current-stage' && impact.review.stageRemoved > 0 && (
              <RadioGroup
                name="orphans"
                variant="cards"
                legend={format(m.itemsImpactStageGone, { count: impact.review.stageRemoved })}
                selected={orphans}
                onChange={(next) => setOrphans(next as 'refuse' | 'restart-route')}
                options={[
                  { value: 'refuse', label: format(m.itemsImpactOrphanKeep) },
                  { value: 'restart-route', label: format(m.itemsImpactOrphanRestart) },
                ]}
              />
            )}
          </div>
        )}
      </div>
    </FormDialog>
  )
}

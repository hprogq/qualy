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
  }
}

export interface ChangeEffects {
  impactToken: string
  form?: { inReview: 'keep' | 'return'; approved: 'keep' | 'return' }
  review?: { open: 'keep' | 'reroute-blocked' | 'reroute-all'; missingCurrentStage: 'refuse' }
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
                  ? // a round whose step this policy no longer has is left
                    // where it is: guessing where it should land is exactly
                    // what step identities exist to prevent
                    { review: { open: rounds, missingCurrentStage: 'refuse' as const } }
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
            {impact.review.stageRemoved > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {format(m.itemsImpactStageGone, { count: impact.review.stageRemoved })}
              </p>
            )}
          </div>
        )}

        {asked.form && asked.review && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {format(m.itemsImpactOrder)}
          </p>
        )}
      </div>
    </FormDialog>
  )
}

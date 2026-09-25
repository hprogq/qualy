import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { ConfirmDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { entryRefusalReason } from './refusals.ts'
import { EntryDetail } from './EntryDetail.tsx'
import type { ActionAvailability, EntryDto, ItemDto } from './model.ts'
import { abandonConsequence } from './standing.ts'

/** what the owner is told giving a claim up takes with it */
const ABANDON_SAYS = {
  'contest-and-result': m.entryAbandonConfirmContestedCounted,
  contest: m.entryAbandonConfirmContested,
  result: m.entryAbandonConfirmDecided,
  claim: m.entryAbandonConfirm,
} as const

// The owner's drawer: their own claim, and the three things they may do to
// it. Everything above the buttons is `EntryDetail`, which the staff drawer
// shows too - one claim has one description, whoever is reading it.
//
// Every act here changes who holds the claim, so every one of them is a
// question first. The words differ because the consequences do.

const styles = stylex.create({
  spacer: { flexGrow: 1 },
  ghostInk: { color: tokens.mutedForeground },
  noPointer: {
    pointerEvents: 'none',
  },
})

export function EntrySheet({
  open,
  entry,
  item,
  resubmit,
  trail,
  busy,
  onClose,
  onEdit,
  onStatus,
  onAppeal,
  onSupplement,
}: {
  open: boolean
  entry: EntryDto
  item: ItemDto
  /**
   * The phase gate's word on submitting into this question at all,
   * independent of the claim's state. Withdrawing while it is shut is a
   * one-way door - the draft cannot be handed back in this phase - and the
   * confirm changes register accordingly.
   */
  resubmit: ActionAvailability | undefined
  /** the groups above the question, outermost first */
  trail: readonly string[]
  busy: boolean
  onClose: () => void
  onEdit: () => void
  /** the second argument is the question this drawer was showing, for submission */
  onStatus: (status: 'in_review' | 'draft' | 'voided', expectedItemRevisionId?: string) => void
  onAppeal: () => void
  onSupplement: () => void
}) {
  const { format } = useI18n()
  // which act is waiting on an answer; every one of them moves the claim
  const [asking, setAsking] = useState<'in_review' | 'draft' | 'voided' | null>(null)
  // withdrawing with submission shut is a one-way door; an absent word from
  // the server is not a shut one, so only an explicit refusal changes tone
  const oneWay = resubmit !== undefined && resubmit.state !== 'available'
  const declared = item.itemType === 'declaration'

  return (
    <>
      <EntryDetail
        open={open}
        entry={entry}
        item={item}
        trail={trail}
        onClose={onClose}
        onSupplement={onSupplement}
        footer={
          <>
            <Offered
              can={entry.capabilities.abandon}
              busy={busy}
              variant="ghost"
              xstyle={styles.ghostInk}
              label={format(m.entryAbandon)}
              onPress={() => setAsking('voided')}
            />
            <span {...stylex.props(styles.spacer)} />
            <Offered
              can={entry.capabilities.appeal}
              busy={busy}
              label={format(m.entryAppeal)}
              onPress={onAppeal}
            />
            <Offered
              can={entry.capabilities.withdraw}
              busy={busy}
              label={format(m.entryWithdraw)}
              onPress={() => setAsking('draft')}
            />
            {!declared && (
              <Offered
                can={entry.capabilities.edit}
                busy={busy}
                label={format(entry.status === 'draft' ? m.myEntriesResume : m.entryEdit)}
                onPress={onEdit}
              />
            )}
            <Offered
              can={entry.capabilities.submit}
              busy={busy}
              variant="default"
              label={format(entry.status === 'draft' ? m.entrySubmit : m.entryResubmit)}
              onPress={() => setAsking('in_review')}
            />
          </>
        }
      />

      {/* Every act here changes who holds the claim, so every one of them
            is a question first: handing it on, taking it back, and giving it
            up. The words differ because the consequences do, and giving up
            is the only one that cannot be undone. Taking it back while the
            phase has shut submission joins the irreversible ones: the draft
            it leaves behind cannot be handed in again until submitting
            reopens, and the confirm must say so before, not after. */}
      <ConfirmDialog
        open={asking !== null}
        tone={asking === 'voided' || (asking === 'draft' && oneWay) ? 'destructive' : 'default'}
        title={format(
          asking === 'voided'
            ? m.entryAbandonConfirmTitle
            : asking === 'draft'
              ? m.entryWithdrawConfirm
              : m.entrySubmitConfirm,
        )}
        description={format(
          asking === 'voided'
            ? ABANDON_SAYS[abandonConsequence(entry)]
            : asking === 'draft'
              ? oneWay
                ? m.entryWithdrawFinalHint
                : m.entryWithdrawConfirmHint
              : m.entrySubmitConfirmHint,
        )}
        confirmLabel={format(
          asking === 'voided'
            ? m.entryAbandon
            : asking === 'draft'
              ? m.entryWithdraw
              : entry.status === 'draft'
                ? m.entrySubmit
                : m.entryResubmit,
        )}
        cancelLabel={format(commonMessages.cancel)}
        pending={busy}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const act = asking
          setAsking(null)
          // Only handing it on is a decision about today's rules; taking
          // it back or giving it up are about the claim alone, and a
          // question that moved in the meantime does not change them.
          if (act === 'in_review') onStatus(act, item.currentRevision?.id)
          else if (act !== null) onStatus(act)
        }}
      />
    </>
  )
}

/**
 * One act on one claim, in whatever state the server offered it: a button,
 * a disabled button with the reason on hover, or nothing. The reason is the
 * refusal vocabulary the error catalog already speaks.
 */
function Offered({
  can,
  busy,
  label,
  variant = 'outline',
  xstyle,
  onPress,
}: {
  can: ActionAvailability
  busy: boolean
  label: string
  variant?: 'outline' | 'default' | 'ghost'
  xstyle?: stylex.StyleXStyles
  onPress: () => void
}) {
  const { format } = useI18n()
  if (can.state === 'hidden') return null
  const button = (
    <Button
      variant={variant}
      size="sm"
      disabled={busy || can.state === 'blocked'}
      className={stylex.props(can.state === 'blocked' && styles.noPointer, xstyle).className}
      onClick={onPress}
    >
      {label}
    </Button>
  )
  if (can.state === 'available') return button
  const why = can.reason === null ? null : entryRefusalReason(can.reason)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{button}</span>
        </TooltipTrigger>
        <TooltipContent>{format(why ?? m.entryBlockedNow)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

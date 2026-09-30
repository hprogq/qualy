import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ClockIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'

import { ConfirmDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import {
  holdOf,
  sayBlocked,
  sayHeld,
  type HeldAct,
  type Hold,
  type RoundState,
} from './refusals.ts'
import { useRound } from './own-acts.ts'
import { EntryDetail } from './EntryDetail.tsx'
import type { ActionAvailability, EntryDto, ItemDto } from './model.ts'
import { abandonConsequence } from './standing.ts'
import type { EntryLine } from './workspace/model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

/** what the owner is told giving a claim up takes with it */
const ABANDON_SAYS = {
  'appeal-and-result': m.entry_abandonConfirmContestedCounted,
  appeal: m.entry_abandonConfirmContested,
  'reopen-and-result': m.entry_abandonConfirmReopenedCounted,
  reopen: m.entry_abandonConfirmReopened,
  result: m.entry_abandonConfirmDecided,
  claim: m.entry_abandonConfirm,
} as const

// The owner's drawer: their own claim, and the three things they may do to
// it. Everything above the buttons is `EntryDetail`, which the staff drawer
// shows too - one claim has one description, whoever is reading it.
//
// Every act here changes who holds the claim, so every one of them is a
// question first. The words differ because the consequences do.

const styles = stylex.create({
  // what the stage holds, above the keys it greys: on a phone no hint on a
  // key can be reached, so the reason stands where the keys are
  bar: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 10,
  },
  keys: { display: 'flex', alignItems: 'center', gap: 8 },
  held: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
  heldIcon: { width: 14, height: 14, flexShrink: 0, marginTop: 2.5 },
  spacer: { flexGrow: 1 },
  ghostInk: { color: tokens.mutedForeground },
  noPointer: {
    pointerEvents: 'none',
  },
})

/** the owner's acts in the order a claim lives through them, for naming several at once */
const LIFE: readonly HeldAct[] = ['edit', 'submit', 'withdraw', 'abandon', 'appeal']

/** one reason the stage holds some of the acts on screen, and which */
interface HeldGroup {
  readonly key: string
  readonly hold: Hold
  readonly reason: string
  readonly acts: readonly HeldAct[]
}

/**
 * The acts on screen the stage holds, gathered by why: one stage usually
 * holds several at once, and is said once for all of them.
 */
const heldGroupsOf = (
  shown: ReadonlyMap<HeldAct, ActionAvailability>,
  round: RoundState | null,
): readonly HeldGroup[] => {
  const groups = new Map<string, { hold: Hold; reason: string; acts: HeldAct[] }>()
  for (const act of LIFE) {
    const can = shown.get(act)
    if (can?.state !== 'blocked') continue
    const hold = holdOf(can.reason, round)
    if (hold === null || can.reason === null) continue
    const key = hold.why === 'phase' ? `phase:${hold.phase}` : hold.why
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { hold, reason: can.reason, acts: [act] })
    else group.acts.push(act)
  }
  return [...groups].map(([key, group]) => ({ key, ...group }))
}

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
  summary,
  editLabel,
}: {
  open: boolean
  entry: EntryDto
  item: ItemDto
  /** how the claim reads in its list, heading the drawer */
  summary?: EntryLine
  /**
   * What the edit button says, where editing happens somewhere other than
   * the page the drawer is open on: the button names where it goes.
   */
  editLabel?: string
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
  const { locale } = useI18n()
  // the stage the round is in, for saying which one holds an act
  const round = useRound(entry.batchId)
  // which act is waiting on an answer; every one of them moves the claim
  const [asking, setAsking] = useState<'in_review' | 'draft' | 'voided' | null>(null)
  // withdrawing with submission shut is a one-way door; an absent word from
  // the server is not a shut one, so only an explicit refusal changes tone
  const oneWay = resubmit !== undefined && resubmit.state !== 'available'
  const declared = item.itemType === 'declaration'
  const returned = entry.status === 'needs_revision'
  // Sent back, the way on is to rewrite it and hand it in from the form. But
  // editing and submitting are two phase gates: where the phase has shut
  // editing and left submitting open, the form is not a way in, and handing
  // it in unchanged from here is the one press the server will take.
  const resubmitHere =
    !returned ||
    declared ||
    (entry.capabilities.edit.state !== 'available' &&
      entry.capabilities.submit.state === 'available')
  // the acts this footer draws, by what the server said of each
  const shown = new Map<HeldAct, ActionAvailability>([
    ['abandon', entry.capabilities.abandon],
    ['appeal', entry.capabilities.appeal],
    ['withdraw', entry.capabilities.withdraw],
    ...(declared ? [] : [['edit', entry.capabilities.edit] as const]),
    ...(resubmitHere ? [['submit', entry.capabilities.submit] as const] : []),
  ])
  const held = heldGroupsOf(shown, round)
  const words = { locale }

  return (
    <>
      <EntryDetail
        open={open}
        entry={entry}
        item={item}
        trail={trail}
        onClose={onClose}
        onSupplement={onSupplement}
        {...(summary === undefined ? {} : { summary })}
        footer={
          <div {...stylex.props(styles.bar)}>
            {held.map((group) => (
              <p
                key={group.key}
                data-testid="entry-held"
                data-why={group.hold.why}
                data-reason={group.reason}
                data-acts={group.acts.join(' ')}
                {...stylex.props(styles.held)}
              >
                <ClockIcon aria-hidden {...stylex.props(styles.heldIcon)} />
                {sayHeld(group.hold, group.acts, words)}
              </p>
            ))}
            <div {...stylex.props(styles.keys)}>
              <Offered
                act="abandon"
                round={round}
                can={entry.capabilities.abandon}
                busy={busy}
                variant="ghost"
                xstyle={styles.ghostInk}
                label={m.entry_abandon()}
                onPress={() => setAsking('voided')}
              />
              <span {...stylex.props(styles.spacer)} />
              <Offered
                act="appeal"
                round={round}
                can={entry.capabilities.appeal}
                busy={busy}
                label={m.entry_appeal()}
                onPress={onAppeal}
              />
              <Offered
                act="withdraw"
                round={round}
                can={entry.capabilities.withdraw}
                busy={busy}
                label={m.entry_withdraw()}
                onPress={() => setAsking('draft')}
              />
              {!declared && (
                <Offered
                  act="edit"
                  round={round}
                  can={entry.capabilities.edit}
                  busy={busy}
                  // sent back, rewriting it is the way on, and handing it in
                  // again happens from the form rather than straight from
                  // here, where it would go back unchanged
                  variant={returned && !resubmitHere ? 'default' : 'outline'}
                  label={editLabel ?? (entry.status === 'draft' ? m.entry_resume : m.entry_edit)()}
                  onPress={onEdit}
                />
              )}
              {resubmitHere && (
                <Offered
                  act="submit"
                  round={round}
                  can={entry.capabilities.submit}
                  busy={busy}
                  variant="default"
                  label={(entry.status === 'draft' ? m.entry_submit : m.entry_resubmit)()}
                  onPress={() => setAsking('in_review')}
                />
              )}
            </div>
          </div>
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
        title={(asking === 'voided'
          ? m.entry_abandonConfirmTitle
          : asking === 'draft'
            ? m.entry_withdrawConfirm
            : m.entry_submitConfirm)()}
        description={(asking === 'voided'
          ? ABANDON_SAYS[abandonConsequence(entry)]
          : asking === 'draft'
            ? oneWay
              ? m.entry_withdrawFinalHint
              : m.entry_withdrawConfirmHint
            : m.entry_submitConfirmHint)()}
        confirmLabel={(asking === 'voided'
          ? m.entry_abandon
          : asking === 'draft'
            ? m.entry_withdraw
            : entry.status === 'draft'
              ? m.entry_submit
              : m.entry_resubmit)()}
        cancelLabel={commonMessages.action_cancel()}
        pending={busy}
        {...(asking === 'voided'
          ? { descriptionData: { 'data-consequence': abandonConsequence(entry) } }
          : {})}
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
 * a disabled button with the reason on hover, or nothing. A stage holding
 * it is said with the act and the stage named; any other reason is the
 * refusal vocabulary the error catalog already speaks.
 */
function Offered({
  act,
  round,
  can,
  busy,
  label,
  variant = 'outline',
  xstyle,
  onPress,
}: {
  act: HeldAct
  round: RoundState | null
  can: ActionAvailability
  busy: boolean
  label: string
  variant?: 'outline' | 'default' | 'ghost'
  xstyle?: stylex.StyleXStyles
  onPress: () => void
}) {
  const { locale } = useI18n()
  if (can.state === 'hidden') return null
  const button = (
    <Button
      variant={variant}
      size="sm"
      data-act={act}
      data-gate={can.state}
      disabled={busy || can.state === 'blocked'}
      className={stylex.props(can.state === 'blocked' && styles.noPointer, xstyle).className}
      onClick={onPress}
    >
      {label}
    </Button>
  )
  if (can.state === 'available') return button
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} data-blocked={act} data-reason={can.reason ?? ''}>
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{sayBlocked(act, can.reason, round, { locale })}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

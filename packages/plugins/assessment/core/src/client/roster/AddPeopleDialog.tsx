import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ShieldQuestionIcon } from 'lucide-react'
import { UiSlot } from '@qualy/web-runtime'
import { peoplePickerView } from '@qualy/ui-contract'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'

import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'

import { DialogBlank } from '../DialogBlank.tsx'
import { AdmissionOutcome, type AdmissionOutcomeFacts } from './AdmissionOutcome.tsx'
import { useCandidates } from './candidates.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Adding people to the roster one at a time, or a dozen at a time.
//
// The drawing is the directory's - tree, search, kind, pages - but the
// people in it come from this round's own endpoint: the people this reader
// manages, which is exactly who the write admits. A round's administrator
// need not hold the directory's read permission, and before this the dialog
// told them they could see nobody. Nothing chosen here is authorized by
// having been chosen; the write proves every id again.

const styles = stylex.create({
  // A height of its own, which the picker grows into: a panel sized by what
  // it held left the list a band short of its own foot, and changed height
  // under the hand with every filter.
  panel: { height: 'min(90dvh, 48rem)' },
})

export function AddPeopleDialog({
  batchId,
  open,
  pending,
  outcome = null,
  onAdd,
  onReview,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  /**
   * What the people just added left the roster with, where that is worth
   * saying: the dialog then says it in place of the picker, and closes on
   * the reader's word.
   */
  outcome?: AdmissionOutcomeFacts | null
  onAdd: (userIds: readonly string[]) => void
  /** open the questions some of the people added cannot file */
  onReview?: () => void
  onClose: () => void
}) {
  const businessNo = useTerm(authTerms.businessNumber)
  const [chosen, setChosen] = useState<readonly string[]>([])
  useEffect(() => {
    if (open) setChosen([])
  }, [open])
  const candidates = useCandidates(batchId, open)

  if (outcome !== null) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent size="32rem" data-testid="add-people-outcome">
          <DialogHeader>
            <DialogTitle>{m.roster_addTitle()}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <AdmissionOutcome facts={outcome} {...(onReview === undefined ? {} : { onReview })} />
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>{m.roster_admittedDone()}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="68rem" xstyle={styles.panel}>
        <DialogHeader>
          <DialogTitle>{m.roster_addTitle()}</DialogTitle>
          <DialogDescription>{m.roster_addHint({ businessNo })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <UiSlot
            token={peoplePickerView}
            context={candidates.context({
              value: chosen,
              // somebody taking part already is shown, and cannot be added
              // twice; somebody taken off the roster can be let back in
              disabled: candidates.rows
                .filter((row) => row.roster === 'active')
                .map((row) => row.userId),
              disabledLabel: m.roster_addOnRoster(),
              onToggle: (userId: string) => {
                const row = candidates.rows.find((one) => one.userId === userId)
                if (row?.roster === 'active') return
                setChosen((now) =>
                  now.includes(userId) ? now.filter((id) => id !== userId) : [...now, userId],
                )
              },
              onChange: setChosen,
            })}
            fallback={
              <DialogBlank
                testId="add-people-unavailable"
                icon={<ShieldQuestionIcon />}
                title={m.roster_pickerUnavailable()}
                description={m.roster_pickerUnavailableHint()}
              />
            }
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_cancel()}
          </Button>
          <Button disabled={pending || chosen.length === 0} onClick={() => onAdd(chosen)}>
            {m.roster_addConfirm({ count: chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

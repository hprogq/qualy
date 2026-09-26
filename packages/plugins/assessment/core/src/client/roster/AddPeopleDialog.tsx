import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { UiSlot } from '@qualy/web-runtime'
import { peoplePickerView } from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
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
import { assessmentMessages as m } from '../i18n.ts'
import { useCandidates } from './candidates.ts'

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
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
})

export function AddPeopleDialog({
  batchId,
  open,
  pending,
  onAdd,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  onAdd: (userIds: readonly string[]) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const [chosen, setChosen] = useState<readonly string[]>([])
  useEffect(() => {
    if (open) setChosen([])
  }, [open])
  const candidates = useCandidates(batchId, open)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="60rem" xstyle={styles.panel}>
        <DialogHeader>
          <DialogTitle>{format(m.addPeopleTitle)}</DialogTitle>
          <DialogDescription>{format(m.addPeopleHint, { businessNo })}</DialogDescription>
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
              disabledLabel: format(m.addPeopleOnRoster),
              onToggle: (userId: string) => {
                const row = candidates.rows.find((one) => one.userId === userId)
                if (row?.roster === 'active') return
                setChosen((now) =>
                  now.includes(userId) ? now.filter((id) => id !== userId) : [...now, userId],
                )
              },
              onChange: setChosen,
            })}
            fallback={<p {...stylex.props(styles.quiet)}>{format(m.pickerUnavailable)}</p>}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={pending || chosen.length === 0} onClick={() => onAdd(chosen)}>
            {format(m.addPeopleConfirm, { count: chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

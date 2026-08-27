import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { UiSlot } from '@qualy/web-runtime'
import { peoplePicker } from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
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

// Adding people to the roster one at a time, or a dozen at a time.
//
// The picker belongs to whoever owns people: this screen says what it is for
// and what happens when it closes, and never learns which people the reader
// is allowed to find.

const styles = stylex.create({
  panel: { maxWidth: { default: null, '@media (min-width: 640px)': '56rem' } },
  body: { height: '58vh' },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
})

export function AddPeopleDialog({
  open,
  pending,
  onAdd,
  onClose,
}: {
  open: boolean
  pending: boolean
  onAdd: (userIds: readonly string[]) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  const [chosen, setChosen] = useState<readonly string[]>([])
  useEffect(() => {
    if (open) setChosen([])
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={stylex.props(styles.panel).className}>
        <DialogHeader>
          <DialogTitle>{format(m.addPeopleTitle)}</DialogTitle>
          <DialogDescription>{format(m.addPeopleHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          {/* a column, so the picker can be told to fill what is left */}
          <UiSlot
            token={peoplePicker}
            context={{ value: chosen, onChange: setChosen }}
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

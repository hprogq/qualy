import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Textarea } from '@qualy/ui/textarea'
import { assessmentMessages as m } from '../i18n.ts'

// Why a running round changed.
//
// The api refuses a scoring-semantic change on a live round without one, and
// the sentence is read later by people reconstructing why a result moved. It
// is asked at the moment of saving rather than parked in the form, where it
// reads as one more optional field and is filled in with a shrug.

const styles = stylex.create({
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
})

export function ReasonDialog({
  open,
  title,
  description,
  busy,
  onConfirm,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  title: string
  description: string
  busy: boolean
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  const [reason, setReason] = useState('')

  return (
    <FormDialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={busy || reason.trim() === ''} onClick={() => onConfirm(reason.trim())}>
            {format(m.entrySave)}
          </Button>
        </div>
      }
    >
      <Field label={format(m.itemsFieldReason)}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  )
}

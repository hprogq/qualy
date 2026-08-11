import { useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { assessmentMessages as m } from '../i18n.ts'

// Opening a finished batch again.
//
// Not an undo: the archive stands, and the phases that ran keep the intervals
// they ran in. What this asks for is what comes next - the period the batch is
// being opened for - and why, because reopening something that was formally
// finished is the one act nobody should be able to perform silently.
export function ReopenDialog({
  open,
  pending,
  onCancel,
  onReopen,
}: {
  open: boolean
  pending: boolean
  onCancel: () => void
  onReopen: (input: { reason: string; displayName: string }) => void
}) {
  const { format } = useI18n()
  const [reason, setReason] = useState('')
  const [displayName, setDisplayName] = useState('')
  const ready = reason.trim() !== '' && displayName.trim() !== ''

  return (
    <FormDialog
      open={open}
      title={format(m.reopenTitle)}
      description={format(m.reopenBody)}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {format(m.cancel)}
          </Button>
          <Button
            disabled={!ready || pending}
            onClick={() => onReopen({ reason: reason.trim(), displayName: displayName.trim() })}
          >
            {format(m.reopen)}
          </Button>
        </>
      }
    >
      <Field label={format(m.reopenReason)}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={reason}
            placeholder={format(m.reopenReasonPlaceholder)}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <Field label={format(m.reopenPhaseName)} hint={format(m.reopenPhaseHint)}>
        {(id) => (
          <Input
            id={id}
            value={displayName}
            placeholder={format(m.reopenPhasePlaceholder)}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  )
}

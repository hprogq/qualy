import { useState } from 'react'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import * as m from '#messages'

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
  const [reason, setReason] = useState('')
  const [displayName, setDisplayName] = useState('')
  const ready = reason.trim() !== '' && displayName.trim() !== ''

  return (
    <FormDialog
      open={open}
      title={m.action_reopenTitle()}
      description={m.action_reopenBody()}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {m.action_cancel()}
          </Button>
          <Button
            disabled={!ready || pending}
            onClick={() => onReopen({ reason: reason.trim(), displayName: displayName.trim() })}
          >
            {m.action_reopen()}
          </Button>
        </>
      }
    >
      <Field label={m.action_reopenReason()}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            maxLength={500}
            value={reason}
            placeholder={m.action_reopenReasonPlaceholder()}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <Field label={m.action_reopenPhase()} hint={m.action_reopenPhaseHint()}>
        {(id) => (
          <Input
            id={id}
            maxLength={100}
            value={displayName}
            placeholder={m.action_reopenPhasePlaceholder()}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  )
}

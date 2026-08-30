import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { entryRefusalMessage } from './refusals.ts'

// Saying a decision is wrong, without touching the material.
//
// The other way out of a rejection is to change what was filed and submit it
// again, and that one is a different button. A single "try again" would have
// to guess which of the two somebody meant, and it would guess wrong for
// whoever was sure.

const styles = stylex.create({
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
})

export function AppealDialog({
  open,
  entryId,
  onClose,
  onDone,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  /** the claim whose standing decision is being contested */
  entryId: string
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const send = useMutation({
    mutationFn: () =>
      run(
        api.assessment.appealEntry({
          params: { entryId },
          payload: { reason: reason.trim() },
        }),
      ),
    onMutate: () => setProblem(null),
    onSuccess: () => {
      toast.success(format(m.entryAppealed))
      onDone()
    },
    onError: (error: unknown) => {
      const refusal = entryRefusalMessage(error)
      setProblem(refusal === null ? formatError(error) : format(refusal))
    },
  })

  return (
    <FormDialog
      open={open}
      title={format(m.entryAppealTitle)}
      description={format(m.entryAppealHint)}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={send.isPending || reason.trim() === ''} onClick={() => send.mutate()}>
            {format(m.entryAppeal)}
          </Button>
        </div>
      }
    >
      <div {...stylex.props(styles.body)}>
        <Field label={format(m.entryAppealReason)}>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <Feedback message={problem} />
      </div>
    </FormDialog>
  )
}

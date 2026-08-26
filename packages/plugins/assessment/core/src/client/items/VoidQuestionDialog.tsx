import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { ItemDto } from '../entry/model.ts'

// Withdrawing a question from a running round: open work under it ends, and
// what was already decided keeps its outcome. The reason is required because
// everyone who filed under it reads it.

const styles = stylex.create({
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
})

export function VoidQuestionDialog({
  open,
  item,
  onClose,
  onDone,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  item: ItemDto
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [reason, setReason] = useState('')

  const act = useMutation({
    mutationFn: () =>
      run(
        api.assessment.setItemStatus({
          params: { itemId: item.id },
          payload: { status: 'voided', reason: reason.trim() },
        }),
      ),
    onSuccess: onDone,
    onError: (error) => toast.error(formatError(error)),
  })

  return (
    <FormDialog
      open={open}
      title={format(m.itemsVoidTitle)}
      description={format(m.itemsVoidHint)}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button
            variant="destructive"
            disabled={act.isPending || reason.trim() === ''}
            onClick={() => act.mutate()}
          >
            {format(m.itemsVoid)}
          </Button>
        </div>
      }
    >
      <Field label={format(m.itemsVoidReason)}>
        {(id) => (
          <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
        )}
      </Field>
    </FormDialog>
  )
}

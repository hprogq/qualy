import { scoringIncompatibleValues } from './scoring-refusals.ts'
import { assertNever } from '@qualy/web-i18n'
import { useApiMutation, useApi } from '@qualy/web-runtime'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'

import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'

import { type ItemDto } from '../entry/model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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

  const [reason, setReason] = useState('')

  const act = useApiMutation({
    mutationFn: () =>
      api.assessment.setItemStatus({
        params: { itemId: item.id },
        payload: { status: 'voided', reason: reason.trim() },
      }),
    onSuccess: onDone,
    onError: (error) => {
      switch (error._tag) {
        case 'ASSESSMENT_BATCH_READ_ONLY':
          toast.error(m.error_batchReadOnly())
          return
        case 'ASSESSMENT_ITEM_ACTION_REFUSED':
          toast.error(m.error_itemActionRefused())
          return
        case 'ASSESSMENT_ITEM_CONFIG_INVALID':
          toast.error(m.error_itemConfigInvalid())
          return
        case 'ASSESSMENT_ITEM_NOT_FOUND':
          toast.error(m.error_itemNotFound())
          return
        case 'ASSESSMENT_ITEM_REVISION_CONFLICT':
          toast.error(m.error_itemRevisionConflict())
          return
        case 'ASSESSMENT_ITEM_SCORING_INCOMPATIBLE':
          toast.error(m.error_itemScoringIncompatible(scoringIncompatibleValues(error)))
          return
        case 'ASSESSMENT_SCORING_UNAVAILABLE':
          toast.error(m.error_scoringUnavailable())
          return
        default:
          assertNever(error)
      }
    },
  })

  return (
    <FormDialog
      open={open}
      title={m.items_voidTitle()}
      description={m.items_voidHint()}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_cancel()}
          </Button>
          <Button
            variant="destructive"
            disabled={act.isPending || reason.trim() === ''}
            onClick={() => act.mutate()}
          >
            {m.items_void()}
          </Button>
        </div>
      }
    >
      <Field label={m.items_voidReason()} required>
        {(id, control) => (
          <Input
            id={id}
            {...control}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  )
}

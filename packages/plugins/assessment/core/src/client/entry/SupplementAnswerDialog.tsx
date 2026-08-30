import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Feedback, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EvidenceForm, type EvidenceFieldSpec, type EvidencePayload } from './EvidenceForm.tsx'
import { entryRefusalMessage } from './refusals.ts'
import type { EntryDto, EntrySupplementDto } from './model.ts'

// Answering the reviewer's ask. The filing itself stays exactly as it was -
// the answer travels beside it, on the round that asked - which is why this
// dialog draws the ask's own pieces and nothing of the original form.

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
  instructions: {
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
    paddingLeft: 10,
    fontSize: 14,
    lineHeight: 1.625,
  },
})

export function SupplementAnswerDialog({
  open,
  entry,
  supplement,
  onClose,
  onDone,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  entry: EntryDto
  supplement: EntrySupplementDto
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [payload, setPayload] = useState<EvidencePayload>({})
  const [problem, setProblem] = useState<string | null>(null)

  // the ask's pieces drawn by the same form the filing uses, so a file
  // answer uploads and previews exactly like one
  const fields: readonly EvidenceFieldSpec[] = supplement.requirements.map((asked) => ({
    key: asked.key,
    type: asked.kind === 'file' ? 'attachment' : 'text',
    label: asked.label,
    required: asked.required,
    ...(asked.kind === 'file' ? { maxCount: 10 } : { maxLength: 2000 }),
  }))

  const doors = {
    prepare: (input: {
      batchId: string
      itemId: string
      filename: string
      declaredMime: string
      size: string
    }) => run(api.assessment.prepareAttachmentUpload({ payload: input })),
    complete: (reservationId: string) =>
      run(api.assessment.completeAttachmentUpload({ params: { reservationId } })),
  }

  const send = useMutation({
    mutationFn: () =>
      run(
        api.assessment.answerSupplement({
          params: { requestId: supplement.requestId },
          payload: { payload },
        }),
      ),
    onMutate: () => setProblem(null),
    onSuccess: () => {
      toast.success(format(m.entrySupplementSent))
      onDone()
    },
    onError: (error: unknown) => {
      const refusal = entryRefusalMessage(error)
      setProblem(refusal === null ? formatError(error) : format(refusal))
    },
  })

  const [evidenceValid, setEvidenceValid] = useState(true)
  const ready = supplement.requirements.every((asked) => {
    if (!asked.required) return true
    const value = payload[asked.key]
    return asked.kind === 'file'
      ? Array.isArray(value) && value.length > 0
      : typeof value === 'string' && value.trim() !== ''
  })

  return (
    <FormDialog
      open={open}
      title={format(m.entrySupplementDialogTitle)}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={send.isPending || !ready || !evidenceValid} onClick={() => send.mutate()}>
            {format(m.entrySubmit)}
          </Button>
        </div>
      }
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.instructions)}>{supplement.instructions}</p>
        <EvidenceForm
          onValidityChange={setEvidenceValid}
          fields={fields}
          value={payload}
          onChange={setPayload}
          doors={doors}
          where={{ batchId: entry.batchId, itemId: entry.itemId }}
        />
        <Feedback message={problem} />
      </div>
    </FormDialog>
  )
}

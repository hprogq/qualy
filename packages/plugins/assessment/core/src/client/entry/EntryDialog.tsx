import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EvidenceForm, type EvidencePayload } from './EvidenceForm.tsx'
import { fieldsOf, type EntryDto, type ItemDto } from './model.ts'

// Filing or revising one claim. The form is whatever the administrator
// composed; the dialog only adds the note and carries the refusals back in
// the reader's language.

/** the payload refusals the driver can raise, as sentences about one field */
const ISSUE_SENTENCES: Record<string, MessageDescriptor> = {
  required: m.entryIssueRequired,
  'out-of-range': m.entryIssueOutOfRange,
  'not-a-date': m.entryIssueNotADate,
  'too-long': m.entryIssueTooLong,
  'too-many': m.entryIssueTooMany,
  'attachment-too-large': m.entryIssueFileTooLarge,
  'attachment-type': m.entryIssueFileType,
  'attachment-not-found': m.entryIssueFileMissing,
  'attachment-retired': m.entryIssueFileMissing,
  'attachment-not-yours': m.entryIssueFileNotYours,
  'attachment-cross-entry': m.entryIssueFileElsewhere,
  'duplicate-attachment': m.entryIssueFileElsewhere,
}

export function EntryDialog({
  batchId,
  materialRange,
  participantId,
  item,
  entry,
  onClose,
  onSaved,
}: {
  batchId: string
  /** the round's window, so a date picker cannot offer a day this round refuses */
  materialRange: { start: string; end: string }
  /** the caller's own membership row, from the my-entries read */
  participantId: string
  item: ItemDto
  entry: EntryDto | null
  onClose: () => void
  onSaved: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [payload, setPayload] = useState<EvidencePayload>(
    () => (entry?.currentRevision?.payload as EvidencePayload | null) ?? {},
  )
  const [note, setNote] = useState(entry?.currentRevision?.note ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [issues, setIssues] = useState<readonly { field: string; reason: string }[]>([])
  const labelOf = (key: string) => fields.find((field) => field.key === key)?.label ?? key

  const fields = fieldsOf(item.currentRevision?.formConfig)

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

  const save = useMutation({
    mutationFn: async () => {
      const body = { payload, ...(note.trim() === '' ? {} : { note: note.trim() }) }
      if (entry === null) {
        return run(
          api.assessment.createEntry({ payload: { itemId: item.id, participantId, ...body } }),
        )
      }
      return run(api.assessment.reviseEntry({ params: { entryId: entry.id }, payload: body }))
    },
    onMutate: () => {
      setProblem(null)
      setIssues([])
    },
    onSuccess: onSaved,
    onError: (error: unknown) => {
      const payload = error as { issues?: readonly { field: string; reason: string }[] }
      if (Array.isArray(payload.issues)) setIssues(payload.issues)
      setProblem(formatError(error))
    },
  })

  return (
    <FormDialog open title={item.title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <EvidenceForm
          fields={fields}
          value={payload}
          onChange={setPayload}
          doors={doors}
          where={{ batchId, itemId: item.id }}
          materialRange={materialRange}
        />
        <Field label={format(m.entryNote)}>
          {(id) => <Input id={id} value={note} onChange={(event) => setNote(event.target.value)} />}
        </Field>
        <Feedback message={problem} />
        {issues.length > 0 && (
          <ul className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {issues.map((issue, index) => (
              <li key={index}>
                {labelOf(issue.field)} {format(ISSUE_SENTENCES[issue.reason] ?? m.entryIssueOther)}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {format(m.entrySave)}
          </Button>
        </div>
      </div>
    </FormDialog>
  )
}

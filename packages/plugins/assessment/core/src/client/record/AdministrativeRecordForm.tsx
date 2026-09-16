import { useEffect, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { ValueFieldsForm } from '@qualy/web-value-form/InputValueForm'
import { draftsFromFields, materializeFields, type FieldDraft } from '@qualy/web-value-form/model'
import { applyAssignment, type AtomicSchema } from '@qualy/value-schema'
import { useI18n } from '@qualy/web-i18n'
import { Feedback, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EvidenceForm, type EvidencePayload } from '../entry/EvidenceForm.tsx'
import { fieldsOf, type ItemDto } from '../entry/model.ts'

// One administrative fact, written down.
//
// It takes effect the moment it is filed - no review round - which is
// exactly why the basis is required: a fact nobody can check is an
// assertion.
//
// The determination the office makes by filing it follows the material as it
// is typed - change the claimed level and the suggested determination moves
// with it - but only until the recorder touches a field: a value they wrote
// is their judgment, and the form stops second-guessing it. The mounting key
// upstream is the session identity (item revision + subject + attempt), so a
// different question, a different person, or the same pair after a filing
// all start from nothing.

const styles = stylex.create({
  recognition: { display: 'flex', flexDirection: 'column', gap: 10 },
  recognitionHead: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: tokens.surfaceMutedForeground,
  },
  foot: { display: 'flex', justifyContent: 'flex-end' },
})

/** the recognition contract as the wire serves it to this form */
export interface RecognitionWire {
  readonly itemRevisionId: string
  readonly fields: readonly { readonly id: string; readonly schema: unknown }[]
  readonly defaults: readonly {
    readonly recognitionId: string
    readonly payloadKey: string
    readonly assignment:
      | { readonly kind: 'direct' }
      | { readonly kind: 'convert'; readonly converter: 'integer-to-decimal@1' }
  }[]
}

export function AdministrativeRecordForm({
  session,
  batchId,
  materialRange,
  item,
  participantId,
  wire,
  onRecorded,
}: {
  /** item revision + subject + attempt; the caller remounts on any change */
  session: string
  batchId: string
  materialRange: { start: string; end: string }
  item: ItemDto
  participantId: string
  wire: RecognitionWire | null
  onRecorded: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError, locale } = useI18n()
  const [payload, setPayload] = useState<EvidencePayload>({})
  const [basis, setBasis] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [evidenceValid, setEvidenceValid] = useState(true)

  const fields = useMemo(
    () =>
      wire === null
        ? []
        : wire.fields.map((field) => ({ id: field.id, schema: field.schema as AtomicSchema })),
    [wire],
  )
  const [recognitionDrafts, setRecognitionDrafts] = useState<Record<string, FieldDraft>>({})
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())
  const seed = useMemo(() => {
    if (wire === null) return {}
    // recognition ids are opaque wire strings - `__proto__` is a legal one -
    // so the seed is built without a prototype and the payload is read as
    // own keys
    const said: Record<string, unknown> = Object.create(null)
    for (const one of wire.defaults) {
      const raw = Object.hasOwn(payload, one.payloadKey) ? payload[one.payloadKey] : undefined
      if (raw === undefined) continue
      // the one interpreter of a compiled assignment, shared with the
      // server's seeding and scoring - the client never invents a second one
      const carried = applyAssignment(one.assignment, raw)
      if (carried !== null && carried !== undefined) said[one.recognitionId] = carried
    }
    return said
  }, [wire, payload])
  useEffect(() => {
    // refresh what the recorder has not touched; keep what they have
    setRecognitionDrafts((current) => {
      const refreshed = draftsFromFields(fields, seed)
      const next: Record<string, FieldDraft> = Object.create(null)
      for (const field of fields) {
        const source = dirty.has(field.id) ? current : refreshed
        const kept = Object.hasOwn(source, field.id) ? source[field.id] : undefined
        if (kept !== undefined) next[field.id] = kept
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, seed])
  const materialized = useMemo(
    () => materializeFields(fields, recognitionDrafts),
    [fields, recognitionDrafts],
  )
  const recognitionReady = wire === null || materialized.value !== null

  const record = useMutation({
    mutationFn: () =>
      run(
        api.assessment.createEntry({
          payload: {
            itemId: item.id,
            participantId,
            payload,
            note: basis.trim(),
            ...(wire === null || materialized.value === null
              ? {}
              : { recognition: { values: materialized.value } }),
            // the form on screen is this item's current version; if it moved
            // while the record was being written, nothing is filed
            ...(item.currentRevision?.id === undefined
              ? {}
              : { expectedItemRevisionId: item.currentRevision.id }),
          },
        }),
      ),
    onSuccess: () => {
      toast.success(format(m.recordDone))
      onRecorded()
    },
    onError: (error) => setProblem(formatError(error)),
  })

  return (
    <>
      <EvidenceForm
        session={session}
        onValidityChange={setEvidenceValid}
        fields={fieldsOf(item.currentRevision?.formConfig)}
        value={payload}
        onChange={setPayload}
        doors={{
          prepare: (input) => run(api.assessment.prepareAttachmentUpload({ payload: input })),
          complete: (reservationId) =>
            run(api.assessment.completeAttachmentUpload({ params: { reservationId } })),
        }}
        where={{ batchId, itemId: item.id }}
        materialRange={materialRange}
      />
      {wire !== null && (
        <div {...stylex.props(styles.recognition)} data-testid="record-recognition">
          <p {...stylex.props(styles.recognitionHead)}>{format(m.recordRecognition)}</p>
          <ValueFieldsForm
            fields={fields}
            drafts={recognitionDrafts}
            onDraft={(id, draft) => {
              setDirty((current) => new Set(current).add(id))
              setRecognitionDrafts((current) => ({ ...current, [id]: draft }))
            }}
            locale={locale}
            scope="record"
          />
        </div>
      )}
      <Field label={format(m.recordBasis)} hint={format(m.recordBasisHint)}>
        {(id) => <Input id={id} value={basis} onChange={(event) => setBasis(event.target.value)} />}
      </Field>
      <Feedback message={problem} />
      <div {...stylex.props(styles.foot)}>
        <Button
          disabled={
            record.isPending ||
            participantId === '' ||
            basis.trim() === '' ||
            !evidenceValid ||
            !recognitionReady
          }
          onClick={() => record.mutate()}
        >
          {format(m.recordSubmit)}
        </Button>
      </div>
    </>
  )
}

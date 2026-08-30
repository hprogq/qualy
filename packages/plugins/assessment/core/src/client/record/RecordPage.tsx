import { useState, useEffect, useMemo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { ValueFieldsForm } from '@qualy/web-value-form/InputValueForm'
import { draftsFromFields, materializeFields, type FieldDraft } from '@qualy/web-value-form/model'
import { applyAssignment, type AtomicSchema } from '@qualy/value-schema'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { NativeSelect } from '@qualy/ui/native-select'
import { Input } from '@qualy/ui/input'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { entryRefusalMessage } from '../entry/refusals.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { EvidenceForm, type EvidencePayload } from '../entry/EvidenceForm.tsx'
import { fieldsOf, type ItemDto } from '../entry/model.ts'

// Recording an administrative fact about somebody. It takes effect the
// moment it is filed - no review round - which is exactly why the basis is
// required: a fact nobody can check is an assertion.

const styles = stylex.create({
  recognition: { display: 'flex', flexDirection: 'column', gap: 10 },
  recognitionHead: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--q-surface-muted-foreground)',
  },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  waiting: { height: 160, width: '100%' },
  form: { display: 'flex', maxWidth: '36rem', flexDirection: 'column', gap: 16 },
  foot: { display: 'flex', justifyContent: 'flex-end' },
})

export default function RecordPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.recordTab)} description={format(m.recordHint)}>
      {(batch) =>
        batch.capabilities.record ? (
          <Recorder batchId={batch.id} materialRange={batch.materialRange} />
        ) : (
          <p {...stylex.props(styles.quiet)}>{format(m.recordNoStanding)}</p>
        )
      }
    </BatchScreen>
  )
}

function Recorder({
  batchId,
  materialRange,
}: {
  batchId: string
  materialRange: { start: string; end: string }
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const roster = useQuery(
    query.assessment.listParticipants.queryOptions({ params: { batchId }, query: {} }),
  )
  const [itemId, setItemId] = useState('')
  const [participantId, setParticipantId] = useState('')
  // bumped on every successful record: the same question and the same
  // person again is a NEW sheet, never leftovers from the one just filed
  const [attempt, setAttempt] = useState(0)
  const contract = useQuery({
    ...query.assessment.getRecognitionContract.queryOptions({ params: { itemId } }),
    enabled: itemId !== '',
  })
  const wire = contract.data?.contract ?? null

  const administrative = ((items.data?.items ?? []) as readonly ItemDto[]).filter(
    (item) => item.status === 'active' && item.currentRevision?.entrySource === 'administrative',
  )
  const item = administrative.find((candidate) => candidate.id === itemId) ?? null
  // Everything typed on this page is ABOUT one question version, one person,
  // one filing. Remounting the sheet on any part of that identity is the
  // whole reset: evidence payload, basis, recognition drafts, dirty marks
  // and the evidence form's own local drafts all go together - a sheet
  // half-filled for one student must never be filable against another.
  const sheetSession = `${item?.currentRevision?.id ?? 'no-revision'}:${participantId}:${attempt}`

  return (
    <AsyncSection
      pending={items.isPending || roster.isPending}
      error={
        items.error ? formatError(items.error) : roster.error ? formatError(roster.error) : null
      }
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void items.refetch()
        void roster.refetch()
      }}
      skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
    >
      {administrative.length === 0 ? (
        <p {...stylex.props(styles.quiet)}>{format(m.recordEmpty)}</p>
      ) : (
        <div {...stylex.props(styles.form)}>
          <Field label={format(m.itemsListTitle)}>
            {(id) => (
              <NativeSelect
                id={id}
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="" />
                {administrative.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={format(m.recordWho)}>
            {(id) => (
              <NativeSelect
                id={id}
                value={participantId}
                onChange={(event) => setParticipantId(event.target.value)}
              >
                <option value="" />
                {(roster.data?.items ?? [])
                  .filter((participant) => participant.status === 'active')
                  .map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.displayName}
                    </option>
                  ))}
              </NativeSelect>
            )}
          </Field>
          {item !== null && (
            <RecordSheet
              key={sheetSession}
              session={sheetSession}
              batchId={batchId}
              materialRange={materialRange}
              item={item}
              participantId={participantId}
              wire={wire}
              onRecorded={() => {
                setParticipantId('')
                setAttempt((count) => count + 1)
              }}
            />
          )}
        </div>
      )}
    </AsyncSection>
  )
}

/** the recognition contract as the wire serves it to this page */
interface RecognitionWire {
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

function RecordSheet({
  session,
  batchId,
  materialRange,
  item,
  participantId,
  wire,
  onRecorded,
}: {
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

  // The determination the registrar makes by filing this record.
  //
  // The defaults follow the material as it is typed - change the claimed
  // level and the suggested determination moves with it - but only until
  // the registrar touches a field: a value they wrote is their judgment,
  // and the form stops second-guessing it. The sheet's mounting key is the
  // session identity (item revision + subject + attempt), so a different
  // question, a different person, or the same pair after a filing all start
  // from nothing.
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
    // refresh what the registrar has not touched; keep what they have
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

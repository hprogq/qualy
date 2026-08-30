import { useState, useEffect, useMemo, useRef } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { ValueFieldsForm } from '@qualy/web-value-form/InputValueForm'
import { draftsFromFields, materializeFields, type FieldDraft } from '@qualy/web-value-form/model'
import { integerToDecimal, type AtomicSchema } from '@qualy/value-schema'
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
  recognitionHead: { margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--q-surface-muted-foreground)' },
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
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError, locale } = useI18n()
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const roster = useQuery(
    query.assessment.listParticipants.queryOptions({ params: { batchId }, query: {} }),
  )
  const [itemId, setItemId] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [payload, setPayload] = useState<EvidencePayload>({})
  const [basis, setBasis] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [evidenceValid, setEvidenceValid] = useState(true)
  const contract = useQuery({
    ...query.assessment.getRecognitionContract.queryOptions({ params: { itemId } }),
    enabled: itemId !== '',
  })

  // The determination the registrar makes by filing this record.
  //
  // The defaults follow the material as it is typed - change the claimed
  // level and the suggested determination moves with it - but only until
  // the registrar touches a field: a value they wrote is their judgment,
  // and the form stops second-guessing it. The item revision is the form's
  // session identity: a different question, or the same question re-saved,
  // starts a clean sheet - stale drafts must never leak into a fresh
  // contract.
  const wire = contract.data?.contract ?? null
  const fields = useMemo(
    () =>
      wire === null
        ? []
        : wire.fields.map((field) => ({ id: field.id, schema: field.schema as AtomicSchema })),
    [wire],
  )
  const [recognitionDrafts, setRecognitionDrafts] = useState<Record<string, FieldDraft>>({})
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())
  const session = useRef<string | null>(null)
  const seed = useMemo(() => {
    if (wire === null) return {}
    const said: Record<string, unknown> = {}
    for (const one of wire.defaults) {
      const raw = payload[one.payloadKey]
      if (raw === undefined) continue
      if (one.assignment.kind === 'direct') said[one.recognitionId] = raw
      else if (typeof raw === 'number') {
        // the one named conversion the platform has; the client reuses it
        // rather than inventing a second String(value)
        const converted = integerToDecimal(raw)
        if (converted !== null) said[one.recognitionId] = converted
      }
    }
    return said
  }, [wire, payload])
  useEffect(() => {
    const identity = wire?.itemRevisionId ?? null
    if (session.current !== identity) {
      session.current = identity
      setRecognitionDrafts(draftsFromFields(fields, seed))
      setDirty(new Set())
      return
    }
    // refresh what the registrar has not touched; keep what they have
    setRecognitionDrafts((current) => {
      const refreshed = draftsFromFields(fields, seed)
      const next: Record<string, FieldDraft> = {}
      for (const field of fields) {
        next[field.id] = dirty.has(field.id) ? (current[field.id] ?? '') : refreshed[field.id]!
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wire?.itemRevisionId, fields, seed])
  const materialized = useMemo(
    () => materializeFields(fields, recognitionDrafts),
    [fields, recognitionDrafts],
  )
  const recognitionReady = wire === null || materialized.value !== null

  const administrative = ((items.data?.items ?? []) as readonly ItemDto[]).filter(
    (item) => item.status === 'active' && item.currentRevision?.entrySource === 'administrative',
  )
  const item = administrative.find((candidate) => candidate.id === itemId) ?? null

  const record = useMutation({
    mutationFn: () =>
      run(
        api.assessment.createEntry({
          payload: {
            itemId,
            participantId,
            payload,
            note: basis.trim(),
            ...(wire === null || materialized.value === null
              ? {}
              : { recognition: { values: materialized.value } }),
            // the form on screen is this item's current version; if it moved
            // while the record was being written, nothing is filed
            ...(item?.currentRevision?.id === undefined
              ? {}
              : { expectedItemRevisionId: item.currentRevision.id }),
          },
        }),
      ),
    onSuccess: () => {
      toast.success(format(m.recordDone))
      setPayload({})
      setBasis('')
      setParticipantId('')
    },
    onError: (error) => setProblem(formatError(error)),
  })

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
            <EvidenceForm
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
          )}
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
            {(id) => (
              <Input id={id} value={basis} onChange={(event) => setBasis(event.target.value)} />
            )}
          </Field>
          <Feedback message={problem} />
          <div {...stylex.props(styles.foot)}>
            <Button
              disabled={
                record.isPending ||
                itemId === '' ||
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
        </div>
      )}
    </AsyncSection>
  )
}

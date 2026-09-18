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
import { SheetAside, SheetBar, SheetBlock, SheetFoot } from './sheet.tsx'
import type { RecordTarget } from './RecordTargets.tsx'

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
//
// This is the lower half of the sheet the caller opened: the material, what
// it determines, and the basis, each announced by its own bar so a reader
// can see at a glance how much of the sheet is left. The bar above the
// determination is the one that earns its words - it says those values came
// from the material, which is the only way to know that editing one is
// allowed rather than a mistake.

const styles = stylex.create({
  summary: { display: 'flex', flexDirection: 'column', gap: 8 },
  count: { fontSize: 14, fontWeight: 500 },
  blockedBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 8%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.warning} 28%, transparent)`,
    paddingInline: 14,
    paddingBlock: 12,
  },
  blockedCount: { fontSize: 13, fontWeight: 500, color: tokens.warningForeground },
  blockedWho: { fontWeight: 500 },
  blockedActions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  blockedHint: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  blockedList: { display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0 },
  blockedRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
    listStyle: 'none',
    fontSize: 13,
  },
  blockedWhy: { color: tokens.mutedForeground },
  frozen: {
    fontSize: 12,
    lineHeight: 1.6,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
})

/** what the server said this act would come to */
interface PreviewResult {
  readonly eligibleCount: number
  readonly targetFingerprint: string
  readonly blocked: readonly {
    readonly participantId: string
    readonly displayName: string
    readonly reason: string
  }[]
}

/** the server's word for a person-level refusal, in the reader's */
const blockerMessage = (reason: string) =>
  reason === 'self-record-refused'
    ? m.recordBlockerSelf
    : reason === 'max-entries-reached'
      ? m.recordBlockerQuota
      : m.recordBlockerOther

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
  target,
  wire,
  onRecorded,
}: {
  /** item revision + subject + attempt; the caller remounts on any change */
  session: string
  batchId: string
  materialRange: { start: string; end: string }
  item: ItemDto
  /** who it is about, already chosen; null until somebody has been */
  target: RecordTarget | null
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

  // What the act would be, sent whole every time it is asked: the preview
  // and the write are the same request plus a confirmation, so a screen that
  // remembered half of it could confirm something it never showed.
  const asked =
    target === null
      ? null
      : {
          itemId: item.id,
          expectedItemRevisionId: item.currentRevision?.id ?? '',
          target:
            target.kind === 'people'
              ? { kind: 'people' as const, participantIds: target.participantIds }
              : {
                  kind: 'organization' as const,
                  orgNodeIds: target.orgNodeIds,
                  userTypeIds: target.userTypeIds,
                },
          payload,
          ...(wire === null || materialized.value === null
            ? {}
            : { recognition: { values: materialized.value } }),
          basis: basis.trim(),
        }

  const [seen, setSeen] = useState<PreviewResult | null>(null)
  const [dropped, setDropped] = useState<readonly string[]>([])

  // Named in the order the sheet is filled, so the state says the first
  // thing to go and do rather than all of them at once.
  const missing =
    target === null
      ? m.recordNeedsTargets
      : !evidenceValid
        ? m.recordNeedsMaterial
        : !recognitionReady
          ? m.recordNeedsResult
          : basis.trim() === ''
            ? m.recordNeedsBasis
            : null

  const check = useMutation({
    mutationFn: () =>
      run(
        api.assessment.previewAdministrativeRecord({
          params: { batchId },
          payload: { ...asked!, excludedParticipantIds: [...dropped] },
        }),
      ),
    onSuccess: (answer) => {
      setSeen(answer)
      setProblem(null)
    },
    onError: (error) => {
      setSeen(null)
      setProblem(formatError(error))
    },
  })

  const record = useMutation({
    mutationFn: () =>
      run(
        api.assessment.recordAdministrativeBatch({
          params: { batchId },
          payload: {
            ...asked!,
            excludedParticipantIds: [...dropped],
            expectedTargetFingerprint: seen!.targetFingerprint,
          },
        }),
      ),
    onSuccess: (done) => {
      toast.success(format(m.recordDoneMany, { count: done.recordedCount }))
      onRecorded()
    },
    onError: (error) => {
      // the set moved under them, or somebody stopped being writable: either
      // way what they were shown is stale, so it goes rather than sitting
      // there looking confirmable
      setSeen(null)
      setProblem(formatError(error))
    },
  })

  return (
    <>
      <SheetBar
        title={format(m.recordSectionEvidence)}
        note={format(m.recordSectionEvidenceNote)}
      />
      <SheetBlock>
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
      </SheetBlock>
      {wire !== null && (
        <>
          <SheetBar title={format(m.recordRecognition)} note={format(m.recordSectionResultNote)} />
          <SheetBlock>
            {/* the sentence that keeps somebody from reading these as the
                score: they are what the formula reads, and the width the
                inputs do not want is exactly where it goes */}
            <SheetAside said={format(m.recordResultAside)}>
              <div data-testid="record-recognition">
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
            </SheetAside>
          </SheetBlock>
        </>
      )}
      <SheetBlock ruled>
        {/* what it takes, and who ends up reading it, both belong under the
            box rather than in the label: a label is the control's name, and
            anything added to it is added to what the control is called */}
        <Field label={format(m.recordBasis)} hint={format(m.recordBasisHint)}>
          {(id) => (
            <Input id={id} value={basis} onChange={(event) => setBasis(event.target.value)} />
          )}
        </Field>
        <Feedback message={problem} />
      </SheetBlock>
      {seen !== null && (
        <>
          {/* The second half of a two-step submit, and it says so. The
              server's own shape is preview-then-commit, so the screen gives
              that step a heading of its own and recaps what is about to be
              settled - a reader confirming a number has to be able to see
              what the number is a number OF. */}
          <SheetBar
            title={format(m.recordCheckTitle)}
            note={format(m.recordCheckRecap, { item: item.title, basis: basis.trim() })}
          />
          <SheetBlock>
            <div {...stylex.props(styles.summary)} data-testid="record-preview">
              <span {...stylex.props(styles.count)} data-eligible={seen.eligibleCount}>
                {format(m.recordTargetsSummary, { count: seen.eligibleCount })}
              </span>
              {seen.blocked.length > 0 && (
                <div {...stylex.props(styles.blockedBox)}>
                  <span {...stylex.props(styles.blockedCount)} data-blocked={seen.blocked.length}>
                    {format(m.recordTargetsBlocked, { count: seen.blocked.length })}
                  </span>
                  <ul {...stylex.props(styles.blockedList)}>
                    {seen.blocked.map((one) => (
                      <li key={one.participantId} {...stylex.props(styles.blockedRow)}>
                        <span {...stylex.props(styles.blockedWho)}>{one.displayName}</span>
                        <span {...stylex.props(styles.blockedWhy)}>
                          {format(blockerMessage(one.reason))}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* dropping them checks again rather than clearing the
                      screen: the old behaviour looked like an error */}
                  <span {...stylex.props(styles.blockedActions)}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDropped([...dropped, ...seen.blocked.map((one) => one.participantId)])
                        setSeen(null)
                        check.mutate()
                      }}
                      data-testid="record-drop-blocked"
                    >
                      {format(m.recordDropBlockedMany, { count: seen.blocked.length })}
                    </Button>
                    <span {...stylex.props(styles.blockedHint)}>
                      {format(m.recordDropBlockedHint)}
                    </span>
                  </span>
                </div>
              )}
              <span {...stylex.props(styles.frozen)}>{format(m.recordFrozenNotice)}</span>
            </div>
          </SheetBlock>
          <SheetFoot note={format(m.recordIrreversible)}>
            <Button size="sm" variant="ghost" onClick={() => setSeen(null)}>
              {format(m.recordCheckBack)}
            </Button>
            <Button
              disabled={record.isPending || seen.eligibleCount === 0 || seen.blocked.length > 0}
              onClick={() => record.mutate()}
              data-testid="record-submit"
            >
              {format(m.recordSubmitMany, { count: seen.eligibleCount })}
            </Button>
          </SheetFoot>
        </>
      )}
      {seen === null && (
        <SheetFoot
          note={format(m.recordIrreversible)}
          status={
            missing === null
              ? format(m.recordReadyToCheck)
              : format(m.recordNeeds, { what: format(missing) })
          }
          blocked={missing !== null}
        >
          <Button
            disabled={check.isPending || missing !== null}
            onClick={() => check.mutate()}
            data-testid="record-check"
          >
            {format(m.recordCheckTargets)}
          </Button>
        </SheetFoot>
      )}
    </>
  )
}

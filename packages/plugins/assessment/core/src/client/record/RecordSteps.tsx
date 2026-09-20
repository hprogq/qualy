import { useEffect, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { ValueFieldsForm } from '@qualy/web-value-form/InputValueForm'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { draftsFromFields, materializeFields, type FieldDraft } from '@qualy/web-value-form/model'
import { applyAssignment, choiceLabel, displayTitle, kindOf } from '@qualy/value-schema'
import type { AtomicSchema } from '@qualy/value-schema'
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
import { RecordTargets, type RecordTarget } from './RecordTargets.tsx'
import {
  WizardAside,
  WizardBody,
  WizardFoot,
  WizardNotice,
  WizardRecap,
  WizardRecapRow,
  WizardSection,
} from './wizard.tsx'

// The two moves after the question has been chosen: fill the finding in,
// then read it back before it counts.
//
// It takes effect the moment it is filed - no review round - which is
// exactly why the basis is required and why there is a third step at all: a
// fact nobody can check is an assertion, and a fact nobody read back is an
// accident.
//
// The determination the office makes follows the material as it is typed -
// change the claimed level and the suggested determination moves with it -
// but only until the recorder touches a field: a value they wrote is their
// judgment, and the form stops second-guessing it.
//
// Who it is about sits with the rest of the filling-in rather than gating
// it. One finding written on many people is one finding: adding a name does
// not make the material somebody else's, so the sheet is not thrown away
// when the set changes. What it does throw away is the checked list, because
// a different set is a different list.

const styles = stylex.create({
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

export function RecordSteps({
  at,
  session,
  batchId,
  materialRange,
  item,
  wire,
  onGo,
  onRecorded,
}: {
  /** 1 while filling in, 2 while confirming */
  at: number
  /** item revision + attempt; the caller remounts on either */
  session: string
  batchId: string
  materialRange: { start: string; end: string }
  item: ItemDto
  wire: RecognitionWire | null
  onGo: (step: number) => void
  onRecorded: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError, locale } = useI18n()
  const words = usePickerWords()
  const [target, setTarget] = useState<RecordTarget | null>(null)
  const [payload, setPayload] = useState<EvidencePayload>({})
  const [basis, setBasis] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [evidenceValid, setEvidenceValid] = useState(true)
  const [seen, setSeen] = useState<PreviewResult | null>(null)
  /**
   * The press this act will come of.
   *
   * Minted with the confirmation and held for as long as it stands, so
   * pressing record again after an answer went missing is the same press and
   * is answered with the act it already became. Anything that clears the
   * confirmation - a changed question, a changed list - mints another,
   * because that is a different act.
   */
  const [press, setPress] = useState(() => crypto.randomUUID())
  const [dropped, setDropped] = useState<readonly string[]>([])

  const fields = useMemo(
    () =>
      wire === null
        ? []
        : wire.fields.map((field) => ({ id: field.id, schema: field.schema as AtomicSchema })),
    [wire],
  )
  // A field the determination stands for is asked once, as the
  // determination: the office IS the determination, so the filing side of
  // such a field is written by the server from what the office decides.
  // Only a field carried over unchanged can be left out; one the
  // determination converts (a whole number read as a decimal) has no single
  // way back and stays on the form.
  const filed = useMemo(() => {
    const bound = new Set(
      (wire?.defaults ?? [])
        .filter((one) => one.assignment.kind === 'direct')
        .map((one) => one.payloadKey),
    )
    return fieldsOf(item.currentRevision?.formConfig).filter((field) => !bound.has(field.key))
  }, [wire, item])
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
    mutationFn: (excluded: readonly string[]) =>
      run(
        api.assessment.previewAdministrativeRecord({
          params: { batchId },
          payload: { ...asked!, excludedParticipantIds: [...excluded] },
        }),
      ),
    onSuccess: (answer) => {
      setSeen(answer)
      setPress(crypto.randomUUID())
      setProblem(null)
      onGo(2)
    },
    onError: (error) => {
      setSeen(null)
      setProblem(formatError(error))
      onGo(1)
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
            // the press, not the people: a retry after a lost answer is
            // answered with the act it already became instead of writing a
            // second finding on everybody
            idempotencyKey: press,
          },
        }),
      ),
    onSuccess: (done) => {
      toast.success(format(m.recordDoneMany, { count: done.recordedCount }))
      onRecorded()
    },
    onError: (error) => {
      // the set moved under them, or somebody stopped being writable: either
      // way what they were shown is stale, so it goes and the reader is put
      // back where they can change something
      setSeen(null)
      setProblem(formatError(error))
      onGo(1)
    },
  })

  // The people are part of the filling-in, but the checked list is not: a
  // name added or removed is a different list, so it is asked for again.
  const chooseTargets = (next: RecordTarget | null) => {
    setTarget(next)
    setDropped([])
    setSeen(null)
  }

  // in the contract's own order, which is the order the determination was
  // made in; a value the contract cannot name is left out rather than
  // printed as an opaque id
  const determined = fields.flatMap((field) => {
    const values = materialized.value
    if (values === null || !Object.hasOwn(values, field.id)) return []
    const value = values[field.id]
    if (value === null || value === undefined || value === '') return []
    return [
      {
        id: field.id,
        label: displayTitle(field.schema, field.id, locale),
        text:
          kindOf(field.schema) === 'choice'
            ? choiceLabel(field.schema as never, String(value), locale)
            : typeof value === 'boolean'
              ? format(value ? m.recognitionYes : m.recognitionNo)
              : String(value),
      },
    ]
  })

  if (at === 2 && seen !== null) {
    return (
      <>
        <WizardBody>
          <WizardNotice>{format(m.recordEffectNotice)}</WizardNotice>
          <WizardSection title={format(m.recordCheckTitle)}>
            <WizardRecap>
              <WizardRecapRow term={format(m.recordActItem)}>{item.title}</WizardRecapRow>
              <WizardRecapRow term={format(m.recordTargets)}>
                <span {...stylex.props(styles.count)} data-testid="record-preview" data-eligible={seen.eligibleCount}>
                  {format(m.recordTargetsSummary, { count: seen.eligibleCount })}
                </span>
              </WizardRecapRow>
              {determined.map((one) => (
                <WizardRecapRow key={one.id} term={one.label}>
                  {one.text}
                </WizardRecapRow>
              ))}
              <WizardRecapRow term={format(m.recordBasis)}>{basis.trim()}</WizardRecapRow>
            </WizardRecap>

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
                {/* dropping them asks again rather than clearing the screen:
                    the old behaviour looked like an error */}
                <span {...stylex.props(styles.blockedActions)}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={check.isPending}
                    onClick={() => {
                      const next = [...dropped, ...seen.blocked.map((one) => one.participantId)]
                      setDropped(next)
                      check.mutate(next)
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
          </WizardSection>
        </WizardBody>
        <WizardFoot
          status={seen.blocked.length > 0 ? format(m.recordNeedsBlocked) : undefined}
          blocked={seen.blocked.length > 0}
        >
          <Button variant="outline" onClick={() => onGo(1)} data-testid="record-step-back">
            {format(m.recordStepBack)}
          </Button>
          <Button
            disabled={record.isPending || seen.eligibleCount === 0 || seen.blocked.length > 0}
            onClick={() => record.mutate()}
            data-testid="record-submit"
          >
            {format(m.recordSubmitMany, { count: seen.eligibleCount })}
          </Button>
        </WizardFoot>
      </>
    )
  }

  return (
    <>
      <WizardBody>
        <WizardSection title={format(m.recordTargets)} note={format(m.recordTargetsNote)}>
          <RecordTargets batchId={batchId} value={target} onChange={chooseTargets} />
        </WizardSection>

        <WizardSection
          title={format(m.recordSectionEvidence)}
          note={format(m.recordSectionEvidenceNote)}
        >
          <EvidenceForm
            session={session}
            onValidityChange={setEvidenceValid}
            fields={filed}
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
        </WizardSection>

        {wire !== null && (
          <WizardSection
            title={format(m.recordRecognition)}
            note={format(m.recordSectionResultNote)}
          >
            {/* the sentence that keeps somebody from reading these as the
                score: they are what the formula reads, and the width the
                inputs do not want is exactly where it goes */}
            <WizardAside said={format(m.recordResultAside)}>
              <div data-testid="record-recognition">
                <ValueFieldsForm
                  words={words}
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
            </WizardAside>
          </WizardSection>
        )}

        <WizardSection title={format(m.recordBasis)}>
          {/* what it takes, and who ends up reading it, both belong under the
              box rather than in the label: a label is the control's name, and
              anything added to it is added to what the control is called */}
          <Field label={format(m.recordBasis)} hideLabel hint={format(m.recordBasisHint)}>
            {(id) => (
              <Input id={id} value={basis} onChange={(event) => setBasis(event.target.value)} />
            )}
          </Field>
          <Feedback message={problem} />
        </WizardSection>
      </WizardBody>
      <WizardFoot
        status={format(missing ?? m.recordReadyToCheck)}
        blocked={missing !== null}
      >
        <Button variant="outline" onClick={() => onGo(0)} data-testid="record-step-back">
          {format(m.recordStepBack)}
        </Button>
        <Button
          disabled={check.isPending || missing !== null}
          onClick={() => check.mutate(dropped)}
          data-testid="record-step-next"
        >
          {format(m.recordStepNext)}
        </Button>
      </WizardFoot>
    </>
  )
}

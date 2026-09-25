import { useEffect, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
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
import { recognitionProblemText } from '../review/recognition.ts'
import { RecordTargets, type RecordTarget } from './RecordTargets.tsx'
import {
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
  score: {
    display: 'flex',
    minHeight: 54,
    alignItems: 'center',
    gap: 14,
    borderRadius: 12,
    paddingInline: 14,
    paddingBlock: 10,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
  },
  scoreBad: {
    backgroundColor: tokens.surface,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.danger} 55%, transparent)`,
  },
  scoreText: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  scoreTitle: {
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: tokens.mutedForeground,
  },
  scoreWords: { fontSize: 12.5, lineHeight: 1.5, color: tokens.mutedForeground },
  scoreWordsBad: { fontSize: 13, color: tokens.danger },
  scoreFigure: { display: 'flex', flexShrink: 0, alignItems: 'baseline', gap: 4 },
  scoreAmount: {
    flexShrink: 0,
    fontSize: 24,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
  },
  scoreDash: { color: tokens.border },
  scoreUnit: { fontSize: 13, color: tokens.mutedForeground },
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
    : reason === 'max-entries-reached' || reason === 'entry-ceiling-reached'
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
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  const { format, formatError, locale } = useI18n()
  const words = usePickerWords()
  const [target, setTarget] = useState<RecordTarget | null>(null)
  const [payload, setPayload] = useState<EvidencePayload>({})
  const [basis, setBasis] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [evidenceValid, setEvidenceValid] = useState(true)
  // a file still on its way up would join the payload after the check read it
  const [uploading, setUploading] = useState(false)
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

  // What it would score, asked a beat after the typing stops. The formula's
  // own refusal is met here, where the determination can still be changed,
  // rather than on the press that files the act for everybody at once.
  const settled = useSettled(
    wire === null || materialized.value === null ? null : JSON.stringify(materialized.value),
  )
  const scored = useQuery({
    ...query.assessment.previewRecordDetermination.queryOptions({
      params: { batchId },
      payload: { itemId: item.id, values: settled === null ? {} : JSON.parse(settled) },
    }),
    enabled: settled !== null,
    staleTime: 60_000,
    retry: false,
  })
  const refused =
    settled !== null && !scored.isPending && !scored.isError && scored.data?.refusal !== null
      ? (scored.data?.refusal ?? null)
      : null
  // What the judge said about the values themselves - a date outside the
  // material window, a value the contract no longer takes - beside the field
  // it is about. The act would be refused for it on the last press.
  const issues =
    settled !== null && !scored.isPending && !scored.isError ? (scored.data?.issues ?? []) : []
  const problems = new Map<string, string>()
  for (const issue of issues) {
    if (problems.has(issue.recognitionId)) continue
    const schema = fields.find((field) => field.id === issue.recognitionId)?.schema
    problems.set(issue.recognitionId, recognitionProblemText(format, schema, issue.reason))
  }

  // Named in the order the sheet is filled, so the state says the first
  // thing to go and do rather than all of them at once.
  const missing =
    target === null
      ? m.recordNeedsTargets
      : uploading
        ? m.recordNeedsUpload
        : !evidenceValid
          ? m.recordNeedsMaterial
          : !recognitionReady
            ? m.recordNeedsResult
            : issues.length > 0
              ? m.recordNeedsCorrection
              : basis.trim() === ''
                ? m.recordNeedsBasis
                : refused !== null
                  ? m.recordNeedsFormula
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
                <span
                  {...stylex.props(styles.count)}
                  data-testid="record-preview"
                  data-eligible={seen.eligibleCount}
                >
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
            onBusyChange={setUploading}
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
                problems={problems}
                scope="record"
              />
            </div>
            {/* what it comes to, and what stops it, said while it is typed */}
            <RecordScore
              state={
                settled === null
                  ? { kind: 'incomplete' }
                  : scored.isPending
                    ? { kind: 'checking' }
                    : scored.isError
                      ? { kind: 'unavailable' }
                      : refused !== null
                        ? { kind: 'refused', reason: refused }
                        : issues.length > 0
                          ? {
                              kind: 'issues',
                              words: problems.get(issues[0]!.recognitionId) ?? '',
                            }
                          : scored.data?.amount !== null && scored.data?.amount !== undefined
                            ? { kind: 'amount', amount: scored.data.amount }
                            : { kind: 'unavailable' }
              }
            />
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
      <WizardFoot status={format(missing ?? m.recordReadyToCheck)} blocked={missing !== null}>
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

/** how long the typing has to rest before the arithmetic is asked */
const SETTLE_MS = 400

/** the same value a beat after it stopped changing */
function useSettled(value: string | null): string | null {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return settled === value ? settled : null
}

type ScoreState =
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'refused'; readonly reason: string }
  /** a value the judge would not take, said in the field's own words */
  | { readonly kind: 'issues'; readonly words: string }
  | { readonly kind: 'amount'; readonly amount: string }

/**
 * What the determination would score, under the question's own formula.
 *
 * One card of one height in every state, so the sheet does not jump while the
 * values are typed; only a refusal or a value the judge will not take
 * changes ground, because those are the states that also stop the act.
 */
function RecordScore({ state }: { state: ScoreState }) {
  const { format } = useI18n()
  const bad = state.kind === 'refused' || state.kind === 'issues'
  const words =
    state.kind === 'amount'
      ? format(m.reviewPreviewStands)
      : state.kind === 'refused'
        ? format(m.reviewPreviewRefused, { reason: state.reason })
        : state.kind === 'issues'
          ? state.words
          : state.kind === 'checking'
            ? format(m.reviewPreviewChecking)
            : state.kind === 'unavailable'
              ? format(m.reviewPreviewUnavailable)
              : format(m.reviewPreviewIncomplete)
  return (
    <div
      {...stylex.props(styles.score, bad && styles.scoreBad)}
      data-testid="record-score"
      data-preview={state.kind}
      {...(state.kind === 'amount' ? { 'data-amount': state.amount } : {})}
      aria-live="polite"
    >
      <span {...stylex.props(styles.scoreText)}>
        <span {...stylex.props(styles.scoreTitle)}>{format(m.reviewPreviewTitle)}</span>
        <span {...stylex.props(styles.scoreWords, bad && styles.scoreWordsBad)}>{words}</span>
      </span>
      {state.kind === 'amount' ? (
        <span {...stylex.props(styles.scoreFigure)}>
          <span {...stylex.props(styles.scoreAmount)}>{state.amount}</span>
          <span {...stylex.props(styles.scoreUnit)}>{format(m.reviewPreviewUnit)}</span>
        </span>
      ) : (
        !bad && (
          <span aria-hidden {...stylex.props(styles.scoreAmount, styles.scoreDash)}>
            –
          </span>
        )
      )}
    </div>
  )
}

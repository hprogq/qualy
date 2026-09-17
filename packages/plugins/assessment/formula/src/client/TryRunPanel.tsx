import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Spinner } from '@qualy/ui/spinner'
import { HistoryIcon, PlayIcon } from 'lucide-react'
import type { NormalizedInputSchema } from '@qualy/value-schema'
import { InputValueForm } from '@qualy/web-value-form/InputValueForm'
import type { FieldDraft } from '@qualy/web-value-form/model'
import { formulaMessages as m } from './i18n.ts'
import { constraintNote } from './constraint-words.ts'
import { shortTime } from './library-styles.ts'
import { ColumnHead } from './WorkbenchLayout.tsx'
import { workbenchStyles as w } from './workbench-styles.ts'

// One try-run: the form the contract asks for, a run, and what came of it.
//
// The column says at its head how the form stands - synced with the code, or
// left over from the last structure that compiled - and keeps the run, the
// result and what may be kept from it standing at its foot, so neither moves
// as the form scrolls. The tries this browser remembers are one press away
// rather than under the form.
//
// The same panel serves the draft, a saved revision and a publication; what
// runs it is the caller's - a draft compiles its buffer, a publication runs
// the artifact it froze. Only the draft offers to keep a try as an example.

export interface TryOutcome {
  readonly actual?: string
  readonly refusal?: string
  readonly defect?: string
}

/** how the form's structure stands, said once at the head of the column */
export interface TryStatus {
  readonly state: string
  readonly tone: 'good' | 'working' | 'warn' | 'quiet'
  readonly words: string
  readonly testId?: string
  /** where the reason can be read, when the structure is not the code's */
  readonly action?: ReactNode
}

const styles = stylex.create({
  column: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  // a phone has no column head; the same two facts ride one quiet strip
  strip: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    paddingBlock: 6,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    fontSize: 11,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  status: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    margin: 0,
    fontSize: 11,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  statusWords: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusWarn: { color: tokens.warningForeground },
  statusSpinner: { width: 11, height: 11, flexShrink: 0 },
  body: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
    paddingBlock: 12,
    paddingInline: 16,
  },
  bodyPhone: { paddingTop: 14, paddingBottom: 16, gap: 14 },
  pending: {
    display: 'flex',
    minHeight: 150,
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingInline: 16,
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: 'center',
    color: tokens.mutedForeground,
  },
  pendingOff: { color: tokens.warningForeground },
  pendingSpinner: { width: 18, height: 18 },
  foot: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 8,
    paddingBlock: 12,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  footPhone: { gap: 10 },
  runRow: { display: 'flex', alignItems: 'center', gap: 12 },
  run: {
    display: 'inline-flex',
    flexGrow: 1,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 32,
    paddingInline: 14,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.primary,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    color: tokens.primaryForeground,
    cursor: { default: 'pointer', ':disabled': 'default' },
    opacity: { default: 1, ':disabled': 0.55 },
  },
  runPhone: { height: 44, fontSize: 14, borderRadius: tokens.radiusLg },
  result: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'baseline',
    gap: 8,
    fontSize: 13,
  },
  resultLabel: { flexShrink: 0, color: tokens.mutedForeground },
  resultValue: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 16,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.foreground,
  },
  resultValuePhone: { fontSize: 20 },
  resultBad: { fontSize: 13, fontWeight: 500, color: tokens.danger, whiteSpace: 'normal' },
  resultWhen: {
    flexShrink: 0,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  resultStale: { color: tokens.warningForeground },
  resultNone: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  keepRow: { display: 'flex', alignItems: 'center', gap: 8 },
  keep: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: { default: tokens.surface, ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: { default: tokens.foreground, ':disabled': tokens.mutedForeground },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  keepPhone: { height: 44, paddingInline: 12, fontSize: 13, borderRadius: tokens.radiusLg },
  records: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 12,
    color: { default: tokens.surfaceMutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  recordsStrip: { height: 22, paddingInline: 0, fontSize: 11, fontWeight: 500 },
  recordsCount: {
    display: 'inline-flex',
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 5,
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
  },
})

export function TryRunPanel({
  title,
  narrow = false,
  status,
  schema,
  pending,
  drafts,
  onDraft,
  issues,
  disabled,
  running,
  result,
  onRun,
  onKeep,
  recordCount,
  onOpenRecords,
}: {
  readonly title: string
  /** a phone has no column of its own, so the head becomes a strip */
  readonly narrow?: boolean
  readonly status: TryStatus
  /** the form's contract; null while there is none to draw */
  readonly schema: NormalizedInputSchema | null
  /** what stands in for the form while there is no contract */
  readonly pending: {
    readonly state: string
    readonly words: string
    readonly working: boolean
    readonly off: boolean
  }
  readonly drafts: Readonly<Record<string, FieldDraft>>
  readonly onDraft: (name: string, draft: FieldDraft) => void
  readonly issues: ReadonlyMap<string, string> | undefined
  readonly disabled: boolean
  readonly running: boolean
  /** the last run, whether it still speaks for what is on screen, and when it ran */
  readonly result: {
    readonly outcome: TryOutcome
    readonly fresh: boolean
    readonly at?: number
  } | null
  readonly onRun: () => void
  /** keeps the try as an example, expecting the given value ('' for none yet) */
  readonly onKeep?: (expected: string) => void
  readonly recordCount: number
  readonly onOpenRecords: () => void
}) {
  const { format, locale } = useI18n()

  const statusWords =
    status.words === '' && status.action === undefined ? null : (
      <span
        data-testid={status.testId}
        data-state={status.state}
        {...stylex.props(styles.status, status.tone === 'warn' && styles.statusWarn)}
      >
        {status.tone === 'working' ? <Spinner aria-hidden xstyle={styles.statusSpinner} /> : null}
        <span {...stylex.props(styles.statusWords)}>{status.words}</span>
        {status.action}
      </span>
    )

  const recordsButton = (
    <button
      type="button"
      data-testid="formula-try-records-open"
      onClick={onOpenRecords}
      {...stylex.props(styles.records, narrow && styles.recordsStrip)}
    >
      <HistoryIcon size={narrow ? 12 : 13} aria-hidden />
      {format(m.tryRecordsTitle)}
      {recordCount === 0 ? null : (
        <span {...stylex.props(!narrow && styles.recordsCount)}>{recordCount}</span>
      )}
    </button>
  )

  const head = narrow ? (
    <div {...stylex.props(styles.strip)}>
      {statusWords}
      <span {...stylex.props(w.spring)} />
      {recordsButton}
    </div>
  ) : (
    <ColumnHead title={title} {...(statusWords === null ? {} : { note: statusWords })} />
  )

  const outcomeWords = (outcome: TryOutcome): string | null =>
    outcome.refusal !== undefined
      ? format(m.refusalPrefix, { message: outcome.refusal })
      : outcome.defect !== undefined
        ? format(m.defectPrefix, { message: outcome.defect })
        : outcome.actual === undefined
          ? format(m.testInputInvalid, { label: title })
          : null

  const body =
    schema === null ? (
      // the form's room, kept while the structure is read: a column that
      // collapsed and then sprang open pushed its neighbours about
      <div
        role="status"
        data-testid="formula-try-pending"
        data-state={pending.state}
        {...stylex.props(styles.pending, pending.off && styles.pendingOff)}
      >
        {pending.working ? <Spinner aria-hidden xstyle={styles.pendingSpinner} /> : null}
        <span>{pending.words}</span>
      </div>
    ) : (
      <InputValueForm
        schema={schema}
        drafts={drafts}
        onDraft={onDraft}
        locale={locale}
        disabled={disabled || running}
        problems={issues}
        scope="try"
        authoring={{
          unnamedLabel: format(m.fieldUnnamed),
          noteOf: (field) => constraintNote(field, format, locale),
          ...(narrow ? { notePlacement: 'below' as const } : {}),
        }}
      />
    )

  const outcome = result?.outcome
  const problem = outcome === undefined ? null : outcomeWords(outcome)
  const fresh = result !== null && result.fresh
  const actual = fresh ? result.outcome.actual : undefined
  const resultLine =
    result === null || outcome === undefined ? (
      <span data-testid="formula-try-idle" {...stylex.props(styles.result)}>
        <span {...stylex.props(styles.resultNone)}>{format(m.resultNotRun)}</span>
      </span>
    ) : (
      <span
        data-testid="formula-try-result"
        data-stale={fresh ? undefined : true}
        aria-live="polite"
        {...stylex.props(styles.result)}
      >
        <span {...stylex.props(styles.resultLabel)}>{format(m.resultLabel)}</span>
        {problem === null ? (
          <span {...stylex.props(styles.resultValue, narrow && styles.resultValuePhone)}>
            {outcome.actual}
          </span>
        ) : (
          <span {...stylex.props(styles.resultValue, styles.resultBad)}>{problem}</span>
        )}
        <span {...stylex.props(styles.resultWhen, !fresh && styles.resultStale)}>
          {fresh
            ? result.at === undefined
              ? ''
              : format(m.resultRanAt, {
                  when: shortTime(new Date(result.at).toISOString(), locale),
                })
            : format(m.resultStale)}
        </span>
      </span>
    )

  const runButton = (
    <button
      type="button"
      disabled={disabled || running}
      onClick={onRun}
      {...stylex.props(styles.run, narrow && styles.runPhone)}
    >
      <PlayIcon size={narrow ? 15 : 13} aria-hidden />
      {format(running ? m.running : m.run)}
    </button>
  )

  const keepButton =
    onKeep === undefined ? null : (
      <button
        type="button"
        data-testid={actual === undefined ? 'formula-try-keep' : 'formula-try-adopt'}
        disabled={disabled || running || schema === null}
        onClick={() => onKeep(actual ?? '')}
        {...stylex.props(styles.keep, narrow && styles.keepPhone)}
      >
        {format(m.trySave)}
      </button>
    )

  return (
    <div {...stylex.props(styles.column)}>
      {head}
      <div {...stylex.props(styles.body, narrow && styles.bodyPhone)}>{body}</div>
      <div {...stylex.props(styles.foot, narrow && styles.footPhone)}>
        <div {...stylex.props(styles.runRow)}>
          {resultLine}
          {recordsButton}
        </div>
        <div {...stylex.props(styles.keepRow)}>
          {runButton}
          {keepButton}
        </div>
      </div>
    </div>
  )
}

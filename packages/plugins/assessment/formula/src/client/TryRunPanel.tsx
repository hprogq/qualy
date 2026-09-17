import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Spinner } from '@qualy/ui/spinner'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ListPlusIcon,
  PlayIcon,
  TargetIcon,
  Trash2Icon,
} from 'lucide-react'
import type { NormalizedInputSchema } from '@qualy/value-schema'
import { InputValueForm } from '@qualy/web-value-form/InputValueForm'
import type { FieldDraft } from '@qualy/web-value-form/model'
import { formulaMessages as m } from './i18n.ts'
import { shortWhen } from './library-styles.ts'
import { inputSummaryOf } from './report-words.ts'
import type { TryRecord } from './try-records.ts'

// One try-run: where the form stands, the form, a run, what came of it, and
// the runs before it.
//
// The same panel serves the draft, a saved revision and a publication; what
// runs it is the caller's - a draft compiles its buffer, a publication runs
// the artifact it froze. Only the draft offers to keep a try as an example.

export interface TryOutcome {
  readonly actual?: string
  readonly refusal?: string
  readonly defect?: string
}

/** how the form's structure stands, said once at the top of the panel */
export interface TryStatus {
  readonly state: string
  readonly tone: 'good' | 'working' | 'warn' | 'quiet'
  readonly words: string
  readonly testId?: string
}

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 },
  status: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    margin: 0,
    fontSize: 12,
    lineHeight: 1.4,
    color: tokens.mutedForeground,
  },
  statusGood: { color: tokens.successForeground },
  statusWarn: { color: tokens.warningForeground },
  statusIcon: { flexShrink: 0 },
  statusSpinner: { width: 12, height: 12, flexShrink: 0 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surface,
  },
  pending: {
    display: 'flex',
    minHeight: 150,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingInline: 16,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: 'center',
    color: tokens.mutedForeground,
  },
  pendingOff: { color: tokens.warningForeground },
  pendingSpinner: { width: 18, height: 18 },
  run: { width: '100%' },
  result: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingBlock: 12,
    paddingInline: 14,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
  },
  resultBad: {
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 8%, ${tokens.surface})`,
  },
  resultStale: { opacity: 0.6 },
  resultLabel: { fontSize: 11.5, color: tokens.mutedForeground },
  resultValue: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontSize: 24,
    lineHeight: 1.2,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.foreground,
  },
  resultWords: { fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere', color: tokens.danger },
  resultNote: { fontSize: 12, color: tokens.mutedForeground },
  keeps: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, marginLeft: -6 },
  keep: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: {
      default: tokens.surfaceMutedForeground,
      ':hover': tokens.foreground,
      ':disabled': tokens.mutedForeground,
    },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  recordsHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    fontSize: 12,
    fontWeight: 600,
    color: tokens.surfaceMutedForeground,
  },
  recordsCount: { fontWeight: 400, color: tokens.mutedForeground },
  spring: { flexGrow: 1 },
  clear: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 11.5,
    fontWeight: 400,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  records: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    overflow: 'hidden',
    backgroundColor: tokens.surface,
  },
  record: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 10,
    paddingBlock: 8,
    paddingInline: 12,
    borderWidth: 0,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    textAlign: 'left',
    color: tokens.foreground,
    cursor: 'pointer',
  },
  recordWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  recordInput: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 11.5,
    color: tokens.surfaceMutedForeground,
  },
  recordMeta: {
    display: 'flex',
    gap: 6,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  recordOld: {
    paddingInline: 4,
    borderRadius: 4,
    backgroundColor: tokens.surfaceMuted,
  },
  recordValue: {
    flexShrink: 0,
    maxWidth: '45%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  recordBad: { fontSize: 12, fontWeight: 500, color: tokens.danger },
  recordsEmpty: {
    margin: 0,
    paddingBlock: 14,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    fontSize: 12,
    textAlign: 'center',
    color: tokens.mutedForeground,
  },
})

export function TryRunPanel({
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
  records,
  mark,
  onPick,
  onClearRecords,
}: {
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
  /** the last run and whether it still speaks for what is on screen */
  readonly result: { readonly outcome: TryOutcome; readonly fresh: boolean } | null
  readonly onRun: () => void
  /** keeps the try as an example, expecting the given value ('' for none yet) */
  readonly onKeep?: (expected: string) => void
  /** earlier runs, newest first */
  readonly records: readonly TryRecord[]
  /** the current source's mark; a record with another ran against other code */
  readonly mark?: string
  readonly onPick: (record: TryRecord) => void
  readonly onClearRecords: () => void
}) {
  const { format, locale } = useI18n()

  const statusLine = (
    <p
      data-testid={status.testId}
      data-state={status.state}
      {...stylex.props(
        styles.status,
        status.tone === 'good' && styles.statusGood,
        status.tone === 'warn' && styles.statusWarn,
      )}
    >
      {status.tone === 'working' ? (
        <Spinner aria-hidden xstyle={styles.statusSpinner} />
      ) : status.tone === 'good' ? (
        <CircleCheckIcon size={13} aria-hidden {...stylex.props(styles.statusIcon)} />
      ) : status.tone === 'warn' ? (
        <CircleAlertIcon size={13} aria-hidden {...stylex.props(styles.statusIcon)} />
      ) : null}
      <span>{status.words}</span>
    </p>
  )

  const outcomeWords = (outcome: TryOutcome): string | null =>
    outcome.refusal !== undefined
      ? format(m.refusalPrefix, { message: outcome.refusal })
      : outcome.defect !== undefined
        ? format(m.defectPrefix, { message: outcome.defect })
        : outcome.actual === undefined
          ? format(m.testInputInvalid, { label: format(m.tryTitle) })
          : null

  const recordList = (
    <>
      <div {...stylex.props(styles.recordsHead)}>
        <span>{format(m.tryRecordsTitle)}</span>
        {records.length === 0 ? null : (
          <span {...stylex.props(styles.recordsCount)}>{records.length}</span>
        )}
        <span {...stylex.props(styles.spring)} />
        {records.length === 0 ? null : (
          <button type="button" onClick={onClearRecords} {...stylex.props(styles.clear)}>
            <Trash2Icon size={12} aria-hidden />
            {format(m.tryRecordsClear)}
          </button>
        )}
      </div>
      {records.length === 0 ? (
        <p {...stylex.props(styles.recordsEmpty)}>{format(m.tryRecordsEmpty)}</p>
      ) : (
        <ul data-testid="formula-try-records" {...stylex.props(styles.records)}>
          {records.map((record) => {
            const old = mark !== undefined && record.mark !== undefined && record.mark !== mark
            return (
              <li key={record.id}>
                <button
                  type="button"
                  data-testid="formula-try-record"
                  disabled={schema === null}
                  title={format(m.tryRecordPick)}
                  onClick={() => onPick(record)}
                  {...stylex.props(styles.record)}
                >
                  <span {...stylex.props(styles.recordWords)}>
                    <span {...stylex.props(styles.recordInput)}>
                      {inputSummaryOf(record.input)}
                    </span>
                    <span {...stylex.props(styles.recordMeta)}>
                      <span>{shortWhen(new Date(record.at).toISOString(), format, locale)}</span>
                      {old ? (
                        <span {...stylex.props(styles.recordOld)}>{format(m.tryRecordOld)}</span>
                      ) : null}
                    </span>
                  </span>
                  {record.outcome.actual === undefined ? (
                    <span {...stylex.props(styles.recordBad)}>
                      {format(
                        record.outcome.refusal !== undefined
                          ? m.tryRecordRefused
                          : record.outcome.defect !== undefined
                            ? m.tryRecordCrashed
                            : m.tryRecordInvalid,
                      )}
                    </span>
                  ) : (
                    <span {...stylex.props(styles.recordValue)}>{record.outcome.actual}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )

  // with no form to draw, the pending block below says how things stand
  if (schema === null)
    return (
      <div {...stylex.props(styles.panel)}>
        {/* the form's room, kept while the structure is read: a column that
            collapsed and then sprang open pushed its neighbours about */}
        <div
          role="status"
          data-testid="formula-try-pending"
          data-state={pending.state}
          {...stylex.props(styles.pending, pending.off && styles.pendingOff)}
        >
          {pending.working ? <Spinner aria-hidden xstyle={styles.pendingSpinner} /> : null}
          <span>{pending.words}</span>
        </div>
        {records.length === 0 ? null : recordList}
      </div>
    )

  const outcome = result?.outcome
  const problem = outcome === undefined ? null : outcomeWords(outcome)
  const actual = result !== null && result.fresh ? result.outcome.actual : undefined
  return (
    <div {...stylex.props(styles.panel)}>
      {statusLine}
      <div {...stylex.props(styles.card)}>
        <InputValueForm
          schema={schema}
          drafts={drafts}
          onDraft={onDraft}
          locale={locale}
          disabled={disabled || running}
          problems={issues}
          scope="try"
          authoring={{ unnamedLabel: format(m.fieldUnnamed) }}
        />
        <Button
          size="sm"
          disabled={disabled || running}
          onClick={onRun}
          className={stylex.props(styles.run).className}
        >
          <PlayIcon aria-hidden />
          {format(running ? m.running : m.run)}
        </Button>
      </div>
      {result === null || outcome === undefined ? null : (
        <div
          data-testid="formula-try-result"
          data-stale={result.fresh ? undefined : true}
          aria-live="polite"
          {...stylex.props(
            styles.result,
            problem !== null && styles.resultBad,
            !result.fresh && styles.resultStale,
          )}
        >
          <span {...stylex.props(styles.resultLabel)}>{format(m.resultLabel)}</span>
          {problem === null ? (
            <span {...stylex.props(styles.resultValue)}>{outcome.actual}</span>
          ) : (
            <span {...stylex.props(styles.resultWords)}>{problem}</span>
          )}
          {result.fresh ? null : (
            <span {...stylex.props(styles.resultNote)}>{format(m.resultStale)}</span>
          )}
        </div>
      )}
      {onKeep === undefined ? null : (
        <div {...stylex.props(styles.keeps)}>
          <button
            type="button"
            disabled={disabled || running}
            onClick={() => onKeep('')}
            {...stylex.props(styles.keep)}
          >
            <ListPlusIcon size={13} aria-hidden />
            {format(m.trySave)}
          </button>
          {actual === undefined ? null : (
            // a STALE actual may never become an expectation: the offer
            // exists only while code and inputs both still match the run
            <button
              type="button"
              data-testid="formula-try-adopt"
              disabled={disabled || running}
              onClick={() => onKeep(actual)}
              {...stylex.props(styles.keep)}
            >
              <TargetIcon size={13} aria-hidden />
              {format(m.trySaveExpecting, { value: actual })}
            </button>
          )}
        </div>
      )}
      {recordList}
    </div>
  )
}

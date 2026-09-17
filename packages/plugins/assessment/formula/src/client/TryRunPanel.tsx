import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Spinner } from '@qualy/ui/spinner'
import { ListPlusIcon, PlayIcon, TargetIcon } from 'lucide-react'
import type { NormalizedInputSchema } from '@qualy/value-schema'
import { InputValueForm } from '@qualy/web-value-form/InputValueForm'
import type { FieldDraft } from '@qualy/web-value-form/model'
import { formulaMessages as m } from './i18n.ts'

// One try-run: a form drawn from a contract, a run, and what came of it.
//
// The same panel serves the draft, a saved revision and a publication; what
// runs it is the caller's - a draft compiles its buffer, a publication runs
// the artifact it froze. Only the draft offers to keep a try as an example.

export interface TryOutcome {
  readonly actual?: string
  readonly refusal?: string
  readonly defect?: string
}

const styles = stylex.create({
  form: { paddingInline: 16, paddingBottom: 12 },
  pending: {
    display: 'flex',
    minHeight: 150,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginInline: 16,
    marginBottom: 14,
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
  actions: { display: 'flex', alignItems: 'center', gap: 12, paddingInline: 16, paddingBottom: 8 },
  inline: { display: 'inline-flex', minWidth: 0, alignItems: 'baseline', gap: 6, fontSize: 13 },
  inlineLabel: { flexShrink: 0, color: tokens.mutedForeground },
  inlineValue: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  note: {
    margin: 0,
    paddingInline: 16,
    paddingBottom: 8,
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
  // what a try can become, as one quiet line under the run
  keeps: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 10,
    paddingRight: 16,
    paddingBottom: 12,
  },
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
})

export function TryRunPanel({
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
}: {
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
}) {
  const { format, locale } = useI18n()

  if (schema === null)
    return (
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
    )

  const actual = result !== null && result.fresh ? result.outcome.actual : undefined
  return (
    <>
      <div {...stylex.props(styles.form)}>
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
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button size="sm" disabled={disabled || running} onClick={onRun}>
          <PlayIcon aria-hidden />
          {format(running ? m.running : m.run)}
        </Button>
        {actual === undefined ? null : (
          <span data-testid="formula-try-result" {...stylex.props(styles.inline)}>
            <span {...stylex.props(styles.inlineLabel)}>{format(m.resultLabel)}</span>
            <span {...stylex.props(styles.inlineValue)}>{actual}</span>
          </span>
        )}
      </div>
      {result === null || actual !== undefined ? null : (
        <p
          data-testid="formula-try-result"
          data-stale={result.fresh ? undefined : true}
          {...stylex.props(styles.note)}
        >
          {!result.fresh
            ? format(m.resultStale)
            : result.outcome.refusal !== undefined
              ? format(m.refusalPrefix, { message: result.outcome.refusal })
              : result.outcome.defect !== undefined
                ? format(m.defectPrefix, { message: result.outcome.defect })
                : format(m.testInputInvalid, { label: format(m.tryTitle) })}
        </p>
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
    </>
  )
}

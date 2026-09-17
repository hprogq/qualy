import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { EmptyRow } from '@qualy/ui/empty-row'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import type { NormalizedInputSchema } from '@qualy/value-schema'
import { formulaMessages as m } from './i18n.ts'
import { shortTime } from './library-styles.ts'
import { inputFactsOf } from './report-words.ts'
import type { TryRecord } from './try-records.ts'
import { workbenchStyles as w } from './workbench-styles.ts'

// The tries this browser remembers, as a drawer rather than a column.
//
// They are one person's on one device, they are capped, and they never travel
// with a publication, so they do not earn standing room beside the code. Each
// one gives what was asked, what came back and a way to ask it again; a try
// that ran against code since edited says so.

const styles = stylex.create({
  panel: { width: { default: 420, [breakpoints.phone]: null } },
  list: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column', overflowY: 'auto' },
  fill: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 24,
  },
  record: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    paddingBlock: 12,
    paddingInline: 24,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  line: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  when: {
    flexShrink: 0,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  old: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 18,
    paddingInline: 6,
    borderRadius: 5,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 10,
    color: tokens.surfaceMutedForeground,
  },
  resultLabel: { flexShrink: 0, fontSize: 11.5, color: tokens.mutedForeground },
  value: {
    flexShrink: 0,
    maxWidth: '55%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  valueBad: { color: tokens.danger },
  facts: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 12,
    rowGap: 2,
    fontSize: 11.5,
    lineHeight: '17px',
  },
  fact: { display: 'inline-flex', minWidth: 0, alignItems: 'baseline', gap: 5 },
  factsLabel: { flexShrink: 0, fontWeight: 500, color: tokens.surfaceMutedForeground },
  factLabel: {
    flexShrink: 0,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  factValue: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.surfaceMutedForeground,
  },
  reason: { fontSize: 11.5, lineHeight: 1.55, color: tokens.danger },
  again: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 26,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: { default: tokens.surface, ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    color: { default: tokens.foreground, ':disabled': tokens.mutedForeground },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  foot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 44,
    paddingInline: 24,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: tokens.surfaceInset,
  },
  clear: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    color: { default: tokens.surfaceMutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
})

export function TryRecordsDrawer({
  open,
  onOpenChange,
  narrow,
  records,
  schema,
  mark,
  onPick,
  onClear,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly narrow: boolean
  /** newest first */
  readonly records: readonly TryRecord[]
  /** the form's contract; without one a record cannot be put back */
  readonly schema: NormalizedInputSchema | null
  /** the current source's mark; a record with another ran against other code */
  readonly mark?: string
  readonly onPick: (record: TryRecord) => void
  readonly onClear: () => void
}) {
  const { format, locale } = useI18n()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={narrow ? 'bottom' : 'right'} xstyle={styles.panel}>
        <SheetHeader>
          <SheetTitle>{format(m.tryRecordsTitle)}</SheetTitle>
          <SheetDescription>{format(m.tryRecordsHint)}</SheetDescription>
        </SheetHeader>
        {records.length === 0 ? (
          <div {...stylex.props(styles.fill)}>
            <EmptyRow>{format(m.tryRecordsEmpty)}</EmptyRow>
          </div>
        ) : (
          <div data-testid="formula-try-records" {...stylex.props(styles.list)}>
            {records.map((record) => {
              const old = mark !== undefined && record.mark !== undefined && record.mark !== mark
              const failed = record.outcome.actual === undefined
              return (
                <div
                  key={record.id}
                  data-testid="formula-try-record"
                  {...stylex.props(styles.record)}
                >
                  <div {...stylex.props(styles.line)}>
                    <span {...stylex.props(styles.when)}>
                      {shortTime(new Date(record.at).toISOString(), locale)}
                    </span>
                    {old ? (
                      <span {...stylex.props(styles.old)}>{format(m.tryRecordOld)}</span>
                    ) : null}
                    <span {...stylex.props(styles.resultLabel)}>{format(m.resultLabel)}</span>
                    <span {...stylex.props(styles.value, failed && styles.valueBad)}>
                      {failed ? format(m.tryRecordFailed) : record.outcome.actual}
                    </span>
                    <span {...stylex.props(w.spring)} />
                    <button
                      type="button"
                      data-testid="formula-try-record-pick"
                      disabled={schema === null}
                      onClick={() => onPick(record)}
                      {...stylex.props(styles.again)}
                    >
                      {format(m.tryRecordPick)}
                    </button>
                  </div>
                  <div {...stylex.props(styles.facts)}>
                    <span {...stylex.props(styles.factsLabel)}>{format(m.testInputLabel)}</span>
                    {inputFactsOf(format, locale, schema, record.input).map((fact) => (
                      <span key={fact.label} {...stylex.props(styles.fact)}>
                        <span {...stylex.props(styles.factLabel)}>{fact.label}</span>
                        <span {...stylex.props(styles.factValue)}>{fact.value}</span>
                      </span>
                    ))}
                  </div>
                  {failed ? (
                    <span {...stylex.props(styles.reason)}>
                      {format(
                        record.outcome.refusal !== undefined
                          ? m.tryRecordRefused
                          : record.outcome.defect !== undefined
                            ? m.tryRecordCrashed
                            : m.tryRecordInvalid,
                      )}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
        {records.length === 0 ? null : (
          <div {...stylex.props(styles.foot)}>
            <span {...stylex.props(w.spring)} />
            <button type="button" onClick={onClear} {...stylex.props(styles.clear)}>
              {format(m.tryRecordsClear)}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

import { Fragment, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { EmptyRow } from '@qualy/ui/empty-row'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import type { NormalizedInputSchema } from '@qualy/value-schema'
import { formulaMessages as m } from './i18n.ts'
import { shortTime } from './library-styles.ts'
import { inputFactsOf, type InputFact } from './report-words.ts'
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
  // Open, the same facts one to a line. A contract of twenty parameters run
  // together reads as a paragraph nobody can find a value in, and wrapping
  // it differently does not help: what makes a value findable is that the
  // next one starts under it.
  factsOpen: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    columnGap: 12,
    rowGap: 3,
    margin: 0,
    fontSize: 11.5,
    lineHeight: '17px',
  },
  factsTerm: { color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)` },
  factsValue: { minWidth: 0, margin: 0, overflowWrap: 'anywhere', color: tokens.surfaceMutedForeground },
  more: {
    alignSelf: 'flex-start',
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
    fontFamily: 'inherit',
    fontSize: 11.5,
    color: tokens.mutedForeground,
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
    cursor: 'pointer',
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
                  <RecordFacts facts={inputFactsOf(format, locale, schema, record.input)} />
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

/** how many parameters a record shows before it offers the rest */
const FACTS_SHOWN = 3

/**
 * One run's input: a glance, and the whole of it on request.
 *
 * A short contract fits on the line it is already on. A long one does not,
 * and running twenty parameters together is a paragraph nobody can read a
 * value out of - so past a few the rest is behind a press, and opening it
 * puts each parameter on its own line where the next one starts under it.
 */
function RecordFacts({ facts }: { facts: readonly InputFact[] }) {
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  const rest = facts.length - FACTS_SHOWN
  if (open)
    return (
      <>
        <dl {...stylex.props(styles.factsOpen)} data-testid="formula-try-record-facts" data-open>
          {facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt {...stylex.props(styles.factsTerm)}>{fact.label}</dt>
              <dd {...stylex.props(styles.factsValue)}>{fact.value}</dd>
            </Fragment>
          ))}
        </dl>
        <button type="button" onClick={() => setOpen(false)} {...stylex.props(styles.more)}>
          {format(m.tryRecordFewerFacts)}
        </button>
      </>
    )
  // Shut, the same one-per-line list, just shorter. Three values packed
  // onto a line that wraps are three values in a paragraph; the whole point
  // of holding the rest back is that what is shown can be read down.
  return (
    <>
      <dl {...stylex.props(styles.factsOpen)} data-testid="formula-try-record-facts">
        {facts.slice(0, FACTS_SHOWN).map((fact) => (
          <Fragment key={fact.label}>
            <dt {...stylex.props(styles.factsTerm)}>{fact.label}</dt>
            <dd {...stylex.props(styles.factsValue)}>{fact.value}</dd>
          </Fragment>
        ))}
      </dl>
      {rest > 0 && (
        <button type="button" onClick={() => setOpen(true)} {...stylex.props(styles.more)}>
          {format(m.tryRecordMoreFacts, { count: rest })}
        </button>
      )}
    </>
  )
}

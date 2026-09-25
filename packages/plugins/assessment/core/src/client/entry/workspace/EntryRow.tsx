import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import { useBatchZone } from '../../batch/zone.ts'
import { EntryStanding } from '../EntryStanding.tsx'
import type { EntryDto } from '../model.ts'
import { momentOf, standingOf, type EntryLine } from './model.ts'

// One claim as one row: two lines that say which claim it is and what last
// happened to it, and a column that says what it counts for.
//
// The second line carries what the reader would otherwise open the drawer
// for: when a reviewer sent it back or asked for more, their words are right
// there. The version number is not - it belongs to the account in the drawer,
// where versions are what the reader is looking at.

const styles = stylex.create({
  row: {
    display: 'grid',
    width: '100%',
    alignItems: 'center',
    columnGap: 14,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.background})`,
    },
    paddingBlock: 14,
    textAlign: 'left',
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  // at a desk the status stands in its own column; narrower it folds into
  // the second line, beside the time
  rowDesk: {
    gridTemplateColumns: 'minmax(0, 1fr) 6.5rem auto 14px',
    paddingInline: 28,
  },
  rowCompact: {
    gridTemplateColumns: 'minmax(0, 1fr) auto 14px',
    paddingInline: 16,
  },
  rowOn: {
    backgroundColor: tokens.selectedSurface,
  },
  main: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
  },
  identity: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
  },
  lead: {
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  },
  sub: {
    minWidth: 0,
    flexShrink: 9,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.surfaceMutedForeground,
  },
  second: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  keep: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  rule: {
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: tokens.border,
  },
  note: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  noteWaits: {
    color: tokens.warningForeground,
  },
  tagCell: {
    display: 'flex',
    justifyContent: 'center',
  },
  amount: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 3,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  amountValue: {
    fontSize: 14.5,
    lineHeight: 1.2,
    fontWeight: 600,
  },
  amountInk: { color: tokens.foreground },
  amountPending: { color: `color-mix(in oklab, ${tokens.mutedForeground} 75%, transparent)` },
  amountNegative: { color: tokens.danger },
  amountWord: {
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  chevron: {
    width: 14,
    height: 14,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
})

export function EntryRow({
  entry,
  line,
  compact,
  selected,
  onOpen,
}: {
  entry: EntryDto
  line: EntryLine
  /** tablet and phone: the status folds into the second line */
  compact: boolean
  /** the claim open in the drawer right now */
  selected: boolean
  onOpen: () => void
}) {
  const { format, locale } = useI18n()
  const zone = useBatchZone()
  const when = momentOf(line.at, locale, zone)
  const standing = (
    <EntryStanding
      status={entry.status}
      source={entry.source}
      revised={entry.currentReviewInstanceId !== null}
      asked={entry.supplement !== null}
      openRound={entry.openRound}
      size={compact ? 'default' : 'roomy'}
    />
  )
  return (
    <button
      type="button"
      data-testid="claim-row"
      data-entry={entry.id}
      data-standing={standingOf(entry)}
      data-files={String(line.files)}
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen}
      {...stylex.props(
        styles.row,
        compact ? styles.rowCompact : styles.rowDesk,
        selected && styles.rowOn,
      )}
    >
      <span {...stylex.props(styles.main)}>
        <span {...stylex.props(styles.identity)}>
          <span {...stylex.props(styles.lead)}>{line.lead}</span>
          {line.sub !== '' && <span {...stylex.props(styles.sub)}>{line.sub}</span>}
        </span>
        <span {...stylex.props(styles.second)}>
          {compact && standing}
          <span {...stylex.props(styles.keep)}>
            {format(m.entriesWhen, { when, action: format(line.action) })}
          </span>
          {line.files > 0 && (
            <>
              <span aria-hidden {...stylex.props(styles.rule)} />
              <span {...stylex.props(styles.keep)}>
                {format(m.entriesFiles, { count: line.files })}
              </span>
            </>
          )}
          {line.note !== null && (
            <>
              <span aria-hidden {...stylex.props(styles.rule)} />
              <span
                data-note={line.note.kind}
                {...stylex.props(styles.note, line.note.kind !== 'refusal' && styles.noteWaits)}
              >
                {line.note.kind === 'return'
                  ? format(m.entriesNoteReturned, { text: line.note.text })
                  : line.note.kind === 'ask'
                    ? format(m.entriesNoteAsked, { text: line.note.text })
                    : line.note.text}
              </span>
            </>
          )}
        </span>
      </span>
      {!compact && <span {...stylex.props(styles.tagCell)}>{standing}</span>}
      <span {...stylex.props(styles.amount)} data-amount={line.amount ?? ''}>
        {line.amount !== null && (
          <span
            {...stylex.props(
              styles.amountValue,
              line.amountTone === 'negative'
                ? styles.amountNegative
                : line.amountTone === 'ink'
                  ? styles.amountInk
                  : styles.amountPending,
            )}
          >
            {line.amount}
          </span>
        )}
        <span {...stylex.props(styles.amountWord)}>{format(line.amountWord)}</span>
      </span>
      <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
    </button>
  )
}

import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import { useBatchZone } from '../../batch/zone.ts'
import { EntryStanding } from '../EntryStanding.tsx'
import type { EntryDto } from '../model.ts'
import { UnreadDot } from './marks.tsx'
import { LineParts } from './LineText.tsx'
import { momentOf, standingOf, type EntryLine } from './model.ts'

// One claim as one row: two lines that say which claim it is and what last
// happened to it, and a column that says what it counts for.
//
// The second line carries what the reader would otherwise open the drawer
// for: when a reviewer sent it back or asked for more, their words are right
// there. The version number is not - it belongs to the account in the drawer,
// where versions are what the reader is looking at.
//
// A claim holding news its owner has not read wears a red dot before its
// name, and its name in a heavier weight, until it is opened.

const styles = stylex.create({
  row: {
    position: 'relative',
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
  // at a desk the status stands in its own column, the list's columns
  // (ItemPane's rowsDesk) shared by every row; narrower it folds into the
  // second line, beside the time
  rowDesk: {
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    paddingInline: 28,
  },
  rowCompact: {
    gridTemplateColumns: 'minmax(0, 1fr) auto 14px',
    paddingInline: 16,
  },
  rowOn: {
    backgroundColor: tokens.selectedSurface,
  },
  // At the head of the name's line and level with it. At a desk it hangs in
  // the row's margin, so nothing on the row moves for it; a narrow row's
  // margin is too slight to hold it clear of the edge, so there it stands
  // before the name.
  unread: { alignSelf: 'center' },
  // 28 of margin: the dot 11 in from the edge, the name where it always is
  unreadHanging: { marginLeft: -17, marginRight: 3 },
  leadUnread: { fontWeight: 600 },
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
  // two lines at most, whole words, under the status line
  noteOwnLine: {
    display: '-webkit-box',
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: 'normal',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    color: tokens.mutedForeground,
  },
  mine: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 20,
    borderRadius: 6,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.warning} 60%, transparent)`,
    paddingInline: 7,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
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
  awaitingMe = false,
  unread = false,
  withItem = false,
  onOpen,
}: {
  entry: EntryDto
  line: EntryLine
  /** the owner has news on it they have not read; nobody else is told */
  unread?: boolean
  /** it ended voided under a question since withdrawn */
  withItem?: boolean
  /** a staff reader's own review is what this claim waits on */
  awaitingMe?: boolean
  /** tablet and phone: the status folds into the second line */
  compact: boolean
  /** the claim open in the drawer right now */
  selected: boolean
  onOpen: () => void
}) {
  const { format, locale } = useI18n()
  const zone = useBatchZone()
  const [lead, ...rest] = line.parts
  const when = momentOf(line.at, locale, zone)
  const standing = (
    <EntryStanding
      status={entry.status}
      source={entry.source}
      revised={entry.currentReviewInstanceId !== null}
      asked={entry.supplement !== null}
      openRound={entry.openRound}
      withItem={withItem}
      size={compact ? 'default' : 'roomy'}
    />
  )
  const said =
    line.note === null ? null : (
      <span
        data-note={line.note.kind}
        {...stylex.props(
          styles.note,
          compact && styles.noteOwnLine,
          line.note.kind !== 'refusal' && styles.noteWaits,
        )}
      >
        {line.note.kind === 'return'
          ? format(m.entriesNoteReturned, { text: line.note.text })
          : line.note.kind === 'ask'
            ? format(m.entriesNoteAsked, { text: line.note.text })
            : line.note.text}
      </span>
    )
  return (
    <button
      type="button"
      data-testid="claim-row"
      data-entry={entry.id}
      data-standing={standingOf(entry)}
      data-files={String(line.files)}
      data-awaiting-me={awaitingMe || undefined}
      data-unread={unread || undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen}
      {...stylex.props(
        styles.row,
        compact ? styles.rowCompact : styles.rowDesk,
        selected && styles.rowOn,
      )}
    >
      <span {...stylex.props(styles.main)}>
        {unread && <VisuallyHidden>{format(m.claimUnread)}</VisuallyHidden>}
        <span {...stylex.props(styles.identity)}>
          {unread && <UnreadDot xstyle={[styles.unread, !compact && styles.unreadHanging]} />}
          <span data-part="lead" {...stylex.props(styles.lead, unread && styles.leadUnread)}>
            {lead === undefined ? line.lead : <LineParts parts={[lead]} />}
          </span>
          {rest.length > 0 && (
            <span data-part="sub" {...stylex.props(styles.sub)}>
              <LineParts parts={rest} />
            </span>
          )}
        </span>
        {/* a claim that ended says how in its standing, with no time to put
            beside it: at a desk that can leave this line with nothing on it */}
        {(compact || awaitingMe || line.dated || line.files > 0 || line.note !== null) && (
          <span {...stylex.props(styles.second)}>
            {compact && standing}
            {awaitingMe && (
              <span {...stylex.props(styles.mine)}>{format(m.entriesAwaitingYou)}</span>
            )}
            {line.dated && (
              <span data-when="" {...stylex.props(styles.keep)}>
                {format(m.entriesWhen, { when, action: format(line.action) })}
              </span>
            )}
            {line.files > 0 && (
              <>
                {line.dated && <span aria-hidden {...stylex.props(styles.rule)} />}
                <span {...stylex.props(styles.keep)}>
                  {format(m.entriesFiles, { count: line.files })}
                </span>
              </>
            )}
            {line.note !== null && !compact && (
              <>
                <span aria-hidden {...stylex.props(styles.rule)} />
                {said}
              </>
            )}
          </span>
        )}
        {/* narrow, the reviewer's words get a line of their own: squeezed in
            after the status and the time there is no room left to read them */}
        {line.note !== null && compact && said}
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

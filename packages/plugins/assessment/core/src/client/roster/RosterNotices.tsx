import type { ReactNode } from 'react'
import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'

// What the roster is waiting on its administrator for, over the list: the
// organization having people somewhere other than this round does, and
// people some question's review steps find nowhere (§32.93). One box, a
// line for each thing and the button that opens it; side by side where the
// page is wide enough, one under the other where it is not. The rows
// themselves are a press away: the subject of the page is the roster, and
// it has to start near the top of the screen.

const styles = stylex.create({
  // The lines are laid on the rule's own colour a hair apart, so the rule
  // between two falls wherever they meet: down the middle when they share a
  // row, across it when one wraps under the other.
  root: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 1,
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.border,
  },
  line: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '18rem',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingBlock: 6,
    paddingInlineStart: 14,
    paddingInlineEnd: 8,
    backgroundColor: tokens.surface,
  },
  icon: { width: 16, height: 16, flexShrink: 0 },
  // amber, as everything waiting on somebody's decision is said
  decide: { color: tokens.warning },
  inform: { color: tokens.mutedForeground },
  words: {
    minWidth: 0,
    flexGrow: 1,
    margin: 0,
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.foreground,
  },
  action: { flexShrink: 0 },
})

function Line({
  tone,
  words,
  action,
  onOpen,
  ...data
}: {
  /** waiting on a decision, or only worth knowing */
  tone: 'decide' | 'inform'
  words: ReactNode
  action: string
  onOpen: () => void
} & Record<`data-${string}`, string>) {
  const Icon = tone === 'decide' ? TriangleAlertIcon : InfoIcon
  return (
    <div data-tone={tone} {...data} {...stylex.props(styles.line)}>
      <Icon aria-hidden {...stylex.props(styles.icon, styles[tone])} />
      <p {...stylex.props(styles.words)}>{words}</p>
      <Button
        size="sm"
        variant="outline"
        className={stylex.props(styles.action).className}
        onClick={onOpen}
      >
        {action}
      </Button>
    </div>
  )
}

export function RosterNotices({
  placements,
  cannotSubmit,
  onPlacements,
  onUnreachable,
}: {
  /** people the organization has somewhere else, and people it has nowhere; null while unread */
  placements: { readonly changedTotal: number; readonly unavailableTotal: number } | null
  /** people some question's ordinary route finds nowhere, each counted once; null while unread */
  cannotSubmit: number | null
  onPlacements: () => void
  onUnreachable: () => void
}) {
  const { format } = useI18n()
  const moved =
    placements !== null && (placements.changedTotal > 0 || placements.unavailableTotal > 0)
      ? placements
      : null
  const stuck = cannotSubmit !== null && cannotSubmit > 0 ? cannotSubmit : null
  if (moved === null && stuck === null) return null
  return (
    <div data-testid="roster-notices" {...stylex.props(styles.root)}>
      {moved !== null && (
        <Line
          data-testid="placement-notice"
          data-changed={String(moved.changedTotal)}
          data-unavailable={String(moved.unavailableTotal)}
          // somebody moved is the reader's to decide; somebody the
          // organization has nowhere is only theirs to know about
          tone={moved.changedTotal > 0 ? 'decide' : 'inform'}
          words={
            moved.changedTotal > 0
              ? format(m.placementPrompt, { count: moved.changedTotal })
              : format(m.placementUnavailablePrompt, { count: moved.unavailableTotal })
          }
          action={format(m.placementOpen)}
          onOpen={onPlacements}
        />
      )}
      {stuck !== null && (
        <Line
          data-testid="unreachable-notice"
          data-count={String(stuck)}
          tone="decide"
          words={format(m.rosterUnreachablePrompt, { count: stuck })}
          action={format(m.rosterUnreachableOpen)}
          onOpen={onUnreachable}
        />
      )}
    </div>
  )
}

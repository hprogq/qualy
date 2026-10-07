import { ChevronRightIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Tooltip, TooltipContent, TooltipTrigger } from '@qualy/ui/tooltip'
import * as m from '#messages'

// Changes belong beside the page's title. Each is one compact action with
// its complete explanation available to focus, hover and assistive readers.
// Loading or resolving a notice never inserts another band above the list.
const styles = stylex.create({
  root: { display: 'flex', minWidth: 0, maxWidth: '32rem', gap: 4, alignItems: 'center' },
  line: { display: 'flex', minWidth: 0, flexShrink: 1 },
  button: { minWidth: 0, maxWidth: '100%', paddingInline: 8, gap: 6 },
  icon: { width: 15, height: 15, flexShrink: 0 },
  decide: { color: tokens.warning },
  inform: { color: tokens.mutedForeground },
  words: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
    display: { default: 'inline', [breakpoints.phone]: 'none' },
  },
  count: {
    display: { default: 'none', [breakpoints.phone]: 'inline' },
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  arrow: { width: 12, height: 12, flexShrink: 0, color: tokens.mutedForeground },
})

function Line({
  tone,
  words,
  count,
  action,
  onOpen,
  ...data
}: {
  tone: 'decide' | 'inform'
  words: string
  count: number
  action: string
  onOpen: () => void
} & Record<`data-${string}`, string>) {
  const Icon = tone === 'decide' ? TriangleAlertIcon : InfoIcon
  return (
    <div data-tone={tone} {...data} {...stylex.props(styles.line)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${words} · ${action}`}
            className={stylex.props(styles.button).className}
            onClick={onOpen}
          >
            <Icon aria-hidden {...stylex.props(styles.icon, styles[tone])} />
            <span aria-hidden {...stylex.props(styles.words)}>
              {words}
            </span>
            <span aria-hidden {...stylex.props(styles.count)}>
              {count}
            </span>
            <ChevronRightIcon aria-hidden {...stylex.props(styles.arrow)} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {words} · {action}
        </TooltipContent>
      </Tooltip>
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
              ? m.placement_prompt({ count: moved.changedTotal })
              : m.placement_unavailablePrompt({ count: moved.unavailableTotal })
          }
          count={moved.changedTotal || moved.unavailableTotal}
          action={m.placement_open()}
          onOpen={onPlacements}
        />
      )}
      {stuck !== null && (
        <Line
          data-testid="unreachable-notice"
          data-count={String(stuck)}
          tone="decide"
          words={m.roster_unreachablePrompt({ count: stuck })}
          count={stuck}
          action={m.roster_unreachableOpen()}
          onOpen={onUnreachable}
        />
      )}
    </div>
  )
}

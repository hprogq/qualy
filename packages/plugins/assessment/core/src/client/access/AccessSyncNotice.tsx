import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import * as m from '#messages'

// One line saying something changed, and the button that opens it.
//
// The changes themselves can run to thousands of rows, so they are not what a
// reader meets on arrival: the subject of this page is the people working on
// the batch, and it has to start at the top of the screen.
//
// A decision somebody owes is amber; a lapse that already took effect is a
// grey line with an i, worth knowing and nothing to alarm anybody about. The
// button stands in the line's own flow, at its end - it used to hang over the
// words from a corner, with padding guessed wide enough to keep them apart.

const styles = stylex.create({
  bar: {
    display: 'flex',
    flexWrap: { default: 'nowrap', [breakpoints.phone]: 'wrap' },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 10,
    borderRadius: tokens.radiusLg,
    paddingInlineStart: 14,
    paddingInlineEnd: 10,
    paddingBlock: 8,
    fontSize: 13.5,
    lineHeight: 1.5,
  },
  decide: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 9%, ${tokens.surface})`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.warning} 32%, transparent)`,
  },
  lapsed: {
    backgroundColor: tokens.surface,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  icon: { flexShrink: 0, width: 16, height: 16 },
  iconDecide: { color: tokens.warning },
  iconLapsed: { color: tokens.mutedForeground },
  words: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: { default: 'auto', [breakpoints.phone]: 'calc(100% - 28px)' },
    textWrap: 'pretty',
  },
  open: {
    flexShrink: 0,
    marginInlineStart: { default: null, [breakpoints.phone]: 28 },
  },
})

export function AccessSyncNotice({
  pendingTotal,
  lapsedTotal,
  onOpen,
}: {
  pendingTotal: number
  lapsedTotal: number
  onOpen: () => void
}) {
  if (pendingTotal === 0 && lapsedTotal === 0) return null
  const decide = pendingTotal > 0

  return (
    // what the round is being told about its own staffing, as counts: a
    // decision owed, or a lapse to be aware of
    <div
      role="status"
      data-testid="access-sync-notice"
      data-kind={decide ? 'decide' : 'lapsed'}
      data-pending={String(pendingTotal)}
      data-lapsed={String(lapsedTotal)}
      {...stylex.props(styles.bar, decide ? styles.decide : styles.lapsed)}
    >
      {decide ? (
        <TriangleAlertIcon aria-hidden {...stylex.props(styles.icon, styles.iconDecide)} />
      ) : (
        <InfoIcon aria-hidden {...stylex.props(styles.icon, styles.iconLapsed)} />
      )}
      <span {...stylex.props(styles.words)}>
        {(decide ? m.access_syncPrompt : m.access_syncLapsedPrompt)()}
      </span>
      <Button
        size="sm"
        variant="outline"
        className={stylex.props(styles.open).className}
        onClick={onOpen}
      >
        {m.access_syncOpen()}
      </Button>
    </div>
  )
}

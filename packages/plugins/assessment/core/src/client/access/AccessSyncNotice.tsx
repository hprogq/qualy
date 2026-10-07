import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import * as m from '#messages'

// One line saying something changed, and the button that opens it.
//
// The changes themselves can run to thousands of rows, so they are not what a
// reader meets on arrival: the subject of this page is the people working on
// the batch, and it has to start at the top of the screen.
//
// A decision somebody owes is amber; a lapse that already took effect is grey.
// The summary shares the page heading instead of adding a banner above the work.

const styles = stylex.create({
  bar: {
    display: 'flex',
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'center',
    columnGap: 8,
    fontSize: 13,
    lineHeight: 1.5,
  },
  icon: { flexShrink: 0, width: 16, height: 16 },
  iconDecide: { color: tokens.warning },
  iconLapsed: { color: tokens.mutedForeground },
  words: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  open: {
    flexShrink: 0,
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
      title={(decide ? m.access_syncPrompt : m.access_syncLapsedPrompt)()}
      {...stylex.props(styles.bar)}
    >
      {decide ? (
        <TriangleAlertIcon aria-hidden {...stylex.props(styles.icon, styles.iconDecide)} />
      ) : (
        <InfoIcon aria-hidden {...stylex.props(styles.icon, styles.iconLapsed)} />
      )}
      <span {...stylex.props(styles.words)}>
        {decide
          ? m.access_syncPendingCount({ count: pendingTotal })
          : m.access_syncLapsedCount({ count: lapsedTotal })}
      </span>
      <Button
        size="xs"
        variant="outline"
        className={stylex.props(styles.open).className}
        onClick={onOpen}
      >
        {m.access_syncOpen()}
      </Button>
    </div>
  )
}

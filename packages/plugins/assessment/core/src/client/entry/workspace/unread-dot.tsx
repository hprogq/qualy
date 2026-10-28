import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The unread dot, apart from the other marks: the batch overview draws it
// beside its notices and nothing else of marks.tsx, whose figures bring the
// workspace's model and the motion library with them.

const styles = stylex.create({
  dot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: 9999,
    backgroundColor: tokens.danger,
  },
})

/**
 * One claim with news its owner has not read. Drawn where the caller puts
 * it, and hidden from assistive technology: the caller says "unread" in
 * words where it reads the claim out.
 */
export function UnreadDot({ xstyle }: { xstyle?: stylex.StyleXStyles }) {
  return <span aria-hidden data-testid="unread-dot" {...stylex.props(styles.dot, xstyle)} />
}

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

const styles = stylex.create({
  seat: {
    display: 'flex',
    justifyContent: 'center',
    flexShrink: 0,
    minHeight: 108,
    pointerEvents: 'none',
  },
  viewport: {
    // Without inline insets, the fixed child's static position is still
    // centered by the flex container in the page's content column.
    position: 'fixed',
    bottom: 'var(--q-shell-foot-room, env(safe-area-inset-bottom, 0px))',
    width: 'min(424px, 100vi)',
    zIndex: 40,
  },
})

export function BatchNoticeViewport({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.seat)}>
      <div data-slot="batch-notice-viewport" {...stylex.props(styles.viewport)}>
        {children}
      </div>
    </div>
  )
}

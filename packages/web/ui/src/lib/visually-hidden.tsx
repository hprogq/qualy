'use client'

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

/**
 * Visually hides announced-only content without affecting document overflow.
 *
 * The logical insets are intentional: an absolutely positioned hidden node
 * left at its static position can extend the document from inside long or
 * horizontally scrolling layouts. Keep these in sync with the overflow
 * regression tests (visually-hidden.browser.test.tsx).
 *
 * This is announced-but-not-shown, not hidden-until-focus. A skip link or any
 * control that reveals itself on focus needs its own primitive; pinning to
 * the containing block's origin is right for a label and wrong for something
 * that has to appear where it belongs.
 */
export const a11yStyles = stylex.create({
  visuallyHidden: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: 0,
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
  },
})

/** a label a screen reader reads and a screen does not */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span {...stylex.props(a11yStyles.visuallyHidden)}>{children}</span>
}

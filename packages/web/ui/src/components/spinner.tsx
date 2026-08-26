import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Loader2Icon } from 'lucide-react'

import { seatOf } from '../lib/xstyle.ts'

// Work in progress, wherever a screen has to wait.
//
// Deliberately NOT the widget library's loader: the first places this
// renders are the i18n catalog fallback and the manifest loading screen -
// both stand OUTSIDE the widget provider, which mounts further down the
// same tree. A provider-dependent loader there throws before the app can
// draw anything (it did). So the spinner is a bare SVG and a compiled
// keyframe, needing nothing, and it takes the ink of whatever names it.

const spin = stylex.keyframes({
  '100%': { transform: 'rotate(360deg)' },
})

const styles = stylex.create({
  mark: {
    width: 16,
    height: 16,
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  screen: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenMark: {
    width: 32,
    height: 32,
  },
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 96,
  },
  pageMark: {
    width: 24,
    height: 24,
  },
})

interface SpinnerProps {
  'aria-label'?: string
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

function Spinner({ className, style, xstyle, ...rest }: SpinnerProps) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      {...rest}
      {...seatOf(stylex.props(styles.mark, xstyle), className, style)}
    />
  )
}

// the two loading surfaces the app composes from the spinner
function LoadingScreen() {
  return (
    <div {...stylex.props(styles.screen)}>
      <Spinner xstyle={styles.screenMark} />
    </div>
  )
}

/** fills the content area of a page without claiming the whole viewport */
function PageLoading() {
  return (
    <div {...stylex.props(styles.page)}>
      <Spinner xstyle={styles.pageMark} />
    </div>
  )
}

export { Spinner, LoadingScreen, PageLoading }

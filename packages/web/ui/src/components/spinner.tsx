import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Loader } from '@qualy/brand/loader'
import { VisuallyHidden } from '../lib/visually-hidden.tsx'
import { seatOf } from '../lib/xstyle.ts'

const appear = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  // the whole of the page seat, not a band of it: the shell's seat is a
  // growing flex column, and this grows with it, so the loader sits at
  // the centre of the room the page will take - between the bars and the
  // foot, not of the viewport
  page: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 24,
  },
  // opacity from 0, with the delay counted in: a page that comes in under
  // 300ms never shows this at all
  lateArrival: {
    animationName: appear,
    animationDuration: '150ms',
    animationDelay: '300ms',
    animationFillMode: 'both',
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

/** the inline indicator: 16px, light polarity, shown at once and gone at once */
function Spinner({ className, style, xstyle, ...rest }: SpinnerProps) {
  return (
    <Loader
      size={16}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      {...rest}
      {...seatOf(stylex.props(xstyle), className, style)}
    />
  )
}

/** Local content can wait without replacing the document with a boot screen. */
function PageLoading() {
  return (
    <div {...stylex.props(styles.page)} role="status" data-band-foot="">
      <Loader size={24} xstyle={styles.lateArrival} />
      <VisuallyHidden>Loading</VisuallyHidden>
    </div>
  )
}

export { Spinner, PageLoading }

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'

// The empty state: centred, given room, one voice for "there is nothing here
// yet". Icon geometry and prose links for caller-provided content live in
// theme.css under [data-slot='empty-*'] - descendants of arbitrary children
// are the one thing compiled styles cannot reach.
//
// Two sizes. The default is a screen's or a panel's: forty pixels of air and
// a title a step above the body. The compact one is for a dialog, or any box
// whose own title already sits right above it: a dialog with nothing to act
// on still says what happened, why and where to go instead, but in the
// dialog's own measure, so the state does not outshout the dialog's title.

type EmptySize = 'default' | 'compact'

/** the size the root was given, read by the parts inside it */
const SizeContext = React.createContext<EmptySize>('default')

const styles = stylex.create({
  root: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: tokens.radiusLg,
    // dashed but zero-width: a caller opts into the visible border, exactly
    // as the utility pair border + border-dashed composed before
    borderWidth: 0,
    borderStyle: 'dashed',
    // one value, not the two axes: a caller's own `padding` has to win over
    // it, and longhands here would beat a shorthand there
    padding: 40,
    textAlign: 'center',
    textWrap: 'balance',
  },
  // a dialog's measure: less air, and a floor that keeps the state from
  // collapsing to a line when it is all the dialog holds
  rootCompact: {
    minHeight: '10rem',
    gap: 14,
    padding: '24px 16px',
  },
  // An empty state says one quiet thing. It is set below the page's own
  // title rather than above it: a state drawn larger than the name of the
  // page it sits in becomes the loudest thing there, and all it has to say
  // is that there is nothing.
  header: {
    display: 'flex',
    maxWidth: '24rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  media: {
    marginBottom: 6,
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // a line drawing in grey with no tile under it: the tile made the glyph a
  // button-sized object, the heaviest thing on a screen with nothing on it
  mediaIcon: {
    color: `color-mix(in oklab, ${tokens.mutedForeground} 75%, transparent)`,
  },
  title: {
    fontSize: 15,
    lineHeight: 1.4,
    fontWeight: 600,
  },
  titleCompact: {
    fontSize: 14,
  },
  description: {
    fontSize: 13,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
  content: {
    display: 'flex',
    width: '100%',
    maxWidth: '24rem',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    textWrap: 'balance',
  },
})

function Empty({
  className,
  xstyle,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'div'>, 'style'> & {
  /** the standard StyleX seat; `className` is the legacy escape hatch */
  xstyle?: StyleXStyles
  /** `compact` inside a dialog or any box that already carries a title */
  size?: EmptySize
}) {
  const sx = stylex.props(styles.root, size === 'compact' && styles.rootCompact, xstyle)
  return (
    <SizeContext value={size}>
      <div
        data-slot="empty"
        data-size={size}
        {...props}
        {...sx}
        className={clsx(sx.className, className)}
      />
    </SizeContext>
  )
}

function EmptyHeader({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'div'> & { xstyle?: StyleXStyles }) {
  const sx = stylex.props(styles.header, xstyle)
  return (
    <div data-slot="empty-header" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function EmptyMedia({
  className,
  variant = 'default',
  xstyle,
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'icon'; xstyle?: StyleXStyles }) {
  const sx = stylex.props(styles.media, variant === 'icon' && styles.mediaIcon, xstyle)
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    />
  )
}

function EmptyTitle({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'div'> & { xstyle?: StyleXStyles }) {
  const compact = React.use(SizeContext) === 'compact'
  const sx = stylex.props(styles.title, compact && styles.titleCompact, xstyle)
  return (
    <div data-slot="empty-title" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function EmptyDescription({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'p'> & { xstyle?: StyleXStyles }) {
  const sx = stylex.props(styles.description, xstyle)
  return (
    <div
      data-slot="empty-description"
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    />
  )
}

function EmptyContent({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'div'> & { xstyle?: StyleXStyles }) {
  const sx = stylex.props(styles.content, xstyle)
  return (
    <div data-slot="empty-content" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia }

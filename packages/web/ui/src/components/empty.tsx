import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'

// The empty state: centred, given room, one voice for "there is nothing here
// yet". Icon geometry and prose links for caller-provided content live in
// theme.css under [data-slot='empty-*'] - descendants of arbitrary children
// are the one thing compiled styles cannot reach.

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
    gap: 16,
    borderRadius: tokens.radiusLg,
    // dashed but zero-width: a caller opts into the visible border, exactly
    // as the utility pair border + border-dashed composed before
    borderWidth: 0,
    borderStyle: 'dashed',
    padding: 48,
    textAlign: 'center',
    textWrap: 'balance',
  },
  header: {
    display: 'flex',
    maxWidth: '24rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  media: {
    marginBottom: 8,
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaIcon: {
    width: 40,
    height: 40,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.foreground,
  },
  title: {
    fontSize: '1.125rem',
    lineHeight: '1.75rem',
    fontWeight: 500,
    letterSpacing: '-0.025em',
  },
  description: {
    fontSize: '0.875rem',
    lineHeight: 1.625,
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
  style,
  ...props
}: Omit<React.ComponentProps<'div'>, 'style'> & {
  /** StyleX overrides from product callers; legacy callers keep className */
  style?: StyleXStyles
}) {
  const sx = stylex.props(styles.root, style)
  return <div data-slot="empty" {...props} {...sx} className={clsx(sx.className, className)} />
}

function EmptyHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.header)
  return (
    <div data-slot="empty-header" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'icon' }) {
  const sx = stylex.props(styles.media, variant === 'icon' && styles.mediaIcon)
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

function EmptyTitle({ className, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.title)
  return (
    <div data-slot="empty-title" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const sx = stylex.props(styles.description)
  return (
    <div
      data-slot="empty-description"
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.content)
  return (
    <div data-slot="empty-content" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia }

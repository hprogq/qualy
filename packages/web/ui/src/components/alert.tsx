import { createContext, use } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'

// the description tints with the alert's tone; context says which tone,
// so the child styles by state instead of a stylesheet digging by variant
const ToneCtx = createContext<'default' | 'destructive'>('default')

// One sentence with standing: an icon seat, a title, a description, and an
// optional action pinned to the corner. What depends on caller-provided
// children - the icon's grid seat, prose links, the destructive tint on the
// description - lives in theme.css under [data-slot='alert'], where a
// descendant of arbitrary content can still be reached.

const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'grid',
    width: '100%',
    gap: 2,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 12,
    textAlign: 'left',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    backgroundColor: tokens.surface,
    color: tokens.foreground,
  },
  destructive: {
    color: tokens.danger,
  },
  title: {
    fontWeight: 500,
  },
  description: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    textWrap: {
      default: 'balance',
      '@media (min-width: 768px)': 'pretty',
    },
    color: tokens.mutedForeground,
  },
  descriptionDestructive: {
    color: `color-mix(in oklab, ${tokens.danger} 90%, transparent)`,
  },
  action: {
    position: 'absolute',
    top: 10,
    right: 12,
  },
})

function Alert({
  className,
  variant = 'default',
  xstyle,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'destructive'
  /** the standard StyleX seat; `className` is the legacy escape hatch */
  xstyle?: StyleXStyles
}) {
  const sx = stylex.props(styles.root, variant === 'destructive' && styles.destructive, xstyle)
  const { children, ...rest } = props
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role="alert"
      {...sx}
      {...rest}
      className={clsx(sx.className, className)}
    >
      <ToneCtx value={variant}>{children}</ToneCtx>
    </div>
  )
}

function AlertTitle({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'div'> & { xstyle?: StyleXStyles }) {
  const sx = stylex.props(styles.title, xstyle)
  return (
    <div data-slot="alert-title" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function AlertDescription({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'div'> & { xstyle?: StyleXStyles }) {
  const tone = use(ToneCtx)
  const sx = stylex.props(
    styles.description,
    tone === 'destructive' && styles.descriptionDestructive,
    xstyle,
  )
  return (
    <div
      data-slot="alert-description"
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    />
  )
}

function AlertAction({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'div'> & { xstyle?: StyleXStyles }) {
  const sx = stylex.props(styles.action, xstyle)
  return (
    <div data-slot="alert-action" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }

import { createContext, use } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'

// the description tints with the alert's tone; context says which tone,
// so the child styles by state instead of a stylesheet digging by variant
const ToneCtx = createContext<'default' | 'destructive'>('default')

// One sentence with standing: an icon seat, a title, a description, and an
// optional action pinned to the corner.
//
// Whether there IS an icon, or an action, is something the caller decides by
// what it passes as children - so the alert asks its own box with `:has()`
// rather than being told. The title needs the same answer but cannot ask it
// (the condition is on its parent), so the root hands it down as a variable.
// What is left in theme.css is only what a compiled style cannot reach at
// all: the caller's own icon element, and links inside caller prose.

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
    paddingInlineStart: 16,
    // room for the action pinned to the corner, when there is one
    paddingInlineEnd: { default: 16, ':has([data-slot="alert-action"])': '4.5rem' },
    paddingBlock: 12,
    // a second column, only once an icon is actually sitting in it
    gridTemplateColumns: { default: null, ':has(> svg)': 'auto 1fr' },
    columnGap: { default: null, ':has(> svg)': '0.625rem' },
    '--q-alert-title-column': { default: 'auto', ':has(> svg)': '2' },
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
    // beside the icon rather than under it, when the root says there is one
    gridColumnStart: 'var(--q-alert-title-column, auto)',
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

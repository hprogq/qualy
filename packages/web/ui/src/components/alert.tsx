import * as stylex from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'

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
  action: {
    position: 'absolute',
    top: 10,
    right: 12,
  },
})

function Alert({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'destructive' }) {
  const sx = stylex.props(styles.root, variant === 'destructive' && styles.destructive)
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role="alert"
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.title)
  return (
    <div data-slot="alert-title" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.description)
  return (
    <div
      data-slot="alert-description"
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.action)
  return (
    <div data-slot="alert-action" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }

import { createContext, use } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'
import { breakpoints } from '../theme/breakpoints.stylex.ts'

type AlertTone = 'default' | 'destructive' | 'warning'
type AlertLayout = 'block' | 'line'

// the description tints with the alert's tone and the action sits by the
// alert's layout; context says which, so the children style by state
// instead of a stylesheet digging by variant
const ToneCtx = createContext<AlertTone>('default')
const LayoutCtx = createContext<AlertLayout>('block')

// One sentence with standing: an icon seat, a title, a description, and an
// optional action.
//
// Whether there IS an icon, or an action, is something the caller decides by
// what it passes as children - so the alert asks its own box with `:has()`
// rather than being told. The title needs the same answer but cannot ask it
// (the condition is on its parent), so the root hands it down as a variable.
// What is left in theme.css is only what a compiled style cannot reach at
// all: the caller's own icon element, and links inside caller prose.
//
// Two layouts. A `block` alert pins its action to the corner, over room
// kept for it - right for a title with a body under it. A `line` alert is
// one sentence and the key that acts on it: the key stands in the line's
// own flow at its end, so words longer than anyone guessed - an English
// sentence, a count that grew - wrap beside it rather than run under it,
// and where the alert is too narrow for both the key drops under the words.
// The alert is its own container, so it is its width that decides, not the
// window's.
//
// `warning` is what waits on somebody's decision: an amber icon on an amber
// wash, where `destructive` is what already went wrong.

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
  warning: {
    borderColor: `color-mix(in oklab, ${tokens.warning} 32%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 9%, ${tokens.surface})`,
  },
  // One row: the icon, the words, the key. The words' column is the only
  // one that gives; the key's is as wide as the key.
  line: {
    containerType: 'inline-size',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) auto',
      ':has(> svg)': 'auto minmax(0, 1fr) auto',
    },
    alignItems: 'center',
    columnGap: 0,
    rowGap: 0,
    paddingInlineEnd: 12,
    paddingBlock: 8,
    '--q-alert-title-column': { default: '1', ':has(> svg)': '2' },
    // alone, the title is the sentence and reads as one; over a body it is
    // the heading again
    '--q-alert-title-weight': {
      default: '400',
      ':has([data-slot="alert-description"])': '500',
    },
    // The key stands against the words it acts on: the title's row, or the
    // title and its body together. Spanning a row with nothing in it, it
    // shared its height out between the two and lifted the words above its
    // middle.
    '--q-alert-action-rows': {
      default: '1',
      ':has([data-slot="alert-description"])': '1 / span 2',
    },
  },
  title: {
    fontWeight: 'var(--q-alert-title-weight, 500)',
    // beside the icon rather than under it, when the root says there is one
    gridColumnStart: 'var(--q-alert-title-column, auto)',
  },
  lineTitle: {
    gridRowStart: 1,
  },
  lineDescription: {
    gridColumnStart: 'var(--q-alert-title-column, auto)',
    gridRowStart: 2,
    marginTop: 2,
  },
  description: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    textWrap: {
      default: 'pretty',
      [breakpoints.phone]: 'balance',
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
  // In the line's flow: the last column, across the title and its body, and
  // under the words - where they start - once the alert is too narrow for
  // the words and the key side by side.
  lineAction: {
    display: 'flex',
    gridColumn: {
      default: '-2 / -1',
      '@container (max-width: 30rem)': 'var(--q-alert-title-column)',
    },
    gridRow: {
      default: 'var(--q-alert-action-rows)',
      '@container (max-width: 30rem)': '3',
    },
    justifySelf: { default: 'end', '@container (max-width: 30rem)': 'start' },
    marginInlineStart: { default: 12, '@container (max-width: 30rem)': 0 },
    marginTop: { default: 0, '@container (max-width: 30rem)': 8 },
  },
})

function Alert({
  className,
  variant = 'default',
  layout = 'block',
  xstyle,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: AlertTone
  /** `line` for one sentence and the key that acts on it, kept in its flow */
  layout?: AlertLayout
  /** the standard StyleX seat; `className` is the legacy escape hatch */
  xstyle?: StyleXStyles
}) {
  const sx = stylex.props(
    styles.root,
    variant === 'destructive' && styles.destructive,
    variant === 'warning' && styles.warning,
    layout === 'line' && styles.line,
    xstyle,
  )
  const { children, ...rest } = props
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      data-layout={layout}
      role="alert"
      {...sx}
      {...rest}
      className={clsx(sx.className, className)}
    >
      <ToneCtx value={variant}>
        <LayoutCtx value={layout}>{children}</LayoutCtx>
      </ToneCtx>
    </div>
  )
}

function AlertTitle({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'div'> & { xstyle?: StyleXStyles }) {
  const line = use(LayoutCtx) === 'line'
  const sx = stylex.props(styles.title, line && styles.lineTitle, xstyle)
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
  const line = use(LayoutCtx) === 'line'
  const sx = stylex.props(
    styles.description,
    tone === 'destructive' && styles.descriptionDestructive,
    line && styles.lineDescription,
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
  const line = use(LayoutCtx) === 'line'
  const sx = stylex.props(line ? styles.lineAction : styles.action, xstyle)
  return (
    <div data-slot="alert-action" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }

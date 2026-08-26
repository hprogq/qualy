import { Children, createContext, isValidElement, use, useMemo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'
import { Separator } from './separator.tsx'

// The field system: a labelled control, its words, and how the two sit
// together. The selector-driven variants of the utility era (has-[...],
// group-*, peer-*) are restated as explicit React state - the Field knows
// its own orientation and whether a FieldContent column is among its
// children, and hands both down through context, so nothing here styles by
// guessing at the DOM. Prose links inside descriptions stay in theme.css,
// where a descendant of caller-written content can still be reached.

interface FieldState {
  orientation: 'vertical' | 'horizontal' | 'responsive'
  hasContent: boolean
}

const FieldCtx = createContext<FieldState | null>(null)
/** true under a FieldContent: a label there is a line, not the row's engine */
const InContentCtx = createContext(false)

const styles = stylex.create({
  field: {
    display: 'flex',
    width: '100%',
    gap: 12,
  },
  fieldVertical: {
    flexDirection: 'column',
  },
  fieldHorizontal: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldHorizontalContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fieldResponsive: {
    flexDirection: {
      default: 'column',
      '@container (min-width: 28rem)': 'row',
    },
    alignItems: {
      default: 'stretch',
      '@container (min-width: 28rem)': 'center',
    },
  },
  fieldResponsiveContent: {
    flexDirection: {
      default: 'column',
      '@container (min-width: 28rem)': 'row',
    },
    alignItems: {
      default: 'stretch',
      '@container (min-width: 28rem)': 'flex-start',
    },
  },
  set: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  legend: {
    marginBottom: 12,
    fontWeight: 500,
  },
  legendAsLegend: {
    fontSize: '1rem',
    lineHeight: '1.5rem',
  },
  legendAsLabel: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  group: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    gap: 28,
    // the query container the responsive orientation measures against
    containerType: 'inline-size',
  },
  content: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 4,
    lineHeight: 1.375,
  },
  label: {
    display: 'flex',
    width: 'fit-content',
    alignItems: 'center',
    gap: 8,
    fontSize: '0.875rem',
    lineHeight: 1.375,
    fontWeight: 500,
    userSelect: 'none',
  },
  /** a direct-child label rides the row: it takes the room the control leaves */
  labelGrow: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    width: 'auto',
  },
  labelGrowResponsive: {
    flexGrow: { default: 0, '@container (min-width: 28rem)': 1 },
    flexShrink: 1,
    flexBasis: 'auto',
    width: { default: 'fit-content', '@container (min-width: 28rem)': 'auto' },
  },
  title: {
    display: 'flex',
    width: 'fit-content',
    alignItems: 'center',
    gap: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  description: {
    textAlign: 'left',
    fontSize: '0.875rem',
    lineHeight: 1.5,
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
  separator: {
    position: 'relative',
    marginBlock: -8,
    height: 20,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  separatorLine: {
    position: 'absolute',
    insetInline: 0,
    bottom: 0,
    top: '50%',
  },
  separatorContent: {
    position: 'relative',
    display: 'block',
    marginInline: 'auto',
    width: 'fit-content',
    backgroundColor: tokens.background,
    paddingInline: 8,
    color: tokens.mutedForeground,
  },
  error: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 400,
    color: tokens.danger,
  },
  errorList: {
    marginLeft: 16,
    display: 'flex',
    listStyleType: 'disc',
    flexDirection: 'column',
    gap: 4,
  },
})

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  const sx = stylex.props(styles.set)
  return (
    <fieldset data-slot="field-set" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  const sx = stylex.props(
    styles.legend,
    variant === 'label' ? styles.legendAsLabel : styles.legendAsLegend,
  )
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.group)
  return (
    <div data-slot="field-group" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function Field({
  className,
  orientation = 'vertical',
  children,
  ...props
}: React.ComponentProps<'div'> & {
  orientation?: 'vertical' | 'horizontal' | 'responsive'
}) {
  // whether the row carries a FieldContent column decides its alignment;
  // the field reads its own children instead of asking CSS to look
  const hasContent = Children.toArray(children).some(
    (child) => isValidElement(child) && child.type === FieldContent,
  )
  const sx = stylex.props(
    styles.field,
    orientation === 'vertical' && styles.fieldVertical,
    orientation === 'horizontal' &&
      (hasContent ? styles.fieldHorizontalContent : styles.fieldHorizontal),
    orientation === 'responsive' &&
      (hasContent ? styles.fieldResponsiveContent : styles.fieldResponsive),
  )
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    >
      <FieldCtx value={{ orientation, hasContent }}>{children}</FieldCtx>
    </div>
  )
}

function FieldContent({ className, children, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.content)
  return (
    <div data-slot="field-content" {...sx} {...props} className={clsx(sx.className, className)}>
      <InContentCtx value={true}>{children}</InContentCtx>
    </div>
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<'label'>) {
  const field = use(FieldCtx)
  const inContent = use(InContentCtx)
  // beside its control on a row, the label is what grows; inside a
  // FieldContent it is one line of the column and keeps its own width
  const grow =
    field !== null && field.orientation !== 'vertical' && !inContent
      ? field.orientation === 'responsive'
        ? styles.labelGrowResponsive
        : styles.labelGrow
      : null
  const sx = stylex.props(styles.label, grow)
  return (
    <label data-slot="field-label" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<'div'>) {
  const sx = stylex.props(styles.title)
  return (
    <div data-slot="field-label" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const sx = stylex.props(styles.description)
  return (
    <p data-slot="field-description" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  children?: React.ReactNode
}) {
  const sx = stylex.props(styles.separator)
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    >
      <Separator className={stylex.props(styles.separatorLine).className} />
      {children && (
        <span {...stylex.props(styles.separatorContent)} data-slot="field-separator-content">
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [...new Map(errors.map((error) => [error?.message, error])).values()]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul {...stylex.props(styles.errorList)}>
        {uniqueErrors.map((error, index) => error?.message && <li key={index}>{error.message}</li>)}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  const sx = stylex.props(styles.error)
  return (
    <div
      role="alert"
      data-slot="field-error"
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}

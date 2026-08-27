import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'

// The semantic table, styled in its own StyleX base. `xstyle` is the
// standard extension seat; `className` stays as the legacy escape hatch.
//
// What a cell HOLDS is the caller's business, and two of these styles turn
// on it: a row that carries a control for opening itself is tinted like a
// hovered one, and a column of checkboxes sheds its trailing padding. Each
// asks its own box with `:has()` rather than being told.
//
// Which section a row is in is not something a row can ask - so the body
// tells the rows inside it, and the last of them drops its rule.

const styles = stylex.create({
  container: {
    position: 'relative',
    width: '100%',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    captionSide: 'bottom',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  footer: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    fontWeight: 500,
  },
  row: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    // standing, not only pointing: a row holding the control that opens it,
    // and a row that has been picked, read as the hovered one does
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
      ':has([aria-expanded])': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
      '[data-state="selected"]': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  // the run of rows ends at the section's edge, which draws its own line
  lastInBody: {
    borderBottomWidth: { default: 1, ':last-child': 0 },
  },
  head: {
    height: 48,
    paddingInlineStart: 12,
    // a checkbox sits against the row's edge; the padding would double the
    // gap between it and the first thing it selects
    paddingInlineEnd: { default: 12, ':has([role="checkbox"])': 0 },
    textAlign: 'left',
    verticalAlign: 'middle',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.foreground,
  },
  cell: {
    paddingBlock: 12,
    paddingInlineStart: 12,
    paddingInlineEnd: { default: 12, ':has([role="checkbox"])': 0 },
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  },
  caption: {
    marginTop: 16,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
})

type Extendable = { xstyle?: StyleXStyles }

function Table({ className, xstyle, ...props }: React.ComponentProps<'table'> & Extendable) {
  const sx = stylex.props(styles.table, xstyle)
  return (
    <div data-slot="table-container" {...stylex.props(styles.container)}>
      <table data-slot="table" {...sx} {...props} className={clsx(sx.className, className)} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" {...props} className={className} />
}

/** whether the rows below are the table's own run of records */
const InBody = React.createContext(false)

function TableBody({ className, children, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody data-slot="table-body" {...props} className={className}>
      <InBody value>{children}</InBody>
    </tbody>
  )
}

function TableFooter({ className, xstyle, ...props }: React.ComponentProps<'tfoot'> & Extendable) {
  const sx = stylex.props(styles.footer, xstyle)
  return (
    <tfoot data-slot="table-footer" {...sx} {...props} className={clsx(sx.className, className)} />
  )
}

function TableRow({ className, xstyle, ...props }: React.ComponentProps<'tr'> & Extendable) {
  const sx = stylex.props(styles.row, React.use(InBody) && styles.lastInBody, xstyle)
  return <tr data-slot="table-row" {...sx} {...props} className={clsx(sx.className, className)} />
}

function TableHead({ className, xstyle, ...props }: React.ComponentProps<'th'> & Extendable) {
  const sx = stylex.props(styles.head, xstyle)
  return <th data-slot="table-head" {...sx} {...props} className={clsx(sx.className, className)} />
}

function TableCell({ className, xstyle, ...props }: React.ComponentProps<'td'> & Extendable) {
  const sx = stylex.props(styles.cell, xstyle)
  return <td data-slot="table-cell" {...sx} {...props} className={clsx(sx.className, className)} />
}

function TableCaption({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'caption'> & Extendable) {
  const sx = stylex.props(styles.caption, xstyle)
  return (
    <caption
      data-slot="table-caption"
      {...sx}
      {...props}
      className={clsx(sx.className, className)}
    />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }

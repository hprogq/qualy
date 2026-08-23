import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { PageHeader } from './admin.tsx'
import { PageContainer } from './page-container.tsx'

// The shape every administration screen shares: a band that names the page,
// and a body laid out in columns under it.
//
// The band spans the content area and is cut from the body by one rule - not
// a card, not an inset box. Everything below is drawn the same way: sections
// separated by a hairline, lists in one bordered box rather than one box per
// row. A page built from cards reads as a pile of unrelated things; these
// screens are one thing with parts.
//
// Sizes and spacing are the product's, not a mock's: a heading here is the
// same heading as on every other page, and a control is whatever the design
// system says a control is.

export function Screen({
  title,
  description,
  actions,
  size = 'default',
  children,
}: {
  title: ReactNode
  description?: ReactNode
  /** what this page offers as a whole: a view switch, an import, a create */
  actions?: ReactNode
  size?: 'default' | 'wide' | 'full'
  children: ReactNode
}) {
  return (
    <>
      {/* edge to edge: a band inset inside the page's own width is a card
          pretending to be a header */}
      <div className="shrink-0 border-b bg-background">
        <PageContainer size={size} className="py-5">
          <PageHeader
            title={title}
            {...(description === undefined ? {} : { description })}
            {...(actions === undefined ? {} : { actions })}
            variant="banner"
          />
        </PageContainer>
      </div>
      <PageContainer size={size} className="flex flex-col gap-5">
        {children}
      </PageContainer>
    </>
  )
}

/**
 * A choice between a few views of the same page.
 *
 * Filled rather than outlined, because it marks where the reader is standing
 * rather than something they may do - the same reason a rail entry is filled
 * and a button is not.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly { value: T; label: string }[]
  /** spoken name for the group; the options name themselves */
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            option.value === value
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** a heading for one part of a screen, with what it counts and what it rules */
export function SectionHead({
  title,
  count,
  aside,
  actions,
}: {
  title: string
  count?: ReactNode
  /** a rule or a summary, said quietly at the far end */
  aside?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
      {count !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
      <span className="flex-1" />
      {aside !== undefined && (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{aside}</span>
      )}
      {actions}
    </div>
  )
}

/** what is true about the open thing, as a row of short label-value pairs */
export function Facts({
  columns = 4,
  items,
}: {
  columns?: 2 | 3 | 4
  items: readonly { label: string; value: ReactNode }[]
}) {
  return (
    <dl
      className={cn(
        'grid min-w-0 gap-x-6 gap-y-3',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-2 sm:grid-cols-3',
        columns === 4 && 'grid-cols-2 sm:grid-cols-4',
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-sm text-pretty">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A label, what it says, and optionally what can be done about it - the row
 * a settings screen is made of once it is past its main control.
 */
export function DefRow({
  label,
  children,
  action,
}: {
  label: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-4 border-t pt-4">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1 text-sm">{children}</div>
        {action}
      </div>
    </div>
  )
}

/** one reason something cannot be done yet, and the way to deal with it */
export function Blocker({
  standing,
  children,
  action,
}: {
  /** open blocks the action; clear is a fact that no longer stands in the way */
  standing: 'open' | 'clear'
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" data-blocker={standing}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          standing === 'open' ? 'bg-destructive' : 'bg-muted-foreground/40',
        )}
      />
      <span className="min-w-0 truncate text-sm">{children}</span>
      <span className="flex-1" />
      {action}
    </div>
  )
}

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

/**
 * The line that names whatever the rail has open, with what may be done to it.
 *
 * Chips carry facts the reader would otherwise have to infer from the rail
 * they came from - a kind, a status - and the actions sit at the far end
 * where every editor on the product keeps them.
 */
export function EditorHead({
  title,
  chips,
  note,
  actions,
}: {
  title: string
  /** short, factual, at most a couple: a kind, a status, a count */
  chips?: readonly { label: string; tone?: 'plain' | 'quiet' | 'alert' }[]
  /** one quiet phrase after the chips, for a rule that applies to the whole editor */
  note?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
      {chips?.map((chip) =>
        (chip.tone ?? 'plain') === 'plain' ? (
          <span
            key={chip.label}
            className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium"
          >
            {chip.label}
          </span>
        ) : (
          <span
            key={chip.label}
            className={cn(
              'shrink-0 text-xs',
              chip.tone === 'alert' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {chip.label}
          </span>
        ),
      )}
      {note !== undefined && (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{note}</span>
      )}
      <span className="flex-1" />
      {actions}
    </div>
  )
}

/**
 * A rule stated as a mode, with the choices on the same line as its name.
 *
 * Two radios rather than one checkbox, because the modes are not each other's
 * negation in any way a reader should have to work out: "anywhere" and "only
 * these" are two rules, and an empty list under the second one means nowhere,
 * not anywhere. Radios say that; an unticked box does not.
 */
export function ModeChoice<T extends string>({
  legend,
  value,
  onChange,
  options,
  hint,
  disabled = false,
}: {
  legend: string
  value: T
  onChange: (next: T) => void
  options: readonly { value: T; label: string }[]
  /** what the current mode means, or what is waiting to be saved */
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <h3 className="shrink-0 text-sm font-semibold" id={`${legend}-legend`}>
        {legend}
      </h3>
      <div
        role="radiogroup"
        aria-labelledby={`${legend}-legend`}
        className="flex shrink-0 items-center gap-4"
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex shrink-0 items-center gap-1.5 text-sm',
              disabled ? 'text-muted-foreground' : 'cursor-pointer',
            )}
          >
            <input
              type="radio"
              className="size-3.5 accent-primary"
              checked={option.value === value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <span className="flex-1" />
      {hint !== undefined && (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  )
}

/**
 * A set of things to tick, each its own bordered cell.
 *
 * Cells rather than a bare column of boxes because these lists are short and
 * the tick is a decision about a named thing - the border is what makes the
 * name and its tally read as one object. The tally is optional and says how
 * much is riding on the box: unticking something nobody uses is not the same
 * decision as unticking something forty people stand under.
 */
export function PickGrid({
  legend,
  options,
  selected,
  onChange,
  emptyLabel,
  disabled = false,
  columns = 3,
}: {
  legend: string
  options: readonly { value: string; label: string; tally?: ReactNode }[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  emptyLabel: string
  disabled?: boolean
  columns?: 2 | 3
}) {
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div
        className={cn(
          'grid min-w-0 gap-2',
          columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3',
        )}
      >
        {options.map((option) => {
          const on = selected.includes(option.value)
          return (
            <label
              key={option.value}
              data-picked={on}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-sm',
                disabled ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent/70',
                on && 'border-foreground/25',
              )}
            >
              <input
                type="checkbox"
                className="size-3.5 shrink-0 accent-primary"
                checked={on}
                disabled={disabled}
                onChange={() =>
                  onChange(
                    on
                      ? selected.filter((value) => value !== option.value)
                      : [...selected, option.value],
                  )
                }
              />
              <span className="min-w-0 truncate">{option.label}</span>
              <span className="flex-1" />
              {option.tally !== undefined && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {option.tally}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/**
 * One named group of tick boxes, in a box of its own, with a select-all.
 *
 * For lists long enough that a reader arrives looking for a section rather
 * than for a row - a permission catalog, mainly. The header carries how many
 * of the group are on, so the shape of a role is legible without reading
 * every box.
 */
export function PickList({
  title,
  count,
  options,
  selected,
  onChange,
  toggleAllLabel,
  disabled = false,
}: {
  title: string
  /** how many of this group are on, as the caller wants it worded */
  count?: ReactNode
  options: readonly { value: string; label: string; note?: ReactNode }[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  toggleAllLabel: string
  disabled?: boolean
}) {
  const values = options.map((option) => option.value)
  const all = values.every((value) => selected.includes(value))
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
      <div className="flex min-w-0 items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <h3 className="min-w-0 truncate text-xs font-semibold">{title}</h3>
        {count !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
        )}
        <span className="flex-1" />
        {!disabled && (
          <button
            type="button"
            className="shrink-0 text-xs font-medium hover:underline"
            aria-pressed={all}
            onClick={() =>
              onChange(
                all
                  ? selected.filter((value) => !values.includes(value))
                  : [...new Set([...selected, ...values])],
              )
            }
          >
            {toggleAllLabel}
          </button>
        )}
      </div>
      {options.map((option) => {
        const on = selected.includes(option.value)
        return (
          <label
            key={option.value}
            data-picked={on}
            className={cn(
              'flex min-w-0 items-center gap-2 border-t px-3 py-1.5 text-sm first:border-t-0',
              disabled ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent/70',
            )}
          >
            <input
              type="checkbox"
              className="size-3.5 shrink-0 accent-primary"
              checked={on}
              disabled={disabled}
              onChange={() =>
                onChange(
                  on
                    ? selected.filter((value) => value !== option.value)
                    : [...selected, option.value],
                )
              }
            />
            <span className="min-w-0 truncate">{option.label}</span>
            <span className="flex-1" />
            {option.note !== undefined && (
              <span className="min-w-0 shrink truncate font-mono text-[0.6875rem] text-muted-foreground">
                {option.note}
              </span>
            )}
          </label>
        )
      })}
    </section>
  )
}

/**
 * The line an editor ends on: what is about to change, and the two ways out.
 *
 * Discard sits beside save rather than somewhere quieter because a form that
 * edits live configuration needs an exit that is as easy to find as the
 * commit; the summary at the left is what the save will affect, said before
 * it is pressed rather than in a dialog afterwards.
 */
export function SaveBar({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-t pt-4">
      {summary !== undefined && (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>
      )}
      <span className="flex-1" />
      {children}
    </div>
  )
}

/** the bordered column a screen selects from: one box, one hairline per row */
export function Rail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border', className)}>
      {children}
    </div>
  )
}

/**
 * One entry in a rail: what it is called, what is true of it, and how much of
 * it there is.
 *
 * Two lines of meta at most. A rail entry answers "is this the one I want",
 * not "what is this" - the editor beside it answers that.
 */
export function RailRow({
  name,
  badges,
  tally,
  meta,
  selected,
  onSelect,
}: {
  name: string
  badges?: readonly { label: string; tone?: 'quiet' | 'alert' }[]
  tally?: ReactNode
  /** at most two short lines; a tone marks the one that is a problem */
  meta?: readonly { text: string; tone?: 'quiet' | 'alert' }[]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-col gap-0.5 border-t px-3 py-2 text-left first:border-t-0 hover:bg-accent/70',
        selected && 'bg-accent',
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn('min-w-0 truncate text-sm', selected ? 'font-semibold' : 'font-medium')}
        >
          {name}
        </span>
        {badges?.map((badge) => (
          <span
            key={badge.label}
            className={cn(
              'shrink-0 text-xs',
              badge.tone === 'alert' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {badge.label}
          </span>
        ))}
        <span className="flex-1" />
        {tally !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tally}</span>
        )}
      </span>
      {meta?.map((line) => (
        <span
          key={line.text}
          className={cn(
            'min-w-0 truncate text-xs',
            line.tone === 'alert' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {line.text}
        </span>
      ))}
    </button>
  )
}

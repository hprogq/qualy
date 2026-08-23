import type { ComponentProps, ReactNode } from 'react'
import { CheckIcon, XIcon } from 'lucide-react'
import { Badge } from './badge.tsx'
import { Checkbox } from './checkbox.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './empty.tsx'
import { Label } from './label.tsx'
import { RadioGroup, RadioGroupItem } from './radio-group.tsx'
import { Skeleton } from './skeleton.tsx'
import { Tabs, TabsList, TabsTrigger } from './tabs.tsx'
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
 * The product's tab list, not a hand-rolled one: it stands 36px tall like
 * every button and field beside it, which is the whole reason a filter row
 * reads as one row.
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
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className={cn('shrink-0', className)}
    >
      <TabsList aria-label={label}>
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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

/**
 * Which actions are barred, said as the actions themselves.
 *
 * A sentence explaining that something can be neither disabled nor deleted
 * makes a reader parse prose to find out what two buttons do; a pair of
 * struck-through action names says the same thing at a glance, and the
 * reason sits under them for whoever wants it.
 */
export function Barred({
  actions,
  reason,
}: {
  actions: readonly { label: string; barred: boolean }[]
  /** why, in one short phrase; omitted when nothing is barred */
  reason?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <Badge
            key={action.label}
            variant={action.barred ? 'secondary' : 'outline'}
            data-barred={action.barred}
            className={action.barred ? 'text-muted-foreground' : ''}
          >
            {action.barred ? (
              <XIcon aria-hidden className="size-3" />
            ) : (
              <CheckIcon aria-hidden className="size-3" />
            )}
            {action.label}
          </Badge>
        ))}
      </div>
      {reason !== undefined && (
        <p className="text-xs text-muted-foreground text-pretty">{reason}</p>
      )}
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
 * A rule stated as a mode, with the choices on the same line as the name.
 *
 * Two radios rather than one checkbox, because the modes are not each
 * other's negation in any way a reader should have to work out: "anywhere"
 * and "only these" are two rules, and an empty list under the second one
 * means nowhere. Radios say so; an unticked box does not.
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
      <h3 className="shrink-0 text-sm font-semibold">{legend}</h3>
      <RadioGroup
        aria-label={legend}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as T)}
        className="flex w-auto shrink-0 items-center gap-4"
      >
        {options.map((option) => (
          <div key={option.value} className="flex shrink-0 items-center gap-2">
            <RadioGroupItem value={option.value} id={`${legend}-${option.value}`} />
            <Label htmlFor={`${legend}-${option.value}`} className="text-sm font-normal">
              {option.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
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
            <Label
              key={option.value}
              data-picked={on}
              className={cn(
                'flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-normal transition-colors',
                disabled ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent/70',
                on && 'border-primary/40 bg-primary/5',
              )}
            >
              <Checkbox
                checked={on}
                disabled={disabled}
                onCheckedChange={() =>
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
            </Label>
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
          <Label
            key={option.value}
            data-picked={on}
            className={cn(
              'flex min-w-0 items-center gap-2.5 border-t px-3 py-2 text-sm font-normal transition-colors first:border-t-0',
              disabled ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent/70',
            )}
          >
            <Checkbox
              checked={on}
              disabled={disabled}
              onCheckedChange={() =>
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
          </Label>
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
export function Rail({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & Omit<
  ComponentProps<'div'>,
  'children' | 'className'
>) {
  return (
    <div
      className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border', className)}
      {...props}
    >
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

/**
 * What a screen shows before anything is open.
 *
 * Tall enough to be the answer to "what is this half of the page for" rather
 * than a stray sentence floating at the top of a column. The copy names the
 * action that fills the space, because a reader arriving here has not done
 * anything wrong - there is simply nothing chosen yet.
 */
export function Blank({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn('min-h-[22rem] rounded-lg border border-dashed', className)}>
      <EmptyHeader>
        {icon !== undefined && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action}
    </Empty>
  )
}

/**
 * The shape of a rail while its rows are still being fetched.
 *
 * A box the size of the answer, so the column does not collapse and then
 * shove the rest of the screen sideways when the rows land.
 */
export function RailSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Rail aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 border-t px-3 py-3 first:border-t-0">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </Rail>
  )
}

/** the shape of an editor while the thing it edits is still being fetched */
export function EditorSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-hidden>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

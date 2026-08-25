import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { Checkbox } from '../checkbox.tsx'
import { Label } from '../label.tsx'

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

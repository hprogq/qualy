import type { ReactNode } from 'react'
import { CheckIcon, XIcon } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { Badge } from '../badge.tsx'
import { Label } from '../label.tsx'
import { RadioGroup, RadioGroupItem } from '../radio-group.tsx'

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

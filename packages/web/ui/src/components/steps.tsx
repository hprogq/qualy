import { CheckIcon } from 'lucide-react'
import { cn } from '../lib/cn.ts'

// Where you are in a short guided form. Presentational only: the owner keeps
// the index, because it is the owner that knows when a step is complete.
export function Steps({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: readonly string[]
  current: number
  /** given, each step becomes a way back to that part of the form */
  onSelect?: (index: number) => void
  className?: string
}) {
  return (
    <ol className={cn('flex items-center gap-3', className)}>
      {steps.map((label, index) => {
        const done = index < current
        const active = index === current
        return (
          <li key={label} className="flex flex-1 items-center gap-3">
            <StepLabel
              index={index}
              label={label}
              done={done}
              active={active}
              {...(onSelect ? { onSelect } : {})}
            />
            {index < steps.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
          </li>
        )
      })}
    </ol>
  )
}

function StepLabel({
  index,
  label,
  done,
  active,
  onSelect,
}: {
  index: number
  label: string
  done: boolean
  active: boolean
  onSelect?: (index: number) => void
}) {
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
          done && 'border-primary bg-primary text-primary-foreground',
          active && 'border-primary text-foreground',
          !done && !active && 'text-muted-foreground',
        )}
      >
        {done ? <CheckIcon className="size-3.5" /> : index + 1}
      </span>
      <span
        className={cn(
          'text-sm whitespace-nowrap',
          active ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </>
  )
  if (!onSelect) {
    return (
      <span aria-current={active ? 'step' : undefined} className="flex items-center gap-2">
        {body}
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-current={active ? 'step' : undefined}
      className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onSelect(index)}
    >
      {body}
    </button>
  )
}

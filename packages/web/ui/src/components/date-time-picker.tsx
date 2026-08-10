import { useEffect, useRef, useState } from 'react'
import { CalendarIcon, ClockIcon, XIcon } from 'lucide-react'
import { enUS, zhCN, type Locale } from 'date-fns/locale'
import { cn } from '../lib/utils.ts'
import { Button } from './button.tsx'
import { Calendar } from './calendar.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'
import { ScrollArea } from './scroll-area.tsx'

// A day and a time of day, as two popovers over one value. The library has no
// time picker of its own and a bare text field is a poor one - typing 09:00 is
// slower than choosing it, and it accepts nonsense - so the hours and minutes
// are lists, scrolled to the current choice when they open.
//
// The value is an iso instant or nothing at all; the fields it serves are
// optional, so clearing has to be reachable. Every word arrives as a prop.

const CALENDAR_LOCALES: Record<string, Locale> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute)

const pad = (part: number) => String(part).padStart(2, '0')

export function DateTimePicker({
  id,
  value,
  onChange,
  datePlaceholder,
  timePlaceholder,
  clearLabel,
  hourLabel,
  minuteLabel,
  localeTag,
  monthLabel,
  yearLabel,
  disabled,
}: {
  id?: string
  /** an iso instant, or null when nothing is set */
  value: string | null
  onChange: (next: string | null) => void
  datePlaceholder: string
  timePlaceholder: string
  clearLabel: string
  /** the two columns are both two-digit numbers; only a name tells them apart */
  hourLabel: string
  minuteLabel: string
  /** a bcp-47 tag such as zh-CN; calendar and display text follow it */
  localeTag?: string
  /** names for the caption pickers, read out but never shown */
  monthLabel?: string
  yearLabel?: string
  disabled?: boolean
}) {
  const [dateOpen, setDateOpen] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const at = value === null ? null : new Date(value)

  const withDate = (day: Date) => {
    const next = new Date(day)
    next.setHours(at?.getHours() ?? 0, at?.getMinutes() ?? 0, 0, 0)
    return next.toISOString()
  }
  const withTime = (hours: number, minutes: number) => {
    const next = at === null ? new Date() : new Date(at)
    next.setHours(hours, minutes, 0, 0)
    return next.toISOString()
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            data-empty={at === null}
            className="w-44 justify-start font-normal data-[empty=true]:text-muted-foreground"
          >
            <CalendarIcon />
            {at === null
              ? datePlaceholder
              : at.toLocaleDateString(localeTag, { dateStyle: 'medium' })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            labels={{
              ...(monthLabel ? { labelMonthDropdown: () => monthLabel } : {}),
              ...(yearLabel ? { labelYearDropdown: () => yearLabel } : {}),
            }}
            {...(localeTag && CALENDAR_LOCALES[localeTag]
              ? { locale: CALENDAR_LOCALES[localeTag] }
              : {})}
            defaultMonth={at ?? undefined}
            selected={at ?? undefined}
            onSelect={(day) => {
              if (day) {
                onChange(withDate(day))
                setDateOpen(false)
              }
            }}
          />
        </PopoverContent>
      </Popover>

      <Popover open={timeOpen} onOpenChange={setTimeOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            data-empty={at === null}
            className="w-28 justify-start font-normal data-[empty=true]:text-muted-foreground"
          >
            <ClockIcon />
            {at === null ? timePlaceholder : `${pad(at.getHours())}:${pad(at.getMinutes())}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-auto divide-x p-0" align="start">
          <TimeColumn
            open={timeOpen}
            label={hourLabel}
            parts={HOURS}
            selected={at?.getHours() ?? null}
            onPick={(hour) => onChange(withTime(hour, at?.getMinutes() ?? 0))}
          />
          <TimeColumn
            open={timeOpen}
            label={minuteLabel}
            parts={MINUTES}
            selected={at?.getMinutes() ?? null}
            onPick={(minute) => onChange(withTime(at?.getHours() ?? 0, minute))}
          />
        </PopoverContent>
      </Popover>

      {at !== null && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={clearLabel}
          onClick={() => onChange(null)}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}

function TimeColumn({
  open,
  label,
  parts,
  selected,
  onPick,
}: {
  open: boolean
  label: string
  parts: readonly number[]
  selected: number | null
  onPick: (part: number) => void
}) {
  const current = useRef<HTMLButtonElement>(null)
  // a list of sixty is only usable if it opens where the choice already is
  useEffect(() => {
    if (open) current.current?.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <ScrollArea className="h-56">
      <div role="group" aria-label={label} className="flex flex-col gap-0.5 p-1">
        {parts.map((part) => (
          <Button
            key={part}
            ref={part === selected ? current : undefined}
            type="button"
            variant={part === selected ? 'default' : 'ghost'}
            size="sm"
            aria-label={`${pad(part)} ${label}`}
            className={cn('w-14 shrink-0 tabular-nums')}
            onClick={() => onPick(part)}
          >
            {pad(part)}
          </Button>
        ))}
      </div>
    </ScrollArea>
  )
}

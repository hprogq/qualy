import { useState } from 'react'
import { CalendarIcon, ClockIcon, XIcon } from 'lucide-react'
import { enUS, zhCN, type Locale } from 'date-fns/locale'
import { Button } from './button.tsx'
import { Calendar } from './calendar.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'
import { TimeField } from './time-field.tsx'

// One instant, asked for once: a calendar with a time under it.
//
// This was two triggers and two popovers, and the time one was a pair of
// scrolling columns - sixty buttons for the minutes. It was slow for the
// thing it was mostly used for (typing a round hour), it needed a click
// before the wheel would move it, and it had quietly become a single column
// of two stacked lists when the popover gained a `flex-col` default the call
// site did not override. Two controls for one value also let the two
// disagree on screen about what the value was.
//
// The time is three typed boxes (see TimeField): 093000 fills all of them
// and moves between them, and the arrows step whichever the caret is in.
// Typing a round hour is two keystrokes, which is what this is mostly used
// for.
//
// The value is an iso instant or nothing at all; the fields it serves are
// optional, so clearing has to be reachable. Every word arrives as a prop.

const CALENDAR_LOCALES: Record<string, Locale> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

const pad = (part: number) => String(part).padStart(2, '0')

export function DateTimePicker({
  id,
  value,
  onChange,
  placeholder,
  hourLabel,
  minuteLabel,
  secondLabel,
  clearLabel,
  localeTag,
  monthLabel,
  yearLabel,
  disabled,
}: {
  id?: string
  /** an iso instant, or null when nothing is set */
  value: string | null
  onChange: (next: string | null) => void
  /** what the trigger says while nothing is chosen */
  placeholder: string
  /** every time box is two digits; only a name tells them apart */
  hourLabel: string
  minuteLabel: string
  secondLabel: string
  clearLabel: string
  /** a bcp-47 tag such as zh-CN; calendar and display text follow it */
  localeTag?: string
  /** names for the caption pickers, read out but never shown */
  monthLabel?: string
  yearLabel?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const at = value === null ? null : new Date(value)

  const withDate = (day: Date) => {
    const next = new Date(day)
    next.setHours(at?.getHours() ?? 0, at?.getMinutes() ?? 0, at?.getSeconds() ?? 0, 0)
    return next.toISOString()
  }
  // naming a time before a day means today, the way it did when these were
  // two controls
  const withTime = (hours: number, minutes: number, seconds: number) => {
    const next = at === null ? new Date() : new Date(at)
    next.setHours(hours, minutes, seconds, 0)
    return next.toISOString()
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            data-empty={at === null}
            className="min-w-0 flex-1 justify-start font-normal data-[empty=true]:text-muted-foreground"
          >
            <CalendarIcon />
            {at === null
              ? placeholder
              : at.toLocaleString(localeTag, { dateStyle: 'medium', timeStyle: 'medium' })}
          </Button>
        </PopoverTrigger>
        {/* the popover stacks by default, which is the direction wanted here -
            only its width and padding give way to the calendar */}
        <PopoverContent className="w-auto gap-0 p-0" align="start">
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
              if (day) onChange(withDate(day))
            }}
          />
          {/* choosing a day leaves the popover open, because the time is the
              other half of the same answer and it is on this panel */}
          <div className="flex items-center justify-center gap-2 border-t border-border p-3">
            <ClockIcon className="size-4 shrink-0 text-muted-foreground" />
            <TimeField
              hours={at?.getHours() ?? 0}
              minutes={at?.getMinutes() ?? 0}
              seconds={at?.getSeconds() ?? 0}
              hourLabel={hourLabel}
              minuteLabel={minuteLabel}
              secondLabel={secondLabel}
              onChange={(hours, minutes, seconds) => onChange(withTime(hours, minutes, seconds))}
            />
          </div>
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

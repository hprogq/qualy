import { CalendarIcon } from 'lucide-react'
import type { DateRange as DayPickerRange } from 'react-day-picker'
import { enUS, zhCN, type Locale } from 'date-fns/locale'
import { Button } from './button.tsx'
import { Calendar } from './calendar.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'

// One control for a span of days, over the calendar's own range mode, in the
// shape the library documents: the calendar owns the interaction and the
// popover closes when the person leaves it. Picking a start therefore leaves
// the calendar open for the end, which is the whole point of a range.
//
// The value stays the wire format at both ends (yyyy-mm-dd, or empty) and the
// text follows the viewer's locale; every word arrives as a prop.

const DAY_PICKER_LOCALES: Record<string, Locale> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

const wireOf = (date: Date) => {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const dateOf = (value: string) => (value === '' ? undefined : new Date(`${value}T00:00:00`))

export interface DateRange {
  start: string
  end: string
}

export function DateRangePicker({
  id,
  value,
  onChange,
  placeholder,
  localeTag,
  monthLabel,
  yearLabel,
  disabled,
}: {
  id?: string
  value: DateRange
  onChange: (next: DateRange) => void
  placeholder?: string
  /** a bcp-47 tag such as zh-CN; calendar and display text follow it */
  localeTag?: string
  /** names for the caption pickers, read out but never shown */
  monthLabel?: string
  yearLabel?: string
  disabled?: boolean
}) {
  const from = dateOf(value.start)
  const to = dateOf(value.end)
  const selected: DayPickerRange | undefined = from ? { from, to } : undefined
  const label = (date: Date) => date.toLocaleDateString(localeTag, { dateStyle: 'medium' })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={from === undefined}
          className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
        >
          <CalendarIcon />
          {from ? (to ? `${label(from)} – ${label(to)}` : label(from)) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          captionLayout="dropdown"
          labels={{
            ...(monthLabel ? { labelMonthDropdown: () => monthLabel } : {}),
            ...(yearLabel ? { labelYearDropdown: () => yearLabel } : {}),
          }}
          {...(localeTag && DAY_PICKER_LOCALES[localeTag]
            ? { locale: DAY_PICKER_LOCALES[localeTag] }
            : {})}
          defaultMonth={from}
          selected={selected}
          onSelect={(range) =>
            onChange({
              start: range?.from ? wireOf(range.from) : '',
              end: range?.to ? wireOf(range.to) : '',
            })
          }
        />
      </PopoverContent>
    </Popover>
  )
}

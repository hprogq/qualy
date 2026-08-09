import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { enUS, zhCN, type Locale } from 'date-fns/locale'
import { Button } from './button.tsx'
import { Calendar } from './calendar.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'

// The date-picker composition: a trigger button that reads like an input and
// a calendar in a popover. Value stays the wire format (yyyy-mm-dd or empty);
// weekday and month names follow the viewer's locale tag. Placeholder text
// arrives as a prop, so the component ships no words of its own.

const DAY_PICKER_LOCALES: Record<string, Locale> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

const wireOf = (date: Date) => {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder,
  localeTag,
  disabled,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** a bcp-47 tag such as zh-CN; calendar and display text follow it */
  localeTag?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = value === '' ? undefined : new Date(`${value}T00:00:00`)
  const display =
    value === ''
      ? placeholder
      : new Date(`${value}T00:00:00`).toLocaleDateString(localeTag, { dateStyle: 'medium' })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={value === ''}
          className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
        >
          <CalendarIcon />
          {display}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          {...(localeTag && DAY_PICKER_LOCALES[localeTag]
            ? { locale: DAY_PICKER_LOCALES[localeTag] }
            : {})}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onChange(date ? wireOf(date) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

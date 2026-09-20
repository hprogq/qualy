'use client'

import * as stylex from '@stylexjs/stylex'
import { DatePickerInput } from '@mantine/dates'

import { FIRST_DAY_OF_WEEK, calendarLook } from '../lib/calendar.ts'
import { dateWordsIn, dayIn } from '../lib/date-format.ts'
import { seatOf } from '../lib/xstyle.ts'

// One calendar day.
//
// The value is a calendar date and stays one from end to end. `2026-08-27`
// is that day wherever it is read, so nothing here turns it into a `Date`
// and back - the crossing that quietly makes a date the day before for half
// the world. The widget speaks the same YYYY-MM-DD spelling the product
// stores, so the two ends meet with no conversion at all.
//
// The same control as the range picker beside it, minus the second end and
// everything that follows from having one: no preview, no track, no marks.
// The field shows the day in the reader's own calendar words; what it
// carries is the stored spelling.

const styles = stylex.create({
  field: {
    width: '100%',
  },
})

export function DatePicker({
  id,
  value,
  onChange,
  placeholder,
  clearLabel,
  localeTag,
  monthLabel,
  yearLabel,
  min,
  max,
  disabled,
  className,
  xstyle,
}: {
  id?: string
  /** a calendar date as YYYY-MM-DD, or null when nothing is set */
  value: string | null
  onChange: (next: string | null) => void
  /** the first and last day on offer, as YYYY-MM-DD; days outside cannot be picked */
  min?: string | null
  max?: string | null
  /** what the field says while nothing is chosen */
  placeholder?: string
  /**
   * Naming the clear button turns it on.
   *
   * A field nobody has to answer needs a way back to unanswered, and one
   * that must be answered should not offer a press that empties it.
   */
  clearLabel?: string
  /** a bcp-47 tag such as zh-CN; calendar and display text follow it */
  localeTag?: string
  /** names for the caption pickers, read out but never shown */
  monthLabel?: string
  yearLabel?: string
  disabled?: boolean
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
}) {
  return (
    <DatePickerInput
      id={id}
      data-slot="date-picker"
      value={value === '' ? null : value}
      onChange={(next) => onChange(typeof next === 'string' && next !== '' ? next : null)}
      placeholder={placeholder}
      disabled={disabled}
      {...(min === undefined || min === null || min === '' ? {} : { minDate: min })}
      {...(max === undefined || max === null || max === '' ? {} : { maxDate: max })}
      firstDayOfWeek={FIRST_DAY_OF_WEEK}
      valueFormatter={({ date }) => {
        const day = Array.isArray(date) ? date[0] : date
        return typeof day === 'string' ? dayIn(localeTag, day) : ''
      }}
      {...(clearLabel === undefined
        ? {}
        : { clearable: true, clearButtonProps: { 'aria-label': clearLabel } })}
      {...calendarLook}
      {...dateWordsIn(localeTag)}
      {...(monthLabel === undefined && yearLabel === undefined
        ? {}
        : {
            ariaLabels: {
              ...(monthLabel === undefined ? {} : { monthLevelControl: monthLabel }),
              ...(yearLabel === undefined ? {} : { yearLevelControl: yearLabel }),
            },
          })}
      {...seatOf(stylex.props(styles.field, xstyle), className)}
    />
  )
}

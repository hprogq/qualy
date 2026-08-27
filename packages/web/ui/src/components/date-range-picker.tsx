'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { DatePickerInput } from '@mantine/dates'

import { useIsBelow } from '../hooks/use-mobile.ts'

import { calendarLook } from '../lib/calendar.ts'
import { dateWordsIn, dayIn } from '../lib/date-format.ts'
import { seatOf } from '../lib/xstyle.ts'

// One control for a span of days.
//
// The value is a pair of calendar dates and stays that way from end to end.
// A calendar date has no instant in it - `2026-08-27` is that day wherever
// you read it - so nothing here turns one into a `Date` and back, which is
// how a date quietly becomes the day before for half the world. The widget
// speaks the same YYYY-MM-DD spelling the product stores, so the two ends
// meet without a conversion at all; the only translation is between the
// product's `{start, end}` and the widget's tuple, which never leaves this
// file.

const styles = stylex.create({
  field: {
    width: '100%',
  },
})

/**
 * What this adapter has to tell the calendar about each day: only whether a
 * second end is being hunted for, which decides whether the day under the
 * pointer is drawn as the end it would become.
 *
 * It does NOT report which day that is. The widget claims the day's own
 * pointer handlers for its preview and drops any passed alongside its data
 * attributes, and the drawing turned out not to need it: an end is the day
 * whose neighbour is not in the span.
 */
const dayMarksOf = (pickingEnd: boolean) => (pickingEnd ? { 'data-range-picking': true } : {})

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
  className,
  xstyle,
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
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
}) {
  const narrow = useIsBelow(560)
  // one end chosen and the other still open: the day under the pointer is a
  // candidate, and worth drawing as one
  const pickingEnd = value.start !== '' && value.end === ''
  return (
    <DatePickerInput
      id={id}
      data-slot="date-range-picker"
      type="range"
      value={[value.start === '' ? null : value.start, value.end === '' ? null : value.end]}
      onChange={([start, end]) => onChange({ start: start ?? '', end: end ?? '' })}
      placeholder={placeholder}
      disabled={disabled}
      // Two months side by side, because the task this control exists for is
      // "from the end of one month into the next" and a single panel makes
      // that a hunt. Where there is no room for two, one is better than two
      // squeezed.
      numberOfColumns={narrow ? 1 : 2}
      valueFormatter={({ date }) => {
        const [start, end] = Array.isArray(date) ? date : [date, null]
        if (typeof start !== 'string') return ''
        return typeof end === 'string'
          ? `${dayIn(localeTag, start)} – ${dayIn(localeTag, end)}`
          : dayIn(localeTag, start)
      }}
      getDayProps={() => dayMarksOf(pickingEnd)}
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

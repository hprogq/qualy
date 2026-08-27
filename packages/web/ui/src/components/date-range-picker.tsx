'use client'

import type * as React from 'react'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import dayjs from 'dayjs'
import { DatePickerInput } from '@mantine/dates'

import { useIsBelow } from '../hooks/use-mobile.ts'

import { FIRST_DAY_OF_WEEK, calendarLook } from '../lib/calendar.ts'
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

export interface DateRange {
  start: string
  end: string
}

/**
 * The two ends of the run currently on screen: the chosen span, or the one
 * being previewed while a second end is hunted for.
 *
 * The widget still owns the span itself - which days are in it, which end it,
 * how a backwards hunt is ordered. This only names the two dates the drawing
 * has to cap at, and it names them from the value this control already holds
 * plus the day the pointer last entered. Calendar dates sort as text, so
 * `YYYY-MM-DD` compares directly and no date ever becomes an instant.
 */
const runEnds = (value: DateRange, previewEnd: string | null) => {
  if (value.start === '') return null
  const other = value.end !== '' ? value.end : previewEnd
  if (other === null || other === '') return null
  return other < value.start
    ? { first: other, last: value.start }
    : { first: value.start, last: other }
}

/** the day's place in its row, counted from the day a week starts on here */
const weekdayIndex = (date: string) => (dayjs(date).day() - FIRST_DAY_OF_WEEK + 7) % 7
const isFirstOfMonth = (date: string) => date.endsWith('-01')
const isLastOfMonth = (date: string) => dayjs(date).date() === dayjs(date).daysInMonth()

/**
 * Where the track has to close on this day, and whether it is the end being
 * hunted for. Nothing about WHY it closes leaves this function.
 *
 * A run stops at its own end, at the edge of a row, and at the edge of a
 * panel - but a month boundary is only a panel edge when the panel hides the
 * days on the other side of it. Shown, they are ordinary cells in the same
 * row, and a span crossing into the next month has to stay one unbroken
 * track through them.
 */
const dayMarks = (
  date: string,
  value: DateRange,
  previewEnd: string | null,
  hideOutsideDates: boolean,
): Record<string, true> => {
  const run = runEnds(value, previewEnd)
  if (run === null) return {}
  const marks: Record<string, true> = {}
  if (
    date === run.first ||
    weekdayIndex(date) === 0 ||
    (hideOutsideDates && isFirstOfMonth(date))
  ) {
    marks['data-track-cap-start'] = true
  }
  if (date === run.last || weekdayIndex(date) === 6 || (hideOutsideDates && isLastOfMonth(date))) {
    marks['data-track-cap-end'] = true
  }
  // Only while a second end is being hunted: once both are chosen the widget
  // marks them selected itself. The mark is read together with the widget's
  // own in-range, so a stale one - the pointer having left the calendar,
  // which clears the widget's preview - draws nothing.
  if (value.end === '' && date === previewEnd) marks['data-preview-end'] = true
  return marks
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
  // Two months side by side, because the task this control exists for is
  // "from the end of one month into the next" and a single panel makes that
  // a hunt. Where there is no room for two, one is better than two squeezed -
  // and a single panel then shows the neighbouring month's days rather than
  // blanks, so a span crossing into it stays one run on screen.
  const numberOfColumns = narrow ? 1 : 2
  const hideOutsideDates = numberOfColumns > 1
  // The day the pointer last entered, which is all this control keeps of the
  // hunt. The widget computes the span, its order and its marks; this only
  // says which day to cap and circle at the loose end.
  const [previewEnd, setPreviewEnd] = useState<string | null>(null)
  const hunting = value.start !== '' && value.end === ''
  return (
    <DatePickerInput
      id={id}
      data-slot="date-range-picker"
      type="range"
      value={[value.start === '' ? null : value.start, value.end === '' ? null : value.end]}
      onChange={([start, end]) => {
        setPreviewEnd(null)
        onChange({ start: start ?? '', end: end ?? '' })
      }}
      placeholder={placeholder}
      disabled={disabled}
      numberOfColumns={numberOfColumns}
      // stated rather than inherited: the same answer has to reach the widget
      // and the marks below, or one would draw a boundary the other denies
      hideOutsideDates={hideOutsideDates}
      firstDayOfWeek={FIRST_DAY_OF_WEEK}
      valueFormatter={({ date }) => {
        const [start, end] = Array.isArray(date) ? date : [date, null]
        if (typeof start !== 'string') return ''
        return typeof end === 'string'
          ? `${dayIn(localeTag, start)} – ${dayIn(localeTag, end)}`
          : dayIn(localeTag, start)
      }}
      getDayProps={(date) => ({
        ...dayMarks(date, value, previewEnd, hideOutsideDates),
        // the widget calls its own handler after this one, so the preview and
        // the mark move together
        onMouseEnter: hunting ? () => setPreviewEnd(date) : undefined,
      })}
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

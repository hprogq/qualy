'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { DatePickerInput } from '@mantine/dates'

import { dateWordsIn, dayIn } from '../lib/date-format.ts'
import { tokens } from '../theme/tokens.stylex.ts'
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

/**
 * The class this adapter draws a span with.
 *
 * Its rules live in theme.css because they hang off state the WIDGET owns:
 * `data-in-range` is not just the value that has been committed - while a
 * start is chosen and the pointer is looking for an end, the library
 * recomputes the whole span on every hover and says so through these same
 * attributes. Restating that machine in React to satisfy a compiled style
 * would mean keeping a second copy of a state machine that already works.
 *
 * The name is this adapter's own, not the library's: nothing here reaches
 * for a `.mantine-*` selector, so the day can be restyled by whoever renders
 * it and a version that renames its internals cannot silently undress this.
 */
const RANGE_DAY = 'q-range-day'
const RANGE_CELL = 'q-range-cell'

/** the first column of the calendar; the widget's own default */
const FIRST_DAY_OF_WEEK = 1

const styles = stylex.create({
  field: {
    width: '100%',
  },
  // the month a page is showing is a caption, not a headline
  monthLabel: {
    fontWeight: 500,
    fontSize: 14,
  },
  weekday: {
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
})

/**
 * Which column of the week a day sits in.
 *
 * The track has to close at the end of a week and open again at the start of
 * the next, and only the day itself knows where in the week it falls. The
 * widget hands each control its own date, so this is arithmetic rather than
 * a lookup at the DOM.
 */
const weekEdgesOf = (date: string) => {
  const weekday = new Date(`${date.slice(0, 10)}T00:00:00`).getDay()
  const column = (weekday - FIRST_DAY_OF_WEEK + 7) % 7
  return {
    ...(column === 0 ? { 'data-week-start': true } : {}),
    ...(column === 6 ? { 'data-week-end': true } : {}),
  }
}

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
  return (
    <DatePickerInput
      id={id}
      data-slot="date-range-picker"
      type="range"
      value={[value.start === '' ? null : value.start, value.end === '' ? null : value.end]}
      onChange={([start, end]) => onChange({ start: start ?? '', end: end ?? '' })}
      placeholder={placeholder}
      disabled={disabled}
      // two months side by side: a span is chosen by seeing both ends
      numberOfColumns={2}
      // no gap between the cells: the seam is what broke a continuous span
      // into a row of separate blue boxes
      withCellSpacing={false}
      valueFormatter={({ date }) => {
        const [start, end] = Array.isArray(date) ? date : [date, null]
        if (typeof start !== 'string') return ''
        return typeof end === 'string'
          ? `${dayIn(localeTag, start)} – ${dayIn(localeTag, end)}`
          : dayIn(localeTag, start)
      }}
      getDayProps={weekEdgesOf}
      classNames={{
        day: RANGE_DAY,
        monthCell: RANGE_CELL,
        calendarHeaderLevel: stylex.props(styles.monthLabel).className,
        weekday: stylex.props(styles.weekday).className,
      }}
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

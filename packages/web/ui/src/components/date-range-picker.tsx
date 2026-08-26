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

/** a day inside a span but not at either end of it */
const MIDDLE = ':is([data-in-range]:not([data-first-in-range]):not([data-last-in-range]))'
const MIDDLE_OVER =
  ':is([data-in-range]:not([data-first-in-range]):not([data-last-in-range]):hover)'

const styles = stylex.create({
  field: {
    width: '100%',
  },
  // A span should read as ONE continuous stretch of days, not as a row of
  // filled boxes: the widget's own range paints a saturated block per day
  // with a white seam between them, which is a spreadsheet selection. The
  // states it stamps on each day are enough to draw the whole thing - the
  // range machine stays where it belongs, and only the ink is stated here.
  //
  // The conditions are written to be MUTUALLY EXCLUSIVE. An end of a span
  // carries data-in-range as well as data-first-in-range, and two rules of
  // equal weight over one property is a coin toss - the first attempt lost
  // it, and the day at the end of the range had near-black text on a
  // near-black ground. Excluded from each other, only one can ever apply.
  day: {
    fontWeight: 400,
    backgroundColor: {
      default: null,
      // the track: faint enough to read the dates through it
      [MIDDLE]: `color-mix(in oklab, ${tokens.primary} 9%, transparent)`,
      [MIDDLE_OVER]: `color-mix(in oklab, ${tokens.primary} 15%, transparent)`,
      // the two ends carry the weight
      ':is([data-first-in-range],[data-last-in-range],[data-selected])': tokens.primary,
    },
    color: {
      default: tokens.foreground,
      // no red weekends: this is a working calendar, not a wall one, and the
      // colour was competing with the selection for attention
      ':is([data-weekend]:not([data-selected]):not([data-in-range]))': tokens.mutedForeground,
      ':is([data-outside]:not([data-selected]):not([data-in-range]))': `color-mix(in oklab, ${tokens.mutedForeground} 55%, transparent)`,
      ':is([data-first-in-range],[data-last-in-range],[data-selected])': tokens.primaryForeground,
    },
    transitionProperty: 'background-color, color',
    transitionDuration: '120ms',
    transitionTimingFunction: 'ease-out',
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
      classNames={{
        day: stylex.props(styles.day).className,
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

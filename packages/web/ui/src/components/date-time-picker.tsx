'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { DateTimePicker as MDateTimePicker } from '@mantine/dates'

import { calendarLook } from '../lib/calendar.ts'
import { dateWordsIn } from '../lib/date-format.ts'
import { instantToLocal, localToInstant } from '../lib/instant.ts'
import { seatOf } from '../lib/xstyle.ts'

// One instant, asked for once: a calendar with a time under it.
//
// The value the product carries is an INSTANT - a moment on the world's
// timeline, written as an iso string - while the control shows a wall clock,
// the hour the reader sees where they are. Those are different things, so
// the crossing between them is explicit and lives in lib/instant.ts; this
// file only calls it, and the widget's own wall-clock spelling never leaves
// this file in either direction.
//
// The time is typed rather than scrolled: 093000 fills hours, minutes and
// seconds and moves between them, which is what a round hour costs two
// keystrokes for.

const styles = stylex.create({
  field: {
    width: '100%',
  },
})

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
  className,
  xstyle,
}: {
  id?: string
  /** an iso instant, or null when nothing is set */
  value: string | null
  onChange: (next: string | null) => void
  /** what the field says while nothing is chosen */
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
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
}) {
  return (
    <MDateTimePicker
      id={id}
      data-slot="date-time-picker"
      value={instantToLocal(value)}
      onChange={(next) => onChange(localToInstant(typeof next === 'string' ? next : null))}
      placeholder={placeholder}
      disabled={disabled}
      {...calendarLook}
      withSeconds
      // the fields this serves are optional, so clearing has to be reachable
      clearable
      clearButtonProps={{ 'aria-label': clearLabel }}
      timePickerProps={{
        hoursInputLabel: hourLabel,
        minutesInputLabel: minuteLabel,
        secondsInputLabel: secondLabel,
      }}
      valueFormat={(local) => {
        const at = localToInstant(local)
        return at === null
          ? ''
          : new Date(at).toLocaleString(localeTag, { dateStyle: 'medium', timeStyle: 'medium' })
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

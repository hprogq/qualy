// oxlint-disable-next-line typescript/triple-slash-reference -- Ambient CSS declarations must follow workspace source consumers without a runtime import.
/// <reference path="../styles/assets.d.ts" />
'use client'

import '@mantine/dates/styles.layer.css'

import { useRef, useState, type MouseEvent } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ActionIcon, CheckIcon, Input, Popover } from '@mantine/core'
import { DatePicker, TimePicker } from '@mantine/dates'
import { formatDateTime } from '@qualy/date-format'

import { calendarLook } from '../lib/calendar.ts'
import { dateWordsIn } from '../lib/date-format.ts'
import { instantToLocal, localToInstant, wallClockExists } from '../lib/instant.ts'
import { seatOf } from '../lib/xstyle.ts'

// One instant, asked for once: a calendar with a time under it.
//
// The value the product carries is an INSTANT - a moment on the world's
// timeline, written as an iso string - while the control shows a wall clock:
// the hour on the reader's own wall, or on the wall of the zone the caller
// names. Those are different things, so the crossing between them is
// explicit and lives in lib/instant.ts; this file only calls it, and the
// widget's own wall-clock spelling never leaves this file in either
// direction.
//
// The time is typed rather than scrolled: 093000 fills hours, minutes and
// seconds and moves between them, which is what a round hour costs two
// keystrokes for.
// The combined Mantine widget parses wall time in the device's zone, so a
// different zone's valid time can move during a DST jump. Keep the date and
// time strings separate until conversion. The calendar substrate still
// cannot represent a day skipped entirely by the device's zone, such as
// 2011-12-30 in Pacific/Apia.

const styles = stylex.create({
  field: {
    width: '100%',
  },
  time: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
})

// SpinInput selects on focus/click, but WebKit's pointer default can collapse
// that selection afterwards. Own the pointer focus so the first digit replaces
// the whole field, just as it does when Tab brings the keyboard here.
function selectTimeField(event: MouseEvent<HTMLInputElement>) {
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.focus()
  event.currentTarget.select()
}

export function DateTimePicker({
  id,
  'aria-describedby': describedBy,
  value,
  onChange,
  placeholder,
  hourLabel,
  minuteLabel,
  secondLabel,
  clearLabel,
  closeLabel,
  localeTag,
  timeZone,
  monthLabel,
  yearLabel,
  onSkippedTime,
  disabled,
  className,
  xstyle,
}: {
  id?: string
  'aria-describedby'?: string
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
  /** name for the button that closes the calendar */
  closeLabel: string
  /** a bcp-47 tag such as zh-CN; calendar and display text follow it */
  localeTag?: string
  /**
   * The IANA zone whose wall clock is shown and typed, such as
   * Asia/Shanghai. Left out, it is the device's own. Saying which zone that
   * is to the reader is the caller's job: this control has no words.
   */
  timeZone?: string
  /** names for the caption pickers, read out but never shown */
  monthLabel?: string
  yearLabel?: string
  /**
   * Told the instant a typed time was moved on to when the zone's clocks skip
   * it (the hour a daylight-saving change jumps over), and `null` once the
   * time typed is one the wall shows. What to say about it is the caller's.
   */
  onSkippedTime?: (movedTo: string | null) => void
  disabled?: boolean
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
}) {
  // A time the clocks skip is saved as the first time after it that exists,
  // but the boxes keep what was typed while that is still the value: showing
  // 03 the moment somebody types 02 would move the hour under their fingers
  // halfway through typing 023000.
  const [typed, setTyped] = useState<{ local: string; instant: string } | null>(null)
  const [opened, setOpened] = useState(false)
  const hourRef = useRef<HTMLInputElement>(null)
  const held = typed !== null && typed.instant === value ? typed.local : null
  const local = held ?? instantToLocal(value, timeZone)
  const day = local?.slice(0, 10) ?? null
  const time = local?.slice(11) ?? ''
  const change = (next: string | null) => {
    const instant = localToInstant(next, timeZone)
    const skipped = next !== null && instant !== null && !wallClockExists(next, timeZone)
    setTyped(skipped ? { local: next, instant } : null)
    onSkippedTime?.(skipped ? instant : null)
    onChange(instant)
  }
  const at = value === null ? NaN : Date.parse(value)
  const label = Number.isNaN(at)
    ? ''
    : formatDateTime(new Date(at), localeTag ?? 'en-US', 'event-time', timeZone)
  return (
    <Popover
      opened={opened && !disabled}
      onChange={setOpened}
      position="bottom-start"
      withRoles={false}
      trapFocus
      returnFocus={false}
      {...calendarLook.popoverProps}
    >
      <Popover.Target>
        <Input
          id={id}
          aria-describedby={describedBy}
          attributes={
            describedBy === undefined ? undefined : { input: { 'aria-describedby': describedBy } }
          }
          data-slot="date-time-picker"
          component="button"
          type="button"
          multiline
          disabled={disabled}
          onClick={() => setOpened(!opened)}
          __clearable={value !== null && !disabled}
          __clearSection={
            <Input.ClearButton aria-label={clearLabel} onClick={() => change(null)} />
          }
          {...seatOf(stylex.props(styles.field, xstyle), className)}
        >
          {label || <Input.Placeholder>{placeholder}</Input.Placeholder>}
        </Input>
      </Popover.Target>
      <Popover.Dropdown data-dates-dropdown="true" data-mantine-stop-propagation="true">
        <DatePicker
          value={day}
          defaultDate={day ?? undefined}
          onChange={(next) => {
            if (typeof next === 'string') {
              change(`${next} ${time || '00:00:00'}`)
              hourRef.current?.focus()
            }
          }}
          withCellSpacing={calendarLook.withCellSpacing}
          classNames={calendarLook.classNames}
          {...dateWordsIn(localeTag)}
          {...(monthLabel === undefined && yearLabel === undefined
            ? {}
            : {
                ariaLabels: {
                  ...(monthLabel === undefined ? {} : { monthLevelControl: monthLabel }),
                  ...(yearLabel === undefined ? {} : { yearLevelControl: yearLabel }),
                },
              })}
        />
        <div {...stylex.props(styles.time)}>
          <TimePicker
            value={time}
            hoursRef={hourRef}
            withSeconds
            hoursInputLabel={hourLabel}
            minutesInputLabel={minuteLabel}
            secondsInputLabel={secondLabel}
            hoursInputProps={{ onMouseDown: selectTimeField }}
            minutesInputProps={{ onMouseDown: selectTimeField }}
            secondsInputProps={{ onMouseDown: selectTimeField }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                setOpened(false)
              }
            }}
            onChange={(next) => {
              if (day !== null && next !== '') change(`${day} ${next}`)
            }}
          />
          <ActionIcon
            variant="default"
            size="input-sm"
            aria-label={closeLabel}
            onClick={() => setOpened(false)}
          >
            <CheckIcon size="30%" />
          </ActionIcon>
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}

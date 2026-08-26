import { useEffect, useRef, useState, type RefObject } from 'react'
import { clsx } from 'clsx'
import * as stylex from '@stylexjs/stylex'
import { Input } from './input.tsx'

// A time of day as two boxes that behave like one clock.
//
// Not `input[type=time]`: the browser draws that one, so it is a different
// control in every browser and cannot be made to match anything around it.
// Not a list of sixty minutes either - that was here, and picking 09:30 from
// it meant scrolling twice.
//
// So: type it. `093000` fills all three boxes and moves between them on its
// own, the arrows step the box the caret is in, and left and right walk
// between them. Nothing accepts a value it cannot mean - a box knows its own
// ceiling - so there is no invalid state to validate afterwards and no error
// to word. Twenty-four hours, which is the form the value is stored in and
// the one this product's readers set clocks in; a twelve-hour face would add
// a fourth box holding am or pm.
//
// Seconds are here because a moment a system acts on is a moment, and a
// control that silently rounds one to the minute is deciding something it
// was not asked to decide.
//
// The caret is hidden and every keystroke is interpreted rather than typed,
// because half a time is not a time: a field that let you leave `9` sitting
// in the hours would have to decide later what that meant.

const fieldStyles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
})

const pad = (part: number) => String(part).padStart(2, '0')

/** how long a lone first digit waits for its partner before it stands alone */
const PAIRING_WINDOW = 2000

export function TimeField({
  hours,
  minutes,
  seconds,
  onChange,
  hourLabel,
  minuteLabel,
  secondLabel,
  disabled,
  className,
  id,
}: {
  hours: number
  minutes: number
  seconds: number
  onChange: (hours: number, minutes: number, seconds: number) => void
  /** every box is two digits; only a name tells them apart */
  hourLabel: string
  minuteLabel: string
  secondLabel: string
  disabled?: boolean
  className?: string
  id?: string
}) {
  const hourBox = useRef<HTMLInputElement>(null)
  const minuteBox = useRef<HTMLInputElement>(null)
  const secondBox = useRef<HTMLInputElement>(null)

  return (
    <div className={clsx(stylex.props(fieldStyles.row).className, className)}>
      <Segment
        ref={hourBox}
        id={id}
        value={hours}
        max={23}
        label={hourLabel}
        disabled={disabled}
        onChange={(next) => onChange(next, minutes, seconds)}
        onNext={minuteBox}
      />
      <Colon />
      <Segment
        ref={minuteBox}
        value={minutes}
        max={59}
        label={minuteLabel}
        disabled={disabled}
        onChange={(next) => onChange(hours, next, seconds)}
        onNext={secondBox}
        onPrevious={hourBox}
      />
      <Colon />
      <Segment
        ref={secondBox}
        value={seconds}
        max={59}
        label={secondLabel}
        disabled={disabled}
        onChange={(next) => onChange(hours, minutes, next)}
        onPrevious={minuteBox}
      />
    </div>
  )
}

/**
 * Punctuation between two named boxes.
 *
 * Hidden from a reader who is told "hour, 09" and then "minute, 30": they
 * have already heard what the colon is there to say.
 */
function Colon() {
  return (
    <span aria-hidden className="text-muted-foreground select-none">
      :
    </span>
  )
}

function Segment({
  ref,
  id,
  value,
  max,
  label,
  disabled,
  onChange,
  onNext,
  onPrevious,
}: {
  ref: RefObject<HTMLInputElement | null>
  id?: string
  value: number
  /** the largest this box can hold; 23 for an hour, 59 for a minute */
  max: number
  label: string
  disabled?: boolean
  onChange: (next: number) => void
  onNext?: RefObject<HTMLInputElement | null>
  onPrevious?: RefObject<HTMLInputElement | null>
}) {
  // whether the next digit joins the one just typed or replaces it
  const [pairing, setPairing] = useState(false)
  useEffect(() => {
    if (!pairing) return
    const timer = setTimeout(() => setPairing(false), PAIRING_WINDOW)
    return () => clearTimeout(timer)
  }, [pairing])

  const wrapped = (next: number) => ((next % (max + 1)) + max + 1) % (max + 1)

  const typeDigit = (digit: number) => {
    // A first digit too large to take a second one is already the whole
    // value: 3 cannot start an hour and 6 cannot start a minute, so the box
    // is done and the caret moves on instead of waiting two seconds to find
    // that out.
    const done = pairing || digit * 10 > max
    onChange(pairing ? Math.min(value * 10 + digit, max) : digit)
    setPairing(!done)
    if (done) onNext?.current?.focus()
  }

  return (
    <Input
      ref={ref}
      id={id}
      type="text"
      inputMode="numeric"
      // a stepper, which is what the arrows make it, and what says the value
      // out loud as a number with a floor and a ceiling
      role="spinbutton"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={pad(value)}
      disabled={disabled}
      value={pad(value)}
      // every keystroke is handled below; the field is never typed into
      // directly, so this only exists to keep react from warning
      onChange={() => {}}
      onFocus={(event) => {
        setPairing(false)
        event.currentTarget.select()
      }}
      onBlur={() => setPairing(false)}
      onKeyDown={(event) => {
        if (event.key === 'Tab') return
        event.preventDefault()
        if (event.key === 'ArrowRight') return onNext?.current?.focus()
        if (event.key === 'ArrowLeft') return onPrevious?.current?.focus()
        if (event.key === 'ArrowUp') return onChange(wrapped(value + 1))
        if (event.key === 'ArrowDown') return onChange(wrapped(value - 1))
        if (event.key >= '0' && event.key <= '9') typeDigit(Number(event.key))
      }}
      // `focus`, not `focus-visible`: which box the digits will land in has
      // to be visible to whoever just clicked one, not only to whoever
      // arrived by keyboard
      className="h-8 w-11 rounded-2xl px-0 text-center tabular-nums caret-transparent focus:bg-accent"
    />
  )
}

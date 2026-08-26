'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Chip as MChip } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// A set of choices that wraps.
//
// Where a segmented control is one unbroken run of two or three options, a
// chip group is a paragraph of them: a batch may configure ten reject
// reasons, and they have to fall onto a second line rather than run off the
// edge of a phone.

const styles = stylex.create({
  group: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  // The resting chip: the widget's own grey ramp carries a blue cast the
  // product's zero-chroma palette forbids, so both the ground and the edge
  // are stated here.
  chip: {
    fontFamily: 'inherit',
    backgroundColor: {
      default: tokens.surfaceMuted,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, ${tokens.foreground} 6%)`,
    },
    borderColor: 'transparent',
    color: tokens.foreground,
  },
  // the chosen chip wears the product's own ink; the widget draws the
  // check inside it
  chipPicked: {
    backgroundColor: {
      default: tokens.primary,
      ':hover': tokens.primary,
    },
    borderColor: tokens.primary,
    color: tokens.primaryForeground,
  },
})

const PickCtx = React.createContext<{ value: string; onChange: (value: string) => void }>({
  value: '',
  onChange: () => {},
})

function ChipGroup({
  className,
  style,
  xstyle,
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}) {
  // the group's own state, handed to each chip as a plain checked flag:
  // the widget's group context wants its chips as direct children, and this
  // group has a layout element between them
  const pick = React.useMemo(() => ({ value, onChange }), [value, onChange])
  return (
    <PickCtx value={pick}>
      <div
        role="radiogroup"
        data-slot="chip-group"
        {...seatOf(stylex.props(styles.group, xstyle), className, style)}
      >
        {children}
      </div>
    </PickCtx>
  )
}

function Chip({
  value,
  disabled,
  children,
}: {
  value: string
  disabled?: boolean
  children: React.ReactNode
}) {
  const pick = React.use(PickCtx)
  const chosen = pick.value === value
  return (
    // the product's own word for chosen, on an element this adapter owns
    // outright, so a substrate swap cannot take the hook with it
    <span data-slot="chip" data-state={chosen ? 'on' : 'off'}>
      <MChip
        checked={chosen}
        onChange={() => pick.onChange(value)}
        disabled={disabled}
        size="sm"
        radius="xl"
        color="var(--q-primary)"
        classNames={{
          label: stylex.props(styles.chip, chosen && styles.chipPicked).className,
        }}
      >
        {children}
      </MChip>
    </span>
  )
}

export { ChipGroup, Chip }

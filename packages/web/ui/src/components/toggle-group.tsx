'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { SegmentedControl } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// A choice between a few values, drawn as one unbroken run with a thumb
// under the chosen one.
//
// The widget takes its options as data; this takes them as children,
// because a screen writes a list of options far more legibly as elements -
// each with its own condition, count or icon - than as an array literal
// halfway up the file. The children are read, never rendered: an item is a
// declaration, and the widget draws the control.
//
// For a set that has to WRAP - a batch may configure ten reject reasons -
// use ChipGroup instead. A segmented control is a single run by definition.

const styles = stylex.create({
  // The widget's stock ground and thumb come from its own grey ramp, which
  // carries a blue cast the product's zero-chroma palette forbids.
  ground: {
    backgroundColor: tokens.surfaceMuted,
  },
  // the sliding thumb passes the pointer through to the option under it
  thumb: {
    backgroundColor: tokens.background,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.08)',
    pointerEvents: 'none',
  },
  option: {
    fontFamily: 'inherit',
    color: tokens.mutedForeground,
  },
  // the control is the input's containing block, so each hit area covers
  // its own option rather than the whole run
  seat: {
    position: 'relative',
  },
  // The widget hides each radio as a zero-sized box and lets the label do
  // the clicking. That works for a pointer, but it leaves the control that
  // ANSWERS to the radio role unreachable - anything driving the page by
  // role finds a radio it cannot press. The input keeps its own hit area,
  // over its option, invisible.
  hit: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    cursor: 'pointer',
    opacity: 0,
    // above the widget's own label, which is painted over the input
    zIndex: 3,
  },
})

interface ItemProps {
  value: string
  disabled?: boolean
  children: React.ReactNode
  'aria-label'?: string
}

/** one option of a ToggleGroup; a declaration, read by the group */
function ToggleGroupItem(_props: ItemProps): React.ReactNode {
  return null
}

function ToggleGroup({
  className,
  style,
  xstyle,
  value,
  onValueChange,
  orientation = 'horizontal',
  fill = false,
  disabled,
  children,
  ...rest
}: {
  value: string
  onValueChange: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
  /** stretch across the row instead of hugging the options */
  fill?: boolean
  disabled?: boolean
  children: React.ReactNode
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
  'aria-label'?: string
}) {
  const data = React.useMemo(() => {
    const options: { value: string; label: React.ReactNode; disabled?: boolean }[] = []
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement<ItemProps>(child)) return
      const { value: optionValue, children: label, disabled: off } = child.props
      options.push({ value: optionValue, label, ...(off === true ? { disabled: true } : {}) })
    })
    return options
  }, [children])

  return (
    <SegmentedControl
      data-slot="toggle-group"
      data={data}
      value={value}
      onChange={onValueChange}
      orientation={orientation}
      fullWidth={fill}
      disabled={disabled}
      size="sm"
      radius="xl"
      withItemsBorders={false}
      classNames={{
        root: stylex.props(styles.ground).className,
        indicator: stylex.props(styles.thumb).className,
        control: stylex.props(styles.seat).className,
        label: stylex.props(styles.option).className,
        input: stylex.props(styles.hit).className,
      }}
      {...rest}
      {...seatOf(stylex.props(xstyle), className, style)}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }

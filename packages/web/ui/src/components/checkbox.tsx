'use client'

import * as React from 'react'
import { Checkbox as MCheckbox } from '@mantine/core'

// The Qualy checkbox keeps its established API: `checked` is a boolean or
// the literal 'indeterminate', changes arrive through `onCheckedChange` as
// the next boolean. Underneath is a real input[type="checkbox"], so Space,
// label click-through and form semantics are the native ones.
export interface CheckboxProps extends Omit<
  React.ComponentProps<'input'>,
  'checked' | 'onChange' | 'size' | 'type'
> {
  checked?: boolean | 'indeterminate'
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

function Checkbox({ checked, defaultChecked, onCheckedChange, readOnly, ...props }: CheckboxProps) {
  const indeterminate = checked === 'indeterminate'
  // mixed is native indeterminate over an unchecked input, so a click
  // resolves it to checked - the platform's own behavior
  return (
    <MCheckbox
      data-slot="checkbox"
      {...(checked === undefined ? {} : { checked: indeterminate ? false : checked })}
      {...(defaultChecked === undefined ? {} : { defaultChecked })}
      indeterminate={indeterminate}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      // a controlled value with no handler is a display, not a control; the
      // readOnly path shows it without react's missing-onChange warning
      readOnly={readOnly ?? (checked !== undefined && onCheckedChange === undefined)}
      {...props}
    />
  )
}

export { Checkbox }

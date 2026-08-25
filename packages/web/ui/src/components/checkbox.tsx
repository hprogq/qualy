'use client'

import * as React from 'react'
import { Checkbox as PrimeCheckbox } from '@primereact/ui/checkbox'
import { CheckIcon } from 'lucide-react'

// The product checkbox over Prime's compound checkbox. The public contract
// stays the Radix-shaped one every caller and test speaks: checked may be
// 'indeterminate' (the tree-select cover state), the change callback
// receives the next state, and `id` still pairs the control with a label.
// The element with role=checkbox is Prime's native input, so everything a
// test or a screen reader reads off that role - data-* facts, aria-*
// relations, the testid - is forwarded there rather than left on the
// wrapper span.
type CheckedState = boolean | 'indeterminate'

function Checkbox({
  className,
  checked,
  defaultChecked,
  onCheckedChange,
  id,
  ...props
}: Omit<React.ComponentProps<'span'>, 'defaultChecked' | 'onChange'> & {
  checked?: CheckedState
  defaultChecked?: CheckedState
  onCheckedChange?: (checked: CheckedState) => void
  disabled?: boolean
  required?: boolean
  name?: string
  value?: string
}) {
  const rootProps: Record<string, unknown> = {}
  const inputProps: Record<string, unknown> = { 'data-slot': 'checkbox' }
  for (const [key, prop] of Object.entries(props)) {
    if (key.startsWith('data-') || key.startsWith('aria-')) inputProps[key] = prop
    else rootProps[key] = prop
  }
  const indeterminate = checked === 'indeterminate'
  return (
    <PrimeCheckbox.Root
      {...(checked === undefined ? {} : { checked: checked === true })}
      {...(defaultChecked === undefined ? {} : { defaultChecked: defaultChecked === true })}
      indeterminate={indeterminate}
      {...(onCheckedChange === undefined
        ? {}
        : {
            onCheckedChange: (event: { checked: boolean }) => onCheckedChange(event.checked),
          })}
      {...(id === undefined ? {} : { inputId: id })}
      {...(className === undefined ? {} : { className })}
      pt={{ input: inputProps }}
      {...rootProps}
    >
      <PrimeCheckbox.Box>
        <PrimeCheckbox.Indicator data-slot="checkbox-indicator">
          <CheckIcon />
        </PrimeCheckbox.Indicator>
      </PrimeCheckbox.Box>
    </PrimeCheckbox.Root>
  )
}

export { Checkbox }

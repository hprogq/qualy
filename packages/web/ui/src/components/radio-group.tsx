'use client'

import * as React from 'react'
import { RadioButton } from '@primereact/ui/radiobutton'
import { RadioButtonGroup } from '@primereact/ui/radiobuttongroup'

// The product radio group over Prime's. The Radix-shaped surface stays:
// the group takes value/onValueChange(string)/name, an item takes value and
// an optional id that must keep pairing with an external label - it lands
// on the native input, the element a label's htmlFor can actually reach.

function RadioGroup({
  className,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
  disabled?: boolean
  required?: boolean
}) {
  return (
    <RadioButtonGroup
      data-slot="radio-group"
      {...(onValueChange === undefined
        ? {}
        : { onValueChange: (event: { value: unknown }) => onValueChange(String(event.value)) })}
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  id,
  ...props
}: Omit<React.ComponentProps<'span'>, 'defaultChecked'> & {
  value: string
  disabled?: boolean
}) {
  // the element with role=radio is Prime's native input; data-* facts and
  // aria-* relations belong there, where a test or a reader finds the role
  const rootProps: Record<string, unknown> = {}
  const inputProps: Record<string, unknown> = { 'data-slot': 'radio-group-item' }
  for (const [key, prop] of Object.entries(props)) {
    if (key.startsWith('data-') || key.startsWith('aria-')) inputProps[key] = prop
    else rootProps[key] = prop
  }
  return (
    <RadioButton.Root
      {...(id === undefined ? {} : { inputId: id })}
      {...(className === undefined ? {} : { className })}
      pt={{ input: inputProps }}
      {...rootProps}
    >
      <RadioButton.Box>
        <RadioButton.Indicator data-slot="radio-group-indicator" />
      </RadioButton.Box>
    </RadioButton.Root>
  )
}

export { RadioGroup, RadioGroupItem }

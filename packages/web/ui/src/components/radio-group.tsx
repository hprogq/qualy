'use client'

import * as React from 'react'
import { Radio as MRadio } from '@mantine/core'

import { cn } from '../lib/utils.ts'

// One-of-several, keeping the established Qualy API: the group holds
// `value`/`onValueChange`/`name`/`disabled`, items hold their `value`.
// Underneath are native radio inputs sharing a name, so arrow keys, the
// radiogroup role and form participation are the platform's own.
function RadioGroup({
  className,
  value,
  defaultValue,
  onValueChange,
  name,
  disabled,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
  disabled?: boolean
}) {
  return (
    <MRadio.Group
      data-slot="radio-group"
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onValueChange === undefined ? {} : { onChange: onValueChange })}
      {...(name === undefined ? {} : { name })}
      {...(disabled === undefined ? {} : { disabled })}
      className={cn('grid w-full gap-3', className)}
      {...props}
    >
      {children}
    </MRadio.Group>
  )
}

function RadioGroupItem({
  className,
  value,
  disabled,
  ...props
}: Omit<React.ComponentProps<'input'>, 'size' | 'type' | 'value'> & { value: string }) {
  return (
    <MRadio
      data-slot="radio-group-item"
      value={value}
      {...(disabled === undefined ? {} : { disabled })}
      classNames={{ root: className ?? '' }}
      {...props}
    />
  )
}

export { RadioGroup, RadioGroupItem }

'use client'

import * as React from 'react'
import { Radio as MRadio } from '@mantine/core'

import { clsx } from 'clsx'
import * as stylex from '@stylexjs/stylex'

// One-of-several, keeping the established Qualy API: the group holds
// `value`/`onValueChange`/`name`/`disabled`, items hold their `value`.
// Underneath are native radio inputs sharing a name, so arrow keys, the
// radiogroup role and form participation are the platform's own.

const groupStyles = stylex.create({
  // The widget's own root is an input wrapper, and it renders the options
  // inside a plain element of its own - so a layout put on the root has one
  // child to lay out, and the options underneath it stack flush. The rule
  // that spaces them has to sit on whatever actually holds them, which is
  // why this component brings its own.
  root: { width: '100%' },
  options: {
    display: 'grid',
    width: '100%',
    gap: 12,
  },
})
function RadioGroup({
  className,
  xstyle,
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
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
}) {
  return (
    <MRadio.Group
      data-slot="radio-group"
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onValueChange === undefined ? {} : { onChange: onValueChange })}
      {...(name === undefined ? {} : { name })}
      {...(disabled === undefined ? {} : { disabled })}
      className={clsx(stylex.props(groupStyles.root).className, className)}
      {...props}
    >
      <div {...stylex.props(groupStyles.options, xstyle)}>{children}</div>
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

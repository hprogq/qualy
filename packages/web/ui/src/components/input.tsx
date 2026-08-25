'use client'

import * as React from 'react'
import { Input as MInput } from '@mantine/core'

// The Qualy text input. The public API stays "a native input's props":
// name, value, onChange, placeholder, type, aria-* and data-* all reach the
// real <input> element, refs point at it, and the label wired by id keeps
// working. The widget library adds one positioning wrapper around the input;
// `className` continues to style the input element itself (border, padding,
// focus - that is where those styles live), and the rare consumer that needs
// to size the wrapper passes `wrapperClassName`.
function Input({
  className,
  wrapperClassName,
  size,
  'aria-invalid': ariaInvalid,
  ...props
}: React.ComponentProps<'input'> & { wrapperClassName?: string }) {
  // the product marks invalid controls with aria-invalid; the widget wants
  // its own error prop and would otherwise overwrite the attribute
  const invalid = ariaInvalid === true || ariaInvalid === 'true'
  return (
    <MInput
      className={wrapperClassName}
      classNames={{ input: className ?? '' }}
      // the native size attribute; the visual size is the theme's business
      {...(size === undefined ? {} : { inputSize: String(size) })}
      {...(invalid ? { error: true } : {})}
      data-slot="input"
      {...props}
    />
  )
}

export { Input }

'use client'

import * as React from 'react'
import type { StyleXStyles } from '@stylexjs/stylex'
import * as stylex from '@stylexjs/stylex'
import { Input as MInput } from '@mantine/core'

// The Qualy text input. The public API stays "a native input's props":
// name, value, onChange, placeholder, type, aria-* and data-* all reach the
// real <input> element, refs point at it, and the label wired by id keeps
// working. The widget library adds one positioning wrapper around the input;
// `className` continues to style the input element itself (border, padding,
// focus - that is where those styles live), and the rare consumer that needs
// to size the wrapper passes `wrapperClassName` or the formal `wrapperXstyle`.
//
// `lead`/`tail` seat a small ornament inside the field's edge - a search
// glyph, a unit - which is what the old InputGroup wrapper existed to do.
// They are ornaments, not controls: they do not take the pointer, and the
// input keeps the whole clickable surface.
function Input({
  className,
  wrapperClassName,
  wrapperXstyle,
  lead,
  tail,
  size,
  'aria-invalid': ariaInvalid,
  ...props
}: React.ComponentProps<'input'> & {
  wrapperClassName?: string
  /** the formal StyleX seat for the positioning wrapper (widths live here) */
  wrapperXstyle?: StyleXStyles
  /** an ornament inside the field's leading edge */
  lead?: React.ReactNode
  /** an ornament inside the field's trailing edge - a unit, a count */
  tail?: React.ReactNode
}) {
  // the product marks invalid controls with aria-invalid; the widget wants
  // its own error prop and would otherwise overwrite the attribute
  const invalid = ariaInvalid === true || ariaInvalid === 'true'
  const sx = stylex.props(wrapperXstyle)
  return (
    <MInput
      className={
        wrapperClassName === undefined
          ? sx.className
          : `${sx.className ?? ''} ${wrapperClassName}`.trim()
      }
      style={sx.style}
      classNames={{ input: className ?? '' }}
      {...(lead === undefined ? {} : { leftSection: lead, leftSectionPointerEvents: 'none' })}
      {...(tail === undefined ? {} : { rightSection: tail, rightSectionPointerEvents: 'none' })}
      // the native size attribute; the visual size is the theme's business
      {...(size === undefined ? {} : { inputSize: String(size) })}
      {...(invalid ? { error: true } : {})}
      data-slot="input"
      {...props}
    />
  )
}

export { Input }

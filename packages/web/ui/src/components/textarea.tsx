'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { InputWrapperContext, Textarea as MTextarea } from '@mantine/core'

// Same contract as the Input: native textarea props reach the real element,
// className styles it, wrapperClassName is the escape hatch for the wrapper.

const styles = stylex.create({
  // room for a short paragraph before it has to scroll; the widget's own
  // field is one line tall, which reads as a text input that lied
  field: {
    minHeight: '4rem',
  },
})

/**
 * The words that describe the field, handed to the widget the way its own
 * wrapper would: it takes them from the wrapper's context, which it always
 * renders and which knows none of the caller's, and drops the caller's
 * attribute. The seat is inside that wrapper, so this one is the nearer.
 */
function Described({ by, children }: { by: string; children: React.ReactNode }) {
  const wrapper = React.use(InputWrapperContext)
  return (
    <InputWrapperContext value={{ ...wrapper, describedBy: by }}>{children}</InputWrapperContext>
  )
}

function Textarea({
  className,
  wrapperClassName,
  'aria-invalid': ariaInvalid,
  'aria-describedby': describedBy,
  ...props
}: React.ComponentProps<'textarea'> & { wrapperClassName?: string }) {
  // as with the Input: the widget writes aria-invalid from its own error prop
  const invalid = ariaInvalid === true || ariaInvalid === 'true'
  return (
    <MTextarea
      className={wrapperClassName}
      classNames={{
        input: `${stylex.props(styles.field).className ?? ''} ${className ?? ''}`.trim(),
      }}
      {...(invalid ? { error: true } : {})}
      {...(describedBy === undefined
        ? {}
        : {
            inputContainer: (children: React.ReactNode) => (
              <Described by={describedBy}>{children}</Described>
            ),
          })}
      data-slot="textarea"
      {...props}
    />
  )
}

export { Textarea }

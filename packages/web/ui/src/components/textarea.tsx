'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Textarea as MTextarea } from '@mantine/core'

// Same contract as the Input: native textarea props reach the real element,
// className styles it, wrapperClassName is the escape hatch for the wrapper.

const styles = stylex.create({
  // room for a short paragraph before it has to scroll; the widget's own
  // field is one line tall, which reads as a text input that lied
  field: {
    minHeight: '4rem',
  },
})

function Textarea({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<'textarea'> & { wrapperClassName?: string }) {
  return (
    <MTextarea
      className={wrapperClassName}
      classNames={{
        input: `${stylex.props(styles.field).className ?? ''} ${className ?? ''}`.trim(),
      }}
      data-slot="textarea"
      {...props}
    />
  )
}

export { Textarea }

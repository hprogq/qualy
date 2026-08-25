'use client'

import * as React from 'react'
import { Textarea as MTextarea } from '@mantine/core'

// Same contract as the Input: native textarea props reach the real element,
// className styles it, wrapperClassName is the escape hatch for the wrapper.
function Textarea({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<'textarea'> & { wrapperClassName?: string }) {
  return (
    <MTextarea
      className={wrapperClassName}
      classNames={{ input: className ?? '' }}
      data-slot="textarea"
      {...props}
    />
  )
}

export { Textarea }

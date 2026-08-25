'use client'

import * as React from 'react'
import { Divider } from '@primereact/ui/divider'

// The product separator over Prime's Divider, reduced to what it always
// was: a hairline. The preset zeroes the Divider margins; decorative lines
// stay out of the accessibility tree the way the Radix version kept them.
function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<'div'> & {
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
}) {
  return (
    <Divider
      data-slot="separator"
      orientation={orientation}
      role={decorative ? 'none' : 'separator'}
      {...(decorative ? { 'aria-orientation': undefined } : {})}
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

export { Separator }

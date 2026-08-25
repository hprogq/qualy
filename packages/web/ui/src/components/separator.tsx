'use client'

import * as React from 'react'
import { Divider as MDivider } from '@mantine/core'

// A rule between things. Decorative by default (invisible to the
// accessibility tree, as before); a semantic separator announces itself
// with the role and its orientation.
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
    <MDivider
      data-slot="separator"
      orientation={orientation}
      className={className}
      {...(decorative ? { role: 'none' } : { role: 'separator', 'aria-orientation': orientation })}
      {...props}
    />
  )
}

export { Separator }

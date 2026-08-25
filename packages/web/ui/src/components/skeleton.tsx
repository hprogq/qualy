import * as React from 'react'
import { Skeleton as PrimeSkeleton } from '@primereact/ui/skeleton'

// The product skeleton over Prime's. Prime sizes itself with inline style
// defaults (100% by 1rem); those are blanked here so the caller's own
// classes keep deciding the shape, exactly as they always have.
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <PrimeSkeleton
      width=""
      height=""
      data-slot="skeleton"
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

export { Skeleton }

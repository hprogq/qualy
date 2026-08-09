import * as React from 'react'
import { Loader2Icon } from 'lucide-react'

import { cn } from '../lib/utils.ts'

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

// fills the viewport; for app-level boot and layout transitions
function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-8" />
    </div>
  )
}

// fills the content area of a page without claiming the whole viewport
function PageLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <Spinner className="size-6" />
    </div>
  )
}

export { Spinner, LoadingScreen, PageLoading }

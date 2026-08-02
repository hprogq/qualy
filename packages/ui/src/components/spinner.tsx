import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

export function Spinner({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="status"
      aria-label="加载中"
      className={cn(
        'size-5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground',
        className,
      )}
      {...props}
    />
  )
}

// fills the viewport; for app-level boot and layout transitions
export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-8" />
    </div>
  )
}

// fills the content area of a page without claiming the whole viewport
export function PageLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <Spinner className="size-6" />
    </div>
  )
}

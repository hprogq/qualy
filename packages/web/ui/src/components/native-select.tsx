import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

// The platform picker styled to sit beside Input: forms use it, and a
// browser test drives it with selectOptions. The composed Select (./select)
// is for chrome; this one is for plain form rows.
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-9 w-full min-w-32 appearance-none rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-background',
        className,
      )}
      {...props}
    />
  )
}

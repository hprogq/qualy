import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

// The native element styled to sit beside Input: options render in the
// platform picker, selection works with a keyboard and announces itself, and
// a browser test drives it with selectOptions. A popover listbox can replace
// it if options ever need structure the platform picker cannot show.
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

import { Root } from '@radix-ui/react-label'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

export function Label({ className, ...props }: ComponentProps<typeof Root>) {
  return (
    <Root className={cn('text-sm font-medium leading-none select-none', className)} {...props} />
  )
}

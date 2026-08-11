import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Avatar, AvatarFallback } from './avatar.tsx'

// A person in a table row: avatar, name, one secondary line, and nothing else.
//
// It used to grow a hover card of its own when given children, which is what
// somebody wanting the fuller story reached for - and then iam contributed a
// person card that does exactly that, knowing who may see what. Two ways to
// answer one question is one too many: this stays the way a person is drawn,
// and what happens when you point at one belongs to whoever owns people.

/** latin names shrink to initials, cjk names keep their first characters */
export const initialsOf = (name: string): string => {
  const trimmed = name.trim()
  if (trimmed === '') return '?'
  const words = trimmed.split(/\s+/)
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => [...word][0]!.toUpperCase())
      .join('')
  }
  const characters = [...trimmed]
  return /^[\x20-\x7e]+$/.test(trimmed)
    ? characters[0]!.toUpperCase()
    : characters.slice(0, 2).join('')
}

export function PersonCell({
  name,
  secondary,
  className,
}: {
  name: string
  secondary?: ReactNode
  className?: string
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <Avatar className="rounded-lg">
        <AvatarFallback className="rounded-lg bg-primary text-xs font-medium text-primary-foreground">
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        {secondary !== undefined && (
          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
        )}
      </span>
    </span>
  )
}

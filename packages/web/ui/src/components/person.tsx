import type { ReactNode } from 'react'
import { Avatar, AvatarFallback } from './avatar.tsx'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card.tsx'

// A person in a table row: avatar, name, one secondary line. Given children,
// hovering (or focusing) the cell opens a card with the fuller story. All
// words arrive from the caller.

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
  children,
}: {
  name: string
  secondary?: ReactNode
  children?: ReactNode
}) {
  const core = (
    <span className="flex min-w-0 items-center gap-2.5">
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
  if (children === undefined) return core
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {core}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        {children}
      </HoverCardContent>
    </HoverCard>
  )
}

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../theme/tokens.stylex.ts'
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

const styles = stylex.create({
  row: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
  },
  lines: { minWidth: 0 },
  name: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  secondary: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
})

export function PersonCell({
  name,
  secondary,
  xstyle,
}: {
  name: string
  secondary?: ReactNode
  xstyle?: StyleXStyles
}) {
  return (
    <span {...stylex.props(styles.row, xstyle)}>
      {/* the avatar adapter still speaks Tailwind, so its overrides stay
          class strings until that boundary migrates */}
      <Avatar className="rounded-lg">
        <AvatarFallback className="rounded-lg bg-primary text-xs font-medium text-primary-foreground">
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      <span {...stylex.props(styles.lines)}>
        <span {...stylex.props(styles.name)}>{name}</span>
        {secondary !== undefined && <span {...stylex.props(styles.secondary)}>{secondary}</span>}
      </span>
    </span>
  )
}

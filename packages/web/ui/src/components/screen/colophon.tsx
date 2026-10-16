import { createContext, useContext, type ComponentType, type ReactNode } from 'react'

/**
 * Where the page is setting the shell's last line: flush to the start edge,
 * one entry to a line, or as one centred line that wraps where it must.
 */
export interface ColophonProps {
  readonly align: 'start' | 'center'
}

export type Colophon = ComponentType<ColophonProps>

const Seat = createContext<Colophon | null>(null)

/**
 * The shell saying what belongs at the very foot of a page that owns the
 * whole viewport.
 *
 * A page drawn edge to edge - the sign-in frame, with the product down one
 * side - knows where its last line goes and the shell does not: a strip
 * the shell appended under it would run under both halves and push the
 * page up to make room. So the shell hands the line down, the page places
 * it and says how it is set there, and nothing here knows what it says.
 */
export function ColophonScope({
  value,
  children,
}: {
  value: Colophon | null
  children: ReactNode
}) {
  return <Seat value={value}>{children}</Seat>
}

/** what the shell hung at the foot of this page; null where it offers nothing */
export function useColophon(): Colophon | null {
  return useContext(Seat)
}

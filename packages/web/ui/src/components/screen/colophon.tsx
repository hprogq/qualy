import { createContext, useContext, type ReactNode } from 'react'

const Colophon = createContext<ReactNode>(null)

/**
 * The shell saying what belongs at the very foot of a page that owns the
 * whole viewport.
 *
 * A page drawn edge to edge - the sign-in frame, with the product down one
 * side - knows where its last line goes and the shell does not: a strip
 * the shell appended under it would run under both halves and push the
 * page up to make room. So the shell hands the line down, the page places
 * it, and nothing here knows what it says.
 */
export function ColophonScope({ value, children }: { value: ReactNode; children: ReactNode }) {
  return <Colophon value={value}>{children}</Colophon>
}

/** what the shell hung at the foot of this page; null where it offers nothing */
export function useColophon(): ReactNode {
  return useContext(Colophon)
}

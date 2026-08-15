import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Rendering into a place somebody else laid out.
//
// For the case where one component owns where something goes and another owns
// what it says - a page's heading band filled by whatever the page has
// opened. Lifting the content instead would put that component's own state in
// its parent; a portal keeps the state where it belongs and only moves the
// output. Nothing renders until the host exists, which is one commit later
// than the first render.
export function Portal({ into, children }: { into: HTMLElement | null; children: ReactNode }) {
  return into === null ? null : createPortal(children, into)
}

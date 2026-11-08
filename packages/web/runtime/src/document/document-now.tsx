'use client'
import { createContext, useContext, type ReactNode } from 'react'
import { useHydrating } from './hydrating.ts'

// What time it is, as a server-drawn document says it
// (docs/adr/0012-rsc-data-mode.md).
//
// A page that says "today" or "3 hours left" from the clock says it twice:
// once in the server's render and once as the browser takes the html over.
// Read from two clocks a moment apart, the two can disagree - a row that was
// today on the server is yesterday in the browser just after midnight - and
// the browser's first frame is then not the html. So that first frame reads
// the moment the server drew the document, and every render after it reads
// the browser's clock, as before. Nothing ticks here: a page that keeps time
// keeps its own timer.

const RenderedAt = createContext<number | undefined>(undefined)

/** the moment the server drew this document, for the clock reads under it */
export function DocumentNow({ at, children }: { at: number | undefined; children: ReactNode }) {
  return <RenderedAt value={at}>{children}</RenderedAt>
}

/** now, as this render may say it: the server's moment while hydrating, the clock after */
export function useDocumentNow(): number {
  const hydrating = useHydrating()
  const rendered = useContext(RenderedAt)
  return hydrating && rendered !== undefined ? rendered : Date.now()
}

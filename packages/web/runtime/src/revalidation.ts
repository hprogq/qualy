'use client'
import type { ShouldRevalidateFunction } from 'react-router'

/**
 * Whether a server-rendered page is drawn again for a navigation
 * (docs/adr/0012-rsc-data-mode.md): only when the reader goes somewhere else.
 *
 * A change of query alone is the page's own state - a tab, a filter, a step
 * of a form - which the page reads and keeps itself. Drawn again by the
 * server it came back as a new page, and everything the reader had in it
 * went with the old one. The same line the leave guard draws: only the path
 * is leaving.
 *
 * Decided in the page, which is where React Router asks it; a module of its
 * own so the server can name it without running it.
 */
export const pageRevalidation: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) => (currentUrl.pathname === nextUrl.pathname ? false : defaultShouldRevalidate)

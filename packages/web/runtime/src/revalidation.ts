'use client'
import type { ShouldRevalidateFunction } from 'react-router'

/**
 * Whether a server-rendered page is drawn again for a navigation
 * (docs/adr/0012-rsc-data-mode.md): only when the reader goes somewhere else.
 *
 * A change of query alone is the page's own state - a tab, a filter, a step
 * of a form - which the page reads and keeps itself. Drawn again by the
 * server for it, every step was a round trip for nothing, and the sign-in
 * page's steps stayed on the view they were leaving. The same line the leave
 * guard draws: only the path is leaving. Asked to draw the same address
 * again, with nothing about it changed, it is drawn again as any route is.
 *
 * Decided in the page, which is where React Router asks it; a module of its
 * own so the server can name it without running it.
 */
export const pageRevalidation: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) =>
  currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search
    ? false
    : defaultShouldRevalidate

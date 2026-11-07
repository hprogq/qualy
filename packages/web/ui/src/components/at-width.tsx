'use client'

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

import { useHydrating } from '../hooks/use-hydrating.ts'
import { useIsBelow } from '../hooks/use-mobile.ts'

// A part of a screen that only exists at some widths, where the narrow and
// the wide screen are different trees rather than different rules.
//
// Where the two differ only in their rules, a media or container query says
// so in the stylesheet and nothing here is needed. Where they are different
// trees - a table that becomes cards, a column that becomes a sheet's
// trigger - javascript has to choose, and javascript cannot choose in html
// a server drew: there is no window there. So the html carries both shapes
// and the stylesheet shows the one the window is wide enough for, from its
// first frame, before any script has run. Once the page is running the
// shape that does not apply is no longer mounted, so it holds no state,
// answers no query and is found by no test; the one that does stays where
// it was, never mounted twice.
//
// The wrapper is `display: contents`, so it takes no part in the layout the
// shapes stand in.

/** the widths a screen folds at, each its own layout's limit */
export type FoldWidth = 480 | 560 | 600 | 640 | 768 | 1024 | 1200 | 1280

const below = stylex.create({
  w480: { display: { default: 'none', '@media (max-width: 479.98px)': 'contents' } },
  w560: { display: { default: 'none', '@media (max-width: 559.98px)': 'contents' } },
  w600: { display: { default: 'none', '@media (max-width: 599.98px)': 'contents' } },
  w640: { display: { default: 'none', '@media (max-width: 639.98px)': 'contents' } },
  w768: { display: { default: 'none', '@media (max-width: 767.98px)': 'contents' } },
  w1024: { display: { default: 'none', '@media (max-width: 1023.98px)': 'contents' } },
  w1200: { display: { default: 'none', '@media (max-width: 1199.98px)': 'contents' } },
  w1280: { display: { default: 'none', '@media (max-width: 1279.98px)': 'contents' } },
})

const from = stylex.create({
  w480: { display: { default: 'contents', '@media (max-width: 479.98px)': 'none' } },
  w560: { display: { default: 'contents', '@media (max-width: 559.98px)': 'none' } },
  w600: { display: { default: 'contents', '@media (max-width: 599.98px)': 'none' } },
  w640: { display: { default: 'contents', '@media (max-width: 639.98px)': 'none' } },
  w768: { display: { default: 'contents', '@media (max-width: 767.98px)': 'none' } },
  w1024: { display: { default: 'contents', '@media (max-width: 1023.98px)': 'none' } },
  w1200: { display: { default: 'contents', '@media (max-width: 1199.98px)': 'none' } },
  w1280: { display: { default: 'contents', '@media (max-width: 1279.98px)': 'none' } },
})

/**
 * Children that exist only below a width (`below`) or from it up (`from`).
 * `as` keeps the html valid where the shape stands in running text.
 */
export function AtWidth({
  children,
  as: Element = 'div',
  ...at
}: ({ below: FoldWidth; from?: never } | { from: FoldWidth; below?: never }) & {
  children: ReactNode
  as?: 'div' | 'span'
}) {
  const width = at.below ?? at.from
  const narrow = at.below !== undefined
  const hydrating = useHydrating()
  const isBelow = useIsBelow(width)
  if (!hydrating && isBelow !== narrow) return null
  return (
    <Element {...stylex.props(narrow ? below[`w${width}`] : from[`w${width}`])}>{children}</Element>
  )
}

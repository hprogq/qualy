import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// A row of chips that runs past the screen's edge: it says so by fading the
// side there is more on, keeps where it was scrolled to across pages, and
// brings the open chip into view.
//
// The row is drawn again by every page - the application's sections under
// each band, a record's sections under each banner - so it is built from
// nothing on every move, at offset zero, and the section the reader had
// scrolled to was suddenly off the edge. One remembered offset per row is
// enough: a row belongs to one application or one record.

const offsets = new Map<string, number>()

/** where the row runs past its edges */
export type ChipRowFade = 'start' | 'end' | 'both' | null

export function useChipRow<Row extends HTMLElement = HTMLDivElement>(name: string) {
  const seat = useRef<Row>(null)
  const [more, setMore] = useState({ start: false, end: false })
  const read = useCallback(() => {
    const row = seat.current
    if (row === null) return
    const over = row.scrollWidth - row.clientWidth
    setMore({ start: row.scrollLeft > 1, end: over > 1 && row.scrollLeft < over - 1 })
  }, [])
  useLayoutEffect(() => {
    const row = seat.current
    if (row === null) return
    // where the row was left, then the open one brought into view from
    // there - gliding, as a row the shell keeps does, unless there is no
    // earlier place to glide from
    const before = offsets.get(name)
    row.scrollLeft = before ?? 0
    row.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: before === undefined ? 'instant' : 'smooth',
    })
    read()
    const watch = new ResizeObserver(read)
    watch.observe(row)
    return () => watch.disconnect()
  }, [name, read])
  // A row the shell keeps across pages is not drawn again when the page
  // changes, so the chip just opened - pressed where it was cut off at the
  // edge - is brought into view when the address moves, as a row drawn anew
  // brings it into view on arrival.
  const { pathname } = useLocation()
  const arrived = useRef(false)
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true
      return
    }
    seat.current?.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    })
  }, [pathname])
  const fade: ChipRowFade =
    more.start && more.end ? 'both' : more.start ? 'start' : more.end ? 'end' : null
  return {
    seat,
    fade,
    onScroll: (event: { currentTarget: HTMLElement }) => {
      offsets.set(name, event.currentTarget.scrollLeft)
      read()
    },
  }
}

// A chip cut clean at the screen's edge reads as the last one; the fade is
// only on the side there is more on.
export const chipRowFades = stylex.create({
  start: { maskImage: 'linear-gradient(to right, transparent, black 14px)' },
  end: { maskImage: 'linear-gradient(to left, transparent, black 14px)' },
  both: {
    maskImage:
      'linear-gradient(to right, transparent, black 14px, black calc(100% - 14px), transparent)',
  },
})

// One chip, wherever a row of them is drawn: an application's sections and
// a record's are the same kind of thing, and were once two sizes by accident.
export const chips = stylex.create({
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingInline: 14,
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 13.5,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    color: tokens.mutedForeground,
  },
  open: {
    backgroundColor: tokens.primary,
    fontWeight: 500,
    color: tokens.primaryForeground,
  },
})

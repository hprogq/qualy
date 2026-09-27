import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'

// Where a question sits in the paper, after the way back to it.
//
// The group the question is in is the one worth reading, so when the line
// is short the outer groups give way first, from the paper down, into one
// mark that says something was left off; then whatever the line says after
// the path that it can do without; and only then does the nearest group's
// own name shorten. The whole path is always there for a screen reader, and
// on hover.
//
// What decides how much fits is the band's room less what else stands on
// the line, and the second can change while the band keeps its width: the
// line's other words (saved, then unsaved) and the letters themselves once
// the product's font arrives. Each of those measures the path again from
// nothing; measured only when the band moved, a path grown too long was
// cut off at its end, with no mark that anything was missing.

const styles = stylex.create({
  trail: {
    display: { default: 'inline-flex', [breakpoints.phone]: 'none' },
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    alignItems: 'center',
    gap: 6,
  },
  crumb: { display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 6 },
  // only once every outer group has given way
  crumbLast: { flexShrink: 1, minWidth: 0 },
  word: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rule: { width: 12, height: 12, flexShrink: 0 },
  // What the line says after the path. While an outer group is left to fold
  // it holds its room and the path is what gives way; once they have all
  // folded it gives way first, by a weight so far out of proportion that the
  // path gives up nothing while this still has anything to give.
  after: { display: 'inline-flex', minWidth: 0, overflow: 'hidden', alignItems: 'center' },
  afterHolds: { flexShrink: 0 },
  afterYields: { flexShrink: 1000000 },
})

/** keyed by the path by whoever renders it, so a new path is measured afresh */
export function QuestionTrail({
  groups,
  room,
  after,
  besides = '',
}: {
  groups: readonly string[]
  /**
   * What the line's room is measured by. The line's own box is only as wide
   * as what it says, so it never grows back once something has given way.
   */
  room: HTMLElement | null
  /**
   * What the line says after the path that it can do without, which gives
   * way once the outer groups have: its own box shrinks, and what is inside
   * decides how it lets go.
   */
  after?: ReactNode
  /** everything else the line says; a change in it measures the path afresh */
  besides?: string
}) {
  const seat = useRef<HTMLSpanElement>(null)
  // how many of the outer groups have given way, counted from the paper,
  // and which measuring this is: a change of room starts a new one even
  // where nothing had given way yet
  const [{ folded, pass }, setFit] = useState({ folded: 0, pass: 0 })
  const outer = Math.max(0, groups.length - 1)
  const whole = groups.join(' / ')

  // Measured before paint: fold one more outer group while the line
  // overflows, and start again from nothing whenever the room changes.
  useLayoutEffect(() => {
    const node = seat.current
    if (node === null) return
    // said outright rather than as a step from whatever is pending: the
    // effect may run twice over one render, and must fold once
    if (folded < outer && node.scrollWidth > node.clientWidth + 1) {
      setFit({ folded: folded + 1, pass })
    }
  }, [folded, pass, outer, whole])

  // The room is the band's width, not the line's: the line is only as wide
  // as what it says whenever that fits, so measured by itself it would take
  // every fold for a change of room and unfold again.
  useLayoutEffect(() => {
    if (room === null) return
    let width = room.getBoundingClientRect().width
    const watch = new ResizeObserver(() => {
      const now = room.getBoundingClientRect().width
      if (Math.abs(now - width) < 1) return
      width = now
      setFit((was) => ({ folded: 0, pass: was.pass + 1 }))
    })
    watch.observe(room)
    return () => watch.disconnect()
  }, [room])

  // what else the line says, measured before the paint that shows it
  const saidBesides = useRef(besides)
  useLayoutEffect(() => {
    if (saidBesides.current === besides) return
    saidBesides.current = besides
    setFit((was) => ({ folded: 0, pass: was.pass + 1 }))
  }, [besides])

  // the letters themselves, once the product's own font replaces the fallback
  useLayoutEffect(() => {
    const fonts = document.fonts
    const refit = () => setFit((was) => ({ folded: 0, pass: was.pass + 1 }))
    fonts.addEventListener('loadingdone', refit)
    return () => fonts.removeEventListener('loadingdone', refit)
  }, [])

  const settled = folded >= outer
  const tail =
    after === undefined ? null : (
      <span
        {...stylex.props(styles.after, settled ? styles.afterYields : styles.afterHolds)}
        data-testid="item-trail-after"
      >
        {after}
      </span>
    )
  if (groups.length === 0) return tail
  const shown = groups.slice(Math.min(folded, outer))
  return (
    <>
      <span
        ref={seat}
        {...stylex.props(styles.trail)}
        title={whole}
        data-testid="item-trail"
        data-folded={Math.min(folded, outer)}
      >
        <VisuallyHidden>{whole}</VisuallyHidden>
        {folded > 0 && (
          <span aria-hidden {...stylex.props(styles.crumb)} data-crumb="folded">
            <ChevronRightIcon {...stylex.props(styles.rule)} />
            <span>…</span>
          </span>
        )}
        {shown.map((name, index) => {
          const last = index === shown.length - 1
          return (
            <span
              key={`${groups.length - shown.length + index}:${name}`}
              aria-hidden
              data-crumb={groups.length - shown.length + index}
              {...stylex.props(styles.crumb, last && settled && styles.crumbLast)}
            >
              <ChevronRightIcon {...stylex.props(styles.rule)} />
              <span {...stylex.props(styles.word)}>{name}</span>
            </span>
          )
        })}
      </span>
      {tail}
    </>
  )
}

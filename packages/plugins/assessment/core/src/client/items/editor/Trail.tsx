import { useLayoutEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'

// Where a question sits in the paper, after the way back to it.
//
// The group the question is in is the one worth reading, so when the line
// is short the outer groups give way first, from the paper down, into one
// mark that says something was left off; only once they are all gone does
// the nearest group's own name shorten. The whole path is always there for
// a screen reader, and on hover.

const styles = stylex.create({
  trail: {
    display: { default: 'inline-flex', [breakpoints.phone]: 'none' },
    minWidth: 0,
    overflow: 'hidden',
    alignItems: 'center',
    gap: 6,
  },
  crumb: { display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 6 },
  // only once every outer group has given way
  crumbLast: { flexShrink: 1, minWidth: 0 },
  word: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rule: { width: 12, height: 12, flexShrink: 0 },
})

/** keyed by the path by whoever renders it, so a new path is measured afresh */
export function QuestionTrail({
  groups,
  room,
}: {
  groups: readonly string[]
  /**
   * What the line's room is measured by. The line's own box is only as wide
   * as what it says, so it never grows back once something has given way.
   */
  room: HTMLElement | null
}) {
  const seat = useRef<HTMLSpanElement>(null)
  // how many of the outer groups have given way, counted from the paper
  const [folded, setFolded] = useState(0)
  const outer = Math.max(0, groups.length - 1)
  const whole = groups.join(' / ')

  // Measured before paint: fold one more outer group while the line
  // overflows, and start again from nothing whenever the room changes.
  useLayoutEffect(() => {
    const node = seat.current
    if (node === null) return
    if (folded < outer && node.scrollWidth > node.clientWidth + 1) setFolded(folded + 1)
  }, [folded, outer, whole])
  useLayoutEffect(() => {
    if (room === null) return
    let width = room.getBoundingClientRect().width
    const watch = new ResizeObserver(() => {
      const now = room.getBoundingClientRect().width
      if (Math.abs(now - width) < 1) return
      width = now
      setFolded(0)
    })
    watch.observe(room)
    return () => watch.disconnect()
  }, [room])

  if (groups.length === 0) return null
  const shown = groups.slice(Math.min(folded, outer))
  return (
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
            {...stylex.props(styles.crumb, last && folded >= outer && styles.crumbLast)}
          >
            <ChevronRightIcon {...stylex.props(styles.rule)} />
            <span {...stylex.props(styles.word)}>{name}</span>
          </span>
        )
      })}
    </span>
  )
}

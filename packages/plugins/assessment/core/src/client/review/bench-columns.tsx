import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The three columns of the workbench, as wide as the reviewer likes them.
//
// The first and the last are dragged; the middle takes what is left. Each has
// a floor and a ceiling, because a column dragged to a sliver is a column the
// next filing cannot be read in, and the reader who did it by accident has no
// way to know where it went. What was chosen is remembered on this device.

const STORE = 'qualy:review-bench-columns'
/** px: [floor, ceiling] of the dragged columns, and the floor of the one between */
const FLOW = [272, 640] as const
const ABOUT = [240, 480] as const
const FILING_FLOOR = 288
const STEP = 16

const lg = '@media (min-width: 1024px)'

const styles = stylex.create({
  handle: {
    position: 'absolute',
    insetBlock: 0,
    zIndex: 2,
    display: { default: 'none', [lg]: 'block' },
    width: 9,
    marginInline: -4,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'col-resize',
    touchAction: 'none',
    outlineStyle: 'none',
  },
  // the line itself: nothing at rest - the columns already have their rules -
  // and the theme's ink under a pointer, a drag or the keyboard
  line: {
    position: 'absolute',
    insetBlock: 0,
    left: 4,
    width: 1,
    backgroundColor: 'transparent',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  lineLit: { width: 2, left: 3.5, backgroundColor: tokens.foreground },
})

interface Widths {
  readonly flow: number
  readonly about: number
}

const clamp = (value: number, [floor, ceiling]: readonly [number, number]) =>
  Math.min(Math.max(value, floor), ceiling)

const remembered = (): Widths | null => {
  try {
    const raw = window.localStorage.getItem(STORE)
    if (raw === null) return null
    const read = JSON.parse(raw) as Partial<Widths>
    if (typeof read.flow !== 'number' || typeof read.about !== 'number') return null
    return { flow: clamp(read.flow, FLOW), about: clamp(read.about, ABOUT) }
  } catch {
    return null
  }
}

/**
 * The bench's column widths and the two handles that set them.
 *
 * `vars` goes on the grid (it reads `--bench-flow` and `--bench-about`, and
 * keeps its own proportions while neither is set); `handles` go inside it,
 * which has to be `position: relative`.
 */
export function useBenchColumns(
  bench: HTMLElement | null,
  labels: { flow: string; about: string },
) {
  const [widths, setWidths] = useState<Widths | null>(remembered)
  const [held, setHeld] = useState<keyof Widths | null>(null)
  const [over, setOver] = useState<keyof Widths | null>(null)
  const latest = useRef(widths)
  latest.current = widths

  // Until somebody drags, the grid lays itself out. The first press starts
  // from what is on screen, so the column does not jump under the pointer.
  const measured = useCallback((): Widths | null => {
    if (bench === null) return null
    const panes = [...bench.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.dataset['benchHandle'] === undefined,
    )
    const first = panes[0]
    const last = panes[panes.length - 1]
    if (first === undefined || last === undefined) return null
    return {
      flow: clamp(first.getBoundingClientRect().width, FLOW),
      about: clamp(last.getBoundingClientRect().width, ABOUT),
    }
  }, [bench])

  const fit = useCallback(
    (next: Widths): Widths => {
      const room = bench?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY
      // the column between keeps its floor: whichever side is being dragged
      // stops where that floor begins
      const flow = clamp(Math.min(next.flow, room - next.about - FILING_FLOOR), FLOW)
      const about = clamp(Math.min(next.about, room - flow - FILING_FLOOR), ABOUT)
      return { flow, about }
    },
    [bench],
  )

  const commit = useCallback((next: Widths) => {
    setWidths(next)
    try {
      window.localStorage.setItem(STORE, JSON.stringify(next))
    } catch {
      // a device that will not remember still resizes
    }
  }, [])

  useEffect(() => {
    if (held === null || bench === null) return
    const move = (event: PointerEvent) => {
      const rect = bench.getBoundingClientRect()
      const from = latest.current ?? measured()
      if (from === null) return
      commit(
        fit(
          held === 'flow'
            ? { flow: event.clientX - rect.left, about: from.about }
            : { flow: from.flow, about: rect.right - event.clientX },
        ),
      )
    }
    const up = () => setHeld(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    const before = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.userSelect = before
    }
  }, [held, bench, measured, fit, commit])

  const nudge = (which: keyof Widths, by: number) => {
    const from = latest.current ?? measured()
    if (from === null) return
    commit(fit({ ...from, [which]: from[which] + by }))
  }

  const handle = (which: keyof Widths) => {
    const range = which === 'flow' ? FLOW : ABOUT
    const lit = held === which || over === which
    return (
      <button
        key={which}
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label={labels[which]}
        aria-valuemin={range[0]}
        aria-valuemax={range[1]}
        aria-valuenow={Math.round(widths?.[which] ?? 0)}
        data-bench-handle={which}
        data-testid={`bench-handle-${which}`}
        {...stylex.props(styles.handle)}
        style={
          which === 'flow'
            ? { left: 'var(--bench-flow-at, 0px)' }
            : { right: 'var(--bench-about-at, 0px)' }
        }
        onPointerDown={(event) => {
          event.preventDefault()
          if (latest.current === null) {
            const now = measured()
            if (now !== null) setWidths(now)
          }
          setHeld(which)
        }}
        onPointerEnter={() => setOver(which)}
        onPointerLeave={() => setOver(null)}
        onFocus={() => setOver(which)}
        onBlur={() => setOver(null)}
        onDoubleClick={() => {
          // back to the bench's own proportions
          setWidths(null)
          try {
            window.localStorage.removeItem(STORE)
          } catch {
            // nothing was remembered
          }
        }}
        onKeyDown={(event) => {
          const toward = which === 'flow' ? 1 : -1
          if (event.key === 'ArrowRight') nudge(which, STEP * toward)
          else if (event.key === 'ArrowLeft') nudge(which, -STEP * toward)
          else return
          event.preventDefault()
        }}
      >
        <span aria-hidden {...stylex.props(styles.line, lit && styles.lineLit)} />
      </button>
    )
  }

  // Where the handles stand before anybody has dragged: on the rules the
  // columns already draw, read off the panes themselves.
  const [resting, setResting] = useState<Widths | null>(null)
  useEffect(() => {
    if (bench === null || widths !== null) return
    const read = () => {
      const panes = [...bench.children].filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.dataset['benchHandle'] === undefined,
      )
      const first = panes[0]
      const last = panes[panes.length - 1]
      if (first === undefined || last === undefined) return
      setResting({
        flow: first.getBoundingClientRect().width,
        about: last.getBoundingClientRect().width,
      })
    }
    read()
    const watch = new ResizeObserver(read)
    watch.observe(bench)
    return () => watch.disconnect()
  }, [bench, widths])

  const at = widths ?? resting
  const vars = {
    ...(widths === null
      ? {}
      : { '--bench-flow': `${widths.flow}px`, '--bench-about': `${widths.about}px` }),
    ...(at === null
      ? {}
      : { '--bench-flow-at': `${at.flow}px`, '--bench-about-at': `${at.about}px` }),
  } as CSSProperties

  return { vars, handles: [handle('flow'), handle('about')], custom: widths !== null }
}

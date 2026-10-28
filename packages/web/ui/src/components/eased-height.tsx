import { useLayoutEffect, useRef, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

// A region whose height eases to what its content comes to, instead of
// jumping there.
//
// For a part of a page whose placeholder and content are close in height but
// not equal: a loading card drawn in the shape most cards take, and the card
// itself, a line taller or a row shorter. Reserving the tallest shape instead
// left a strip of nothing on every card that was not the tallest. Here both
// take the height they come to, and what follows the region slides by the
// difference rather than being knocked down it.
//
// The height is followed outside React. A resize observer runs after layout
// and before paint, so the region takes its new height in the frame the
// content changed; through state it would land a frame later, with the
// content already spilling over what follows. Growing, the region clips for
// as long as it eases, so the taller content opens downwards instead of
// covering what is below it; once it has arrived nothing is clipped, and a
// shadow falls past the edge again. Nothing eases for a reader who asked for
// less motion: the region simply takes the new height.

const REDUCE = '@media (prefers-reduced-motion: reduce)'
const REDUCED = '(prefers-reduced-motion: reduce)'

const styles = stylex.create({
  region: {
    transitionProperty: { default: 'height', [REDUCE]: 'none' },
    transitionDuration: { default: '240ms', [REDUCE]: '0s' },
    transitionTimingFunction: 'ease-out',
  },
  // its own formatting context, so a margin inside it counts towards the height
  content: { display: 'flow-root' },
})

export function EasedHeight({ children, testId }: { children: ReactNode; testId?: string }) {
  const region = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const outer = region.current
    const inner = content.current
    if (outer === null || inner === null) return
    let shown: number | undefined
    const settle = (event: TransitionEvent) => {
      if (event.target === outer && event.propertyName === 'height') outer.style.overflow = ''
    }
    const follow = () => {
      const next = inner.getBoundingClientRect().height
      if (shown !== undefined && next > shown + 0.5 && !window.matchMedia(REDUCED).matches) {
        outer.style.overflow = 'clip'
      }
      shown = next
      outer.style.height = `${String(next)}px`
    }
    const observer = new ResizeObserver(follow)
    observer.observe(inner)
    // only an ending clears the clip: one interrupted by the next change
    // goes on easing towards that one, which may be taller still
    outer.addEventListener('transitionend', settle)
    return () => {
      observer.disconnect()
      outer.removeEventListener('transitionend', settle)
      outer.style.height = ''
      outer.style.overflow = ''
    }
  }, [])
  return (
    <div ref={region} data-testid={testId} {...stylex.props(styles.region)}>
      <div ref={content} {...stylex.props(styles.content)}>
        {children}
      </div>
    </div>
  )
}

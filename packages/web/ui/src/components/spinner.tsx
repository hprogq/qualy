import type * as React from 'react'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'
import * as stylex from '@stylexjs/stylex'
import { bootFrame, bootPlacement } from '@qualy/brand/boot'
import { Loader } from '@qualy/brand/loader'
import { Wordmark } from '@qualy/brand/wordmark'

import { VisuallyHidden } from '../lib/visually-hidden.tsx'
import { seatOf } from '../lib/xstyle.ts'
import { tokens } from '../theme/tokens.stylex.ts'

// Work in progress, wherever a screen has to wait.
//
// Deliberately NOT the widget library's loader: the first places this
// renders are the i18n catalog fallback and the manifest loading screen -
// both stand OUTSIDE the widget provider, which mounts further down the
// same tree. A provider-dependent loader there throws before the app can
// draw anything (it did). So the spinner is a bare SVG and compiled
// keyframes, needing nothing, and it takes the ink of whatever names it.
//
// Three surfaces. The inline spinner shows at once and goes at once. The
// page loader waits 300ms before appearing, because a page that arrives in
// 200ms should not flash a spinner on the way. The loading screen is the
// brand's cold start: the wordmark index.html already painted, taken over
// in place, its Q lit only if the wait passes 400ms, and flown into the top
// bar when the shell arrives.

const appear = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const vanish = stylex.keyframes({
  to: { opacity: 0 },
})

const styles = stylex.create({
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 96,
  },
  // opacity from 0, with the delay counted in: a page that comes in under
  // 300ms never shows this at all
  lateArrival: {
    animationName: appear,
    animationDuration: '150ms',
    animationDelay: '300ms',
    animationFillMode: 'both',
  },
  // the standalone screen, for a tree without a cold-start host
  screen: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
  },
})

interface SpinnerProps {
  'aria-label'?: string
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

/** the inline indicator: 16px, light polarity, shown at once and gone at once */
function Spinner({ className, style, xstyle, ...rest }: SpinnerProps) {
  return (
    <Loader
      size={16}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      {...rest}
      {...seatOf(stylex.props(xstyle), className, style)}
    />
  )
}

/** fills the content area of a page without claiming the whole viewport */
function PageLoading() {
  return (
    <div {...stylex.props(styles.page)} role="status">
      <Loader size={24} xstyle={styles.lateArrival} />
      <VisuallyHidden>Loading</VisuallyHidden>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The cold start.
//
// Three fallbacks stand in a row on the way to the first screen - the
// catalog, the manifest, the layout chunk - and each of them renders a
// LoadingScreen. If each drew its own wordmark, the loop would restart at
// every hand-over and nothing could animate out, because the fallback that
// drew it is gone by the time the screen behind it exists. So a
// LoadingScreen is a CLAIM on one shared overlay, and the overlay is drawn
// by a host mounted once at the root, above every provider. The host keeps
// the wordmark up while any claim stands, times the threshold and the
// hints from the first claim, and when the last claim goes it fades the
// loop to solid and flies the wordmark into the top bar - with the drawing
// itself, by its geometry, not the browser's view transition, which WebKit
// captured wrongly at every zoom but one. A LoadingScreen in a tree with no
// host draws a plain screen
// of its own, so it never renders nothing by mistake.
//
// Whether a screen is hosted is a fact of the tree, told by context, so a
// screen knows it in the render that mounts it. It was once a counter the
// host raised in a layout effect, which left every first render believing
// it stood alone: the standalone screen was committed under the first
// frame and taken back a commit later - and that commit was painted, in
// every engine, as a second wordmark under the first for one frame.

type Listener = () => void
const listeners = new Set<Listener>()
let claims = 0
const notify = () => {
  for (const listener of listeners) listener()
}
const subscribe = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const claimsNow = () => claims

/** true inside a cold-start host's tree */
const HostContext = createContext(false)
/** true while the host's screen is up: the application is arriving under it */
const HandoffContext = createContext(false)

/**
 * Whether the screen mounting now arrives under the cold start.
 *
 * For an entrance that would otherwise play inside the hand-over: the
 * application's own fade-in is the entrance there, and a second one under
 * it is a jump on a browser that captures the incoming page as a still.
 */
function useColdStartHandoff(): boolean {
  return useContext(HandoffContext)
}

/** a claim on the cold-start overlay; on its own, a plain loading screen */
function LoadingScreen() {
  const hosted = useContext(HostContext)
  useLayoutEffect(() => {
    claims += 1
    notify()
    return () => {
      claims -= 1
      notify()
    }
  }, [])
  if (hosted) return null
  return (
    <div {...stylex.props(styles.screen)} role="status">
      <Wordmark height={28} />
      <VisuallyHidden>Loading</VisuallyHidden>
    </div>
  )
}

/** the wait a cold start may end within without the loop ever lighting */
const THRESHOLD = 400
const HINT_AFTER = 6000
const STALL_AFTER = 30000
const EXIT = 150
const CAP = 28
/** the placeholder index.html paints before any script runs */
const PLACEHOLDER = 'qualy-boot'
/** the wordmark the flight lands on: the top bar's, which marks itself */
const DESTINATION = '[data-brand-wordmark]'
/** on the root while the wordmark is in flight; the destination hides under it */
const FLIGHT = 'data-cold-start-flight'
/** the layer carrying the wordmark in flight */
const FLIGHT_LAYER = 'data-cold-start-flight-layer'
const FLIGHT_MS = 320
const FLIGHT_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/**
 * When the first frame was painted, on the performance clock.
 *
 * The threshold is about how long the reader has looked at a still
 * wordmark, and that starts at the first contentful paint, not at the
 * navigation: with a slow stylesheet the frame appears late, and counting
 * from the navigation would set the loop going on a wordmark the reader
 * had seen for a moment. A browser that has not reported the paint counts
 * from the navigation, the earlier of the two.
 */
const firstFramePaintedAt = (): number =>
  performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0
const COLD_START = 'data-cold-start'

// The ring's centre line sits at 44vh, so the wordmark's top is that much
// higher; the hint sits 40px under its bottom. The same numbers position
// the first frame the build writes into index.html: both read them from
// the brand's boot placement, so neither can drift from the other.
export const coldStartPlacement = bootPlacement(CAP)
// the two offsets, resolved here and handed to the dynamic styles below:
// the compiler reads a stylesheet's values from the file itself and will
// not follow a number computed from an import
const seatTop = `calc(${coldStartPlacement.line} - ${coldStartPlacement.ringDrop}px)`
const hintTop = `calc(${coldStartPlacement.line} - ${coldStartPlacement.ringDrop}px + ${coldStartPlacement.height}px + ${coldStartPlacement.hintGap}px)`

const overlayStyles = stylex.create({
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    backgroundColor: tokens.background,
    color: tokens.foreground,
  },
  fading: {
    animationName: vanish,
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'forwards',
  },
  seat: (top: string) => ({
    position: 'absolute',
    top,
    insetInline: 0,
    display: 'flex',
    justifyContent: 'center',
  }),
  below: (top: string) => ({
    position: 'absolute',
    top,
    insetInline: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
    animationName: appear,
    animationDuration: '400ms',
    animationFillMode: 'both',
  }),
  retry: {
    appearance: 'none',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surface,
    color: tokens.foreground,
    paddingInline: 12,
    paddingBlock: 6,
    fontSize: 14,
    lineHeight: '1.25rem',
    cursor: 'pointer',
  },
})

type Phase = 'idle' | 'waiting' | 'stalled' | 'fading'

export interface ColdStartCopy {
  /** what the status region says while the screen is up */
  loading: string
  /** the line under the wordmark once the wait has run long */
  stillLoading: string
  /** the button once the wait has run too long */
  retry: string
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** the two ends of the flight: where the screen drew the wordmark, and the top bar's */
interface Flight {
  readonly from: DOMRect
  readonly to: DOMRect
  /** the ink the top bar draws it in */
  readonly ink: string
}

/** the flight there is to make, or none: no top bar to land on, or no way to animate */
const flightFrom = (screen: HTMLElement): Flight | null => {
  const source = screen.querySelector('svg')
  const destination = document.querySelector(DESTINATION)
  if (source === null || destination === null) return null
  if (typeof Element.prototype.animate !== 'function') return null
  const from = source.getBoundingClientRect()
  const to = destination.getBoundingClientRect()
  if (from.width === 0 || to.width === 0) return null
  return { from, to, ink: getComputedStyle(destination).color }
}

/**
 * The wordmark's flight from the screen into the top bar, made with the
 * drawing itself, by its geometry.
 *
 * A still copy of the wordmark is laid over the screen's own, at the place
 * and size the screen drew it; the top bar's is hidden; the screen leaves;
 * the copy's left, top, width and height are animated onto the top bar's
 * rectangle; the copy leaves and the top bar's stands. Geometry, not a
 * transform: a transform is a texture scaled on the compositor, and WebKit
 * draws text and paths on such a texture soft, then sharp again the frame
 * the animation ends - the "settling" a slowed-down flight showed to be
 * not a movement at all but a change of rendering. Laid out at every
 * size, the drawing is rasterised at that size each frame and ends as
 * exactly the drawing the top bar shows, so the hand-over is between two
 * identical pictures. The cost is a layout and paint of one small element
 * per frame for a third of a second, contained to itself.
 *
 * The view transition this all replaces asked the browser to capture the
 * page and the wordmark, and WebKit answered wrongly at every zoom but
 * one; here every measure is a rectangle of the live layout and nothing
 * is captured.
 */
const fly = ({ from, to, ink }: Flight, leave: () => void) => {
  const layer = document.createElement('div')
  layer.setAttribute(FLIGHT_LAYER, '')
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, {
    position: 'fixed',
    left: `${String(from.left)}px`,
    top: `${String(from.top)}px`,
    width: `${String(from.width)}px`,
    height: `${String(from.height)}px`,
    color: ink,
    pointerEvents: 'none',
    zIndex: '1000',
    contain: 'layout paint',
  } satisfies Partial<CSSStyleDeclaration>)
  // the first frame's drawing: the same geometry, at rest, filling the seat
  layer.innerHTML = bootFrame(CAP).svg
  const drawing = layer.firstElementChild
  if (drawing instanceof SVGElement) {
    drawing.setAttribute('width', '100%')
    drawing.setAttribute('height', '100%')
  }
  // one task, no frame between: the copy is on before the screen is off,
  // and the top bar's wordmark is hidden before either
  document.documentElement.setAttribute(FLIGHT, '')
  document.body.append(layer)
  leave()
  const animation = layer.animate(
    [
      {
        left: `${String(from.left)}px`,
        top: `${String(from.top)}px`,
        width: `${String(from.width)}px`,
        height: `${String(from.height)}px`,
      },
      {
        left: `${String(to.left)}px`,
        top: `${String(to.top)}px`,
        width: `${String(to.width)}px`,
        height: `${String(to.height)}px`,
      },
    ],
    { duration: FLIGHT_MS, easing: FLIGHT_EASE, fill: 'forwards' },
  )
  // the landed copy is painted before the top bar's own takes its place
  const land = () =>
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        layer.remove()
        document.documentElement.removeAttribute(FLIGHT)
      })
    })
  animation.finished.then(land, land)
}

/**
 * The loop brought to rest: the eight parts paused where they are, then
 * every one taken to full ink and the tail back home within EXIT ms. A
 * script animation sits above the paused stylesheet ones and holds, so the
 * picture the view transition takes afterwards is of the solid wordmark.
 */
const settle = (root: HTMLElement): Promise<void> => {
  const finished: Promise<unknown>[] = []
  for (const part of root.querySelectorAll<SVGElement>('[data-seg]')) {
    const { opacity, transform } = getComputedStyle(part)
    for (const animation of part.getAnimations()) animation.pause()
    const rest = part.animate(
      [
        { opacity, transform },
        { opacity: 1, transform: 'none' },
      ],
      { duration: EXIT, easing: 'ease-out', fill: 'forwards' },
    )
    finished.push(rest.finished)
  }
  return Promise.all(finished).then(() => undefined)
}

/**
 * The host of the cold-start overlay: mounted once, at the root, around
 * every provider, with the copy the fallbacks cannot fetch yet. Its
 * children are the hosted tree: every loading screen in it is a claim on
 * the one overlay, and knows so from its first render.
 */
function ColdStart({ copy, children }: { copy: ColdStartCopy; children?: React.ReactNode }) {
  const pending = useSyncExternalStore(subscribe, claimsNow, claimsNow)
  const [phase, setPhase] = useState<Phase>('idle')
  const [hint, setHint] = useState(false)
  const overlay = useRef<HTMLDivElement>(null)
  // how many times the screen has gone up in this page: the flight into
  // the top bar is the first screen's gesture, and a screen that comes
  // back later - the manifest reloading after a sign-in - leaves by a fade
  const episodes = useRef(0)
  // the loop's delay: on the first screen the threshold counts from the
  // first frame index.html painted, so the time the scripts took to arrive
  // is already spent; a later screen counts from when it goes up
  const [delay, setDelay] = useState(THRESHOLD)

  // a claim while nothing is up: the overlay goes up, in the placeholder's
  // place, its loop set to begin 400ms from now
  useLayoutEffect(() => {
    if (pending > 0 && phase === 'idle') {
      episodes.current += 1
      setDelay(
        episodes.current === 1
          ? Math.max(0, THRESHOLD - (performance.now() - firstFramePaintedAt()))
          : THRESHOLD,
      )
      setHint(false)
      setPhase('waiting')
    }
  }, [pending, phase])

  // the placeholder leaves in the same frame the overlay arrives, so neither
  // two wordmarks nor none are ever painted
  useLayoutEffect(() => {
    if (phase === 'idle') return
    document.getElementById(PLACEHOLDER)?.remove()
    document.documentElement.setAttribute(COLD_START, '')
  }, [phase])

  // the wait's own clock: a hint, then a way out
  useEffect(() => {
    if (phase !== 'waiting') return
    const hintTimer = setTimeout(() => setHint(true), HINT_AFTER)
    const stallTimer = setTimeout(() => setPhase('stalled'), STALL_AFTER)
    return () => {
      clearTimeout(hintTimer)
      clearTimeout(stallTimer)
    }
  }, [phase])

  // stalled: the loop is brought to rest and stays there
  useEffect(() => {
    if (phase !== 'stalled' || overlay.current === null) return
    void settle(overlay.current)
  }, [phase])

  // The last claim has gone: rest the loop, then hand the wordmark over.
  // A hand-over between two fallbacks is one claim released and the next
  // made inside one commit, and this effect runs after the commit, so a
  // count of zero here is the end and not a gap. The copy that flies is
  // of the settled wordmark, which is why the flight waits for the rest.
  useEffect(() => {
    if (pending > 0 || (phase !== 'waiting' && phase !== 'stalled')) return
    const root = overlay.current
    if (root === null) return
    let cancelled = false
    void settle(root).then(() => {
      if (cancelled) return
      const leave = () => {
        document.documentElement.removeAttribute(COLD_START)
        flushSync(() => setPhase('idle'))
      }
      // the flight is the first screen's gesture; a screen that comes back
      // later leaves by a fade, and so does one with nowhere to fly to
      const flight = episodes.current === 1 && !reducedMotion() ? flightFrom(root) : null
      if (flight !== null) {
        fly(flight, leave)
      } else {
        setPhase('fading')
        setTimeout(leave, EXIT)
      }
    })
    return () => {
      cancelled = true
    }
  }, [pending, phase])

  const hosted = (
    <HostContext value={true}>
      <HandoffContext value={phase !== 'idle'}>{children}</HandoffContext>
    </HostContext>
  )
  if (phase === 'idle') return hosted
  return (
    <>
      {hosted}
      <div
        ref={overlay}
        role="status"
        data-cold-start-phase={phase}
        {...stylex.props(overlayStyles.overlay, phase === 'fading' && overlayStyles.fading)}
      >
      <div {...stylex.props(overlayStyles.seat(seatTop))}>
        <Wordmark height={CAP} live={phase === 'waiting' || phase === 'stalled'} liveDelay={delay} />
      </div>
      <VisuallyHidden>{copy.loading}</VisuallyHidden>
      {hint || phase === 'stalled' ? (
        <div {...stylex.props(overlayStyles.below(hintTop))} data-testid="cold-start-hint">
          <span>{copy.stillLoading}</span>
          {phase === 'stalled' ? (
            <button
              type="button"
              {...stylex.props(overlayStyles.retry)}
              onClick={() => window.location.reload()}
            >
              {copy.retry}
            </button>
          ) : null}
        </div>
      ) : null}
      </div>
    </>
  )
}

export { Spinner, LoadingScreen, PageLoading, ColdStart, useColdStartHandoff }

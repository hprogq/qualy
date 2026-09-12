// The loading loop as a rule, so the hand-written keyframes can be checked
// against it and the preview can draw the same motion in plain CSS.
//
// Nothing moves. A head of light (dark polarity: the ring is solid and the
// head is the dark part) or of ink (light polarity: the ring is faint and
// the head is the solid part) passes through the eight parts in order -
// tail, then sectors 1 to 7 clockwise from the bottom, then the tail again.
// It dwells 280ms on the tail and 160ms on each sector: one round is
// 1400ms. A part's opacity depends only on how many steps ago the head
// passed it, `level[d]`, d = 0 while the head is on it; the tail as head
// has a value of its own.
//
// The keyframes start 40ms before the head reaches the tail, when the tail
// begins to lean towards the gap, so that an animation-delay of 0 begins
// with the lean and the head's arrival at part i falls on C[i] + 40ms.
// A keyframe carries the value a part has AT that moment, which is what
// it reached during the previous dwell; the value the new dwell heads for
// sits on the next keyframe, and the interval between them is eased fast
// then slow, so a part changes right after the head reaches it and then
// holds. The one exception is the tail after the head has left it, which
// recovers on a slow ease-in-out: the afterglow.

export type Polarity = 'dark' | 'light'

export const PERIOD = 1400
/** how long the head dwells on each part, the tail first */
export const DWELL = [280, 160, 160, 160, 160, 160, 160, 160] as const
/** how long before the head reaches the tail the tail starts to lean */
export const LEAD = 40
/** the opacity of a part by how many steps ago the head passed it, and of the tail while it is the head */
export const LEVELS: Record<Polarity, { level: readonly number[]; tailHead: number }> = {
  dark: { level: [0.4, 0.62, 0.85, 1, 1, 1, 1, 1], tailHead: 0.32 },
  light: { level: [1, 0.6, 0.36, 0.24, 0.17, 0.14, 0.13, 0.12], tailHead: 1 },
}
export const FAST_SLOW = 'cubic-bezier(.1,.9,.2,1)'
export const AFTERGLOW = 'cubic-bezier(.4,0,.6,1)'
export const LEAN_OUT = 'cubic-bezier(.33,1,.68,1)'
export const LEAN_BACK = 'cubic-bezier(.65,0,.35,1)'
/** the lean, in user units at s = 16: 0.3s along 45 degrees, taken off the tail's 1.5s */
export const LEAN_SHIFT = Number((0.3 * 16 * Math.SQRT1_2).toFixed(3))
export const LEAN_OUT_MS = 140
export const LEAN_BACK_MS = 220
export const BREATH_MS = 2400
export const BREATH_LOW = 0.55

/** when the head reaches each part, from the head's arrival at the tail */
export const ARRIVALS: readonly number[] = DWELL.slice(0, -1).reduce<number[]>(
  (at, dwell) => [...at, at[at.length - 1]! + dwell],
  [0],
)

/** a time within the period as a keyframe selector, from the lean's start */
export const percent = (ms: number): string => `${Number(((ms / PERIOD) * 100).toFixed(3))}%`

/** the keyframe selectors at which the head moves on, the tail's arrival first */
export const switchPoints = (): readonly string[] => ARRIVALS.map((ms) => percent(ms + LEAD))

export interface OpacityFrame {
  readonly opacity: number
  readonly animationTimingFunction?: string
}

/** what part k is at while the head is on part i */
const targetOf = (polarity: Polarity, k: number, i: number): number => {
  const { level, tailHead } = LEVELS[polarity]
  return k === 0 && i === 0 ? tailHead : level[(i - k + 8) % 8]!
}

/** the opacity keyframes of part k, exactly as keyframes.ts spells them */
export function loopFrames(polarity: Polarity, k: number): Record<string, OpacityFrame> {
  const rest = targetOf(polarity, k, 7)
  const frames: Record<string, OpacityFrame> = {
    '0%': { opacity: rest, animationTimingFunction: FAST_SLOW },
  }
  switchPoints().forEach((at, j) => {
    frames[at] = {
      opacity: targetOf(polarity, k, (j + 7) % 8),
      animationTimingFunction: k === 0 && j === 1 ? AFTERGLOW : FAST_SLOW,
    }
  })
  frames['100%'] = { opacity: rest }
  return frames
}

export interface TransformFrame {
  readonly transform: string
  readonly animationTimingFunction?: string
}

const translate = (by: number) => `translate(${by}px, ${by}px)`

/** the tail's lean: out over 140ms from the start, back over the 220ms after */
export const leanFrames = (): Record<string, TransformFrame> => ({
  '0%': { transform: translate(0), animationTimingFunction: LEAN_OUT },
  [percent(LEAN_OUT_MS)]: { transform: translate(-LEAN_SHIFT), animationTimingFunction: LEAN_BACK },
  [percent(LEAN_OUT_MS + LEAN_BACK_MS)]: { transform: translate(0) },
  '100%': { transform: translate(0) },
})

/** what the tail does instead when motion is to be reduced */
export const breatheFrames = (): Record<string, OpacityFrame> => ({
  '0%': { opacity: 1 },
  '50%': { opacity: BREATH_LOW },
  '100%': { opacity: 1 },
})

// ---------------------------------------------------------------------------
// the same motion as a stylesheet, for the preview page

const block = (frames: Record<string, OpacityFrame | TransformFrame>) =>
  Object.entries(frames)
    .map(([at, frame]) => {
      const declarations = Object.entries(frame).map(([property, value]) => {
        const name = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
        return `${name}:${value}`
      })
      return `${at}{${declarations.join(';')}}`
    })
    .join('')

/**
 * Keyframes and classes for one polarity: `.q-<polarity> [data-seg="k"]`
 * loops, the tail leans as well, and under reduced motion the tail
 * breathes instead.
 */
export function loopCss(polarity: Polarity): string {
  const rules: string[] = []
  for (let k = 0; k < 8; k += 1) {
    rules.push(`@keyframes q-${polarity}-${k}{${block(loopFrames(polarity, k))}}`)
  }
  rules.push(`@keyframes q-lean{${block(leanFrames())}}`)
  rules.push(`@keyframes q-breathe{${block(breatheFrames())}}`)
  for (let k = 1; k < 8; k += 1) {
    rules.push(
      `.q-${polarity} [data-seg="${k}"]{animation:q-${polarity}-${k} ${PERIOD}ms linear infinite}`,
    )
  }
  rules.push(
    `.q-${polarity} [data-seg="0"]{animation:q-${polarity}-0 ${PERIOD}ms linear infinite, q-lean ${PERIOD}ms linear infinite}`,
  )
  rules.push(
    `@media (prefers-reduced-motion: reduce){.q-${polarity} [data-seg]{animation:none}.q-${polarity} [data-seg="0"]{animation:q-breathe ${BREATH_MS}ms ease-in-out infinite}}`,
  )
  return rules.join('\n')
}

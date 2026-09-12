import { describe, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { cleanup, render } from 'vitest-browser-react'
import { Loader } from '@qualy/brand/loader'
import { Wordmark } from '@qualy/brand/wordmark'

// The loading loop as the browser runs it: one animation per part, two on
// the tail, the keyframes' own easing honoured, the lean measured in user
// units, and none of it under reduced motion. Asserted on getAnimations()
// and computed style, never on pixels. The suite's context asks for
// reduced motion, so the cases about the loop ask for the opposite and put
// it back.

const segmentsOf = (svg: Element) =>
  [...svg.querySelectorAll<SVGPathElement>('path[data-seg]')].filter(
    (path) => path.dataset.seg !== '1-7',
  )

/** the drawing with this accessible name, once it is on the stage */
const located = async (name: string) => {
  const locator = page.getByRole('img', { name })
  await expect.element(locator).toBeInTheDocument()
  return locator.element()
}

const keyframesOf = (animation: Animation) => (animation.effect as KeyframeEffect).getKeyframes()

const withMotion = async (body: () => Promise<void>) => {
  await commands.emulateMedia({ reducedMotion: 'no-preference' })
  try {
    await body()
  } finally {
    await commands.emulateMedia({ reducedMotion: 'reduce' })
  }
}

describe('the loader', () => {
  it('runs one opacity loop per part and the lean on the tail, in the polarity its size says', () =>
    withMotion(async () => {
      await render(<Loader size={48} title="Loading" />)
      const svg = await located('Loading')
      expect(svg.getAttribute('data-polarity')).toBe('dark')
      const segments = segmentsOf(svg)
      expect(segments.map((path) => path.dataset.seg)).toEqual([
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
      ])
      for (const path of segments) {
        const animations = path.getAnimations()
        expect(animations).toHaveLength(path.dataset.seg === '0' ? 2 : 1)
        for (const animation of animations) {
          expect(animation.playState).toBe('running')
          expect((animation.effect as KeyframeEffect).getTiming().delay).toBe(0)
        }
      }

      // the keyframes carry their own easing: fast then slow between the
      // head's switch points, the afterglow curve on the tail once the head
      // has left it
      const fade = segments[1]!.getAnimations()[0]!
      const frames = keyframesOf(fade)
      expect(frames.map((frame) => Number(frame.offset!.toFixed(5)))).toEqual([
        0, 0.02857, 0.22857, 0.34286, 0.45714, 0.57143, 0.68571, 0.8, 0.91429, 1,
      ])
      expect(frames[0]!.easing).toBe('cubic-bezier(0.1, 0.9, 0.2, 1)')
      const tailFade = segments[0]!
        .getAnimations()
        .find((animation) => keyframesOf(animation).some((frame) => 'opacity' in frame))!
      expect(keyframesOf(tailFade)[2]!.easing).toBe('cubic-bezier(0.4, 0, 0.6, 1)')

      // the lean is a translate in user units: at 140ms the tail sits
      // 3.394 units up and left, which on a 48px canvas of 128 units is
      // 1.27px on screen
      const tail = segments[0]!
      const lean = tail
        .getAnimations()
        .find((animation) => keyframesOf(animation).some((frame) => 'transform' in frame))!
      lean.pause()
      lean.currentTime = 0
      const home = tail.getBoundingClientRect()
      lean.currentTime = 140
      const matrix = new DOMMatrix(getComputedStyle(tail).transform)
      expect(matrix.e).toBeCloseTo(-3.394, 2)
      expect(matrix.f).toBeCloseTo(-3.394, 2)
      const leaning = tail.getBoundingClientRect()
      expect(home.left - leaning.left).toBeCloseTo((3.394 * 48) / 128, 1)
      expect(home.top - leaning.top).toBeCloseTo((3.394 * 48) / 128, 1)
    }))

  it('is light at 24px and below, dark above, unless told otherwise', async () => {
    await render(
      <>
        <Loader size={16} title="small" />
        <Loader size={24} title="edge" />
        <Loader size={32} title="large" />
        <Loader size={16} polarity="dark" title="told" />
      </>,
    )
    const polarity = async (name: string) => (await located(name)).getAttribute('data-polarity')
    expect(await polarity('small')).toBe('light')
    expect(await polarity('edge')).toBe('light')
    expect(await polarity('large')).toBe('dark')
    expect(await polarity('told')).toBe('dark')
  })

  it('under reduced motion runs no loop and only lets the tail breathe', async () => {
    await render(<Loader size={16} title="Loading" />)
    const svg = await located('Loading')
    const segments = segmentsOf(svg)
    for (const path of segments.slice(1)) expect(path.getAnimations()).toEqual([])
    const [breath, ...more] = segments[0]!.getAnimations()
    expect(more).toEqual([])
    expect((breath!.effect as KeyframeEffect).getTiming().duration).toBe(2400)
    const frames = keyframesOf(breath!)
    expect(frames.map((frame) => frame.opacity)).toEqual(['1', '0.55', '1'])
    expect(frames.some((frame) => 'transform' in frame)).toBe(false)
  })
})

describe('the wordmark', () => {
  it('draws the ring as one piece until it is live, then as eight parts that loop from 400ms', () =>
    withMotion(async () => {
      await render(<Wordmark height={28} title="Qualy" />)
      const whole = await located('Qualy')
      expect(whole.querySelector('[data-seg="1-7"]')).not.toBeNull()
      expect(segmentsOf(whole).map((path) => path.dataset.seg)).toEqual(['0'])
      expect(whole.querySelector('[data-seg="0"]')!.getAnimations()).toEqual([])
      await cleanup()

      await render(<Wordmark height={28} live title="Qualy" />)
      const svg = await located('Qualy')
      expect(svg.querySelector('[data-seg="1-7"]')).toBeNull()
      const segments = segmentsOf(svg)
      expect(segments).toHaveLength(8)
      for (const path of segments) {
        const animations = path.getAnimations()
        expect(animations.length).toBeGreaterThan(0)
        for (const animation of animations) {
          expect((animation.effect as KeyframeEffect).getTiming().delay).toBe(400)
        }
      }
      // the letters stand still
      for (const letter of svg.querySelectorAll('path[data-letter]')) {
        expect(letter.getAnimations()).toEqual([])
      }

      // during the lean's first 40ms only the tail's place changes: its
      // opacity holds at 1 until the head lands, then falls to its head
      // value by the time the head moves on
      const tail = segments[0]!
      const opacityAt = (ms: number) => {
        for (const animation of svg.getAnimations({ subtree: true })) {
          animation.pause()
          animation.currentTime = 400 + ms
        }
        return Number(getComputedStyle(tail).opacity)
      }
      expect(opacityAt(0)).toBe(1)
      expect(opacityAt(20)).toBe(1)
      expect(opacityAt(39)).toBe(1)
      expect(opacityAt(320)).toBeCloseTo(0.32, 2)
    }))
})

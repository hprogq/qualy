import { fixed, wordmarkLayout } from './geometry.ts'

// The first frame, as data.
//
// index.html paints the wordmark before any script runs, and the loading
// screen that takes it over must paint the same wordmark in the same place
// to the pixel. Both used to hold the numbers - one by hand, one from the
// geometry - and a test held them together. Now both read them from here:
// the build writes this markup into index.html in place of a marker, and
// the loading screen positions itself with the same placement. Nothing at
// run time needs this module for the first frame; that is the point of it.

/** the element index.html paints, and the loading screen removes */
export const BOOT_ID = 'qualy-boot'

/** the marker index.html carries for the build to replace with the frame */
export const BOOT_PLACEHOLDER = '<!-- qualy-boot -->'

/** the data block beside the frame holding what the shell's watchdog says, per locale */
export const BOOT_COPY_ID = 'qualy-boot-copy'

export interface BootPlacement {
  /** cap height of the wordmark in CSS pixels */
  readonly cap: number
  /** the ring's centre line, as a share of the viewport height */
  readonly line: string
  /** from the wordmark's top edge down to the ring's centre line, in CSS pixels */
  readonly ringDrop: string
  /** the wordmark's rendered width and height, in CSS pixels */
  readonly width: string
  readonly height: string
  /** from the wordmark's bottom edge to a line of text under it */
  readonly hintGap: number
  /** where the wordmark's top edge sits, as a css length */
  readonly top: string
}

/** where the first frame puts the wordmark, from its cap height */
export function bootPlacement(cap = 28): BootPlacement {
  const layout = wordmarkLayout(16)
  const [, boxTop = 0, boxWidth = 0, boxHeight = 0] = layout.viewBox.split(' ').map(Number)
  const scale = cap / layout.cap
  const line = '44vh'
  const ringDrop = fixed((layout.ringCenter.y - boxTop) * scale)
  return {
    cap,
    line,
    ringDrop,
    width: fixed(boxWidth * scale),
    height: fixed(boxHeight * scale),
    hintGap: 40,
    top: `calc(${line} - ${ringDrop}px)`,
  }
}

export interface BootFrame {
  readonly placement: BootPlacement
  /** the wordmark, as the loading screen draws it: one band, the tail, the letters */
  readonly svg: string
  /** the whole element, positioned through the two custom properties the shell's style reads */
  readonly markup: string
}

/** the first frame, ready to stand in for the marker */
export function bootFrame(cap = 28): BootFrame {
  const layout = wordmarkLayout(16)
  const placement = bootPlacement(cap)
  const paths = [
    `<path data-seg="1-7" d="${layout.band}"/>`,
    `<path data-seg="0" d="${layout.segments[0]!}"/>`,
    ...layout.letters.map((letter) => `<path data-letter="${letter.char}" d="${letter.d}"/>`),
  ]
  const svg = `<svg viewBox="${layout.viewBox}" width="${placement.width}" height="${placement.height}" fill="currentColor" aria-hidden="true">${paths.join('')}</svg>`
  const vars = `--boot-top:${placement.top};--boot-hint-gap:${placement.hintGap}px`
  const markup = `<div id="${BOOT_ID}" role="status" aria-label="Loading" style="${vars}"><div>${svg}</div></div>`
  return { placement, svg, markup }
}

import type { Font, PathCommand } from 'fontkit'

import {
  fixed,
  markGeometry,
  pieceReach,
  type Point,
} from '../../packages/web/brand/src/geometry.ts'
import { stemOf } from './font.ts'

// The wordmark laid out: the ring where a capital would stand, the four
// letters after it, everything in the wordmark's own coordinates.
//
// One unit of s is the stem of the l at the solved weight, so the scale from
// font units is s over that stem. The baseline is y = 0 with y pointing
// down, which is why the glyph outlines are flipped. The ring's centre sits
// half a cap height above the baseline and its left edge on x = 0; the tail
// reaches pieceReach s to the right of the centre, the u starts a set
// clearance after that, and each following letter starts one advance on,
// less the tracking.

const LETTERS = 'ualy'

const SVG_COMMAND = {
  moveTo: 'M',
  lineTo: 'L',
  quadraticCurveTo: 'Q',
  bezierCurveTo: 'C',
  closePath: 'Z',
} as const

/** fontkit's own toSVG rounds to two decimals; this keeps three */
const serialize = (commands: readonly PathCommand[]): string =>
  commands
    .map(({ command, args }) => `${SVG_COMMAND[command]}${args.map(fixed).join(' ')}`)
    .join('')

export interface WordmarkBuild {
  readonly wght: number
  readonly s: number
  /** clearance between the tail and the u, in s */
  readonly tailGap: number
  /** taken off every advance, in em */
  readonly tracking: number
}

export interface Letter {
  readonly char: string
  readonly d: string
  /** the glyph origin's x */
  readonly origin: number
  /** the outline's extent, from its bounding box */
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export interface WordmarkLayout {
  readonly viewBox: string
  readonly s: number
  readonly capHeight: number
  readonly ringCenter: Point
  readonly letters: readonly Letter[]
  /** wordmark units per font unit */
  readonly scale: number
  readonly unitsPerEm: number
  /** the rightmost point of the tail */
  readonly tailRight: number
  /** whitespace between neighbours, tail to u first, in s */
  readonly gaps: readonly number[]
}

const round = (value: number) => Number(fixed(value))

export function layoutWordmark(font: Font, build: WordmarkBuild): WordmarkLayout {
  const instance = font.getVariation({ wght: build.wght })
  const { s } = build
  const scale = s / stemOf(instance)
  const capHeight = instance.capHeight * scale
  const ringCenter = { x: round(3 * s), y: round(-capHeight / 2) }
  const tailRight = ringCenter.x + pieceReach * s

  const run = instance.layout(LETTERS)
  if (run.glyphs.length !== LETTERS.length) {
    throw new Error(`expected one glyph per letter of ${LETTERS}, got ${run.glyphs.length}`)
  }
  const letters: Letter[] = []
  let pen = 0
  run.glyphs.forEach((glyph, at) => {
    const position = run.positions[at]!
    if (at === 0) pen = tailRight + build.tailGap * s - glyph.bbox.minX * scale
    const origin = pen + position.xOffset * scale
    const lift = -position.yOffset * scale
    letters.push({
      char: LETTERS[at]!,
      d: serialize(glyph.path.transform(scale, 0, 0, -scale, origin, lift).commands),
      origin,
      left: origin + glyph.bbox.minX * scale,
      right: origin + glyph.bbox.maxX * scale,
      top: lift - glyph.bbox.maxY * scale,
      bottom: lift - glyph.bbox.minY * scale,
    })
    pen += position.xAdvance * scale + build.tracking * instance.unitsPerEm * scale
  })

  const left = ringCenter.x - 3 * s
  const right = Math.max(...letters.map((letter) => letter.right))
  const top = Math.min(ringCenter.y - 3 * s, ...letters.map((letter) => letter.top))
  const bottom = Math.max(ringCenter.y + pieceReach * s, ...letters.map((letter) => letter.bottom))
  const gaps = letters.map((letter, at) =>
    at === 0 ? (letter.left - tailRight) / s : (letter.left - letters[at - 1]!.right) / s,
  )
  return {
    viewBox: `${fixed(left)} ${fixed(top)} ${fixed(right - left)} ${fixed(bottom - top)}`,
    s,
    capHeight: round(capHeight),
    ringCenter,
    letters,
    scale,
    unitsPerEm: instance.unitsPerEm,
    tailRight,
    gaps,
  }
}

/** the ring and tail of a laid-out wordmark, in its coordinates */
export const ringOf = (layout: { readonly s: number; readonly ringCenter: Point }) =>
  markGeometry({ s: layout.s, center: layout.ringCenter })

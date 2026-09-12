import fs from 'node:fs'
import path from 'node:path'
import { create, type Font } from 'fontkit'
import wawoff2 from 'wawoff2'

import { RING_TO_CAP, WEIGHT_RANGE } from './spec.ts'

// Jost, opened for measuring.
//
// fontkit reads WOFF2 but not its variations: a WOFF2 glyf table arrives
// transformed, fontkit decodes those glyphs ahead of time, and the decoder
// that applies the gvar deltas is never reached - every weight came back
// with the Regular's outlines (a stem of 80 at wght 500 and at 700 alike),
// while the advances, which come from HVAR, did vary. Expanding the WOFF2
// to a TTF first, with the reference decoder Google ships compiled to WASM,
// is lossless and puts the same bytes in front of the code path that does
// apply them. The advances agree between the two routes, which is the check
// that nothing else changed.

const ROOT = path.resolve(import.meta.dirname, '../..')
const PACKAGE = path.join(ROOT, 'node_modules/@fontsource-variable/jost')
const LATIN_VARIABLE = /-latin-wght-normal\.woff2$/

export interface JostFont {
  readonly font: Font
  /** repository-relative path of the file the outlines came from */
  readonly file: string
  readonly packageVersion: string
  readonly fontVersion: string
}

export async function openJost(): Promise<JostFont> {
  const files = path.join(PACKAGE, 'files')
  const name = fs.readdirSync(files).find((file) => LATIN_VARIABLE.test(file))
  if (name === undefined) throw new Error(`no latin variable woff2 under ${files}`)
  const file = path.join(files, name)
  const ttf = Buffer.from(await wawoff2.decompress(fs.readFileSync(file)))
  const font = create(ttf)
  if (!('getVariation' in font)) throw new Error(`${name} is a collection, not a font`)
  const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')) as {
    version: string
  }
  return {
    font,
    file: path.relative(ROOT, file),
    packageVersion: manifest.version,
    fontVersion: String(font.version),
  }
}

/** the width of the l: a plain vertical stem, so its box is the line width */
export const stemOf = (instance: Font): number => {
  const box = instance.glyphForCodePoint('l'.codePointAt(0)!).bbox
  return box.maxX - box.minX
}

export interface WeightSolution {
  readonly wght: number
  /** in font units */
  readonly stem: number
  readonly capHeight: number
  readonly unitsPerEm: number
  /** six stems over the cap height */
  readonly ratio: number
  /** how far that ratio misses the target, as a fraction of it */
  readonly error: number
}

/**
 * The weight at which six stems come closest to 1.03 cap heights.
 *
 * Scanned one wght at a time over the range, so the answer is a value the
 * axis actually has rather than an interpolation between two.
 */
export function solveWeight(font: Font, range = WEIGHT_RANGE): WeightSolution {
  let best: WeightSolution | undefined
  for (let wght = range.min; wght <= range.max; wght += 1) {
    const instance = font.getVariation({ wght })
    const stem = stemOf(instance)
    const ratio = (6 * stem) / instance.capHeight
    const candidate = {
      wght,
      stem,
      capHeight: instance.capHeight,
      unitsPerEm: instance.unitsPerEm,
      ratio,
      error: ratio / RING_TO_CAP - 1,
    }
    if (best === undefined || Math.abs(candidate.error) < Math.abs(best.error)) best = candidate
  }
  if (best === undefined) throw new Error('an empty weight range has no solution')
  return best
}

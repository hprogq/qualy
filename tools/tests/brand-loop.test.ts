import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  breatheFrames,
  leanFrames,
  loopFrames,
  switchPoints,
  type Polarity,
} from '../brand/loop.ts'

// The loading loop's keyframes are written out by hand, because the style
// compiler reads them from the call itself and will not follow a reference;
// the rule they follow lives in tools/brand/loop.ts. This holds the one to
// the other, the way the favicon is held to the geometry: by reading the
// source as text rather than by generating it.

const ROOT = path.resolve(import.meta.dirname, '../..')
const source = fs.readFileSync(path.join(ROOT, 'packages/web/brand/src/keyframes.ts'), 'utf8')

/** every `const name = stylex.keyframes({...})` in the file, evaluated as the object it spells */
const spelled = (): Map<string, Record<string, Record<string, unknown>>> => {
  const found = new Map<string, Record<string, Record<string, unknown>>>()
  for (const match of source.matchAll(/const (\w+) = stylex\.keyframes\((\{[\s\S]*?\n\})\)/g)) {
    // the literal is plain data - string keys, number and string values -
    // so reading it back is a matter of letting the engine parse it
    found.set(
      match[1]!,
      new Function(`return ${match[2]!}`)() as Record<string, Record<string, unknown>>,
    )
  }
  return found
}

const nameOf = (polarity: Polarity, k: number) => (k === 0 ? `${polarity}Tail` : `${polarity}${k}`)

describe('the loading loop as written', () => {
  const literals = spelled()

  it('spells eighteen keyframe sets', () => {
    expect([...literals.keys()]).toEqual([
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => nameOf('dark', k)),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => nameOf('light', k)),
      'lean',
      'breathe',
    ])
  })

  it('switches the head where the timing says', () => {
    expect(switchPoints()).toEqual([
      '2.857%',
      '22.857%',
      '34.286%',
      '45.714%',
      '57.143%',
      '68.571%',
      '80%',
      '91.429%',
    ])
  })

  for (const polarity of ['dark', 'light'] as const) {
    for (let k = 0; k < 8; k += 1) {
      it(`gives ${nameOf(polarity, k)} the values the rule derives`, () => {
        expect(literals.get(nameOf(polarity, k))).toEqual(loopFrames(polarity, k))
      })
    }
  }

  it('leans the tail out over 140ms and back over 220ms', () => {
    expect(literals.get('lean')).toEqual(leanFrames())
    expect(Object.keys(leanFrames())).toEqual(['0%', '10%', '25.714%', '100%'])
  })

  it('breathes the tail under reduced motion', () => {
    expect(literals.get('breathe')).toEqual(breatheFrames())
  })

  it('closes every loop: the value at 100% is the value at 0%', () => {
    for (const [name, frames] of literals) {
      const first = frames['0%']!
      const last = frames['100%']!
      expect({ name, opacity: last.opacity, transform: last.transform }).toEqual({
        name,
        opacity: first.opacity,
        transform: first.transform,
      })
    }
  })
})

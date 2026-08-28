import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'

// A conditional override has to restate what it overrides.
//
// Compiled styles compose by PROPERTY, not by property-and-condition. So when
// a later style says
//
//   backgroundColor: { default: null, ':hover': darker }
//
// over an earlier one that said `backgroundColor: green`, the green does not
// survive as the resting value: the property is left with no declaration at
// all, and the element falls back to whatever else paints it.
//
// It reads exactly like the opposite. `default: null` looks like "add a hover
// and leave the rest alone", which is what it means when nothing else in the
// composition sets that property - which is most of the time, which is why
// this shape spreads. The three verdict keys in the review dialogs went black
// the moment they became pressable, because the style that added their hover
// was only worn once the form was complete: disabled they were right, and
// filling the form turned them all the colour of the default button.
//
// Nothing else would have caught it. Every assertion about those buttons is
// about what they say and what they do.

const ROOT = path.resolve(import.meta.dirname, '../..')
const ROOTS = ['packages', 'apps']

/** property -> how the value was written, for one style key */
type Shape = Map<string, 'plain' | 'null-default' | 'conditional'>

/** the matching brace for the one at `open` */
const closing = (text: string, open: number): number => {
  let depth = 0
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1
    else if (text[at] === '}') {
      depth -= 1
      if (depth === 0) return at
    }
  }
  return text.length
}

/** every style key a file declares, with how each property was written */
const declared = (text: string): Map<string, Shape> => {
  const styles = new Map<string, Shape>()
  for (const call of text.matchAll(/stylex\.create\(\s*\{/g)) {
    const open = text.indexOf('{', call.index)
    const body = text.slice(open + 1, closing(text, open))
    for (const key of body.matchAll(/(\w+)\s*:\s*\{/g)) {
      const keyOpen = body.indexOf('{', key.index)
      const block = body.slice(keyOpen + 1, closing(body, keyOpen))
      const shape: Shape = new Map()
      for (const property of block.matchAll(/(\w+)\s*:\s*/g)) {
        const rest = block.slice(property.index + property[0].length)
        if (!rest.startsWith('{')) {
          if (!shape.has(property[1]!)) shape.set(property[1]!, 'plain')
          continue
        }
        const inner = block.slice(
          property.index + property[0].length,
          closing(block, property.index + property[0].length) + 1,
        )
        shape.set(property[1]!, /default\s*:\s*null/.test(inner) ? 'null-default' : 'conditional')
      }
      styles.set(key[1]!, shape)
    }
  }
  return styles
}

/**
 * The style names one call actually puts on one element, at once.
 *
 * The arms of a ternary are alternatives, never companions, so they are
 * expanded into separate compositions rather than flattened together -
 * otherwise every `active ? filled : hollow` pair reads as a conflict.
 */
const names = (part: string) => [...part.matchAll(/\b\w+\.(\w+)/g)].map((match) => match[1]!)

/** the ':' that answers a given '?', skipping the ones nested inside it */
const answering = (text: string, question: number): number => {
  let nested = 0
  for (let at = question + 1; at < text.length; at += 1) {
    if (text[at] === '?') nested += 1
    else if (text[at] === ':') {
      if (nested === 0) return at
      nested -= 1
    }
  }
  return -1
}

/**
 * The style names one call actually puts on one element, at once.
 *
 * The arms of a ternary are alternatives, never companions, so each is
 * expanded into its own composition - and nested ones too, because a row that
 * is `judged ? one : chosen ? two : three` would otherwise read as all three
 * at once and report a conflict that cannot happen.
 */
const compositions = (args: string): string[][] => {
  const question = args.indexOf('?')
  if (question < 0) return [names(args)]
  const colon = answering(args, question)
  if (colon < 0) return [names(args)]
  const before = args.slice(0, question)
  const whenTrue = args.slice(question + 1, colon)
  // whatever follows the alternative belongs to both of them
  const rest = args.slice(colon + 1)
  const tail = rest.indexOf(',')
  const whenFalse = tail < 0 ? rest : rest.slice(0, tail)
  const after = tail < 0 ? '' : rest.slice(tail)
  return [whenTrue, whenFalse].flatMap((arm) => compositions(`${before}${arm}${after}`))
}

describe('what a conditional style leaves standing', () => {
  it('never erases a value an earlier style in the same composition set', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of walkSources(path.join(ROOT, root))) {
        if (!file.endsWith('.tsx')) continue
        const text = fs.readFileSync(file, 'utf8')
        const styles = declared(text)
        if (styles.size === 0) continue
        for (const call of text.matchAll(/stylex\.props\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
          for (const composed of compositions(call[1]!)) {
            const plain = new Set<string>()
            for (const name of composed) {
              const shape = styles.get(name)
              if (shape === undefined) continue
              for (const [property, how] of shape) {
                if (how === 'null-default' && plain.has(property)) {
                  const line = text.slice(0, call.index).split('\n').length
                  offenders.push(
                    `${path.relative(ROOT, file)}:${line} ${name}.${property} leaves nothing where an earlier style put a value`,
                  )
                }
                if (how === 'plain') plain.add(property)
              }
            }
          }
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([])
  })
})

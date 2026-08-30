import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// Every field the wire accepts has to reach the service.
//
// A payload field the endpoint declares and the handler forgets is the
// quietest bug this boundary can produce: the request succeeds, the caller
// is told it worked, and what they sent is gone. It happened with an
// administrative record's determination - the office said "provincial", the
// handler passed everything except that, and the plan's defaults were stored
// under their name.
//
// Read as text rather than through the api value, because the failure is a
// missing line of code and text is what a missing line is absent from. The
// pairing is by endpoint name, which is the same name on both sides.

const source = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

const api = source('../src/api.ts')
const handlers = source('../src/server/index.ts')

/** the payload property names one endpoint declares, in api.ts */
const declaredPayloads = (): ReadonlyMap<string, readonly string[]> => {
  const found = new Map<string, string[]>()
  const endpoint = /HttpApiEndpoint\.\w+\(\s*'([A-Za-z0-9]+)'/g
  for (let match = endpoint.exec(api); match !== null; match = endpoint.exec(api)) {
    const name = match[1]!
    const rest = api.slice(match.index)
    const at = rest.indexOf('payload: Schema.Struct({')
    // an endpoint without a payload declares nothing to forward; the search
    // is bounded to this endpoint's own block so the next one's payload is
    // never read as this one's
    const ends = rest.indexOf('}).middleware(')
    if (at === -1 || (ends !== -1 && at > ends)) continue
    const body = rest.slice(at + 'payload: Schema.Struct({'.length)
    let depth = 1
    let end = 0
    for (; end < body.length && depth > 0; end += 1) {
      if (body[end] === '{') depth += 1
      else if (body[end] === '}') depth -= 1
    }
    const struct = body.slice(0, end - 1)
    const keys: string[] = []
    // top-level keys only: a nested struct's fields travel inside their own
    let nesting = 0
    for (const line of struct.split('\n')) {
      const key = /^\s{8}([A-Za-z][A-Za-z0-9]*):/.exec(line)
      if (nesting === 0 && key !== null) keys.push(key[1]!)
      nesting += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length
      if (nesting < 0) nesting = 0
    }
    found.set(name, keys)
  }
  return found
}

/** the body of one handler, in server/index.ts */
const handlerBodies = (): ReadonlyMap<string, string> => {
  const found = new Map<string, string>()
  const opening = /\.handle\(\s*'([A-Za-z0-9]+)',/g
  const starts: { name: string; at: number }[] = []
  for (let match = opening.exec(handlers); match !== null; match = opening.exec(handlers)) {
    starts.push({ name: match[1]!, at: match.index })
  }
  for (const [index, one] of starts.entries()) {
    const next = starts[index + 1]
    found.set(one.name, handlers.slice(one.at, next === undefined ? undefined : next.at))
  }
  return found
}

/**
 * Whether a handler hands the whole payload over rather than picking fields.
 *
 * That form cannot drop anything, so there is nothing to check: the risk is
 * entirely in the picking, where a field is forwarded by being named and
 * forgotten by not being named.
 */
const passesEverything = (body: string): boolean => /\n\s+payload,\n/.test(body)

describe('the entry and review http boundary', () => {
  it('forwards every payload field its endpoint declares', () => {
    const declared = declaredPayloads()
    const bodies = handlerBodies()
    const dropped: string[] = []
    for (const [name, keys] of declared) {
      const body = bodies.get(name)
      if (body === undefined || passesEverything(body)) continue
      for (const key of keys) {
        if (!body.includes(`payload.${key}`)) dropped.push(`${name}.${key}`)
      }
    }
    expect(dropped).toEqual([])
  })

  it('reads both sides, so an empty comparison cannot pass for agreement', () => {
    const declared = declaredPayloads()
    expect(declared.size).toBeGreaterThan(10)
    expect(declared.get('createEntry')).toContain('recognition')
    expect(handlerBodies().size).toBeGreaterThan(10)
  })
})

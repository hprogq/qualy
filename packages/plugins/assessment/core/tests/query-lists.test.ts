import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { idList } from '../src/api.ts'

// A list-valued query parameter is a list only when it repeats.
//
// `?a=1&a=2` reaches a handler as an array and `?a=1` as a plain string -
// that is what UrlParams.toRecord builds (repos/effect/packages/effect/src/
// unstable/http/UrlParams.ts). A schema asking for an array therefore refused
// every request that named exactly one thing, which is most of them, and the
// refusal arrived at the screen as a bare 400 with nothing to act on.
//
// Not written as an http test: the request would be refused by authentication
// before anything decoded its query, so a passing response would say nothing
// about the schema. This asks the schema.

const decode = Schema.decodeUnknownSync(idList)
const one = '019fd31f-0a15-7092-b49e-4966627e9f95'
const two = '019fd31f-0a17-7b5e-a0c5-ab0eb515043a'

describe('a repeated query parameter', () => {
  it('decodes when it appears once', () => {
    expect(decode(one)).toEqual(one)
  })

  it('decodes when it appears more than once', () => {
    expect(decode([one, two])).toEqual([one, two])
  })

  it('still refuses something that is not an id', () => {
    expect(() => decode('not-an-id')).toThrow()
    expect(() => decode([one, 'not-an-id'])).toThrow()
  })
})

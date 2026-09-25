import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  boundedText,
  expectedVersion,
  INT4_MAX,
  likeContains,
  positiveIntParam,
  trimmedName,
} from '../src/schema.ts'

// Every text field in the product is built from one of these two, so what
// they admit is what reaches a text column. PostgreSQL stores no NUL byte
// and refuses the row rather than dropping it, which arrives as a database
// fault - a 500 for a request a schema can see is malformed.

const NUL = String.fromCharCode(0)

const admits = (schema: Schema.Codec<string, string>, value: string): boolean =>
  Schema.decodeUnknownResult(schema)(value)._tag === 'Success'

describe('what a text primitive admits', () => {
  it('takes the text the product really carries', () => {
    for (const value of ['张三', 'a'.repeat(50), 'line one\nline two 😀', '校发〔2026〕7 号']) {
      expect(admits(boundedText(500), value), value).toBe(true)
    }
    // a name is trimmed rather than refused for its padding
    expect(admits(trimmedName(255), '  padded  ')).toBe(true)
  })

  it('refuses a NUL byte, which the column would refuse after it', () => {
    expect(admits(trimmedName(255), `a${NUL}b`)).toBe(false)
    expect(admits(boundedText(500), `a${NUL}b`)).toBe(false)
    // including one that would survive trimming into a name
    expect(admits(trimmedName(255), `  ${NUL}  `)).toBe(false)
  })

  it('refuses half of a surrogate pair, which a jsonb column refuses and a text one mangles', () => {
    expect(admits(boundedText(500), 'a\ud800b')).toBe(false)
    expect(admits(trimmedName(255), '\udc00')).toBe(false)
    // a whole pair is one character, and welcome
    expect(admits(boundedText(500), '\ud83d\ude00')).toBe(true)
  })

  it('still holds its ceiling', () => {
    expect(admits(boundedText(4), 'abcd')).toBe(true)
    expect(admits(boundedText(4), 'abcde')).toBe(false)
    expect(admits(trimmedName(4), '')).toBe(false)
  })
})

describe('a substring somebody typed', () => {
  it('means the characters it contains, wildcards included', () => {
    expect(likeContains('ada')).toBe('%ada%')
    // unescaped, this one matched every row in the table
    expect(likeContains('%')).toBe('%\\%%')
    // and this one matched any single character
    expect(likeContains('_')).toBe('%\\_%')
    expect(likeContains('100%')).toBe('%100\\%%')
    // the escape character itself, or it would escape the escapes
    expect(likeContains('a\\b')).toBe('%a\\\\b%')
  })
})

describe('a number compared with an int4 column', () => {
  // Past the column's range the comparison is not an empty answer but a
  // database error (22003): `/versions/3000000000` answered 500.
  const decodes = (schema: Schema.Codec<unknown, unknown>, value: unknown): boolean =>
    Schema.decodeUnknownResult(schema)(value)._tag === 'Success'

  it('takes a version written in the address while the column can hold it', () => {
    for (const value of ['1', '42', String(INT4_MAX)]) {
      expect(decodes(positiveIntParam, value), value).toBe(true)
    }
    for (const value of [String(INT4_MAX + 1), '3000000000', '0', '-1', '01', '1.5', '1e3', '']) {
      expect(decodes(positiveIntParam, value), value).toBe(false)
    }
  })

  it('takes an expected version while the column can hold it', () => {
    expect(decodes(expectedVersion, 1)).toBe(true)
    expect(decodes(expectedVersion, INT4_MAX)).toBe(true)
    expect(decodes(expectedVersion, INT4_MAX + 1)).toBe(false)
    expect(decodes(expectedVersion, 3_000_000_000)).toBe(false)
  })
})

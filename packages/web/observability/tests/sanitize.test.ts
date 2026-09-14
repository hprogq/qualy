import { describe, expect, it } from 'vitest'
import { sanitizePath, sanitizeUrl } from '../src/sanitize.ts'

// What a reporting platform may be told an address was.
//
// This runs only when the manifest has not matched a page pattern - before it
// has loaded, or on an address no page owns - so it is the fallback rather
// than the normal answer. It is also the last thing between a viewer's row and
// a third party, which is why it guesses toward masking: a segment that could
// be an identifier is treated as one.

describe('a path on its way to a reporting platform', () => {
  it('keeps the names of screens', () => {
    expect(sanitizePath('/assessment/batches')).toBe('/assessment/batches')
    expect(sanitizePath('/iam/user-types')).toBe('/iam/user-types')
    expect(sanitizePath('/')).toBe('/')
  })

  it('masks a uuid, which is a row', () => {
    expect(sanitizePath('/assessment/batches/0199f03e-1111-7abc-8def-000000000001/review')).toBe(
      '/assessment/batches/:id/review',
    )
  })

  it('masks a run of digits long enough to be somebody', () => {
    expect(sanitizePath('/students/202312345678')).toBe('/students/:id')
    // short numbers are not identities: a page number, a step, a year
    expect(sanitizePath('/wizard/2')).toBe('/wizard/2')
  })

  it('masks anything that had to be escaped, which is how a name gets into a path', () => {
    expect(sanitizePath(`/people/${encodeURIComponent('张三')}`)).toBe('/people/:id')
    expect(sanitizePath(`/search/${encodeURIComponent('a b')}`)).toBe('/search/:id')
  })

  it('masks a long opaque segment, which is a token', () => {
    expect(sanitizePath('/invite/ZmFrZS10b2tlbi12YWx1ZQ')).toBe('/invite/:id')
  })

  it('masks a segment whose escaping is broken rather than passing it on', () => {
    expect(sanitizePath('/thing/%E0%A4%A')).toBe('/thing/:id')
  })

  it('drops the query and the fragment entirely', () => {
    expect(sanitizeUrl('https://qualy.example/assessment/batches?student=QUALY_SENTINEL')).toBe(
      '/assessment/batches',
    )
    expect(sanitizeUrl('https://qualy.example/batches#token=abc')).toBe('/batches')
  })

  it('drops the origin, which distinguishes nothing and could carry a subdomain', () => {
    expect(sanitizeUrl('https://tenant-a.qualy.example/assessment/batches')).toBe(
      '/assessment/batches',
    )
    expect(sanitizeUrl('https://qualy.example')).toBe('/')
  })
})

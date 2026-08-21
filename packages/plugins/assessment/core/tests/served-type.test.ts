import { describe, expect, it } from 'vitest'
import { BYTES, servedTypeOf } from '../src/attachment/served-type.ts'

// The type the attachment door is willing to say (§19). The uploader names
// the type, and a cited file belongs to whoever is being reviewed, so the
// only types repeated back are ones a browser draws without running them.
// Everything else is bytes, which with `nosniff` is the browser's
// instruction to render nothing at all.

describe('what the attachment door says a file is', () => {
  it('repeats a type a browser draws without running it', () => {
    for (const inert of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']) {
      expect(servedTypeOf(inert)).toBe(inert)
    }
  })

  it('refuses active content, however it is spelled', () => {
    for (const active of [
      'text/html',
      'TEXT/HTML',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/xml',
      'application/javascript',
      'text/html; charset=utf-8',
    ]) {
      expect(servedTypeOf(active)).toBe(BYTES)
    }
  })

  it('refuses anything that would break out of the header line', () => {
    expect(servedTypeOf('image/png\r\nset-cookie: a=b')).toBe(BYTES)
    expect(servedTypeOf('image/png\nx: y')).toBe(BYTES)
    expect(servedTypeOf('')).toBe(BYTES)
  })

  it('reads a type the way http writes it: case and surrounding space carry nothing', () => {
    expect(servedTypeOf('  Image/PNG  ')).toBe('image/png')
  })
})

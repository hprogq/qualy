import { describe, expect, it } from 'vitest'
import { opensWithClientDirective } from '../src/client-directive.ts'

describe('client references in the RSC StyleX transform', () => {
  it('recognizes either quote after leading comments and whitespace', () => {
    expect(opensWithClientDirective(`/* header */\n// author note\r\n"use client";`)).toBe(true)
    expect(opensWithClientDirective(`\uFEFF\n'use client'\nimport 'react'`)).toBe(true)
  })

  it('does not consume code or rejoin block comments when looking for a directive', () => {
    expect(opensWithClientDirective(`/* first */ import 'react'; /* second */ 'use client'`)).toBe(
      false,
    )
    expect(opensWithClientDirective(`/* unterminated 'use client'`)).toBe(false)
  })

  it('can discard a generated non-client module with many leading comments', () => {
    const generated = '/* generated */\n   '.repeat(2_000) + 'export const data = {}'
    expect(opensWithClientDirective(generated)).toBe(false)
  })
})

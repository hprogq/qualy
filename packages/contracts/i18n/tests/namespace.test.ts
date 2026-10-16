import { describe, expect, it } from 'vitest'
import { namespaceOf } from '../src/namespace.ts'

describe('message namespaces', () => {
  it.each([
    ['@Qualy/plugin-auth', 'qualy-plugin-auth'],
    [' Example__Package...42 ', 'example-package-42'],
    ['--leading-and-trailing--', 'leading-and-trailing'],
    ['a@@@b///c', 'a-b-c'],
    ['İstanbul/中文/PLUGIN', 'i-stanbul-plugin'],
    ['', ''],
    ['@---/中文_😀', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(namespaceOf(input)).toBe(expected)
  })

  it('handles long separator runs without changing the namespace', () => {
    const separators = '-'.repeat(200_000)
    expect(namespaceOf(`${separators}Owner${separators}Plugin${separators}`)).toBe('owner-plugin')
    expect(namespaceOf(separators)).toBe('')
  })
})

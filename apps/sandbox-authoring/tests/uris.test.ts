import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeUriBoundary, rewriteStrings } from '../src/lsp/uris.ts'
import { isJsonRecord } from '../src/lsp/manager.ts'

// The boundary in isolation: what may come in as URI metadata, what may
// leave in any position, and what sinks a message whole.

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lsp-uris-')))
fs.mkdirSync(path.join(root, 'node_modules', '@qualy', 'formula', 'src'), { recursive: true })
const boundary = makeUriBoundary(root)

describe('inbound uri fields', () => {
  it('accepts exactly the two virtual schemes', () => {
    expect(boundary.inboundUri('qualy-formula:///formula.ts')).toBe(
      pathToFileURL(path.join(root, 'formula.ts')).href,
    )
    // pathToFileURL leaves @ alone; the %40 spelling is the SERVER's habit,
    // matched on decode in the outbound direction
    expect(boundary.inboundUri('qualy-formula-sdk:///formula/src/index.ts')).toContain(
      'node_modules/@qualy/formula/src/index.ts',
    )
  })

  it('refuses foreign schemes, bare paths and traversal', () => {
    expect(boundary.inboundUri('file:///etc/passwd')).toBeNull()
    expect(boundary.inboundUri('file:///proc/self/environ')).toBeNull()
    expect(boundary.inboundUri('/etc')).toBeNull()
    expect(boundary.inboundUri('/app')).toBeNull()
    expect(boundary.inboundUri('qualy-formula-sdk:///../../../etc/passwd')).toBeNull()
    expect(boundary.inboundUri('https://example.com')).toBeNull()
  })
})

describe('outbound sweep', () => {
  it('lets non-filesystem content through untouched', () => {
    expect(boundary.outbound('https://example.com')).toBe('https://example.com')
    expect(boundary.outbound('see the docs at https://qualy.dev/x')).toBe(
      'see the docs at https://qualy.dev/x',
    )
    expect(boundary.outbound('(alias) const defineFormula: <T>(x: T) => T')).toBe(
      '(alias) const defineFormula: <T>(x: T) => T',
    )
  })

  it('rewrites workspace references and sinks foreign filesystem paths', () => {
    expect(boundary.outbound(pathToFileURL(path.join(root, 'formula.ts')).href)).toBe(
      'qualy-formula:///formula.ts',
    )
    expect(boundary.outbound(path.join(root, 'formula.ts'))).toBe('qualy-formula:/formula.ts')
    expect(boundary.outbound('file:///etc/passwd')).toBeNull()
    expect(boundary.outbound('/etc/passwd')).toBeNull()
    expect(boundary.outbound('/app/packages/core/formula/src/index.ts')).toBeNull()
  })

  it('sinks a whole message when any string carries a foreign path', () => {
    const poisoned = {
      result: { items: [{ label: 'ok', data: { fileName: '/app/secrets.ts' } }] },
    }
    expect(rewriteStrings(poisoned, boundary.outbound)).toBeNull()
    const clean = {
      result: { items: [{ label: 'ok', documentation: 'https://example.com' }] },
    }
    expect(rewriteStrings(clean, boundary.outbound)).toEqual(clean)
  })
})

describe('the structural door', () => {
  it('admits real frames and turns primitives away', () => {
    expect(
      isJsonRecord(JSON.parse('{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}')),
    ).toBe(true)
    expect(isJsonRecord(JSON.parse('{"jsonrpc":"2.0","method":"initialized"}'))).toBe(true)
    for (const body of ['null', '[]', '"x"', '1', 'true']) {
      expect(isJsonRecord(JSON.parse(body)), body).toBe(false)
    }
  })
})

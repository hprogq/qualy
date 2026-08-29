import { describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { proxyTable, proxied } from '../src/dev/proxy.ts'

// The proxy table is behavior the browser can only discover by failing:
// a missing `ws` on the api prefix means the formula language websocket
// never reaches the backend and nothing says why. So the shape is frozen.

describe('dev proxy table', () => {
  const table = proxyTable('http://127.0.0.1:3000')

  it('covers exactly the backend-owned prefixes', () => {
    expect(Object.keys(table).sort()).toEqual([...proxied].sort())
    expect(proxied).toContain(QUALY_API_PREFIX)
    expect(proxied).toContain('/health')
  })

  it('upgrades websockets on the api prefix and nowhere else', () => {
    expect(table[QUALY_API_PREFIX]?.ws).toBe(true)
    expect(table['/health']?.ws).toBe(false)
  })

  it('keeps the browser host and unbounded timeouts', () => {
    for (const entry of Object.values(table)) {
      expect(entry.changeOrigin).toBe(false)
      expect(entry.timeout).toBe(0)
      expect(entry.proxyTimeout).toBe(0)
      expect(entry.target).toBe('http://127.0.0.1:3000')
    }
  })
})

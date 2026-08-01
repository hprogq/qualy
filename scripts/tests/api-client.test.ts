import { describe, expect, it } from 'vitest'
import { createApiClient } from '../../packages/api-client/src/index.ts'

// the @ts-expect-error line keeps the type chain honest: if contract
// inference ever degrades to any, the unused suppression fails typecheck

describe('api client type inference', () => {
  it('exposes contract procedures as typed callables', () => {
    const client = createApiClient('/api')
    expect(typeof client.ping.hello).toBe('function')
    void (() => {
      // @ts-expect-error name must be a string
      return client.ping.hello({ name: 1 })
    })
  })
})

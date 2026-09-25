import { describe, expect, it } from 'vitest'
import { createHttpServer, HEADERS_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from '../src/http-server.ts'

// How long a request may take to arrive.
//
// Node's own answer is five minutes for the whole request, body included,
// whether or not bytes are still flowing. An attachment is one PUT carrying
// the whole file, so a large one on a slow line was cut with a 408 at the
// fifth minute and failed again on every retry. Nothing about this shows up
// except on a slow line, which no suite has, so the numbers themselves are
// what is held here.

const NODE_DEFAULT_REQUEST_TIMEOUT_MS = 300_000

describe('the server this host listens with', () => {
  it('lets a slow upload keep arriving well past the five minutes node allows', () => {
    const server = createHttpServer()
    try {
      expect(server.requestTimeout).toBe(REQUEST_TIMEOUT_MS)
      expect(server.requestTimeout).toBeGreaterThanOrEqual(30 * 60 * 1000)
      expect(server.requestTimeout).toBeGreaterThan(NODE_DEFAULT_REQUEST_TIMEOUT_MS)
    } finally {
      server.close()
    }
  })

  it('still bounds a request that never finishes, and headers that never arrive', () => {
    const server = createHttpServer()
    try {
      // zero would mean no bound at all, for a deployment with no proxy in front
      expect(server.requestTimeout).toBeGreaterThan(0)
      expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS)
      expect(server.headersTimeout).toBeLessThanOrEqual(60 * 1000)
    } finally {
      server.close()
    }
  })
})

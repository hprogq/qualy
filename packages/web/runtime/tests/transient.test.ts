import { describe, expect, it } from 'vitest'
import { isBackendUnavailable } from '@qualy/web-i18n'
import { retryDelay, retryManifest, retryQuery } from '../src/api-query.ts'

// Telling "wait a moment" apart from "this failed".
//
// A development backend is replaced while the page stays open, and for a
// second or two there is either nothing on the port or a process that has
// bound it and not finished building. Both answer 503, and a page that
// renders a refusal for either is a page somebody has to dismiss by hand
// every time they save a file.
//
// The distinction cannot come from the status: a real 503 from a real server
// means something else entirely. It comes from a header both the proxy and
// the starting backend set, and everything below is about not extending that
// patience to anything else.

const answering = (status: number, state?: string) => ({
  _tag: 'HttpClientError',
  response: {
    status,
    headers: state === undefined ? {} : { 'x-qualy-state': state },
  },
})

describe('a server that is between processes', () => {
  it('is recognised whichever half of the replacement answered', () => {
    // nothing on the port: the development proxy answers for it
    expect(isBackendUnavailable(answering(503, 'unavailable'))).toBe(true)
    // bound, still building: the backend answers for itself
    expect(isBackendUnavailable(answering(503, 'starting'))).toBe(true)
  })

  it('is not read into anything else', () => {
    // a real 503 from a real server is a refusal, not a pause
    expect(isBackendUnavailable(answering(503))).toBe(false)
    expect(isBackendUnavailable(answering(503, 'something-else'))).toBe(false)
    expect(isBackendUnavailable(answering(500, 'starting'))).toBe(false)
    expect(isBackendUnavailable(new Error('offline'))).toBe(false)
    expect(isBackendUnavailable(null)).toBe(false)
  })
})

describe('how long a page waits it out', () => {
  const transient = answering(503, 'starting')
  const refused = answering(403)

  it('waits out a replacement on a read, and gives up eventually', () => {
    expect(retryQuery(0, transient)).toBe(true)
    expect(retryQuery(7, transient)).toBe(true)
    // bounded: an unbounded window is a spinner that never resolves, which
    // is worse than a message the reader can act on
    expect(retryQuery(8, transient)).toBe(false)
  })

  it('waits longer for the manifest, because nothing renders without it', () => {
    expect(retryManifest(8, transient)).toBe(true)
    expect(retryManifest(19, transient)).toBe(true)
    expect(retryManifest(20, transient)).toBe(false)
  })

  it('does not wait out a refusal', () => {
    expect(retryQuery(0, refused)).toBe(false)
    expect(retryManifest(0, refused)).toBe(false)
  })

  it('climbs and then holds, because a replacement takes seconds', () => {
    expect(retryDelay(0)).toBe(250)
    expect(retryDelay(1)).toBe(500)
    expect(retryDelay(10)).toBe(2_000)
  })
})

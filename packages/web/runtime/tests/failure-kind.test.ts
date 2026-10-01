import { describe, expect, it } from 'vitest'
import { isRecordId, loadFailureKind, subjectFailureKind } from '../src/failure-kind.ts'

// A reading that failed, told apart by what the reader can do about it.
// The errors are built in the shapes the typed client actually surfaces:
// a declared failure is its tagged class, an unreachable server is Effect's
// HttpClientError with a TransportError reason, a server between processes
// answers 503 with the state in a header.

const declared = (code: string) => Object.assign(new Error(code), { _tag: code })
const unreachable = { _tag: 'HttpClientError', reason: { _tag: 'TransportError' } }
const restarting = {
  _tag: 'HttpClientError',
  reason: { _tag: 'StatusCodeError' },
  response: { status: 503, headers: { 'x-qualy-state': 'starting' } },
}

describe('why a reading failed', () => {
  it('tells the network, the server and the thing itself apart', () => {
    expect(loadFailureKind(unreachable)).toBe('offline')
    expect(loadFailureKind(new TypeError('Failed to fetch'))).toBe('failed')
    expect(loadFailureKind(declared('SERVICE_UNAVAILABLE'))).toBe('unavailable')
    expect(loadFailureKind(restarting)).toBe('unavailable')
    expect(loadFailureKind(declared('ACCESS_DENIED'))).toBe('denied')
    expect(loadFailureKind(declared('INTERNAL_SERVER_ERROR'))).toBe('failed')
    expect(loadFailureKind(new Error('boom'))).toBe('failed')
  })

  it('calls a thing missing only by the codes its owner names', () => {
    const gone = declared('ASSESSMENT_BATCH_NOT_FOUND')
    expect(loadFailureKind(gone, ['ASSESSMENT_BATCH_NOT_FOUND'])).toBe('missing')
    // a code shaped like a missing thing, not named by this owner: a part
    // of the page that is not there is not the page's subject being gone
    expect(
      loadFailureKind(declared('ASSESSMENT_PHASE_NOT_FOUND'), ['ASSESSMENT_BATCH_NOT_FOUND']),
    ).toBe('failed')
    expect(loadFailureKind(gone)).toBe('failed')
  })

  it('does not take an effect internal for a declared code', () => {
    // what the client reports for an id it refuses to encode
    expect(loadFailureKind({ _tag: 'SchemaError' }, ['SchemaError'])).toBe('failed')
  })
})

describe('an address that can name a record', () => {
  it('is the shape the client would send', () => {
    expect(isRecordId('019a2b3c-4d5e-7f60-8a7b-9c8d7e6f5a4b')).toBe(true)
    expect(isRecordId('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isRecordId('abc')).toBe(false)
    expect(isRecordId('')).toBe(false)
    expect(isRecordId('019a2b3c-4d5e-7f60-8a7b-9c8d7e6f5a4b/entries')).toBe(false)
  })
})

describe('a screen whose subject is absent', () => {
  const missing = ['USER_NOT_FOUND']
  it('is absent once the subject is known to be gone, whatever was shown before', () => {
    const gone = declared('USER_NOT_FOUND')
    expect(subjectFailureKind({ data: undefined, error: gone, isError: true }, missing)).toBe(
      'missing',
    )
    // deleted by somebody else while this reader was looking at it
    expect(subjectFailureKind({ data: { id: 'u' }, error: gone, isError: true }, missing)).toBe(
      'missing',
    )
    expect(
      subjectFailureKind(
        { data: { id: 'u' }, error: declared('ACCESS_DENIED'), isError: true },
        missing,
      ),
    ).toBe('denied')
  })

  it('keeps what it has through a dropped connection, and says so only before it had anything', () => {
    expect(subjectFailureKind({ data: { id: 'u' }, error: unreachable, isError: true })).toBeNull()
    expect(subjectFailureKind({ data: undefined, error: unreachable, isError: true })).toBe(
      'offline',
    )
    expect(subjectFailureKind({ data: undefined, error: null, isError: false })).toBeNull()
  })
})

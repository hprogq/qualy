import { describe, expect, it } from 'vitest'
import { cosFailure } from '../src/cli/cos-failure.ts'

describe('what the object store said went wrong', () => {
  it('reads an Error the sdk copied into a plain object', () => {
    const said = { code: 'ECONNRESET', name: 'ECONNRESET', message: 'socket hang up' }
    const failure = cosFailure(said)
    expect(failure.message).toBe('ECONNRESET socket hang up')
    expect(failure.cause).toBe(said)
  })

  it('reads a failed request with its status', () => {
    expect(
      cosFailure({ statusCode: 400, code: 'RequestTimeOut', message: 'User network is too slow' })
        .message,
    ).toBe('400 RequestTimeOut User network is too slow')
  })

  it('never says only "[object Object]"', () => {
    expect(cosFailure({ unexpected: true }).message).toBe('{"unexpected":true}')
    expect(cosFailure('timeout').message).toBe('timeout')
  })

  it('passes an Error through', () => {
    const error = new Error('refused')
    expect(cosFailure(error)).toBe(error)
  })
})

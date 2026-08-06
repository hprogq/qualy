import { describe, expect, it } from 'vitest'
import { closeAll, withCleanup } from '../src/cleanup.ts'

// What a failed cleanup is allowed to do to the failure that caused it.
//
// Every one of these was once wrong somewhere in this package: a `finally` that
// threw replaced the real error with "could not drop a database", and the fix
// that suppressed the cleanup failure instead left scratch databases on a real
// server with nothing said about them.

const fails = (what: string) => async () => {
  throw new Error(what)
}

describe('running something that has to be cleaned up', () => {
  it('cleans up and answers when both succeed', async () => {
    const done: string[] = []
    const value = await withCleanup(
      async () => {
        done.push('body')
        return 42
      },
      async () => {
        done.push('cleanup')
      },
      { cleanupFailed: 'cleanup failed', bothFailed: 'both failed' },
    )
    expect(value).toBe(42)
    expect(done).toEqual(['body', 'cleanup'])
  })

  it('reports a cleanup failure the body did not cause', async () => {
    const error = await withCleanup(async () => 42, fails('drop refused'), {
      cleanupFailed: 'cleanup failed',
      bothFailed: 'both failed',
    }).then(
      () => undefined,
      (thrown: unknown) => thrown as AggregateError,
    )
    if (!error) throw new Error('the cleanup failure was swallowed')
    expect(error.message).toBe('cleanup failed')
    expect((error.errors[0] as Error).message).toBe('drop refused')
  })

  it('hands back the body failure untouched when the cleanup worked', async () => {
    // no wrapper: the caller catches what they would have caught anyway
    await expect(
      withCleanup(fails('migration refused'), async () => {}, {
        cleanupFailed: 'cleanup failed',
        bothFailed: 'both failed',
      }),
    ).rejects.toThrow('migration refused')
  })

  it('carries both, cause first, when the cleanup failed too', async () => {
    // the case that used to lose the cause entirely, and then - once the
    // cleanup failure was suppressed instead - lost the abandoned database
    const error = await withCleanup(fails('migration refused'), fails('drop refused'), {
      cleanupFailed: 'cleanup failed',
      bothFailed: 'both failed',
    }).then(
      () => undefined,
      (thrown: unknown) => thrown as AggregateError,
    )
    if (!error) throw new Error('the failures were swallowed')
    expect(error.message).toBe('both failed')
    expect(error.errors.map((one: Error) => one.message)).toEqual([
      'migration refused',
      'drop refused',
    ])
  })

  it('closes every one of them even when the first refuses', async () => {
    const closed: string[] = []
    const error = await closeAll<string>(
      ['a', 'b', 'c'],
      async (name) => {
        closed.push(name)
        if (name !== 'b') throw new Error(`${name} refused`)
      },
      'could not close',
    ).then(
      () => undefined,
      (thrown: unknown) => thrown as AggregateError,
    )
    if (!error) throw new Error('the close failures were swallowed')
    expect(closed).toEqual(['a', 'b', 'c'])
    expect(error.errors.map((one: Error) => one.message)).toEqual(['a refused', 'c refused'])
  })
})

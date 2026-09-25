import { Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { readWorkbook, WORKBOOKS_IN_LINE_MOST } from '../src/gate.ts'

// One workbook at a time, whoever asks. The reader's promise cannot be
// cancelled, so the permit is only handed on once it has actually settled -
// a client that hangs up mid-read does not let the next workbook start
// beside the one still being built.

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const tick = () => new Promise((done) => setTimeout(done, 10))

describe('reading workbooks under one permit', () => {
  it('reads one at a time, and every request is read', async () => {
    let active = 0
    let most = 0
    const read = async () => {
      active += 1
      most = Math.max(most, active)
      await tick()
      active -= 1
      return 'read'
    }
    const results = await Effect.runPromise(
      Effect.all(
        Array.from({ length: 4 }, () =>
          readWorkbook({
            bytes: Effect.succeed(new Uint8Array()),
            read,
            refused: String,
            busy: () => 'busy',
          }),
        ),
        { concurrency: 'unbounded' },
      ),
    )
    expect(results).toEqual(['read', 'read', 'read', 'read'])
    expect(most).toBe(1)
  })

  it('holds the permit until an abandoned read has finished', async () => {
    const first = deferred()
    const started: string[] = []
    const program = Effect.gen(function* () {
      const abandoned = yield* Effect.forkChild(
        readWorkbook({
          bytes: Effect.succeed(new Uint8Array()),
          read: async () => {
            started.push('abandoned')
            await first.promise
          },
          refused: String,
          busy: () => 'busy',
        }),
      )
      yield* Effect.promise(tick)
      // the client hangs up: interruption waits for the read it cannot stop
      const hangUp = yield* Effect.forkChild(Fiber.interrupt(abandoned))
      const next = yield* Effect.forkChild(
        readWorkbook({
          bytes: Effect.succeed(new Uint8Array()),
          read: async () => {
            started.push('next')
          },
          refused: String,
          busy: () => 'busy',
        }),
      )
      yield* Effect.promise(tick)
      const beforeSettling = [...started]
      first.resolve()
      yield* Fiber.join(hangUp)
      yield* Fiber.join(next)
      return beforeSettling
    })
    expect(await Effect.runPromise(program)).toEqual(['abandoned'])
    expect(started).toEqual(['abandoned', 'next'])
  })

  // A request in line holds its file's bytes and somebody's screen: past a
  // few in line, or a wait nobody would sit through, it is turned away to be
  // asked again rather than joining a line that only grows.
  it('turns a request away once the line is full, and reads the rest', async () => {
    const held = deferred()
    const program = Effect.gen(function* () {
      const inLine = yield* Effect.forEach(Array.from({ length: WORKBOOKS_IN_LINE_MOST }), () =>
        Effect.forkChild(
          readWorkbook({
            bytes: Effect.succeed(new Uint8Array()),
            read: async () => {
              await held.promise
              return 'read'
            },
            refused: String,
            busy: () => 'busy',
          }),
        ),
      )
      yield* Effect.promise(tick)
      const turnedAway = yield* Effect.exit(
        readWorkbook({
          bytes: Effect.succeed(new Uint8Array()),
          read: async () => 'read',
          refused: String,
          busy: () => 'busy',
        }),
      )
      held.resolve()
      const read = yield* Effect.forEach(inLine, (fiber) => Fiber.join(fiber))
      return { turnedAway, read }
    })
    const { turnedAway, read } = await Effect.runPromise(program)
    expect(Exit.isFailure(turnedAway) && String(turnedAway)).toContain('busy')
    expect(read).toEqual(Array.from({ length: WORKBOOKS_IN_LINE_MOST }, () => 'read'))
  })

  it('turns a waiting request away once it has waited as long as anybody would', async () => {
    const held = deferred()
    const program = Effect.gen(function* () {
      const reading = yield* Effect.forkChild(
        readWorkbook({
          bytes: Effect.succeed(new Uint8Array()),
          read: async () => {
            await held.promise
            return 'read'
          },
          refused: String,
          busy: () => 'busy',
        }),
      )
      yield* Effect.promise(tick)
      const waiting = yield* Effect.forkChild(
        Effect.exit(
          readWorkbook({
            bytes: Effect.succeed(new Uint8Array()),
            read: async () => 'read',
            refused: String,
            busy: () => 'busy',
          }),
        ),
      )
      yield* TestClock.adjust('21 seconds')
      const waited = yield* Fiber.join(waiting)
      held.resolve()
      yield* Fiber.join(reading)
      return waited
    }).pipe(Effect.provide(TestClock.layer()))
    const waited = await Effect.runPromise(program)
    expect(Exit.isFailure(waited) && String(waited)).toContain('busy')
  })

  it('says why a workbook was not read in the caller own words', async () => {
    const exit = await Effect.runPromiseExit(
      readWorkbook({
        bytes: Effect.succeed(new Uint8Array()),
        read: () => Promise.reject(new Error('not-xlsx')),
        refused: (error) => `refused: ${(error as Error).message}`,
        busy: () => 'busy',
      }),
    )
    expect(exit._tag).toBe('Failure')
    expect(String(exit)).toContain('refused: not-xlsx')
  })
})

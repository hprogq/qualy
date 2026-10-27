import { Readable } from 'node:stream'
import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import type { AttachmentRead } from '@qualy/plugin-storage/server'
import { readSourceBytes } from '../src/administrative-import/read-source.ts'

const source = (body: AsyncIterable<Uint8Array>, size: bigint) =>
  ({ meta: { size }, body }) as AttachmentRead

const read = (body: Readable, size: bigint) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          body.destroy()
        }),
      )
      return yield* readSourceBytes(source(body, size))
    }),
  )

describe('reading the stored import source', () => {
  it('keeps original bytes without fetching a public delivery URL', async () => {
    const bytes = await Effect.runPromise(read(Readable.from([Buffer.from('original')]), 8n))
    expect(Buffer.from(bytes).toString()).toBe('original')
  })

  it('stops and releases a body as soon as it outruns its recorded size', async () => {
    let yielded = 0
    let released = false
    const body = (async function* () {
      try {
        for (;;) {
          yielded += 1
          yield Buffer.alloc(128)
        }
      } finally {
        released = true
      }
    })()
    const exit = await Effect.runPromiseExit(readSourceBytes(source(body, 256n)))
    expect(Exit.isFailure(exit) && exit.cause.toString()).toContain('source-too-large')
    expect(yielded).toBe(3)
    expect(released).toBe(true)
  })

  it('refuses truncated content instead of parsing a partial workbook', async () => {
    const exit = await Effect.runPromiseExit(read(Readable.from([Buffer.from('short')]), 100n))
    expect(Exit.isFailure(exit) && exit.cause.toString()).toContain('source-unavailable')
  })

  it('propagates a mid-stream failure and releases the body', async () => {
    const body = Readable.from(
      (async function* () {
        yield Buffer.from('start')
        throw new Error('read failed')
      })(),
    )
    const exit = await Effect.runPromiseExit(read(body, 100n))
    expect(Exit.isFailure(exit) && exit.cause.toString()).toContain('source-unavailable')
    expect(body.destroyed).toBe(true)
  })

  it('closes a pending read when the caller times out', async () => {
    const body = new Readable({ read() {} })
    const exit = await Effect.runPromiseExit(read(body, 100n).pipe(Effect.timeout(20)))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(body.destroyed).toBe(true)
  })
})

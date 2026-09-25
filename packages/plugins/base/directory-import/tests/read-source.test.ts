import http from 'node:http'
import type { AddressInfo } from 'node:net'
import zlib from 'node:zlib'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AttachmentOpen } from '@qualy/plugin-storage/server'
import { readSourceBytes, SourceUnreadable } from '../src/server/read-source.ts'

// A store that signs rather than streams hands out a url, and whatever comes
// back from it is read with the same ceiling a stream is: counted as it
// arrives, not buffered whole and measured after. An encoding the response
// names would be inflated before anything could count it, so a response
// that names one is not read at all.

const MiB = 1024 * 1024
const chunk = Buffer.alloc(64 * 1024, 0x61)
const inflated = Buffer.alloc(4 * MiB)
const deflated = zlib.gzipSync(inflated)
const workbook = Buffer.from('PK these are the bytes of the file')

let served = 0
let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/encoded') {
      response.writeHead(200, { 'content-encoding': 'gzip' })
      response.end(deflated)
      return
    }
    if (request.url === '/endless') {
      served = 0
      response.writeHead(200)
      // far past any ceiling, written as fast as the reader takes it
      const more = () => {
        while (served < 64 * MiB) {
          served += chunk.byteLength
          if (!response.write(chunk)) return void response.once('drain', more)
        }
        response.end()
      }
      response.on('close', () => response.removeAllListeners('drain'))
      more()
      return
    }
    response.writeHead(200)
    response.end(workbook)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
})

const signed = (path: string, size: number): AttachmentOpen =>
  ({
    meta: { size: BigInt(size) },
    target: { kind: 'redirect', url: `${base}${path}`, expiresInSeconds: 60 },
  }) as unknown as AttachmentOpen

const reasonOf = (exit: Exit.Exit<Uint8Array, SourceUnreadable>) =>
  Exit.isFailure(exit) ? (exit.cause.toString().match(/source-[a-z-]+/)?.[0] ?? null) : null

describe('reading a spreadsheet back from a signed url', () => {
  it('reads the stored bytes as they are', async () => {
    const bytes = await Effect.runPromise(readSourceBytes(signed('/', workbook.byteLength)))
    expect(Buffer.from(bytes).equals(workbook)).toBe(true)
  })

  it('refuses a response that names an encoding, rather than inflating it', async () => {
    const exit = await Effect.runPromiseExit(
      readSourceBytes(signed('/encoded', deflated.byteLength)),
    )
    expect(reasonOf(exit)).toBe('source-unavailable')
  })

  it('stops reading once the body outruns the ceiling', async () => {
    const exit = await Effect.runPromiseExit(readSourceBytes(signed('/endless', MiB)))
    expect(reasonOf(exit)).toBe('source-too-large')
    // the connection was dropped, not drained: what was sent is the ceiling
    // plus what the sockets had already buffered, nowhere near the whole body
    await new Promise((done) => setTimeout(done, 50))
    expect(served).toBeLessThan(32 * MiB)
  })
})

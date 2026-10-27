import http from 'node:http'
import type { AddressInfo } from 'node:net'
import COS from 'cos-nodejs-sdk-v5'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readObject } from '../src/server/read.ts'

let server: http.Server
let cos: COS
let connections = 0
let closedSlowReads = 0
const seen: { path: string; encoding: string | undefined }[] = []

beforeAll(async () => {
  server = http.createServer((request, response) => {
    seen.push({ path: request.url!, encoding: request.headers['accept-encoding'] })
    if (request.url?.startsWith('/encoded')) {
      response.writeHead(200, { 'Content-Encoding': 'gzip' })
      response.end(Buffer.from([31, 139, 0]))
    } else if (request.url?.startsWith('/missing')) {
      response.writeHead(404)
      response.end('<Error><Code>NoSuchKey</Code></Error>')
    } else if (request.url?.startsWith('/slow')) {
      response.writeHead(200)
      response.write('start')
      const timer = setInterval(() => response.write('more'), 20)
      response.on('close', () => {
        clearInterval(timer)
        closedSlowReads += 1
      })
    } else {
      response.writeHead(200, { 'Content-Length': '8' })
      response.end('original')
    }
  })
  server.on('connection', (socket) => {
    connections += 1
    socket.on('close', () => {
      connections -= 1
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cos = new COS({
    SecretId: 'test-id',
    SecretKey: 'test-key',
    Protocol: 'http:',
    Domain: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    Timeout: 2000,
  })
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const read = (key: string) =>
  readObject(cos, {
    Bucket: 'test-1250000000',
    Region: 'ap-beijing',
    Key: key,
    VersionId: 'null',
  })
const collect = (key: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const body = yield* read(key)
      return yield* Effect.tryPromise(() =>
        (async () => {
          const chunks: Uint8Array[] = []
          for await (const chunk of body) chunks.push(chunk)
          return chunks
        })(),
      )
    }),
  )

describe('direct SDK streaming', () => {
  it('reads original bytes from the versioned object with identity encoding', async () => {
    const parts = await Effect.runPromise(collect('original'))
    expect(Buffer.concat(parts).toString()).toBe('original')
    expect(seen.at(-1)).toEqual({ path: '/original?versionId=null', encoding: 'identity' })
  })

  it.each(['encoded', 'missing'])('rejects %s before handing bytes to a consumer', async (key) => {
    let count = 0
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const body = yield* read(key)
          yield* Effect.tryPromise(async () => {
            for await (const part of body) count += part.byteLength
          })
        }),
      ),
    )
    expect(exit._tag).toBe('Failure')
    expect(count).toBe(0)
  })

  it('cancels the actual HTTP request when iteration stops early', async () => {
    const before = closedSlowReads
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const body = yield* read('slow')
          yield* Effect.promise(async () => {
            for await (const _ of body) break
          })
        }),
      ),
    )
    await expect.poll(() => closedSlowReads).toBe(before + 1)
  })

  it('releases an acquired body without ever consuming it', async () => {
    await Effect.runPromise(read('slow-unread').pipe(Effect.asVoid, Effect.scoped))
    await expect.poll(() => connections).toBe(0)
  })

  it('also cancels when credentials arrive after the read scope has closed', async () => {
    let authorize!: (authorization: COS.GetAuthorizationCallbackParams) => void
    const delayed = new COS({
      Protocol: 'http:',
      Domain: `127.0.0.1:${(server.address() as AddressInfo).port}`,
      getAuthorization: (_options, callback) => {
        authorize = callback
      },
    })
    const get = delayed.getObjectStream.bind(delayed)
    const aborted = new Promise<void>((resolve) => {
      vi.spyOn(delayed, 'getObjectStream').mockImplementation((params, callback) => {
        const output = get(params, callback)
        output.once('pipe', (request: NodeJS.ReadableStream) => request.once('abort', resolve))
        return output
      })
    })
    await Effect.runPromise(
      readObject(delayed, {
        Bucket: 'test-1250000000',
        Region: 'ap-beijing',
        Key: 'slow-late-credentials',
      }).pipe(Effect.asVoid, Effect.scoped),
    )
    authorize(
      COS.getAuthorization({
        SecretId: 'test-id',
        SecretKey: 'test-key',
        Method: 'GET',
        Key: 'slow-late-credentials',
      }),
    )
    // Wait for the SDK's actual abort, not a zero count before a connection
    // has had a chance to open.
    await aborted
    await expect.poll(() => connections).toBe(0)
    expect(seen.some(({ path }) => path.startsWith('/slow-late-credentials'))).toBe(false)
  })

  it('releases a stalled read when its scope is interrupted', async () => {
    const before = closedSlowReads
    const exit = await Effect.runPromiseExit(collect('slow-timeout').pipe(Effect.timeout(100)))
    expect(exit._tag).toBe('Failure')
    await expect.poll(() => closedSlowReads).toBe(before + 1)
  })
})

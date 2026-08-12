import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { backendContract } from '@qualy/plugin-storage/testkit/contract'
import { localBackend, localReceiver } from '../src/server/backend.ts'

// The disk provider against the shared contract, plus the things only a
// filesystem can get wrong.
//
// The contract is the part that matters for interchangeability; the rest here
// is about half files and stray temporaries, which is where a naive
// implementation loses data quietly rather than loudly.

let root: string
const backend = () => localBackend(root)
const receiver = () => localReceiver(root)

const stream = async function* (bytes: Uint8Array, chunk = 8) {
  for (let index = 0; index < bytes.byteLength; index += chunk) {
    yield bytes.subarray(index, index + chunk)
  }
}

const write = async (key: string, bytes: Uint8Array) => {
  await Effect.runPromise(
    receiver().receive({
      reservationId: randomUUID(),
      key,
      maxBytes: BigInt(bytes.byteLength),
      body: stream(bytes),
    }),
  )
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'qualy-storage-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the local backend keeps the storage contract', () => {
  for (const check of backendContract(() => ({ backend: backend(), write }))) {
    it(check.name, check.run)
  }
})

describe('the local backend on a real filesystem', () => {
  it('leaves nothing behind when an upload runs over its reservation', async () => {
    const key = `attachments/${randomUUID()}/${randomUUID()}`
    const reservationId = randomUUID()
    const exit = await Effect.runPromiseExit(
      receiver().receive({
        reservationId,
        key,
        maxBytes: 4n,
        body: stream(Buffer.from('far more than four bytes')),
      }),
    )

    expect(exit._tag).toBe('Failure')
    // neither the object nor the temporary file it was accumulating in
    expect(await Effect.runPromise(backend().stat(key))).toBeNull()
    expect(await readdir(path.join(root, '.tmp'))).not.toContain(reservationId)
  })

  it('refuses a second upload on the same ticket while the first is running', async () => {
    const reservationId = randomUUID()
    const first = `attachments/${randomUUID()}/${randomUUID()}`
    const second = `attachments/${randomUUID()}/${randomUUID()}`
    // a temporary file already exists under this ticket, which is what a
    // concurrent second upload would find
    await writeFile(path.join(root, '.tmp', reservationId), 'partial')

    const exit = await Effect.runPromiseExit(
      receiver().receive({
        reservationId,
        key: second,
        maxBytes: 64n,
        body: stream(Buffer.from('second writer')),
      }),
    )

    expect(exit._tag).toBe('Failure')
    expect(await Effect.runPromise(backend().stat(second))).toBeNull()
    expect(await Effect.runPromise(backend().stat(first))).toBeNull()
  })

  it('computes the digest from the file on disk, not from what it was handed', async () => {
    const key = `attachments/${randomUUID()}/${randomUUID()}`
    const bytes = Buffer.from('a'.repeat(1000))
    await write(key, bytes)
    const stat = await Effect.runPromise(backend().stat(key))
    expect(stat?.size).toBe(1000n)

    // the file is replaced behind the backend's back; stat must follow the
    // bytes rather than remember what it was told
    await writeFile(path.join(root, key), 'b')
    const again = await Effect.runPromise(backend().stat(key))
    expect(again?.size).toBe(1n)
    expect(again?.integrityValue).not.toBe(stat?.integrityValue)
  })

  it('hands out a url a browser can PUT to and the ceiling it is held to', async () => {
    const grant = await Effect.runPromise(
      backend().prepareUpload({
        tenantId: randomUUID(),
        ownerUserId: randomUUID(),
        attachmentId: randomUUID(),
        reservationId: 'ticket-1',
        key: 'attachments/t/a',
        maxBytes: 2048n,
        grantExpiresAt: new Date(0),
      }),
    )

    expect(grant.driver).toBe('local')
    expect(grant.payload).toMatchObject({
      url: '/api/storage/local/uploads/ticket-1',
      maxBytes: '2048',
    })
  })
})

import { mkdir, mkdtemp, rm, readdir, utimes, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { backendContract } from '@qualy/plugin-storage/testkit/contract'
import {
  localBackend,
  localReceiver,
  STALE_STAGING_MS,
  sweepStaging,
} from '../src/server/backend.ts'

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
    // the first upload has started and is waiting on its next chunk
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = async function* () {
      yield Buffer.from('first ')
      await held
      yield Buffer.from('writer')
    }
    const running = Effect.runPromiseExit(
      receiver().receive({ reservationId, key: first, maxBytes: 64n, body: slow() }),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

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

    // and the first, left alone, finishes whole
    release()
    expect((await running)._tag).toBe('Success')
    expect((await Effect.runPromise(backend().stat(first)))?.size).toBe(12n)
  })

  it('takes a ticket back from the half file a crashed upload left', async () => {
    // a process killed mid-upload leaves its temporary file, and the retry
    // on the same ticket used to find it and be refused until the ticket ran out
    const reservationId = randomUUID()
    const key = `attachments/${randomUUID()}/${randomUUID()}`
    await mkdir(path.join(root, '.tmp'), { recursive: true })
    await writeFile(path.join(root, '.tmp', reservationId), 'half of a file from a dead process')

    await Effect.runPromise(
      receiver().receive({
        reservationId,
        key,
        maxBytes: 64n,
        body: stream(Buffer.from('the whole file')),
      }),
    )
    const stat = await Effect.runPromise(backend().stat(key))
    expect(stat?.size).toBe(14n)
    expect(await readdir(path.join(root, '.tmp'))).not.toContain(reservationId)
  })

  it('sweeps the staging files nothing can still be writing, and only those', async () => {
    const staging = path.join(root, '.tmp')
    await mkdir(staging, { recursive: true })
    const abandoned = randomUUID()
    const recent = randomUUID()
    await writeFile(path.join(staging, abandoned), 'left by a crash')
    await writeFile(path.join(staging, recent), 'perhaps still arriving elsewhere')
    const longAgo = new Date(Date.now() - STALE_STAGING_MS - 60_000)
    await utimes(path.join(staging, abandoned), longAgo, longAgo)

    // and one this process is writing right now, however old it looks
    const writing = randomUUID()
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = async function* () {
      yield Buffer.from('arriving')
      await held
    }
    const running = Effect.runPromiseExit(
      receiver().receive({
        reservationId: writing,
        key: `attachments/${randomUUID()}/${randomUUID()}`,
        maxBytes: 64n,
        body: slow(),
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    await utimes(path.join(staging, writing), longAgo, longAgo)

    expect(await sweepStaging(root, Date.now())).toBe(1)
    const left = await readdir(staging)
    expect(left).not.toContain(abandoned)
    expect(left).toContain(recent)
    expect(left).toContain(writing)

    release()
    expect((await running)._tag).toBe('Success')
    await rm(path.join(staging, recent), { force: true })
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

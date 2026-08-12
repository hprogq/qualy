import { createHash, randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import type { StorageBackend } from '../server/backend.ts'

// The questions every storage provider has to answer the same way.
//
// Written once and run against each real store, because "it works" is not the
// property core storage depends on. It depends on a missing object statting
// null rather than throwing, on a repeated delete being success, and above all
// on a second write to an occupied key being refused - the whole immutability
// story rests on that one, and it is exactly the behaviour that differs
// between a filesystem and a bucket unless somebody checks.
//
// Plain functions rather than a vitest suite: this module is shipped in the
// package, and a package that imports a test runner drags one into every
// deployment that installs it.

export interface BackendUnderTest {
  readonly backend: StorageBackend
  /**
   * Puts bytes at a key the way this provider's transport does.
   *
   * Not part of the backend contract - a browser does this, not the server -
   * but the contract cannot be checked without it.
   */
  readonly write: (key: string, bytes: Uint8Array) => Promise<void>
}

export interface ContractCheck {
  readonly name: string
  readonly run: () => Promise<void>
}

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const rejects = async (work: Promise<unknown>, message: string) => {
  try {
    await work
  } catch {
    return
  }
  throw new Error(message)
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

const bytesOf = async (body: AsyncIterable<Uint8Array>) => {
  const chunks: Uint8Array[] = []
  for await (const chunk of body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** the shared suite, as checks a provider's own test file names and runs */
export const backendContract = (subject: () => BackendUnderTest): readonly ContractCheck[] => {
  const key = () => `attachments/${randomUUID()}/${randomUUID()}`
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

  return [
    {
      name: 'says nothing is there when nothing was written',
      run: async () => {
        const { backend } = subject()
        const stat = await run(backend.stat(key()))
        assert(stat === null, 'stat of an unwritten key should be null')
      },
    },
    {
      name: 'reports the size and a fingerprint of what was actually written',
      run: async () => {
        const { backend, write } = subject()
        const target = key()
        const bytes = Buffer.from('the bytes that were actually written')
        await write(target, bytes)
        const stat = await run(backend.stat(target))
        assert(stat !== null, 'stat of a written key should not be null')
        assert(
          stat!.size === BigInt(bytes.byteLength),
          `size should be ${bytes.byteLength}, got ${stat!.size}`,
        )
        assert(stat!.integrityValue.length > 0, 'integrity value should not be empty')
        assert(
          stat!.integrityAlgorithm === 'sha256' || stat!.integrityAlgorithm === 'crc64-ecma',
          `unexpected integrity algorithm ${stat!.integrityAlgorithm}`,
        )
        if (stat!.integrityAlgorithm === 'sha256') {
          assert(stat!.integrityValue === sha256(bytes), 'sha256 should be of the stored bytes')
        }
      },
    },
    {
      name: 'refuses a second write to a key that already holds an object',
      run: async () => {
        const { write } = subject()
        const target = key()
        await write(target, Buffer.from('first'))
        await rejects(
          write(target, Buffer.from('second')),
          'writing over an existing object should be refused',
        )
      },
    },
    {
      name: 'gives back what was written',
      run: async () => {
        const { backend, write } = subject()
        const target = key()
        const bytes = Buffer.from('readable again')
        await write(target, bytes)
        const opened = await run(backend.open(target, { filename: 'a.txt', mime: 'text/plain' }))
        if (opened.kind === 'stream') {
          const read = await bytesOf(opened.body)
          assert(read.equals(bytes), 'the stream should carry the stored bytes')
          assert(opened.size === BigInt(bytes.byteLength), 'the stream should know its size')
        } else {
          assert(opened.url.length > 0, 'a redirect should carry a url')
          assert(opened.expiresInSeconds > 0, 'a redirect should expire')
        }
      },
    },
    {
      name: 'deletes, and deleting again is still success',
      run: async () => {
        const { backend, write } = subject()
        const target = key()
        await write(target, Buffer.from('temporary'))
        await run(backend.delete(target))
        const stat = await run(backend.stat(target))
        assert(stat === null, 'a deleted object should stat null')
        // a sweeper retries; the second pass must not fail on its own success
        await run(backend.delete(target))
      },
    },
    {
      name: 'deletes a key that never existed without complaining',
      run: async () => {
        const { backend } = subject()
        await run(backend.delete(key()))
      },
    },
    {
      name: 'hands out a grant naming a driver a browser could look up',
      run: async () => {
        const { backend } = subject()
        const grant = await run(
          backend.prepareUpload({
            tenantId: randomUUID(),
            ownerUserId: randomUUID(),
            attachmentId: randomUUID(),
            reservationId: randomUUID(),
            key: key(),
            maxBytes: 1024n,
            grantExpiresAt: new Date(Date.now() + 60_000),
          }),
        )
        assert(grant.driver.length > 0, 'a grant should name its driver')
        assert(grant.payload !== undefined, 'a grant should carry a payload')
      },
    },
  ]
}

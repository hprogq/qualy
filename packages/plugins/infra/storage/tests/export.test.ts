import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { run as exportFiles } from '../src/cli/export.ts'
import { Storage } from '../src/server/service.ts'
import { memoryBackend, ok, run } from './support/harness.ts'

describe.runIf(postgresAvailable)('direct attachment backup', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  let directory: string
  beforeEach(async () => {
    db = await createTestContext('storage-export')
    directory = await mkdtemp(path.join(os.tmpdir(), 'qualy-storage-export-'))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await db?.dispose()
    await rm(directory, { recursive: true, force: true })
  })

  const upload = (backend: ReturnType<typeof memoryBackend>) =>
    run(
      db.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const tenantId = randomUUID()
        const ownerUserId = randomUUID()
        const ticket = yield* storage.prepareUpload({
          tenantId,
          ownerUserId,
          filename: 'source.txt',
          declaredMime: 'text/plain',
          size: 8n,
        })
        const key = `attachments/${tenantId}/${ticket.attachmentId}`
        backend.put(key, Buffer.from('original'))
        yield* storage.completeUpload({
          tenantId,
          ownerUserId,
          reservationId: ticket.reservationId,
        })
        return key
      }),
    )

  it('exports the recorded version without ever opening a public delivery URL', async () => {
    const backend = memoryBackend('memory', { versioned: true })
    const key = ok(await upload(backend))
    backend.put(key, Buffer.from('replaced'))
    const open = vi.spyOn(backend, 'open').mockImplementation(() => {
      throw new Error('unexpected public delivery')
    })
    ok(await run(db.url, backend, exportFiles({ args: ['--to', directory] })))
    expect(await readFile(path.join(directory, backend.code, key), 'utf8')).toBe('original')
    const manifest = await readFile(path.join(directory, 'attachments.tsv'), 'utf8')
    expect(manifest.split('\n').filter(Boolean)).toHaveLength(2)
    expect(open).not.toHaveBeenCalled()
  })

  it.each(['oversize', 'truncated', 'wrong-hash'] as const)(
    'fails an %s backup and releases the read scope',
    async (fault) => {
      const backend = memoryBackend()
      await upload(backend).then(ok)
      let released = false
      vi.spyOn(backend, 'read').mockImplementation(() =>
        Effect.acquireRelease(
          Effect.sync(() =>
            (async function* () {
              yield Buffer.from(
                fault === 'oversize'
                  ? 'too many bytes'
                  : fault === 'truncated'
                    ? 'short'
                    : 'tampered',
              )
            })(),
          ),
          () =>
            Effect.sync(() => {
              released = true
            }),
        ),
      )
      const result = await run(db.url, backend, exportFiles({ args: ['--to', directory] }))
      expect(result._tag).toBe('Failure')
      expect(released).toBe(true)
      expect(
        (await readFile(path.join(directory, 'attachments.tsv'), 'utf8'))
          .split('\n')
          .filter(Boolean),
      ).toHaveLength(1)
    },
  )
})

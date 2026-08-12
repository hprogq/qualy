import { createHash } from 'node:crypto'
import { Effect, Layer } from 'effect'
import type { StorageBackend } from '../server/backend.ts'
import { StorageBackends } from '../server/registry.ts'

// What a suite needs to exercise storage without a disk or a cloud, and what
// every real provider has to agree with.
//
// The shared contract lives next door in ./contract, so that every provider
// answers the same questions about its own store.

export interface MemoryObject {
  readonly bytes: Uint8Array
}

export interface MemoryBackend extends StorageBackend {
  /** writes an object the way a browser would, for tests that skip transport */
  readonly put: (key: string, bytes: Uint8Array) => void
  readonly has: (key: string) => boolean
  readonly keys: () => readonly string[]
  /** makes the next call of an operation fail, to test what callers do then */
  readonly failNext: (operation: 'stat' | 'delete') => void
}

/**
 * A backend that keeps objects in a map.
 *
 * Used by core storage's own suite, where the question is never "did the bytes
 * land" but "what did the service do about it".
 */
export const memoryBackend = (code = 'memory'): MemoryBackend => {
  const objects = new Map<string, Uint8Array>()
  const failures = new Set<string>()
  const fail = (operation: string) => {
    if (!failures.has(operation)) return false
    failures.delete(operation)
    return true
  }
  return {
    code,
    put: (key, bytes) => {
      objects.set(key, bytes)
    },
    has: (key) => objects.has(key),
    keys: () => [...objects.keys()],
    failNext: (operation) => {
      failures.add(operation)
    },
    prepareUpload: (request) =>
      Effect.succeed({
        driver: code,
        payload: {
          key: request.key,
          maxBytes: request.maxBytes.toString(),
          expiresAt: request.grantExpiresAt.toISOString(),
        },
      }),
    stat: (key) =>
      Effect.suspend(() => {
        if (fail('stat')) return Effect.die(new Error('memory backend was told to fail stat'))
        const bytes = objects.get(key)
        if (bytes === undefined) return Effect.succeed(null)
        return Effect.succeed({
          size: BigInt(bytes.byteLength),
          integrityAlgorithm: 'sha256' as const,
          integrityValue: createHash('sha256').update(bytes).digest('hex'),
        })
      }),
    open: (key) =>
      Effect.suspend(() => {
        const bytes = objects.get(key) ?? new Uint8Array()
        return Effect.succeed({
          kind: 'stream' as const,
          body: (async function* () {
            yield bytes
          })(),
          size: BigInt(bytes.byteLength),
        })
      }),
    delete: (key) =>
      Effect.suspend(() => {
        if (fail('delete')) return Effect.die(new Error('memory backend was told to fail delete'))
        objects.delete(key)
        return Effect.void
      }),
  }
}

/** registers a backend the way a provider plugin's layer would */
export const backendLayer = (backend: StorageBackend): Layer.Layer<never, never, StorageBackends> =>
  Layer.effectDiscard(Effect.flatMap(StorageBackends, (registry) => registry.register(backend)))

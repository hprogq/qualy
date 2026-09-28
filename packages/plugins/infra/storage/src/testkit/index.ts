import { createHash } from 'node:crypto'
import { Effect, Layer } from 'effect'
import { backendFailure } from '../errors.ts'
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

/** one write to a key in a memory backend that keeps revisions, or a delete marker */
export interface MemoryRevision {
  readonly revision: string
  readonly bytes: Uint8Array | null
  readonly modifiedAt: number
}

export interface MemoryBackend extends StorageBackend {
  /**
   * Writes an object the way a browser would, for tests that skip transport.
   * A backend that keeps revisions adds one, dated `modifiedAt` when given.
   */
  readonly put: (key: string, bytes: Uint8Array, options?: { modifiedAt?: number }) => void
  readonly has: (key: string) => boolean
  readonly keys: () => readonly string[]
  /** every revision and marker kept under a key, oldest first, when revisions are kept */
  readonly revisionsOf: (key: string) => readonly MemoryRevision[]
  /** hides the key behind a marker, as deleting without naming a revision does in such a store */
  readonly mark: (key: string, options?: { modifiedAt?: number }) => void
  /** makes the next call of an operation fail, to test what callers do then */
  readonly failNext: (operation: 'stat' | 'delete' | 'remove') => void
  /**
   * The type the service asked this object be served as, last time it was
   * opened.
   *
   * A backend that signs its own url puts this straight on the response,
   * where `nosniff` holds a browser to it - so what the service hands down
   * is the whole of the answer, and a test has to be able to read it.
   */
  readonly servedAs: () => string | undefined
  /** the revision the last `open` was asked for, when there was one */
  readonly openedRevision: () => string | null | undefined
}

/**
 * A backend that keeps objects in a map.
 *
 * Used by core storage's own suite, where the question is never "did the bytes
 * land" but "what did the service do about it". With `versioned` it keeps
 * every write as a revision the way a bucket with versioning does: `stat`
 * answers about the newest, `open` honours the revision it is given, and
 * `delete` removes every revision and marker under the key.
 */
export const memoryBackend = (
  code = 'memory',
  options: { readonly versioned?: boolean } = {},
): MemoryBackend => {
  const versioned = options.versioned === true
  const store = new Map<string, MemoryRevision[]>()
  let counter = 0
  let lastServedAs: string | undefined
  let lastRevision: string | null | undefined
  const failures = new Set<string>()
  const fail = (operation: string) => {
    if (!failures.has(operation)) return false
    failures.delete(operation)
    return true
  }
  const append = (key: string, bytes: Uint8Array | null, modifiedAt: number) => {
    counter += 1
    const entry = { revision: `r${String(counter)}`, bytes, modifiedAt }
    store.set(key, versioned ? [...(store.get(key) ?? []), entry] : [entry])
  }
  /** the newest revision that is an object, if the newest entry is not a marker */
  const current = (key: string) => {
    const entries = store.get(key) ?? []
    const last = entries[entries.length - 1]
    return last === undefined || last.bytes === null ? undefined : last
  }
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

  return {
    code,
    put: (key, bytes, put) => append(key, bytes, put?.modifiedAt ?? Date.now()),
    mark: (key, marked) => {
      if (!versioned) {
        store.delete(key)
        return
      }
      append(key, null, marked?.modifiedAt ?? Date.now())
    },
    has: (key) => current(key) !== undefined,
    keys: () => [...store.keys()].filter((key) => current(key) !== undefined),
    revisionsOf: (key) => [...(store.get(key) ?? [])],
    servedAs: () => lastServedAs,
    openedRevision: () => lastRevision,
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
        const found = current(key)
        if (found === undefined || found.bytes === null) return Effect.succeed(null)
        return Effect.succeed({
          size: BigInt(found.bytes.byteLength),
          integrityAlgorithm: 'sha256' as const,
          integrityValue: digest(found.bytes),
          ...(versioned ? { revision: found.revision } : {}),
        })
      }),
    open: (ref, opened) =>
      Effect.suspend(() => {
        lastServedAs = opened?.mime
        lastRevision = ref.revision
        const entries = store.get(ref.key) ?? []
        const found =
          ref.revision === undefined || ref.revision === null
            ? current(ref.key)
            : entries.find((entry) => entry.revision === ref.revision)
        const bytes = found?.bytes ?? new Uint8Array()
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
        store.delete(key)
        return Effect.void
      }),
    ...(versioned
      ? {
          revisions: {
            list: (prefix, cursor) =>
              Effect.sync(() => {
                // one key a page, so a caller that pages through gets the
                // same answer whatever it does between pages
                const keys = [...store.keys()].filter((key) => key.startsWith(prefix)).sort()
                const at = cursor === undefined ? 0 : keys.indexOf(cursor) + 1
                const key = keys[at]
                if (key === undefined) return { entries: [], next: undefined }
                return {
                  entries: (store.get(key) ?? []).map((entry) => ({
                    key,
                    revision: entry.revision,
                    deleteMarker: entry.bytes === null,
                    modifiedAt: entry.modifiedAt,
                  })),
                  next: at + 1 < keys.length ? key : undefined,
                }
              }),
            remove: (key, revision) =>
              Effect.suspend(() => {
                // a typed failure, as a store that cannot be reached answers
                if (fail('remove')) {
                  return Effect.fail(
                    backendFailure('remove', new Error('memory backend was told to fail remove')),
                  )
                }
                const kept = (store.get(key) ?? []).filter((entry) => entry.revision !== revision)
                if (kept.length === 0) store.delete(key)
                else store.set(key, kept)
                return Effect.void
              }),
          },
        }
      : {}),
  }
}

/** registers a backend the way a provider plugin's layer would */
export const backendLayer = (backend: StorageBackend): Layer.Layer<never, never, StorageBackends> =>
  Layer.effectDiscard(Effect.flatMap(StorageBackends, (registry) => registry.register(backend)))

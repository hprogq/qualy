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
  options: {
    readonly versioned?: boolean
    /** how many revisions and markers one listing page holds; a bucket's is 1000 */
    readonly listPage?: number
  } = {},
): MemoryBackend => {
  const versioned = options.versioned === true
  const listPage = options.listPage ?? 1000
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
            // As a bucket lists them: keys in order, each key's revisions
            // newest first, cut into pages wherever the count falls - so one
            // key's revisions may span pages, its oldest on a later one. The
            // cursor names the last entry given, as a bucket's key and
            // version markers do, so removing what a page held does not
            // move where the next one starts.
            list: (prefix, cursor) =>
              Effect.sync(() => {
                const numberOf = (revision: string) => Number(revision.slice(1))
                const all = [...store.keys()]
                  .filter((key) => key.startsWith(prefix))
                  .sort()
                  .flatMap((key) =>
                    [...(store.get(key) ?? [])].reverse().map((entry) => ({
                      key,
                      revision: entry.revision,
                      deleteMarker: entry.bytes === null,
                      modifiedAt: entry.modifiedAt,
                    })),
                  )
                const [afterKey, afterRevision] =
                  cursor === undefined
                    ? [undefined, undefined]
                    : (JSON.parse(cursor) as [string, number])
                const from =
                  afterKey === undefined
                    ? 0
                    : all.findIndex(
                        (entry) =>
                          entry.key > afterKey ||
                          (entry.key === afterKey && numberOf(entry.revision) < afterRevision),
                      )
                const entries = from < 0 ? [] : all.slice(from, from + listPage)
                const last = entries.at(-1)
                const more = from >= 0 && from + listPage < all.length
                return {
                  entries,
                  next:
                    more && last !== undefined
                      ? JSON.stringify([last.key, numberOf(last.revision)])
                      : undefined,
                }
              }),
            exists: (key, revision) =>
              Effect.sync(() =>
                (store.get(key) ?? []).some(
                  (entry) => entry.bytes !== null && entry.revision === revision,
                ),
              ),
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

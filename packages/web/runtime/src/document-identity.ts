import { Context, Effect } from 'effect'
import { ANONYMOUS_IDENTITY } from '@qualy/api-kit'

// Whose this page is (docs/adr/0013-document-identity.md).
//
// Every request the page makes says so, and the server refuses one whose
// session belongs to somebody else before anything is done for it. The
// answer is the manifest the page took: its identity key, or nobody. It
// changes only when the page takes another manifest - which a recovery
// keeps from happening while it waits for the same person to come back -
// and never because a probe heard somebody else is signed in now.
//
// Unset until the page has taken its first manifest: until then the only
// thing it may ask is who is signed in, and a request that is not that
// question goes out saying nothing, which the server refuses as a broken
// page rather than answering as anybody.

let current: string | undefined

/** the identity this page belongs to, or nothing before its first manifest */
export const documentIdentity = (): string | undefined => current

/** the identity a manifest makes the page: its person, or nobody */
export const identityOfManifest = (manifest: {
  readonly viewer: string
  readonly identity?: string | undefined
}): string =>
  manifest.viewer === 'authenticated' && manifest.identity !== undefined
    ? manifest.identity
    : ANONYMOUS_IDENTITY

/** the page takes a manifest as its own */
export const adoptDocumentIdentity = (identity: string): void => {
  current = identity
}

/**
 * The identity one logical request said when it started.
 *
 * A request held while a session is recovered is made again later; it must
 * go out as the page it was made for, never as whatever the page has since
 * become. Left at its default, a request says the page's identity as it
 * goes out.
 */
export const ExpectedIdentity = Context.Reference<string | undefined>(
  '@qualy/web-runtime/ExpectedIdentity',
  { defaultValue: () => undefined },
)

/** runs `effect` as the page it was started for, however long it waits */
export const asTheDocument = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
  const identity = current
  return identity === undefined ? effect : Effect.provideService(effect, ExpectedIdentity, identity)
}

const unassertedListeners = new Set<() => void>()

/**
 * Told when the server refused a request because the page did not say whose
 * it is: a broken page, which cannot go on talking. Returns the way to stop.
 */
export const onUnasserted = (listener: () => void): (() => void) => {
  unassertedListeners.add(listener)
  return () => {
    unassertedListeners.delete(listener)
  }
}

/** the server refused the page for not saying whose it is */
export const unassertedHeard = (): void => {
  for (const listener of [...unassertedListeners]) listener()
}

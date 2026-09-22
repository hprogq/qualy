import { Context, Data } from 'effect'
import type { Effect, Option, Redacted } from 'effect'

// What a plugin holds to keep a value secret: a login entrance's client
// secret, the state a sign-in carries through a redirect.
//
// The owner says whose value it is and names it; this capability encrypts it
// under the deployment's master key and never hands the plaintext back except
// as a Redacted, so a log line or a span that captures one prints
// `<redacted>`. Every call runs on the caller's transaction when there is
// one, so a secret written beside a row commits or rolls back with it.

/** whose secrets: a tenant, the kind of thing that owns them, and which one */
export interface SecretOwner {
  readonly tenantId: string
  /** in the owner's own words, `auth-provider`; at most 63 characters */
  readonly ownerKind: string
  readonly ownerId: string
}

/** one secret of one owner; the key is at most 127 characters */
export interface SecretRef extends SecretOwner {
  readonly key: string
}

/**
 * A stored or sealed value that does not decrypt under this deployment's
 * master key and this reference.
 *
 * Either the master key changed, or the value was moved onto another owner or
 * key, or somebody edited it. None of those is something a caller can repair,
 * but each is something it has to decide how to answer.
 */
export class SecretUnreadable extends Data.TaggedError('SecretUnreadable')<{
  readonly key: string
}> {}

export class Secrets extends Context.Service<
  Secrets,
  {
    /** writes the value, replacing whatever was stored under the same reference */
    readonly put: (ref: SecretRef, value: Redacted.Redacted<string>) => Effect.Effect<void>
    readonly get: (
      ref: SecretRef,
    ) => Effect.Effect<Option.Option<Redacted.Redacted<string>>, SecretUnreadable>
    /** whether a value is stored, without decrypting it */
    readonly has: (ref: SecretRef) => Effect.Effect<boolean>
    /** the keys an owner has values under, in order */
    readonly keysOf: (owner: SecretOwner) => Effect.Effect<readonly string[]>
    /** whether there was a value to remove */
    readonly delete: (ref: SecretRef) => Effect.Effect<boolean>
    /** every value of an owner, for an owner that is going away; how many there were */
    readonly deleteOwner: (owner: SecretOwner) => Effect.Effect<number>
    /**
     * The value encrypted for somebody else to keep, as one line of text.
     *
     * Bound to the reference the same way a stored value is: it opens only
     * under the reference it was sealed for.
     */
    readonly seal: (ref: SecretRef, value: Redacted.Redacted<string>) => Effect.Effect<string>
    readonly open: (
      ref: SecretRef,
      sealed: string,
    ) => Effect.Effect<Redacted.Redacted<string>, SecretUnreadable>
    /**
     * A keyed digest of a value, as 64 hex characters.
     *
     * The same scope and value always give the same text, and nobody without
     * the deployment's master key can compute one or test a guess against
     * it: what to store when something has to be found again by a value that
     * must not be stored - the address a sign-in attempt was counted against.
     * The scope keeps two uses of one value apart.
     */
    readonly fingerprint: (scope: string, value: string) => Effect.Effect<string>
  }
>()('@qualy/plugin-secrets/Secrets') {}

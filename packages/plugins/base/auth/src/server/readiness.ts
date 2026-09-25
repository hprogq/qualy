import { Effect, type Context } from 'effect'
import { LoginDrivers, type LoginDriver } from '@qualy/auth-contract/login'
import { Secrets, type SecretOwner } from '@qualy/plugin-secrets/plugin'
import { PublicOriginResolver } from './public-origin.ts'
import { effectiveValues, visibleIn } from './entrance-values.ts'

// Whether an entrance can let anybody in, asked in one place.
//
// The detail screen, putting an entrance in service, the sign-in page's list,
// resolving an entrance at sign-in and the recovery check all ask the same
// question, and each used to answer it with a different subset: one checked
// the driver, one the audience, none the settings. An entrance that is in
// service is always ready - every write that would make one unready while in
// service is refused - so a caller that finds an unready one in service is
// looking at a driver that changed under it, and treats the entrance as
// absent.

/** what an entrance is still missing */
export type ReadinessGap =
  /** no installed plugin implements its kind */
  | { readonly kind: 'driver' }
  /** a required setting, named by the driver's field key */
  | { readonly kind: 'field'; readonly key: string }
  /**
   * Its kind sends people away and expects them back, and this deployment
   * has no address to be sent back to (QUALY_PUBLIC_URL).
   */
  | { readonly kind: 'public-origin' }
  /**
   * A secret is stored and does not open under this deployment's master key:
   * the key changed since it was written, or the row was edited. It stays
   * where it is - nothing clears it - until somebody types it again.
   */
  | { readonly kind: 'secret-unreadable'; readonly key: string }

export interface Readiness {
  readonly ready: boolean
  readonly missing: readonly ReadinessGap[]
}

/** the owner every secret of one entrance is stored under */
export const entranceSecrets = (tenantId: string, providerId: string): SecretOwner => ({
  tenantId,
  ownerKind: 'auth-provider',
  ownerId: providerId,
})

/** the stored config as an object, whatever the column handed back */
export const configOf = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** the judgment itself, on facts already read */
export const readinessOf = (
  driver: LoginDriver | undefined,
  config: Readonly<Record<string, unknown>>,
  storedSecrets: readonly string[],
  publicOrigin: boolean,
  unreadableSecrets: readonly string[] = [],
): Readiness => {
  if (driver === undefined) return { ready: false, missing: [{ kind: 'driver' }] }
  const missing: ReadinessGap[] =
    driver.callback !== undefined && !publicOrigin ? [{ kind: 'public-origin' }] : []
  if (driver.provisioning.mode === 'tenant-managed') {
    const entrance = driver.provisioning.entrance
    // judged on the values as they stand, defaults included; a field the
    // form does not show is not asked for
    const values = effectiveValues(entrance, config)
    const shown = entrance.fields.filter((field) => visibleIn(field, values))
    missing.push(
      ...shown
        .filter((field) => field.required)
        .filter((field) =>
          field.kind === 'secret'
            ? !storedSecrets.includes(field.key)
            : values[field.key] === undefined,
        )
        .map((field): ReadinessGap => ({ kind: 'field', key: field.key })),
      // stored but not openable: the door would fail the first person who
      // came through it, so it is not a door until the secret is typed again
      ...shown
        .filter((field) => field.kind === 'secret' && unreadableSecrets.includes(field.key))
        .map((field): ReadinessGap => ({ kind: 'secret-unreadable', key: field.key })),
    )
  }
  return { ready: missing.length === 0, missing }
}

/**
 * Which of an entrance's stored secrets do not open under this deployment's
 * master key. Asked by opening each one; nothing is kept of what opens.
 */
export const unreadableSecretsOf = (
  secrets: Context.Service.Shape<typeof Secrets>,
  owner: SecretOwner,
  keys: readonly string[],
) =>
  Effect.filter(keys, (key) =>
    secrets.get({ ...owner, key }).pipe(
      Effect.as(false),
      Effect.catchTag('SecretUnreadable', () => Effect.succeed(true)),
    ),
  )

export interface ReadinessSubject {
  readonly tenantId: string
  readonly id: string
  readonly type: string
  readonly config: unknown
}

/**
 * The question as the services ask it: the driver from the registry, the
 * stored secrets from the secrets capability. Built once per consumer, so the
 * function it hands back has no requirements of its own and runs on whatever
 * transaction its caller is in.
 */
export const makeReadiness = Effect.gen(function* () {
  const drivers = yield* LoginDrivers
  const secrets = yield* Secrets
  const origin = yield* PublicOriginResolver
  return Effect.fn('Auth.providerReadiness')(function* (provider: ReadinessSubject) {
    const driver = (yield* drivers.forType(provider.type))?.driver
    const asksSecrets =
      driver?.provisioning.mode === 'tenant-managed' &&
      driver.provisioning.entrance.fields.some((field) => field.kind === 'secret')
    const owner = entranceSecrets(provider.tenantId, provider.id)
    const stored = asksSecrets ? yield* secrets.keysOf(owner) : []
    const unreadable = yield* unreadableSecretsOf(secrets, owner, stored)
    return readinessOf(driver, configOf(provider.config), stored, origin.configured, unreadable)
  })
})

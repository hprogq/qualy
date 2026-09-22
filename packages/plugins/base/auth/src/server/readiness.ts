import { Effect } from 'effect'
import { LoginDrivers, type LoginDriver } from '@qualy/auth-contract/login'
import { Secrets, type SecretOwner } from '@qualy/plugin-secrets/plugin'
import { PublicOriginResolver } from './public-origin.ts'

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

const filled = (value: unknown) =>
  typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null

/** the judgment itself, on facts already read */
export const readinessOf = (
  driver: LoginDriver | undefined,
  config: Readonly<Record<string, unknown>>,
  storedSecrets: readonly string[],
  publicOrigin: boolean,
): Readiness => {
  if (driver === undefined) return { ready: false, missing: [{ kind: 'driver' }] }
  const missing: ReadinessGap[] =
    driver.callback !== undefined && !publicOrigin ? [{ kind: 'public-origin' }] : []
  if (driver.provisioning.mode === 'tenant-managed') {
    missing.push(
      ...driver.provisioning.entrance.fields
        .filter((field) => field.required)
        .filter((field) =>
          field.kind === 'secret' ? !storedSecrets.includes(field.key) : !filled(config[field.key]),
        )
        .map((field): ReadinessGap => ({ kind: 'field', key: field.key })),
    )
  }
  return { ready: missing.length === 0, missing }
}

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
    const stored = asksSecrets
      ? yield* secrets.keysOf(entranceSecrets(provider.tenantId, provider.id))
      : []
    return readinessOf(driver, configOf(provider.config), stored, origin.configured)
  })
})

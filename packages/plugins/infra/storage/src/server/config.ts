import { Config, Context, Effect, Layer, Schema } from 'effect'

// What core storage was told about its own deployment: how much, and where
// new uploads go.
//
// Not where the files actually live. A root directory or a bucket name is a
// provider's business, and this plugin knowing either of them is the coupling
// the split exists to remove. All that is here is a code - the same word the
// provider declared - and the allowances every provider is held to.

/** the allowances an upload has to fit inside */
export interface StorageLimits {
  readonly maxFileBytes: bigint
  readonly maxActiveReservationsPerOwner: number
  readonly maxReservedBytesPerOwner: bigint
  readonly maxStagedBytesPerOwner: bigint
  readonly maxStoredBytesPerOwner: bigint
  /** how long an upload credential works for */
  readonly uploadGrantTtlMinutes: number
  /**
   * How long after that the sweeper waits.
   *
   * An upload that started while the credential was valid may still be
   * arriving; deleting at the moment of expiry would race a write that is
   * about to land and leave an object nothing in the database knows about.
   */
  readonly uploadCleanupGraceMinutes: number
  /** how long an attachment nobody saved is kept */
  readonly stagedTtlHours: number
  /** how many upload tickets one person may ask for in an hour */
  readonly prepareRatePerHour: number
  /**
   * What a whole tenant may hold, counting reservations.
   *
   * The hard line refuses uploads. The two below it refuse nothing and only
   * reach the log: an operator who first hears about a full tenant when
   * students stop being able to upload has been told too late.
   */
  readonly tenantWarningBytes: bigint
  readonly tenantCriticalBytes: bigint
  readonly tenantHardBytes: bigint
}

export class StorageConfig extends Context.Service<
  StorageConfig,
  {
    /** the backend code new attachments are written to */
    readonly defaultBackend: string
    readonly limits: StorageLimits
  }
>()('@qualy/plugin-storage/StorageConfig') {}

const MIB = 1024n * 1024n

export const DEFAULT_LIMITS: StorageLimits = {
  maxFileBytes: 50n * MIB,
  maxActiveReservationsPerOwner: 5,
  maxReservedBytesPerOwner: 100n * MIB,
  maxStagedBytesPerOwner: 250n * MIB,
  maxStoredBytesPerOwner: 1024n * MIB,
  uploadGrantTtlMinutes: 15,
  uploadCleanupGraceMinutes: 30,
  stagedTtlHours: 24,
  prepareRatePerHour: 20,
  tenantWarningBytes: 48n * 1024n * MIB,
  tenantCriticalBytes: 56n * 1024n * MIB,
  tenantHardBytes: 64n * 1024n * MIB,
}

const positive = Schema.Number.check(Schema.isGreaterThan(0))

/** what this plugin accepts in `qualy.yml` */
export const StorageManifestConfig = Schema.Struct({
  defaultBackend: Schema.optional(Schema.String),
  limits: Schema.optional(
    Schema.Struct({
      maxFileBytes: Schema.optional(positive),
      maxActiveReservationsPerOwner: Schema.optional(positive),
      maxReservedBytesPerOwner: Schema.optional(positive),
      maxStagedBytesPerOwner: Schema.optional(positive),
      maxStoredBytesPerOwner: Schema.optional(positive),
      uploadGrantTtlMinutes: Schema.optional(positive),
      uploadCleanupGraceMinutes: Schema.optional(positive),
      stagedTtlHours: Schema.optional(positive),
      prepareRatePerHour: Schema.optional(positive),
      tenantWarningBytes: Schema.optional(positive),
      tenantCriticalBytes: Schema.optional(positive),
      tenantHardBytes: Schema.optional(positive),
    }),
  ),
})
export type StorageManifestConfig = typeof StorageManifestConfig.Type

const limitsFrom = (declared: StorageManifestConfig['limits']): StorageLimits => {
  const big = (value: number | undefined, fallback: bigint) =>
    value === undefined ? fallback : BigInt(Math.floor(value))
  const count = (value: number | undefined, fallback: number) => value ?? fallback
  return {
    maxFileBytes: big(declared?.maxFileBytes, DEFAULT_LIMITS.maxFileBytes),
    maxActiveReservationsPerOwner: count(
      declared?.maxActiveReservationsPerOwner,
      DEFAULT_LIMITS.maxActiveReservationsPerOwner,
    ),
    maxReservedBytesPerOwner: big(
      declared?.maxReservedBytesPerOwner,
      DEFAULT_LIMITS.maxReservedBytesPerOwner,
    ),
    maxStagedBytesPerOwner: big(
      declared?.maxStagedBytesPerOwner,
      DEFAULT_LIMITS.maxStagedBytesPerOwner,
    ),
    maxStoredBytesPerOwner: big(
      declared?.maxStoredBytesPerOwner,
      DEFAULT_LIMITS.maxStoredBytesPerOwner,
    ),
    uploadGrantTtlMinutes: count(
      declared?.uploadGrantTtlMinutes,
      DEFAULT_LIMITS.uploadGrantTtlMinutes,
    ),
    uploadCleanupGraceMinutes: count(
      declared?.uploadCleanupGraceMinutes,
      DEFAULT_LIMITS.uploadCleanupGraceMinutes,
    ),
    stagedTtlHours: count(declared?.stagedTtlHours, DEFAULT_LIMITS.stagedTtlHours),
    prepareRatePerHour: count(declared?.prepareRatePerHour, DEFAULT_LIMITS.prepareRatePerHour),
    tenantWarningBytes: big(declared?.tenantWarningBytes, DEFAULT_LIMITS.tenantWarningBytes),
    tenantCriticalBytes: big(declared?.tenantCriticalBytes, DEFAULT_LIMITS.tenantCriticalBytes),
    tenantHardBytes: big(declared?.tenantHardBytes, DEFAULT_LIMITS.tenantHardBytes),
  }
}

/**
 * The configuration layer the host builds from the manifest block.
 *
 * Which backend to write to can also come from the environment, because it is
 * the one setting that legitimately differs between two deployments of the
 * same committed manifest - a laptop keeping files on disk and a server
 * keeping them in a bucket are running the same product.
 */
export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<StorageConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    StorageConfig,
    Effect.gen(function* () {
      const declared = yield* Schema.decodeUnknownEffect(StorageManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
      const defaultBackend = yield* Config.string('QUALY_STORAGE_DEFAULT_BACKEND').pipe(
        Config.withDefault(declared.defaultBackend ?? 'local'),
      )
      return StorageConfig.of({ defaultBackend, limits: limitsFrom(declared.limits) })
    }),
  )

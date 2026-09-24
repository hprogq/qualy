import { Layer, Redacted } from 'effect'
import type { Orm } from '@qualy/plugin-database/server'
import type { Secrets } from '../plugin.ts'
import { masterKeyFrom, SecretsConfig } from '../server/config.ts'
import { serviceLayer } from '../server/service.ts'

// The capability as a suite composes it: the real service under a fixed key,
// and the table its orm must know about.

export { entities } from '../db/entities.ts'

export const TEST_MASTER_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='

/** the service under a key of the suite's choosing */
export const secretsLayerWith = (masterKey: string): Layer.Layer<Secrets, never, Orm> =>
  serviceLayer.pipe(
    Layer.provide(
      Layer.succeed(
        SecretsConfig,
        SecretsConfig.of({ masterKey: Redacted.make(masterKeyFrom(masterKey)!) }),
      ),
    ),
  )

export const secretsLayer: Layer.Layer<Secrets, never, Orm> = secretsLayerWith(TEST_MASTER_KEY)

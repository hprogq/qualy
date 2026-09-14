import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/plugin'
import { rumApiGroup, RUM_SETTINGS_SCHEMA } from '../api.ts'
import { RumProviders, barrierLayer, registryLayer } from './registry.ts'

// The server half: a slot a provider fills, and one endpoint that reads it.

export { RumProviders, barrierLayer, registryLayer } from './registry.ts'

export const layer: Layer.Layer<RumProviders> = registryLayer

const local = Api.local(rumApiGroup)

export const rumApiHandlers = HttpApiBuilder.group(local, 'rum', (handlers) =>
  handlers.handle(
    'getRumSettings',
    Effect.fn('rum.getRumSettings.handler')(function* () {
      const selected = yield* (yield* RumProviders).selected
      return selected === null
        ? { schema: RUM_SETTINGS_SCHEMA, provider: null, config: {} }
        : {
            schema: RUM_SETTINGS_SCHEMA,
            provider: selected.code,
            config: selected.publicConfig,
          }
    }),
  ),
)

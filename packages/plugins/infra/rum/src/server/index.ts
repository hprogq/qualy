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
      // the code stays here: it is how the assembly refuses two providers and
      // how a boot failure names the one that never registered, and none of
      // that is a browser's business
      return { schema: RUM_SETTINGS_SCHEMA, config: selected?.publicConfig ?? null }
    }),
  ),
)

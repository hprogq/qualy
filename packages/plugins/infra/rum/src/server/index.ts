import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '@qualy/api-kit/plugin'
import { rumApiGroup, RUM_SETTINGS_SCHEMA } from '../api.ts'
import { RumProviders } from './registry.ts'

// The server half: a slot a provider fills, and one endpoint that reads it.

export { RumProviders, barrierLayer, registryLayer } from './registry.ts'
export { config, RUM_REPORTING_VARIABLE, RumReporting } from './config.ts'

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

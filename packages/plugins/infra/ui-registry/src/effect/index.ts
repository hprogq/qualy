import { Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { CurrentUser } from '@qualy/plugin-auth/effect/session'
import { appApiGroup } from '../api.ts'
import { UiCatalog, UiManifest, layer as manifestLayer } from './manifest.ts'

// The registry as a layer: a projection over declarations, plus the one live
// service it genuinely needs.

export { UiAuthorizer, denyAll } from './authorizer.ts'
export { UiCatalog, UiManifest } from './manifest.ts'
export type { Manifest } from './manifest.ts'

export const layer: Layer.Layer<UiManifest, never, UiCatalog> = manifestLayer

// see QUALY_API_ID: implemented against a local api so this plugin does not
// import the aggregate it is part of
const local = HttpApi.make(QUALY_API_ID).add(appApiGroup).prefix(QUALY_API_PREFIX)

export const appApiHandlers = HttpApiBuilder.group(local, 'app', (handlers) =>
  handlers.handle(
    'getManifest',
    Effect.fn('app.getManifest.handler')(function* () {
      const manifest = yield* UiManifest
      // Anonymous callers are served: an absent principal is a viewer who sees
      // the public surfaces, not a caller to refuse. The tag is read
      // optionally rather than through the middleware, so this endpoint has no
      // layer dependency on auth at all: an assembly without it serves a
      // manifest in which everyone is anonymous.
      const principal = yield* Effect.serviceOption(CurrentUser)
      return yield* manifest.build(principal._tag === 'Some' ? principal.value : undefined)
    }),
  ),
)

import { Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { CurrentViewer } from '@qualy/plugin-auth/server/session-contract'
import { appApiGroup } from '../api.ts'
import { UiManifest, layer as manifestLayer } from './manifest.ts'
import { Ui, uiLayer } from './registry.ts'

// The registry as a layer: a projection over declarations, plus the one live
// service it genuinely needs.

export { UiAuthorizer, denyAll } from './authorizer.ts'
export { UiManifest } from './manifest.ts'
export { Ui, registerSurfaces } from './registry.ts'
export type { Manifest } from './manifest.ts'

// The registry travels with the manifest that reads it: a plugin has to have
// somewhere to put a page before the manifest exists, which is what
// `provideMerge` gives it - supplying the registry and publishing it at once.
export const layer: Layer.Layer<UiManifest | Ui> = manifestLayer.pipe(Layer.provideMerge(uiLayer))

// see QUALY_API_ID: implemented against a local api so this plugin does not
// import the aggregate it is part of
const local = HttpApi.make(QUALY_API_ID).add(appApiGroup).prefix(QUALY_API_PREFIX)

export const appApiHandlers = HttpApiBuilder.group(local, 'app', (handlers) =>
  handlers.handle(
    'getManifest',
    Effect.fn('app.getManifest.handler')(function* () {
      const manifest = yield* UiManifest
      // an absent principal is a viewer who sees the public surfaces, not a
      // caller to refuse
      const viewer = yield* CurrentViewer
      return yield* manifest.build(viewer.principal)
    }),
  ),
)

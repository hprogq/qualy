import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '@qualy/api-kit/plugin'
import { CurrentViewer } from '@qualy/auth-contract/session'
import { appApiGroup } from '@qualy/app-contract'
import { requestLocale } from '@qualy/api-kit/locale'
import { UiManifest, layer as manifestLayer } from './manifest.ts'
import { DocumentContext } from '../document-context.ts'
import { Ui } from './registry.ts'

// The registry as a layer: a projection over declarations, plus the one live
// service it genuinely needs.

export { UiAuthorizer, denyAll } from './authorizer.ts'
export { UiManifest } from './manifest.ts'
export { Ui, registerSurfaces } from './registry.ts'
export type { Manifest } from './manifest.ts'

// The registry arrives from the prepare phase, already populated: pages are
// declarations the assembler collected before any service existed, so this
// service only projects them per request.
export const layer: Layer.Layer<UiManifest, never, Ui> = manifestLayer

const local = Api.local(appApiGroup)

export const appApiHandlers = HttpApiBuilder.group(local, 'app', (handlers) =>
  handlers.handle(
    'getManifest',
    Effect.fn('app.getManifest.handler')(function* () {
      const manifest = yield* UiManifest
      // an absent principal is a viewer who sees the public surfaces, not a
      // caller to refuse
      const viewer = yield* CurrentViewer
      const locale = yield* requestLocale
      const built = yield* manifest.build(viewer.principal, locale)
      const documentContext = yield* DocumentContext
      return {
        ...built,
        context: yield* documentContext.of({ principal: viewer.principal, locale }),
      }
    }),
  ),
)

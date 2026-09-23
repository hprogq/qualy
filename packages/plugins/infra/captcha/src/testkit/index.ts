import { Effect, Layer } from 'effect'
import type { Secrets } from '@qualy/plugin-secrets/plugin'
import { CaptchaProviders, registryLayer } from '../server/registry.ts'
import { Captcha, serviceLayer } from '../server/service.ts'
import type { CaptchaProvider } from '../server/provider.ts'

// The capability as a suite composes it: the real guard over the real
// registry, with no provider - which is how a deployment without one runs -
// or with one the suite supplies.

/** the guard and its registry, with nobody to issue challenges */
export const captchaLayer: Layer.Layer<Captcha | CaptchaProviders, never, Secrets> =
  serviceLayer.pipe(Layer.provideMerge(registryLayer))

/** the guard and its registry, with this provider registered as its own plugin would */
export const captchaLayerWith = (
  provider: CaptchaProvider,
): Layer.Layer<Captcha | CaptchaProviders, never, Secrets> =>
  serviceLayer.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(
        Effect.flatMap(CaptchaProviders, (registry) => registry.register(provider)),
      ).pipe(Layer.provideMerge(registryLayer)),
    ),
  )

// The capability as a caller and a provider use it: the guard a caller asks,
// the registry a provider registers into, and what a provider implements.

export {
  Captcha,
  serviceLayer,
  type CaptchaGuardInput,
  type CaptchaGuardResult,
  type CaptchaPassage,
} from './service.ts'
export { barrierLayer, CaptchaProviders, registryLayer } from './registry.ts'
export {
  CaptchaUnavailable,
  type CaptchaProvider,
  type CaptchaProviderContext,
} from './provider.ts'

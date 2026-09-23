// The browser half of the capability: what a provider registers, the gate a
// caller drives, and the host it renders.

export {
  captchaProviderFor,
  registerCaptchaProvider,
  type BrowserCaptchaProvider,
  type CaptchaClientState,
} from './registry.ts'
export {
  useCaptchaGate,
  type CaptchaGate,
  type CaptchaPlacement,
  type CaptchaSolution,
  type CaptchaState,
} from './gate.ts'
export { CaptchaChallenge } from './CaptchaChallenge.tsx'

// What a provider's browser half implements, and where it announces itself.
//
// A provider is an imperative driver, not a component: it is handed a
// container and a challenge, and reports how things stand. It never decides
// where anything goes on the page - whether it is working quietly, needs the
// person, or is done is all it says, and the host decides what that looks
// like. A silent provider therefore adds nothing visible to a form, and one
// that needs a click is shown only when it does.
//
// Registering stays cheap, because every page of a deployment with the
// provider active evaluates the provider's browser module: a name and a
// function. Whatever the provider needs to actually run - a widget, a worker,
// a vendor script - it loads in `start`, when a challenge has arrived.

export type CaptchaClientState =
  /** computing, or waiting on the provider's own service; nothing to show */
  | { readonly kind: 'working' }
  /** the person has to do something in the container */
  | { readonly kind: 'interaction-required' }
  /** done: the provider's opaque payload, handed over untouched */
  | { readonly kind: 'solved'; readonly response: string }
  | { readonly kind: 'failed' }

export interface BrowserCaptchaProvider {
  readonly code: string
  readonly start: (input: {
    readonly container: HTMLElement
    readonly challenge: Readonly<Record<string, unknown>>
    readonly onStateChange: (state: CaptchaClientState) => void
  }) => Promise<{ readonly dispose: () => void }>
}

const providers = new Map<string, BrowserCaptchaProvider>()

/** a provider's browser half announcing itself; the disposer takes it back */
export const registerCaptchaProvider = (provider: BrowserCaptchaProvider): (() => void) => {
  providers.set(provider.code, provider)
  return () => {
    if (providers.get(provider.code) === provider) providers.delete(provider.code)
  }
}

/** the provider a challenge names, when this build carries it */
export const captchaProviderFor = (code: string): BrowserCaptchaProvider | undefined =>
  providers.get(code)

// What a reporting provider plugin implements, and nothing else.
//
// The vocabulary a SCREEN uses - captureException, captureDiagnostic,
// setObservedPage - is the platform's and lives in
// `@qualy/browser-observability`. This module is the capability's own face:
// only a provider's browser half imports it, and only to say it exists.

export type { BrowserRumProvider, ObservedRelease } from './registry.ts'
export { activateRumProvider, registerRumProvider, resetBrowserRum } from './registry.ts'

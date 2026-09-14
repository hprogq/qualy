import {
  installSink,
  noSinkArriving,
  resetObservability,
  type ObservabilitySink,
} from '@qualy/browser-observability'

// Which provider this deployment reports through, and bringing it up.
//
// Everything vendor-neutral moved to the platform: a page calls
// `captureException` from `@qualy/browser-observability` and this plugin is
// not on its import path at all. What is left here is the part that only
// exists because a deployment CHOSE a reporting platform - the vocabulary a
// provider implements, the registry it announces itself to, and the moment
// the assembly's answer turns into an installed sink.
//
// This module is still evaluated by every page that loads a provider's
// browser half, so it stays this cheap: no api client, no vendor import.
// Asking the server which provider was selected costs a client and lives in
// `start.ts`, which the composition root imports once.

/** what the browser is running, which only the bundle knows */
export interface ObservedRelease {
  readonly releaseId: string
  readonly mode: 'development' | 'production'
}

export interface BrowserRumProvider {
  /** the code its plugin declared to the assembly */
  readonly provider: string
  /**
   * Brings the vendor sdk up with this deployment's settings.
   *
   * `null` for "configured off" rather than a throw: a provider that decides
   * it has nothing to do is the normal disabled case. Whatever it costs - a
   * vendor bundle, a handshake - is paid here and never in the boot graph.
   */
  start(
    config: Record<string, unknown>,
    release: ObservedRelease,
  ): Promise<ObservabilitySink | null>
}

const providers = new Map<string, BrowserRumProvider>()
let started = false
let reporting = false

/** one line per distinct problem, never a line per occurrence */
const warned = new Set<string>()
const warnOnce = (key: string, cause: unknown): void => {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[qualy] browser reporting is not working (${key})`, cause)
}

/**
 * A provider offering its browser half.
 *
 * Called by the provider's own browser module, which every page evaluates -
 * so it must stay this cheap. Registering costs a name and a function, and
 * whether this deployment reports at all is decided in `startBrowserRum`.
 */
export const registerRumProvider = (provider: BrowserRumProvider): void => {
  const existing = providers.get(provider.provider)
  if (existing !== undefined && existing !== provider) {
    warnOnce(provider.provider, 'registered twice; the second registration was ignored')
    return
  }
  providers.set(provider.provider, provider)
}

/**
 * Brings up the provider this deployment named, and hands the platform its
 * sink - or tells the platform that none is coming.
 *
 * Every path ends in one of those two, because the platform is holding the
 * failures from before any of this and has no other way to know which it is.
 * A failure here is warned about once and changes nothing else.
 */
export const activateRumProvider = async (
  selected: string | null,
  config: Record<string, unknown>,
  release: ObservedRelease,
): Promise<void> => {
  if (started) return
  started = true
  try {
    if (selected !== null) {
      const provider = providers.get(selected)
      if (provider === undefined) {
        // the assembly selected a provider whose browser half is not in this
        // build, which is a deployment fault rather than anything a viewer did
        warnOnce(selected, 'the selected provider is not part of this build')
      } else {
        const sink = await provider.start(config, release)
        // installing replays what failed before the sink existed; a provider
        // that decided it has nothing to do leaves that to the line below.
        // The disposer it hands back has nowhere to be called yet - browser
        // plugins have no teardown - so it is deliberately not kept.
        if (sink !== null) {
          installSink(sink)
          reporting = true
        }
      }
    }
  } catch (cause) {
    warnOnce('start', cause)
  }
  if (!reporting) noSinkArriving()
}

/** test seam: module state is per page in a browser and per file in a suite */
export const resetBrowserRum = (): void => {
  providers.clear()
  started = false
  warned.clear()
  reporting = false
  resetObservability()
}

import type { Dispose } from '@qualy/plugin-kit/browser'
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

/**
 * What the browser is running, which only the bundle knows.
 *
 * The id alone. It also carried the deployment's mode, and nothing ever read
 * it: a provider that needs to know which environment it is reporting for
 * gets that from its own settings, which is where a deployment says such
 * things - the bundle's mode is a build fact, and a staging deployment built
 * in production mode would have answered wrong.
 */
export interface ObservedRelease {
  readonly releaseId: string
}

export interface BrowserRumProvider {
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

/**
 * One slot, because a build carries one.
 *
 * It was a map keyed by the vendor's name, which only made sense while the
 * server named a vendor for the browser to look up. A production build is
 * the active selection's browser code and nothing else, and the assembly
 * refuses two reporting providers - so whatever registers here is the one
 * this deployment chose. A second registration is a bug in the build, not a
 * choice to be made at run time.
 */
let registered: BrowserRumProvider | null = null
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
export const registerRumProvider = (provider: BrowserRumProvider): Dispose => {
  if (registered !== null && registered !== provider) {
    warnOnce('registration', 'a second reporting provider registered; it was ignored')
    return () => undefined
  }
  registered = provider
  return () => {
    if (registered === provider) registered = null
  }
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
  config: Record<string, unknown> | null,
  release: ObservedRelease,
): Promise<Dispose> => {
  if (started) return () => undefined
  started = true
  let dispose: Dispose = () => undefined
  try {
    if (config !== null) {
      if (registered === null) {
        // the deployment turned reporting on and this build carries no
        // provider to do it with, which is a deployment fault rather than
        // anything a viewer did
        warnOnce('provider', 'this deployment reports, but no provider is part of this build')
      } else {
        const sink = await registered.start(config, release)
        // installing replays what failed before the sink existed; a provider
        // that decided it has nothing to do leaves that to the line below
        if (sink !== null) {
          dispose = installSink(sink)
          reporting = true
        }
      }
    }
  } catch (cause) {
    warnOnce('start', cause)
  }
  if (!reporting) noSinkArriving()
  return dispose
}

/** test seam: module state is per page in a browser and per file in a suite */
export const resetBrowserRum = (): void => {
  registered = null
  started = false
  warned.clear()
  reporting = false
  resetObservability()
}

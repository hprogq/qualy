import { HttpApiClient } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/local'
import { rumApiGroup, RUM_SETTINGS_SCHEMA } from '../api.ts'
import type { Dispose } from '@qualy/plugin-kit/browser'
import { activateRumProvider, type ObservedRelease } from './registry.ts'

// Asking the deployment whether it reports, and to whom.
//
// Its own module because of what it costs: the address comes from the same
// contract the server serves, which means an api client, which is a large
// dependency to put on a path that every page and every provider registration
// takes. The composition root imports this once; everything else imports the
// vocabulary next door.
//
// The address is built rather than written. A renamed endpoint is then a
// compile error instead of a probe that quietly 404s forever and leaves a
// deployment reporting nothing.

const settingsUrl = HttpApiClient.urlBuilder(Api.local(rumApiGroup)).rum.getRumSettings()

/**
 * The settings this deployment answered with, or null for "reports nowhere".
 *
 * Every way of not getting an answer means the same thing and is not a
 * failure: an assembly without the reporting capability answers the api's
 * tagged 404, and a build older or newer than the server reads a generation
 * it does not know. A page that cannot tell what it was told reports nothing,
 * which is the only safe reading of a document about where data goes.
 */
const readSettings = async (): Promise<Record<string, unknown> | null> => {
  const response = await fetch(settingsUrl, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
  })
  if (!response.ok) return null
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) return null
  const candidate = body as { schema?: unknown; config?: unknown }
  if (candidate.schema !== RUM_SETTINGS_SCHEMA) return null
  return typeof candidate.config === 'object' && candidate.config !== null
    ? (candidate.config as Record<string, unknown>)
    : null
}

/**
 * Brings reporting up, if this deployment has any, and hands back the way to
 * take it down again.
 *
 * Not awaited by the composition root: nothing renders any sooner for having
 * waited, and a deployment whose answer never arrives must not be able to hold
 * the first screen. Every failure inside is swallowed by the registry, which
 * warns once.
 *
 * The disposer matters because this is the one thing here that outlives the
 * call: a sink installed into the platform stays installed. Its caller is the
 * browser module, which holds it for the lifetime the host gave it.
 */
export const startBrowserRum = async (release: ObservedRelease): Promise<Dispose> => {
  try {
    return await activateRumProvider(await readSettings(), release)
  } catch {
    // the answer never came: no reporting, and nothing else about the page
    // changes. The registry's own warning covers the cases worth a line.
    return activateRumProvider(null, release)
  }
}

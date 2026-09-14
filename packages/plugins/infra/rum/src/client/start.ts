import { HttpApiClient } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/local'
import { rumApiGroup, RUM_SETTINGS_SCHEMA } from '../api.ts'
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

/** what the deployment answered, or nothing at all - which is not an error */
const readSettings = async (): Promise<{
  provider: string | null
  config: Record<string, unknown>
}> => {
  const response = await fetch(settingsUrl, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
  })
  // An assembly without the reporting capability answers the api's tagged 404.
  // That is an answer, not a failure: reporting is not part of this deployment.
  if (!response.ok) return { provider: null, config: {} }
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) return { provider: null, config: {} }
  const candidate = body as { schema?: unknown; provider?: unknown; config?: unknown }
  if (candidate.schema !== RUM_SETTINGS_SCHEMA) return { provider: null, config: {} }
  const provider = typeof candidate.provider === 'string' ? candidate.provider : null
  const config =
    typeof candidate.config === 'object' && candidate.config !== null
      ? (candidate.config as Record<string, unknown>)
      : {}
  return { provider, config }
}

/**
 * Brings reporting up, if this deployment has any.
 *
 * Not awaited by the composition root: nothing renders any sooner for having
 * waited, and a deployment whose answer never arrives must not be able to hold
 * the first screen. Every failure inside is swallowed by the registry, which
 * warns once.
 */
export const startBrowserRum = async (release: ObservedRelease): Promise<void> => {
  try {
    const settings = await readSettings()
    await activateRumProvider(settings.provider, settings.config, release)
  } catch {
    // the answer never came: no reporting, and nothing else about the page
    // changes. The registry's own warning covers the cases worth a line.
    await activateRumProvider(null, {}, release)
  }
}

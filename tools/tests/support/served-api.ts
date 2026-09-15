import { HttpApi, type HttpApiGroup } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { ApiGroups } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { runtimeLayers, runtimeLevels } from '@qualy/assembly'
import { currentResolution } from '@qualy/assembly/host'
import { manifestPath } from '../../lib/manifest.ts'

// The api this assembly serves, built the way the runtime builds it.
//
// Descriptors in dependency order, every `Api.group` feature added to one
// api, the aggregate's prefix applied once at the end. Shared rather than
// repeated because two suites ask different questions of the same value - one
// compares it against the frozen path table, the other asks what a browser
// may report a call as - and a second copy of this assembly would be a second
// thing to keep in step.

const resolution = await currentResolution(manifestPath())

let aggregate = HttpApi.make(QUALY_API_ID) as unknown as HttpApi.HttpApi<
  string,
  HttpApiGroup.Constraint
>
for (const entry of runtimeLevels(runtimeLayers(resolution)).flat()) {
  const descriptor = resolution.descriptors.get(entry.id)!
  for (const contribution of Plugin.contributionsOf(descriptor, ApiGroups)) {
    aggregate = aggregate.add(contribution.group)
  }
}

export const servedApi = aggregate.prefix(QUALY_API_PREFIX)

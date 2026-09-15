import { describe, expect, it } from 'vitest'
import { isPluginDescriptor } from '@qualy/plugin-kit'
import { surfaceLabel } from '@qualy/ui-contract'
import { browserContractHashOf } from '@qualy/ui-contract/browser-contract'
import { collectWebPlugins } from '@qualy/web-build/collect'
import { browserContractOf, browserSurfacesOf } from '@qualy/web-build/browser-contract'
import { currentResolution } from '@qualy/assembly/host'
import { manifestPath } from '../lib/manifest.ts'

// Two readers of one contract, and they have to agree.
//
// The browser build writes a release's contract hash from the surfaces it
// collected; a starting host computes the same hash from the descriptors it
// loaded, and refuses to serve a release whose hash differs. That refusal is
// only worth having if the two arrive at the same answer for the same
// assembly - a host computing a different set would refuse every release
// there has ever been, and the log would say nothing a reader could act on.
//
// So this compares them: not the strings the two happen to produce, but the
// sets they produce them from.

describe('the browser contract, from both sides', () => {
  it('is the same set whether a build collects it or a host declares it', async () => {
    const resolution = await currentResolution(manifestPath())
    const declared = resolution.runtimePlugins
      .map((id) => resolution.descriptors.get(id))
      .filter((descriptor) => isPluginDescriptor(descriptor))
      .flatMap(browserSurfacesOf)

    const collected = (await collectWebPlugins({ ymlPath: manifestPath() })).flatMap((entry) =>
      entry.surfaces.map((binding) => surfaceLabel(binding.surface)),
    )

    // a real assembly, so an empty answer on both sides would pass while
    // proving nothing
    expect(declared.length).toBeGreaterThan(20)
    expect([...declared].sort()).toEqual([...collected].sort())
    expect(browserContractHashOf(declared)).toBe(browserContractHashOf(collected))
    // and the host's one-call form, which is what apps/server actually uses
    expect(browserContractOf(resolution)).toBe(browserContractHashOf(collected))
  })

  it('moves when a surface is added, renamed or removed, and not when a module is', () => {
    const surfaces = ['page:a/one', 'slot:x/y:a/two', 'login:local']
    const hash = browserContractHashOf(surfaces)
    // order is not identity
    expect(browserContractHashOf([...surfaces].reverse())).toBe(hash)
    // an implementation change is not a contract change: the labels carry no
    // module, so there is nothing here for one to move
    expect(browserContractHashOf(surfaces)).toBe(hash)
    expect(browserContractHashOf([...surfaces, 'page:a/three'])).not.toBe(hash)
    expect(browserContractHashOf(['page:a/renamed', surfaces[1]!, surfaces[2]!])).not.toBe(hash)
    expect(browserContractHashOf(surfaces.slice(1))).not.toBe(hash)
  })
})

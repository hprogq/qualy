import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadProviders } from '@qualy/assembly'
import { isPluginDescriptor, type PluginDescriptor } from '@qualy/plugin-kit'

// Which capabilities a deployment changes, and why that is one.
//
// A deployment used to keep a record of its own - a deployed lock beside the
// instance, compared at every start - so that a start could tell whether every
// capability's deploy work had happened. It was removed (docs/deployment.md,
// STATUS P4.5) because exactly one capability had deploy work, the database,
// and the database already records what it applied: the migration ledger is
// the instance's applied state, and a start compares it with the lineage the
// image carries.
//
// That argument is a fact about today's providers, and the capability contract
// still lets any provider define `deploy`. A second one - a search index, an
// object store bucket - would be run by `qualy deploy` and never checked by a
// start, because nothing records that it ran. So the fact is held here: a
// provider with deploy work is the database's, and a second one is the moment
// to design how a start verifies it, not a line to add to this list.

const ROOT = path.resolve(import.meta.dirname, '../..')
const DEPLOYS_WITH_A_LEDGER = new Set(['database'])

/** every plugin package in the repository, whether or not the manifest selects it */
const pluginDescriptors = async (): Promise<Map<string, PluginDescriptor>> => {
  const found = new Map<string, PluginDescriptor>()
  const base = path.join(ROOT, 'packages/plugins')
  for (const family of fs.readdirSync(base)) {
    const familyDir = path.join(base, family)
    if (!fs.statSync(familyDir).isDirectory()) continue
    for (const name of fs.readdirSync(familyDir)) {
      const entry = path.join(familyDir, name, 'src/index.ts')
      if (!fs.existsSync(entry)) continue
      const module = (await import(pathToFileURL(entry).href)) as { default?: unknown }
      if (isPluginDescriptor(module.default)) found.set(module.default.id, module.default)
    }
  }
  return found
}

describe('what a deployment changes', () => {
  it('is only the database, whose ledger records what it applied', async () => {
    const descriptors = await pluginDescriptors()
    expect(descriptors.size).toBeGreaterThan(10)
    const providers = await loadProviders(descriptors)
    const deploying = [...providers]
      .filter(([, loaded]) => typeof loaded.provider.deploy === 'function')
      .map(([key, loaded]) => `${key} (${loaded.pluginId})`)
    // not vacuous: the one that is allowed does deploy
    expect(deploying).toContain('database (@qualy/plugin-database)')
    expect(
      deploying.filter((one) => !DEPLOYS_WITH_A_LEDGER.has(one.split(' ')[0]!)),
      'a capability with deploy work that no start verifies; decide how a start knows it ran before adding it',
    ).toEqual([])
  })
})

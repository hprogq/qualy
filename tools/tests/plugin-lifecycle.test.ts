import { describe, expect, it } from 'vitest'
import { Plugin } from '@qualy/plugin-kit'
import { ApiGroups } from '@qualy/api-kit/plugin'
import { CliCommands } from '@qualy/plugin-kit/cli'
import { runtimeLayers, runtimeLevels, lockPathFor, readLock } from '@qualy/assembly'
import { commitLock, createWorkspace } from '@qualy/assembly/testkit'
import { buildPluginModuleSource } from '@qualy/web-build/collect'
import { browserSurfacesOf } from '@qualy/web-build/browser-contract'

// What is left of a plugin that is off.
//
// Every other test here asks one question about one mechanism: the isolation
// gate asks who imports whom, the CLI suite asks what the lock records, the
// public-web gate asks what the artifact serves. This asks the question those
// are all really about, of one plugin, across the three states a deployment
// can put it in - because the answer has to be the same everywhere at once,
// and a residue is exactly the thing each individual check has no reason to
// look for.
//
// The states are the ones a deployment has:
//
//   active     everything the plugin declares is part of the product
//   disabled   installed, in the lock, and contributing nothing
//   removed    not in the manifest; kept in the lock only if a capability
//              says it is holding something of its own
//
// `@qualy/plugin-org` is the subject because it contributes in every way that
// leaves a trace: an api group, a page, tables, a runtime layer. What the
// browser half of a disabled plugin leaves in the ARTIFACT is a different
// question with a different answer, and `check-public-web` asks it of a real
// build.

const INFRA = [
  '@qualy/plugin-database',
  '@qualy/plugin-mail',
  '@qualy/plugin-secrets',
  '@qualy/plugin-ui-registry',
]
const KIT = ['@qualy/plugin-kit', '@qualy/ui-contract']
// org's tables reference auth's, and rbac owns the permission catalog both
// contribute to: any of them alone is an assembly resolution refuses
const SELECTION = [
  ...INFRA,
  '@qualy/plugin-audit',
  '@qualy/plugin-org',
  '@qualy/plugin-auth',
  '@qualy/plugin-rbac',
]
const SUBJECT = '@qualy/plugin-org'

/** everything the assembly would build, for one manifest */
const traceOf = async (workspace: ReturnType<typeof createWorkspace>) => {
  const { resolveAssembly } = await import('@qualy/assembly')
  const resolution = await resolveAssembly({
    manifestPath: workspace.manifestPath,
    previousLock: readLock(lockPathFor(workspace.manifestPath)),
  })
  const running = runtimeLevels(runtimeLayers(resolution)).flat()
  const descriptorsOf = (id: string) =>
    running.filter((entry) => entry.id === id).map((entry) => resolution.descriptors.get(entry.id)!)

  const subject = descriptorsOf(SUBJECT)
  return {
    state: resolution.plugins.get(SUBJECT)?.state,
    /** its layer is built at all - which is what registers a policy or starts a job */
    running: running.some((entry) => entry.id === SUBJECT),
    apiGroups: subject.flatMap((descriptor) =>
      Plugin.contributionsOf(descriptor, ApiGroups).map((one) => one.group.identifier),
    ),
    surfaces: subject.flatMap(browserSurfacesOf),
    commands: subject.flatMap((descriptor) =>
      Plugin.contributionsOf(descriptor, CliCommands).map((one) => one.name),
    ),
    browser: await buildPluginModuleSource({ ymlPath: workspace.manifestPath }),
    lock: readLock(lockPathFor(workspace.manifestPath)),
  }
}

describe('a plugin across the states a deployment can put it in', () => {
  it('contributes everything when it is on, and nothing at all when it is off', async () => {
    const workspace = createWorkspace(SELECTION, { linked: KIT })
    try {
      await commitLock(workspace)
      const on = await traceOf(workspace)

      // not vacuous: this plugin contributes in every way that leaves a trace
      expect(on.state).toBe('active')
      expect(on.running).toBe(true)
      expect(on.apiGroups.length).toBeGreaterThan(0)
      expect(on.surfaces.length).toBeGreaterThan(0)
      expect(on.browser).toContain(on.surfaces[0]!.split(':').pop()!)

      workspace.writeManifest(SELECTION, { disabled: [SUBJECT], linked: KIT })
      await commitLock(workspace)
      const off = await traceOf(workspace)

      expect(off.state).toBe('disabled')
      // 0 layer - and therefore 0 policy contribution, 0 background fiber,
      // 0 boot hook, because all three happen while a layer builds
      expect(off.running).toBe(false)
      // 0 api, 0 browser surface, 0 command
      expect(off.apiGroups).toEqual([])
      expect(off.surfaces).toEqual([])
      expect(off.commands).toEqual([])
      // 0 bytes in the browser aggregate, which is what a build is made from
      for (const surface of on.surfaces) {
        expect(off.browser).not.toContain(surface.split(':').pop()!)
      }
      // and its data is untouched: the lock still names it, which is what
      // keeps the schema aggregate and the baseline reading it
      expect(Object.keys(off.lock?.plugins ?? {})).toContain(SUBJECT)
    } finally {
      workspace.dispose()
    }
  }, 120_000)

  it('is kept in the lock when it is removed, because a capability holds its tables', async () => {
    const workspace = createWorkspace(SELECTION, { linked: KIT })
    try {
      await commitLock(workspace)
      workspace.writeManifest(
        SELECTION.filter((id) => id !== SUBJECT),
        { linked: KIT },
      )
      await commitLock(workspace)
      const gone = await traceOf(workspace)

      // removal is a selection verb, and a table is not a selection
      expect(gone.state).toBe('detached')
      expect(gone.lock?.plugins[SUBJECT]?.retainedBy).toEqual(['database'])
      expect(gone.running).toBe(false)
      expect(gone.apiGroups).toEqual([])
      expect(gone.surfaces).toEqual([])
      expect(gone.browser).not.toContain('org/page')
    } finally {
      workspace.dispose()
    }
  }, 120_000)
})

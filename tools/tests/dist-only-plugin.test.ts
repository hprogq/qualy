import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { createWorkspace } from '@qualy/assembly/testkit'
import { resolveAssembly } from '@qualy/assembly'
import { loadAssembly } from '@qualy/assembly/runtime'
import { buildPluginModuleSource, collectWebPlugins } from '@qualy/web-build/collect'
import { surfaceLabel } from '@qualy/ui-contract'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'

// A third party's plugin, as a third party actually ships one: a package.json
// and a dist/, with no sources at all.
//
// This is the acceptance for the module reference. It used to name a file
// under the plugin's own `src/`, extension included, so the only plugin this
// product could build was one whose sources were on disk in this
// repository's shape - which is not what anybody publishes. A reference is an
// export subpath now, and the package's exports map says what stands behind
// it, so the build tool no longer knows what `src`, `dist`, `.tsx` or `.js`
// are.
//
// Nothing here may reach into the fixture's sources, because it has none.

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/acme-dist-probe')
const PROBE = '@acme/qualy-dist-probe'
const NEEDED = ['@qualy/plugin-database', '@qualy/plugin-ui-registry']
const KIT = ['@qualy/plugin-kit', '@qualy/ui-contract']

const workspace = () =>
  createWorkspace([...NEEDED, PROBE], {
    linked: KIT,
    external: { [PROBE]: FIXTURE },
  })

describe('a plugin published the ordinary way, with no sources', () => {
  it('ships nothing but a manifest and a dist', () => {
    // the fixture is the claim; a stray source file would make every case
    // below prove something weaker than it says
    const files = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const at = path.join(dir, entry.name)
        return entry.isDirectory() ? files(at) : [path.relative(FIXTURE, at)]
      })
    const shipped = files(FIXTURE).sort()
    expect(shipped).toEqual([
      'dist/client/ProbePage.js',
      'dist/client/boot.js',
      'dist/client/i18n.js',
      'dist/index.js',
      'package.json',
    ])
  })

  it('resolves, and the descriptor the host loads is the one in dist', async () => {
    const at = workspace()
    try {
      const resolution = await resolveAssembly({ manifestPath: at.manifestPath })
      expect([...resolution.plugins.keys()]).toContain(PROBE)
      // the runtime loader orders descriptors the way a booting server does,
      // which is the other half of "the host can actually load this package".
      // The host descriptor is the one apps/server contributes: the api
      // aggregate's owner, without which nothing that serves an api assembles.
      const host = Plugin.define('@qualy/test-host', Api.provider({}), Api.routesProvider)
      // it assembles at all, which is the claim: every point this package
      // contributes to has a provider, and its layers fold into the graph
      expect(() => loadAssembly(resolution, { host: [host] })).not.toThrow()
      // and the descriptor the resolution imported is the one in dist
      expect(resolution.descriptors.get(PROBE)?.id).toBe(PROBE)
    } finally {
      at.dispose()
    }
  })

  it('is collected into the browser aggregate, every module out of dist', async () => {
    const at = workspace()
    try {
      const collected = await collectWebPlugins({ ymlPath: at.manifestPath })
      const probe = collected.find((entry) => entry.name === PROBE)
      expect(probe, 'the browser build did not see it').toBeDefined()
      expect(probe!.surfaces.map((binding) => surfaceLabel(binding.surface))).toEqual([
        'page:acme/probe',
      ])
      expect(probe!.hasCatalogs).toBe(true)
      expect(probe!.browserModules).toHaveLength(1)
      // where each one resolved: through the package's exports, into dist,
      // and never into a src/ that does not exist
      const resolved = [
        ...probe!.surfaces.map((binding) => binding.file),
        probe!.i18nModule!,
        ...probe!.browserModules,
      ]
      for (const file of resolved) {
        expect(file).toContain(`${path.sep}dist${path.sep}`)
        expect(file).not.toContain(`${path.sep}src${path.sep}`)
        expect(fs.existsSync(file), file).toBe(true)
      }
    } finally {
      at.dispose()
    }
  })

  it('builds for production, and its page is a chunk of its own', async () => {
    const at = workspace()
    // realpath, because the aggregate's imports are relative to where it is
    // written and macOS hands out a symlinked temporary directory
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-dist-probe-')))
    try {
      // the aggregate exactly as the shell gets it, written where the shell
      // writes it, so the imports it carries are resolved the same way
      const aggregate = path.join(root, 'plugins.js')
      fs.writeFileSync(
        aggregate,
        await buildPluginModuleSource({ ymlPath: at.manifestPath, fromDir: root }),
      )
      fs.writeFileSync(
        path.join(root, 'main.js'),
        // the shell's own two uses of the aggregate: run every browser half,
        // then resolve a surface by the address the manifest names
        `import { browserPlugins, pageComponents } from './plugins.js'\n` +
          `for (const plugin of browserPlugins) plugin.setup?.({ release: { releaseId: 'r_x', clientProtocol: 2 } })\n` +
          `const load = pageComponents['acme/probe']\n` +
          `document.title = String(load)\n` +
          `void load().then((module) => { document.body.textContent = module.default() })\n`,
      )
      fs.writeFileSync(
        path.join(root, 'index.html'),
        '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>',
      )
      await build({
        root,
        configFile: false,
        envFile: false,
        logLevel: 'silent',
        build: { outDir: 'dist', emptyOutDir: true },
      })
      const assets = path.join(root, 'dist/assets')
      const chunks = fs.readdirSync(assets).filter((name) => name.endsWith('.js'))
      const sources = chunks.map((name) => fs.readFileSync(path.join(assets, name), 'utf8'))
      // the page's own code is in the build, in a chunk of its own - the
      // dynamic import the aggregate carries is a real split point
      const page = chunks.filter((name) => name.startsWith('ProbePage-'))
      expect(page, chunks.join(', ')).toHaveLength(1)
      expect(sources.join('\n')).toContain('acme-dist-probe-page-8f21c6')
      // and the browser half the descriptor declared is in the entry, where
      // the host runs it: a value now, so it is there because something uses
      // it rather than because an import had a side effect
      expect(sources.join('\n')).toContain('acme-dist-probe-boot-4d90ab')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      at.dispose()
    }
  }, 60_000)
})

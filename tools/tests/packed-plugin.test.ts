import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { resolveAssembly, lockPathFor, readLock } from '@qualy/assembly'
import { loadAssembly } from '@qualy/assembly/runtime'
import { buildPluginModuleSource, collectWebPlugins } from '@qualy/web-build/collect'
import { createPackageResolver } from '../../packages/core/assembly/src/metadata.ts'

// One plugin, one chain, from a tarball a package manager made.
//
// The other third-party tests each prove a link: the dist-only suite proves a
// package with no sources resolves and builds, the browser fixture proves a
// stranger can write a component test, the CLI suite proves add and remove.
// Each of them, though, puts the package where it needs it - a symlink, a
// path in a temporary manifest - and a symlink is not an install. What that
// never asks is whether the thing a registry would actually hand somebody
// works, and the first run of this test answered no: `pnpm pack` produced a
// tarball with the manifest, the licence and NOTHING ELSE, because this
// repository's .gitignore hides `dist/` and npm reads it when a package
// declares no `files`. The fixture had been proving a claim about a package
// that could not exist.
//
// So the install here is real: pack, declare, install, and then ask the
// assembly the same questions it asks of any plugin. No network - the tarball
// is a local file and the peers are linked the way a workspace links them.
//
// What this does not cover is the browser half, which needs a bundler and a
// page; `tools/fixtures/acme-browser-probe` owns that, with its own package.

const repoRoot = path.resolve(import.meta.dirname, '../..')
const FIXTURE = path.join(repoRoot, 'tools/fixtures/acme-dist-probe')
const PROBE = '@acme/qualy-dist-probe'
const CLI = path.join(repoRoot, 'apps/cli/src/main.ts')
/** what the probe's descriptor needs to resolve, as a host installs them */
const PEERS = [
  '@qualy/plugin-kit',
  '@qualy/plugin-ui-registry',
  '@qualy/ui-contract',
  '@qualy/plugin-database',
]

const pnpm = (args: readonly string[], cwd: string) =>
  execFileSync('pnpm', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

const qualy = (args: readonly string[], manifestPath: string) =>
  execFileSync('node', [CLI, ...args, '--yml', manifestPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  })

/** a deployment that installed one published plugin and nothing else of ours */
const installed = () => {
  // realpath because macOS puts the temporary directory behind a symlink, and
  // a bundler resolving a relative import through one lands somewhere else
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-packed-')))
  const tarball = pnpm(['pack', '--pack-destination', dir], FIXTURE).trim().split('\n').pop()!

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'packed-probe-host',
        version: '0.0.0',
        private: true,
        dependencies: { [PROBE]: `file:${path.basename(tarball)}` },
      },
      null,
      2,
    )}\n`,
  )
  // its own workspace root, so nothing of this repository's configuration
  // reaches it - and peers off, because the ones this plugin declares are
  // private packages no registry has
  fs.writeFileSync(
    path.join(dir, 'pnpm-workspace.yaml'),
    'packages: []\nautoInstallPeers: false\nstrictPeerDependencies: false\n',
  )
  pnpm(['install'], dir)

  // the peers, linked the way a product has them on disk: from this
  // repository's root, which is the development product package
  const host = createPackageResolver(repoRoot)
  for (const id of PEERS) {
    const at = path.join(dir, 'node_modules', ...id.split('/'))
    fs.mkdirSync(path.dirname(at), { recursive: true })
    if (!fs.existsSync(at)) fs.symlinkSync(host.resolvePackageDir(id), at, 'dir')
  }

  // the manifest sits in the package that installed the plugin, which is
  // the whole of what a product layout is
  const manifestPath = path.join(dir, 'qualy.yml')
  fs.writeFileSync(
    manifestPath,
    [
      'version: 3',
      '',
      'plugins:',
      "  '@qualy/plugin-database': {}",
      "  '@qualy/plugin-ui-registry': {}",
      '',
    ].join('\n'),
  )
  return { dir, manifestPath, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('a plugin installed the way a registry would hand it over', () => {
  it('is packed with what it needs to be a plugin at all', () => {
    const at = installed()
    try {
      const inside = path.join(at.dir, 'node_modules', ...PROBE.split('/'))
      // resolved through the install, not through the fixture directory: the
      // package.json here is the one the tarball carried
      const where = createPackageResolver(at.dir).resolvePackageDir(PROBE)
      expect(fs.realpathSync(where).startsWith(fs.realpathSync(at.dir))).toBe(true)
      expect(fs.existsSync(path.join(inside, 'dist/index.js'))).toBe(true)
      expect(fs.existsSync(path.join(inside, 'src'))).toBe(false)
    } finally {
      at.dispose()
    }
  }, 120_000)

  it('is added, resolved, assembled and built from where it was installed', async () => {
    const at = installed()
    try {
      const added = qualy(['plugin', 'add', PROBE], at.manifestPath)
      expect(added).toContain(`${PROBE} is active`)

      const resolution = await resolveAssembly({
        manifestPath: at.manifestPath,
        previousLock: readLock(lockPathFor(at.manifestPath)),
      })
      expect(resolution.descriptors.get(PROBE)?.id).toBe(PROBE)

      // it assembles: every point it contributes to has a provider
      const host = Plugin.define('@qualy/test-host', Api.provider({}), Api.routesProvider)
      expect(() => loadAssembly(resolution, { host: [host] })).not.toThrow()

      // and the browser build reaches its modules inside the install
      const collected = await collectWebPlugins({ ymlPath: at.manifestPath })
      const probe = collected.find((entry) => entry.name === PROBE)!
      expect(probe.surfaces.length).toBeGreaterThan(0)
      for (const binding of probe.surfaces) {
        expect(fs.realpathSync(binding.file).startsWith(fs.realpathSync(at.dir))).toBe(true)
        expect(binding.file).toContain(`${path.sep}dist${path.sep}`)
      }

      // a real bundle of it, out of the tarball's own compiled output
      fs.writeFileSync(
        path.join(at.dir, 'plugins.js'),
        await buildPluginModuleSource({ ymlPath: at.manifestPath, fromDir: at.dir }),
      )
      fs.writeFileSync(
        path.join(at.dir, 'main.js'),
        `import { browserPlugins, pageComponents } from './plugins.js'\n` +
          `for (const plugin of browserPlugins) plugin.setup?.({ release: { releaseId: 'r_x', clientProtocol: 2 } })\n` +
          `void pageComponents['acme/probe']().then((module) => { document.body.textContent = module.default() })\n`,
      )
      fs.writeFileSync(
        path.join(at.dir, 'index.html'),
        '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>',
      )
      await build({
        root: at.dir,
        configFile: false,
        envFile: false,
        logLevel: 'silent',
        build: { outDir: 'out', emptyOutDir: true },
      })
      const bundled = fs
        .readdirSync(path.join(at.dir, 'out/assets'))
        .filter((name) => name.endsWith('.js'))
        .map((file) => fs.readFileSync(path.join(at.dir, 'out/assets', file), 'utf8'))
        .join('\n')
      expect(bundled).toContain('acme-dist-probe-page-8f21c6')
      expect(bundled).toContain('acme-dist-probe-boot-4d90ab')

      // and it comes off again without taking anything with it
      const removed = qualy(['plugin', 'remove', PROBE], at.manifestPath)
      expect(removed).toContain('nothing of it was deleted')
      expect(readLock(lockPathFor(at.manifestPath))?.plugins[PROBE]).toBeUndefined()
    } finally {
      at.dispose()
    }
  }, 300_000)
})

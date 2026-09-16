import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import {
  createPackageResolver,
  lockPathFor,
  readLock,
  readManifest,
  resolveAssembly,
} from '@qualy/assembly'
import { loadAssembly } from '@qualy/assembly/runtime'
import { collectWebPlugins } from '@qualy/web-build/collect'

// The product package, alone in a room.
//
// The repository root declares the plugins the product installs, and every
// tool resolves them from there. In this repository that proves less than it
// looks like: pnpm hoists every workspace package into the root node_modules,
// so a plugin the root forgot to declare still resolves, and the omission
// shows up only in a deployment that installed exactly what was declared.
//
// So this builds that deployment: a directory holding a copy of the product's
// manifest, a package.json naming what the root's names, and a node_modules
// linking those packages and NOTHING else. The three questions every tool
// asks of an assembly - resolve it, compose it, collect its browser half -
// have to be answerable from that directory. A plugin missing from the root's
// dependencies is missing here too, and this is where it says so.
//
// The resolver is not what is being tested and is not made stricter to make
// this pass: ancestor node_modules resolution is ordinary Node, and the
// temporary directory simply has no ancestor with anything in it.

const repoRoot = path.resolve(import.meta.dirname, '../..')
const manifestFile = path.join(repoRoot, 'qualy.yml')

const declaredProduct = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-product-')))
  const product = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const declared = Object.keys(product.dependencies ?? {})
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'qualy-product-clean-room',
        version: '0.0.0',
        private: true,
        dependencies: Object.fromEntries(declared.map((id) => [id, '*'])),
      },
      null,
      2,
    )}\n`,
  )
  // linked from where pnpm put them, so each package still resolves its own
  // dependencies from its real location - exactly as an install would
  const source = createPackageResolver(repoRoot)
  for (const id of declared) {
    const at = path.join(dir, 'node_modules', ...id.split('/'))
    fs.mkdirSync(path.dirname(at), { recursive: true })
    let target: string
    try {
      target = source.resolvePackageDir(id)
    } catch {
      // a dependency that is not a plugin package (tsx) has no package.json
      // export to resolve through; it is not what this room is about
      continue
    }
    fs.symlinkSync(target, at, 'dir')
  }
  fs.copyFileSync(manifestFile, path.join(dir, 'qualy.yml'))
  return {
    dir,
    manifestPath: path.join(dir, 'qualy.yml'),
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

describe('the product package declares enough to stand alone', () => {
  it('resolves, composes and collects from a directory installing only what it declares', async () => {
    const room = declaredProduct()
    try {
      // with the product's own lock, so what the lock still keeps - a
      // detached plugin, and the provider keeping it - has to be installed too
      const resolution = await resolveAssembly({
        manifestPath: room.manifestPath,
        previousLock: readLock(lockPathFor(manifestFile)),
      })
      const manifest = readManifest(manifestFile)
      expect([...resolution.plugins.keys()].filter((id) => manifest.plugins.has(id)).sort()).toEqual(
        [...manifest.plugins.keys()].sort(),
      )
      // every package resolved from inside the room, not from this repository
      for (const id of resolution.plugins.keys()) {
        expect(
          fs.existsSync(path.join(room.dir, 'node_modules', ...id.split('/'))),
          `${id} is not installed in the product package`,
        ).toBe(true)
      }

      // it composes: every point a plugin contributes to has a provider,
      // with the same host descriptor the server adds
      const host = Plugin.define('@qualy/test-host', Api.provider({}), Api.routesProvider)
      expect(() => loadAssembly(resolution, { host: [host] })).not.toThrow()

      // and the browser build collects the same plugins from the room as it
      // does from this repository - only those with a browser half, which is
      // the collector's own rule and not this room's - finding every module
      // where the room installed it
      const collected = await collectWebPlugins({ ymlPath: room.manifestPath })
      const fromRepository = await collectWebPlugins({ ymlPath: manifestFile })
      expect(collected.map((entry) => entry.name).sort()).toEqual(
        fromRepository.map((entry) => entry.name).sort(),
      )
      expect(collected.length).toBeGreaterThan(5)
      for (const entry of collected) {
        for (const binding of entry.surfaces) {
          expect(fs.existsSync(binding.file), `${entry.name} ${binding.module}`).toBe(true)
        }
      }
    } finally {
      room.dispose()
    }
  }, 120_000)
})

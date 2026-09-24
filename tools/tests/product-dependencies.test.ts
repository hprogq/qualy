import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWorkspace, resolveWorkspace } from '@qualy/assembly/testkit'

// The package holding qualy.yml installs its plugins - that is what makes it
// the product - and resolution holds it to that rather than trusting it.
//
// Node's resolution would happily find a plugin an ancestor directory
// installed, or one this package lists for development only; a production
// install of this package (`pnpm install --prod`, which is how the image is
// built) links neither. This repository's root declares everything, and the
// clean-room test proves that for this product; this proves the rule holds
// for any product, by refusing the two ways a plugin can resolve here without
// the product having installed it.

const INFRA = ['@qualy/plugin-database', '@qualy/plugin-ui-registry']

const rewriteDependencies = (
  dir: string,
  edit: (dependencies: Record<string, string>) => {
    dependencies: Record<string, string>
    devDependencies?: Record<string, string>
  },
) => {
  const file = path.join(dir, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const next = edit({ ...manifest.dependencies })
  fs.writeFileSync(file, `${JSON.stringify({ ...manifest, ...next }, null, 2)}\n`)
}

describe('what the product package installs', () => {
  it('is every plugin the manifest selects, as a dependency', async () => {
    const workspace = createWorkspace(INFRA)
    try {
      await expect(resolveWorkspace(workspace)).resolves.toBeDefined()

      // resolvable, still linked in node_modules, but the product does not
      // say it depends on it: a production install would not link it
      rewriteDependencies(workspace.dir, (dependencies) => {
        delete dependencies['@qualy/plugin-ui-registry']
        return { dependencies }
      })
      await expect(resolveWorkspace(workspace)).rejects.toThrow(
        /selects plugins that .*package\.json does not install:\n {2}@qualy\/plugin-ui-registry is not in dependencies; `pnpm add @qualy\/plugin-ui-registry`/,
      )

      // listed for development only is the same absence with a different hint
      rewriteDependencies(workspace.dir, (dependencies) => {
        delete dependencies['@qualy/plugin-ui-registry']
        return { dependencies, devDependencies: { '@qualy/plugin-ui-registry': '*' } }
      })
      await expect(resolveWorkspace(workspace)).rejects.toThrow(
        /@qualy\/plugin-ui-registry is only in devDependencies; a production install links dependencies alone/,
      )
    } finally {
      workspace.dispose()
    }
  })
})

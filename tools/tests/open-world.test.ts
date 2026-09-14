import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'
import { createWorkspace } from '@qualy/assembly/testkit'
import { collectWebPlugins } from '@qualy/web-build/collect'
import { resolveAssembly } from '@qualy/assembly'
import { surfaceLabel } from '@qualy/ui-contract'

// A plugin is a package whose default export is a descriptor calling itself
// by that package's name. Nothing about the scope it is published under is
// part of that, and this is where it stops being.
//
// It was: three places skipped anything outside `@qualy/`, so a third party's
// plugin could be installed, resolved and selected, and then be silently
// missing from the browser build, the permission catalog and the localisation
// gate. `@qualy/plugin-*` is this repository's convention for its own
// packages, which is a different thing from a definition.
//
// The probe here is written the way a third party writes one: another scope,
// its own package.json and exports, a descriptor built with the published
// kit, and a client component, a catalog and a browser module beside it. It
// is installed into the workspace rather than into this repository, and no
// file of the host is edited to make any of it work.

const repoRoot = path.resolve(import.meta.dirname, '../..')

const KIT = ['@qualy/plugin-kit', '@qualy/ui-contract']
const NEEDED = ['@qualy/plugin-database', '@qualy/plugin-ui-registry']

const descriptor = (id: string, surfaceId: string, path: string) => `
import { Plugin } from '@qualy/plugin-kit'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { APP_SHELL, PUBLIC } from '@qualy/ui-contract'

export default Plugin.define(
  ${JSON.stringify(id)},
  { dependsOn: ['@qualy/plugin-ui-registry'] },
  Ui.page({
    id: ${JSON.stringify(surfaceId)},
    path: ${JSON.stringify(path)},
    component: Ui.react('./client/ProbePage'),
    layout: APP_SHELL,
    visibility: PUBLIC,
  }),
  Ui.i18n('./client/i18n'),
  Ui.browser('./client/boot'),
)
`

const files = (namespace: string) => ({
  'index.js': '',
  'src/client/ProbePage.jsx': 'export default function ProbePage() {\n  return null\n}\n',
  'src/client/i18n.js': `export const catalogs = {
  namespace: ${JSON.stringify(namespace)},
  messages: [{ id: ${JSON.stringify(`${namespace}/probe/title`)}, defaultMessage: 'Probe' }],
  locales: {},
}
`,
  'src/client/boot.js': 'export {}\n',
})

const probe = (options: { id: string; surface: string; path: string; namespace: string }) => ({
  id: options.id,
  // the package says where its modules are, which is the whole point: the
  // build asks the exports map and never guesses at src/ or an extension
  exports: {
    './plugin': './index.js',
    './client/ProbePage': './src/client/ProbePage.jsx',
    './client/i18n': './src/client/i18n.js',
    './client/boot': './src/client/boot.js',
  },
  files: {
    ...files(options.namespace),
    'index.js': descriptor(options.id, options.surface, options.path),
  },
})

const workspaceWith = (...synthetic: ReturnType<typeof probe>[]) =>
  createWorkspace([...NEEDED, ...synthetic.map((entry) => entry.id)], {
    linked: KIT,
    synthetic,
  })

describe('what counts as a plugin', () => {
  it('is never the scope it is published under, anywhere in the toolchain', () => {
    // three places read `@qualy/` as the definition of a plugin. Written down
    // here because the next one would be just as quiet as those were: a
    // third-party plugin that resolves and is selected, and then is simply
    // absent from whatever this filter guarded.
    const offenders: string[] = []
    for (const root of ['packages', 'apps', 'tools']) {
      for (const file of walkSources(path.join(repoRoot, root))) {
        // A suite may name the scope: `plugin-isolation` asks questions ABOUT
        // this repository's own packages, which is the opposite of deciding
        // what counts as a plugin. What may not is anything that discovers.
        if (/[\\/]tests[\\/]/.test(file)) continue
        const source = fs.readFileSync(file, 'utf8').replaceAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
        if (/startsWith\(\s*[`'"]@qualy\//.test(source)) {
          offenders.push(path.relative(repoRoot, file))
        }
      }
    }
    // plugin:add scaffolds a package INTO this repository's own tree, where
    // the naming convention is this repository's; it names no third party and
    // discovers nothing. Phase H's `qualy plugin add` is the open-world one.
    expect(offenders).toEqual(['tools/repo/plugin-add.ts'])
  })
})

describe('a plugin published under somebody else’s scope', () => {
  it('resolves, and brings its surfaces, catalog and browser module with it', async () => {
    const workspace = workspaceWith(
      probe({
        id: '@acme/qualy-probe',
        surface: 'acme/probe',
        path: '/acme/probe',
        namespace: 'acme',
      }),
    )
    try {
      const resolution = await resolveAssembly({ manifestPath: workspace.manifestPath })
      expect([...resolution.plugins.keys()]).toContain('@acme/qualy-probe')

      const collected = await collectWebPlugins({ ymlPath: workspace.manifestPath })
      const acme = collected.find((entry) => entry.name === '@acme/qualy-probe')
      expect(acme, 'the browser build did not see it').toBeDefined()
      expect(acme!.surfaces.map((binding) => surfaceLabel(binding.surface))).toEqual([
        'page:acme/probe',
      ])
      expect(acme!.hasCatalogs).toBe(true)
      expect(acme!.browserModules).toHaveLength(1)
      // and the aggregate really imports it, by the surface the manifest names
      expect(acme!.surfaces[0]!.file).toContain('ProbePage.jsx')
    } finally {
      workspace.dispose()
    }
  })

  it('collides with anybody, under any scope, and says whose it was', async () => {
    // two strangers claiming one page id: the browser registry would keep
    // whichever import came second, so the build refuses instead
    const workspace = workspaceWith(
      probe({ id: '@acme/qualy-probe', surface: 'acme/probe', path: '/a', namespace: 'acme' }),
      probe({ id: '@globex/plugin', surface: 'acme/probe', path: '/b', namespace: 'globex' }),
    )
    try {
      await expect(collectWebPlugins({ ymlPath: workspace.manifestPath })).rejects.toThrow(
        /surface conflict: page:acme\/probe/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a package whose descriptor calls itself something else', async () => {
    const workspace = workspaceWith({
      id: '@acme/qualy-probe',
      exports: {
        './plugin': './index.js',
        './client/ProbePage': './src/client/ProbePage.jsx',
        './client/i18n': './src/client/i18n.js',
        './client/boot': './src/client/boot.js',
      },
      files: {
        ...files('acme'),
        // a copied-and-renamed package, which resolution has to catch: every
        // registry downstream is keyed by the package id
        'index.js': descriptor('@acme/somebody-else', 'acme/probe', '/acme/probe'),
      },
    })
    try {
      await expect(resolveAssembly({ manifestPath: workspace.manifestPath })).rejects.toThrow(
        '@acme/somebody-else',
      )
    } finally {
      workspace.dispose()
    }
  })
})

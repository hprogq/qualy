import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'

// A plugin must typecheck on its own, not merely in company.
//
// Services reach a plugin as `ctx.<name>`, typed by the owning plugin's
// `declare module 'cordis'`. That augmentation arrives only if something in
// the file's own program pulls it in, and the root tsconfig compiles every
// package together, so a plugin that never imports its peer still typechecks
// here while having no type for the call at all.
//
// It was not hypothetical: org called `ctx.auth.iam.usersBlockingOrgType`
// without importing @qualy/plugin-auth anywhere, and ping and auth-local had
// the same hole. Nothing failed, because nothing ever compiled them alone.
//
// This matters beyond tidiness. The Effect migration turns these calls into
// service tags, which are values rather than ambient types, and a call whose
// type exists only by accident cannot be ported faithfully.

const repoRoot = path.resolve(import.meta.dirname, '../..')
// One probe per plugin, not one reused file. These cases run concurrently, and
// a shared probe would have each tsc compiling whichever plugin wrote last -
// which still passes, because every plugin does compile alone, so the file
// would go green while checking the wrong things.
const probeFor = (dir: string) =>
  path.join(repoRoot, `tsconfig.probe.${dir.replaceAll('/', '-')}.json`)

const pluginDirs = fs
  .readdirSync(path.join(repoRoot, 'packages/plugins'))
  .flatMap((group) => {
    const groupDir = path.join(repoRoot, 'packages/plugins', group)
    if (!fs.statSync(groupDir).isDirectory()) return []
    return fs.readdirSync(groupDir).map((name) => path.join('packages/plugins', group, name))
  })
  .filter((dir) => fs.existsSync(path.join(repoRoot, dir, 'src')))

afterAll(() => {
  for (const dir of pluginDirs) fs.rmSync(probeFor(dir), { force: true })
})

// Each probe keeps its own build info, so a second run rechecks what changed
// instead of the whole program: ten plugins cost 6.5s cold and half a second
// warm. It lives under node_modules, which is already nobody's to commit and
// goes away with the install it belongs to.
const buildInfoFor = (dir: string) =>
  path.join('node_modules/.cache/qualy-isolation', `${dir.replaceAll('/', '-')}.tsbuildinfo`)

const typecheckAlone = (dir: string) => {
  const probe = probeFor(dir)
  fs.mkdirSync(path.join(repoRoot, 'node_modules/.cache/qualy-isolation'), { recursive: true })
  fs.writeFileSync(
    probe,
    JSON.stringify({
      extends: './tsconfig.base.json',
      compilerOptions: { noEmit: true, incremental: true, tsBuildInfoFile: buildInfoFor(dir) },
      // the server-side program only: browser code lives in src/client and
      // typechecks under the plugin's own client project, with DOM and jsx
      include: [`${dir}/src/**/*.ts`],
      exclude: [`${dir}/src/client`],
    }),
  )
  try {
    execFileSync('node_modules/.bin/tsc', ['-p', probe, '--noEmit'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return ''
  } catch (error) {
    return (error as { stdout?: string }).stdout ?? String(error)
  }
}

/**
 * The platform, and what it is allowed to know about.
 *
 * A plugin is optional by definition, so a platform package that imports one
 * makes it not optional: the browser runtime used to import the reporting
 * plugin in order to report a component failure, which meant a deployment
 * reporting nowhere still carried it, and a product assembled without that
 * plugin could not have been built at all.
 *
 * Three things are not that. `@qualy/plugin-kit` is the kit a plugin is
 * WRITTEN with and belongs to the platform whatever its name says; a
 * capability facade (`@qualy/plugin-x/plugin`) is how a contributor declares a
 * contribution, and §79 of the refactor keeps it allowed until those move to
 * their contract packages; and the two edges below are what is left.
 */
const PLATFORM = ['packages/web', 'packages/core', 'packages/contracts']
const PLUGIN_KIT = /^@qualy\/plugin-kit(\/|$)/
const CAPABILITY_FACADE = /^@qualy\/plugin-[a-z-]+\/plugin$/

/**
 * What still crosses, named one edge at a time.
 *
 * A package-level exemption would have been a hole rather than a record: it
 * would let any platform file import any subpath of that plugin, and the
 * list would still read as one exception. An edge is a file and a specifier,
 * so removing it in Phase F is removing exactly these, and a new edge to the
 * same plugin is a failure like any other.
 */
const REMAINING_IMPORTS = [
  {
    importer: 'packages/web/runtime/src/index.tsx',
    specifier: '@qualy/plugin-ui-registry/api',
    // the shell manifest's own contract, which the runtime consumes and this
    // plugin happens to hold; Phase F moves it to @qualy/app-contract
    why: 'the app manifest contract has not moved out of the plugin yet',
  },
] as const

const REMAINING_DEPENDENCIES = [
  {
    manifest: 'packages/web/runtime/package.json',
    dependency: '@qualy/plugin-ui-registry',
    why: 'the same edge, declared',
  },
] as const

const allowedImport = (importer: string, specifier: string) =>
  REMAINING_IMPORTS.some((edge) => edge.importer === importer && edge.specifier === specifier)

const allowedDependency = (manifest: string, dependency: string) =>
  REMAINING_DEPENDENCIES.some(
    (edge) => edge.manifest === manifest && edge.dependency === dependency,
  )

/**
 * Every module specifier a file names.
 *
 * A regex rather than a syntax tree because there is no longer a syntax tree
 * to be had: TypeScript 7 is a native executable and ships no `createProgram`,
 * which is why the component checker next door writes a file and runs `tsc`
 * over it instead. So this covers the four forms that exist - `from`, a
 * side-effect import, `export ... from`, and a dynamic `import()` - in either
 * quote, and a fifth form arriving is the thing to watch for.
 */
const importsOf = (source: string): string[] =>
  [
    ...source.matchAll(
      /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g,
    ),
  ]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((specifier) => specifier !== '')

const relative = (file: string) => path.relative(repoRoot, file).split(path.sep).join('/')

describe('the platform depends on no plugin implementation', () => {
  it('imports none, in any browser, core or contract package', () => {
    const offenders: string[] = []
    for (const root of PLATFORM) {
      for (const file of walkSources(path.join(repoRoot, root))) {
        if (/[\\/]tests[\\/]/.test(file)) continue
        for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
          if (!specifier.startsWith('@qualy/plugin-')) continue
          if (PLUGIN_KIT.test(specifier) || CAPABILITY_FACADE.test(specifier)) continue
          if (allowedImport(relative(file), specifier)) continue
          offenders.push(`${relative(file)} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares none, in any browser, core or contract package manifest', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue
        const at = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(at)
          continue
        }
        if (entry.name !== 'package.json') continue
        const manifest = JSON.parse(fs.readFileSync(at, 'utf8')) as {
          dependencies?: Record<string, string>
        }
        for (const name of Object.keys(manifest.dependencies ?? {})) {
          if (!name.startsWith('@qualy/plugin-')) continue
          if (PLUGIN_KIT.test(name) || allowedDependency(relative(at), name)) continue
          offenders.push(`${relative(at)} depends on ${name}`)
        }
      }
    }
    for (const root of PLATFORM) walk(path.join(repoRoot, root))
    expect(offenders).toEqual([])
  })

  it('names every edge that is left, so the list shrinks on purpose', () => {
    // two entries today, one edge stated twice: the import and the manifest
    // line that declares it. Phase F deletes both, and the two cases above
    // become the plain statement they read as.
    expect(REMAINING_IMPORTS.map((edge) => `${edge.importer} -> ${edge.specifier}`)).toEqual([
      'packages/web/runtime/src/index.tsx -> @qualy/plugin-ui-registry/api',
    ])
    expect(REMAINING_DEPENDENCIES.map((edge) => `${edge.manifest} -> ${edge.dependency}`)).toEqual([
      'packages/web/runtime/package.json -> @qualy/plugin-ui-registry',
    ])
  })
})

// concurrent: each case compiles one plugin in its own subprocess, and they
// share nothing but the disk. Run in sequence this file was the whole suite's
// critical path, since vitest parallelises files and not the cases inside one.
describe.concurrent('every plugin typechecks on its own', () => {
  it('found plugins to check', () => {
    expect(pluginDirs.length).toBeGreaterThan(5)
  })

  for (const dir of pluginDirs) {
    it(`${dir.split('/').slice(-1)[0]} needs no other plugin in its program`, () => {
      const output = typecheckAlone(dir)
      // the failure this guards reads as "Property 'auth' does not exist on
      // type 'Context'", so point at the fix rather than only the symptom
      expect(
        output,
        `${dir} does not typecheck alone. A service reached as ctx.<name> needs the owning plugin's module augmentation in this program: add \`import type {} from '@qualy/plugin-<name>'\`.\n${output}`,
      ).toBe('')
    })
  }
})

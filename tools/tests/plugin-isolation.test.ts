import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { lockPathFor, productRootFor, readLock, readManifest } from '@qualy/assembly'
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

const run = promisify(execFile)

// Asynchronous, because the suite below is declared concurrent and a
// synchronous spawn cannot be. A synchronous one holds the thread for the whole
// compile, so the cases never overlapped: they only started their clocks
// together and then queued, and on a two-core runner the ones at the back of
// the queue timed out - including the trivial case that only counts
// directories, which had nothing to wait for but the thread. Vitest bounds
// how many run at once, which is the bound this wants anyway: each `tsc`
// holds a whole program in memory.
const typecheckAlone = async (dir: string) => {
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
    await run('node_modules/.bin/tsc', ['-p', probe, '--noEmit'], {
      cwd: repoRoot,
      encoding: 'utf8',
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
 *
 * `packages/testkit` is held to the same rule for the same reason: a
 * harness that imported one plugin's catalogs would make every test using
 * it a test of an assembly containing that plugin.
 */
const PLATFORM = ['packages/web', 'packages/core', 'packages/contracts', 'packages/testkit']
const PLUGIN_KIT = /^@qualy\/plugin-kit(\/|$)/
const CAPABILITY_FACADE = /^@qualy\/plugin-[a-z-]+\/plugin$/

/**
 * What still crosses: nothing.
 *
 * The list is kept rather than deleted, because its shape is what made the
 * last one shrink - an edge is a file and a specifier, so it can only go by
 * removing exactly that import, and adding one means writing it down beside
 * the work that takes it away. There is none to write.
 */
const REMAINING_IMPORTS: readonly { importer: string; specifier: string; why: string }[] = []

const REMAINING_DEPENDENCIES: readonly {
  manifest: string
  dependency: string
  why: string
}[] = []

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
  it('imports none, in any browser, core, contract or testkit package', () => {
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

  it('declares none, in any browser, core, contract or testkit manifest', () => {
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

  it('has nothing left to name', () => {
    // the two cases above are now the plain statement they always read as
    expect(REMAINING_IMPORTS).toEqual([])
    expect(REMAINING_DEPENDENCIES).toEqual([])
  })
})

/**
 * The composition root, and the plugins it is allowed to name.
 *
 * It named seventeen, because the collector refused to build a plugin's
 * browser half unless apps/web declared it - a second list of what the
 * resolution already knew, kept in step by hand and by an error message.
 * Nothing needed it: the aggregate imports each module by a path the
 * assembly resolver produced, so the shell was never the one resolving them.
 *
 * What is left is named one package at a time, with the phase that removes
 * it, for the same reason the platform's list is: a rule that exempts a
 * category cannot shrink.
 */
const WEB_APP = 'apps/web/package.json'

/**
 * Imported by production source.
 *
 * The kit a plugin is written with, which the shell uses to RUN browser
 * halves rather than to be one of them - the same exemption the platform
 * list makes, for the same reason. No plugin implementation is left.
 */
const WEB_APP_RUNTIME = ['@qualy/plugin-kit']

/**
 * Imported by the browser tests that live here.
 *
 * Nothing. A test in apps/web is about the host - the shell, the cold
 * start, the release protocol, localisation across screens - and a test
 * about one plugin's screens lives in that plugin, with that plugin's
 * catalogs. The host harness is the shared one from `@qualy/testkit`,
 * which knows no plugin either.
 */
const WEB_APP_TESTS: readonly string[] = []

describe('the composition root names no plugin it does not import', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, WEB_APP), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const pluginsIn = (deps: Record<string, string> | undefined) =>
    Object.keys(deps ?? {})
      .filter((name) => name.startsWith('@qualy/plugin-'))
      .sort()

  it('ships with only the plugin its own source still starts', () => {
    expect(pluginsIn(manifest.dependencies)).toEqual(WEB_APP_RUNTIME)
  })

  it('declares for its tests only what those tests import', () => {
    expect(pluginsIn(manifest.devDependencies)).toEqual([...WEB_APP_TESTS].sort())
  })

  it('is not what the collector asks whether a plugin may be built', () => {
    // The check that made the list necessary. A plugin's browser half is
    // found through the assembly - manifest, resolver, package - and asking
    // the shell's dependencies instead made a third-party plugin impossible
    // to build without editing the host.
    const collector = fs
      .readFileSync(path.join(repoRoot, 'packages/build/web/src/collect.ts'), 'utf8')
      // comments may still explain why it does not; code may not do it
      .replaceAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    expect(collector).not.toContain('apps/web')
  })
})

/**
 * Who installs the plugins: the product package, and nobody else.
 *
 * The server used to declare every product plugin as a dependency, which made
 * it the product in all but name - a deployment that wanted a different
 * selection had to edit the server's manifest, and a plugin installed from
 * outside this repository had nowhere to be declared but there. Now the
 * manifest resolves its plugins from the package it sits in, so that package
 * (this repository's root, the development product) declares them and the
 * server is a generic host that names none.
 *
 * Three facts, each its own case: the server declares no plugin from
 * packages/plugins; the product declares at least what its manifest selects
 * and what its lock still keeps - a superset is fine, a plugin installed
 * ahead of being selected is an ordinary state; and the manifest sits inside
 * a package at all.
 */
const SERVER = 'apps/server/package.json'
const PRODUCT = 'package.json'
const MANIFEST = 'qualy.yml'

const pluginPackageNames = pluginDirs.map(
  (dir) =>
    (JSON.parse(fs.readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8')) as { name: string })
      .name,
)

describe('the product package installs the plugins, the server installs none', () => {
  const dependenciesOf = (file: string) =>
    Object.keys(
      (JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8')) as {
        dependencies?: Record<string, string>
      }).dependencies ?? {},
    )

  it('found the plugin packages it is about', () => {
    expect(pluginPackageNames.length).toBeGreaterThan(10)
  })

  it('the server declares no plugin under packages/plugins', () => {
    // the kit a plugin is written with lives under packages/core and is not
    // in this list; everything that is in it is a product decision
    const declared = dependenciesOf(SERVER).filter((name) => pluginPackageNames.includes(name))
    expect(declared).toEqual([])
  })

  it('the product declares every plugin its manifest selects and its lock still keeps', () => {
    const manifest = readManifest(path.join(repoRoot, MANIFEST))
    const lock = readLock(lockPathFor(path.join(repoRoot, MANIFEST)))
    // manifest ids cover active and disabled; the lock adds what left the
    // manifest but is still accounted for, and the plugins providing the
    // capabilities that keep them
    const required = new Set([
      ...manifest.plugins.keys(),
      ...Object.keys(lock?.plugins ?? {}),
      ...Object.values(lock?.capabilities ?? {}).map((capability) => capability.provider),
    ])
    const declared = new Set(dependenciesOf(PRODUCT))
    expect([...required].filter((id) => !declared.has(id)).sort()).toEqual([])
  })

  it('the manifest sits inside the package that installs its plugins', () => {
    expect(productRootFor(path.join(repoRoot, MANIFEST))).toBe(repoRoot)
  })
})

/**
 * What one plugin may reach for in another.
 *
 * A capability is consumed through a surface its owner publishes: the
 * declaration facade (`/plugin`), the contract leaves a plugin exports for
 * its neighbours - an api group, a table closure, a permission catalog - and
 * the service surface of an infrastructure capability. What is refused is
 * everything else: an implementation module of somebody else's plugin, which
 * is a coupling neither package declared and neither can change.
 *
 * Named rather than pattern-matched, for the reason the platform's list is:
 * a rule that exempts `/server` exempts every server module anybody writes,
 * and nobody would notice the next one. `/plugin` is the one pattern, because
 * §79 of the refactor keeps it allowed for every capability until those
 * facades move to their contract packages.
 */
const CAPABILITY_FACADE_ANY = /^@qualy\/plugin-[a-z-]+\/plugin$/

/** the workspace package a specifier names: `@qualy/plugin-x/api` -> `@qualy/plugin-x` */
const packageOf = (specifier: string) => specifier.split('/').slice(0, 2).join('/')

const CROSS_PLUGIN_SURFACES: Readonly<Record<string, string>> = {
  // infrastructure capabilities, consumed through the service surface their
  // owner publishes for exactly that
  '@qualy/plugin-database/server': 'the database capability, as every table owner uses it',
  '@qualy/plugin-database/server/constraints': 'naming a constraint the owner declared',
  '@qualy/plugin-storage/server': 'the storage capability',
  '@qualy/plugin-storage/client': 'the upload registry a provider registers into',
  '@qualy/plugin-storage/backend': 'what a storage provider implements',
  '@qualy/plugin-storage/errors': 'the failures that capability defines',
  '@qualy/plugin-storage/upload': 'the ticket a screen spends',
  '@qualy/plugin-rum/server': 'the reporting capability',
  '@qualy/plugin-rum/client': 'the provider registry a reporting provider registers into',
  '@qualy/plugin-sandbox/service': 'the sandbox capability',
  '@qualy/plugin-ui-registry/server/authorizer':
    'the single authorizer slot rbac fills; the shell fails closed without it',
  '@qualy/plugin-ui-registry/service':
    'the ui capability, and the one contribution a running assembly may make',

  // contract leaves: what a plugin publishes FOR its neighbours
  '@qualy/plugin-auth/api': 'a neighbour api group, which is a contract leaf',
  '@qualy/plugin-rbac/api': 'a neighbour api group',
  '@qualy/plugin-auth/db': 'a table closure, which is the schema graph and not the runtime one',
  '@qualy/plugin-org/db': 'a table closure',
  '@qualy/plugin-rbac/db': 'a table closure',
  '@qualy/plugin-assessment/surfaces': 'the slot tokens assessment publishes',
  '@qualy/plugin-assessment/errors': 'the failures its api declares, which a neighbour api reuses',
}

describe('one plugin reaching into another', () => {
  it('only through a surface its owner publishes', () => {
    const offenders: string[] = []
    for (const dir of pluginDirs) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'),
      ) as { name?: string }
      for (const file of walkSources(path.join(repoRoot, dir, 'src'))) {
        for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
          if (!specifier.startsWith('@qualy/plugin-')) continue
          if (PLUGIN_KIT.test(specifier) || CAPABILITY_FACADE_ANY.test(specifier)) continue
          if (packageOf(specifier) === manifest.name) continue
          if (specifier in CROSS_PLUGIN_SURFACES) continue
          offenders.push(`${relative(file)} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('names the surfaces it allows, so the list cannot grow by accident', () => {
    // Every entry is now a surface its owner publishes for this. The two that
    // were implementation and said so are gone: assessment's api errors moved
    // to a leaf of their own, and the ui capability publishes its service tag
    // rather than having contributors reach into the registry behind it.
    //
    // These two still spell `/server/`, and are the whole of what does. Both
    // are single-slot service surfaces of an infrastructure capability, named
    // where their owner already keeps them; a third appearing means somebody
    // reached past a published surface again.
    expect(Object.keys(CROSS_PLUGIN_SURFACES).filter((one) => one.includes('/server/'))).toEqual([
      '@qualy/plugin-database/server/constraints',
      '@qualy/plugin-ui-registry/server/authorizer',
    ])
  })
})

/**
 * A browser test about one plugin's screens belongs to that plugin.
 *
 * They all lived in apps/web, which made each of them a test of the whole
 * composition wearing a smaller name: the harness took its catalogs from
 * the generated aggregate, so a screen's copy was asserted against every
 * plugin's catalogs at once, and a plugin outside this repository had no
 * way to write one at all.
 *
 * Now the harness is `@qualy/testkit/browser` and takes both as arguments.
 * What these cases hold is the property that makes it usable by a stranger:
 * a test that lives with its plugin may not reach for the aggregate, and
 * may not reach into the host.
 */
describe('a browser test outside the host reaches for neither aggregate nor host', () => {
  const owned = (root: string): string[] => {
    const found: string[] = []
    const stack = [path.join(repoRoot, root)]
    while (stack.length > 0) {
      const dir = stack.pop()!
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue
        const at = path.join(dir, entry.name)
        if (entry.isDirectory()) stack.push(at)
        else if (/\.browser\.test\.tsx$/.test(entry.name) || entry.name === 'screen.tsx') {
          found.push(at)
        }
      }
    }
    return found.sort()
  }
  const files = [...owned('packages/plugins'), ...owned('tools/fixtures')]

  it('found the tests that moved', () => {
    // the cases below say nothing at all if the walk found nothing
    expect(files.length).toBeGreaterThan(20)
  })

  it('names no generated aggregate', () => {
    const offenders = files.filter((file) =>
      importsOf(fs.readFileSync(file, 'utf8')).some((specifier) =>
        specifier.startsWith('virtual:qualy/'),
      ),
    )
    expect(offenders.map(relative)).toEqual([])
  })

  it('points its relative imports at files that exist', () => {
    // a `.css` side-effect import is invisible to the type gate - the vite
    // client types declare every stylesheet as a module - so a path that
    // climbed the wrong number of directories typechecked clean and only
    // failed when the runner tried to serve it
    const offenders: string[] = []
    for (const file of files) {
      for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.')) continue
        if (!fs.existsSync(path.resolve(path.dirname(file), specifier))) {
          offenders.push(`${relative(file)} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('imports nothing from the host', () => {
    // the one thing it does take from apps/web is the stylesheet, which is
    // the product's and belongs to whoever renders a screen
    const offenders: string[] = []
    for (const file of files) {
      for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
        if (!/(^|\/)apps\/web\//.test(specifier)) continue
        if (specifier.endsWith('/apps/web/src/app.css')) continue
        offenders.push(`${relative(file)} imports ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// Two at a time, and the number is the point.
//
// Each case compiles one plugin in its own subprocess, and they share nothing
// but the disk - so they run concurrently, because in sequence this file was
// the whole suite's critical path: vitest parallelises files, not the cases
// inside one. But a whole TypeScript program is not a small unit of work, and
// the runner's default of five of them at once is an amount of parallelism
// this file cannot see the machine to justify. On a two-core runner it is
// oversubscription: measured there, the two largest programs took 30.0s each
// and died on the 30s budget while three more compilers held the cores.
//
// Two, rather than one, because the cost of the bound is wall time and the
// benefit is per-case time. Measured cold, locally: five lanes finish the
// file in 9.2s with the slowest case at 2.5s; two lanes finish in 10.1s with
// the slowest at 1.3s; one lane finishes in 15.9s. Two buys most of the
// headroom for a second of wall.
//
// `vi.setConfig` rather than the root config, because this is the only
// concurrent suite in the repository and a limit chosen for compilers should
// not be waiting for the next suite that has nothing to do with them. It is
// scoped to this file: every file gets its own runtime config.
//
// Measured, not assumed: a case queued behind the bound does not spend its
// timeout waiting. Per-case times FALL as the bound tightens (2.5s -> 1.3s ->
// 0.9s), which they could not do if the clock started at queue time.
vi.setConfig({ maxConcurrency: 2 })

describe.concurrent('every plugin typechecks on its own', () => {
  it('found plugins to check', () => {
    expect(pluginDirs.length).toBeGreaterThan(5)
  })

  for (const dir of pluginDirs) {
    it(`${dir.split('/').slice(-1)[0]} needs no other plugin in its program`, async () => {
      const output = await typecheckAlone(dir)
      // the failure this guards reads as "Property 'auth' does not exist on
      // type 'Context'", so point at the fix rather than only the symptom
      expect(
        output,
        `${dir} does not typecheck alone. A service reached as ctx.<name> needs the owning plugin's module augmentation in this program: add \`import type {} from '@qualy/plugin-<name>'\`.\n${output}`,
      ).toBe('')
    })
  }
})

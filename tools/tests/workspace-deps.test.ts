import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'
import { runtimeClosure, runtimeFilter } from '../release/runtime-closure.ts'

// A package that imports a workspace package has to say so.
//
// pnpm's store makes an undeclared one work anyway: the package is on disk
// because something else in the tree asked for it, so the import resolves and
// nothing complains. It resolves until the day that other thing stops asking,
// and then a package fails to install for a reason that names neither of the
// two packages actually involved.
//
// It also matters ahead of the development supervisor. Deciding which running
// process a saved file belongs to wants a dependency closure to reason over,
// and a closure with holes in it answers wrong - so the manifests have to be
// true before anything is allowed to trust them.

const ROOT = path.resolve(import.meta.dirname, '../..')
const ROOTS = ['packages', 'apps']

interface Manifest {
  readonly name?: string
  readonly exports?: Record<string, unknown>
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

const manifestPaths = (): string[] => {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const at = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(at)
      else if (entry.name === 'package.json') found.push(at)
    }
  }
  for (const root of ROOTS) walk(path.join(ROOT, root))
  return found
}

const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest

/** the workspace package a specifier belongs to: `@qualy/ui/button` -> `@qualy/ui` */
const packageOf = (specifier: string) => specifier.split('/').slice(0, 2).join('/')

const NAMES_A_PACKAGE = /(?:from\s+'(@qualy\/[^']+)'|import\(\s*'(@qualy\/[^']+)')/g

describe('what a package says it depends on', () => {
  it('names every workspace package its own sources import', () => {
    const manifests = manifestPaths().map((file) => ({ file, manifest: read(file) }))
    const workspace = new Set(
      manifests.map(({ manifest }) => manifest.name).filter((name) => name !== undefined),
    )
    const offenders: string[] = []
    for (const { file, manifest } of manifests) {
      if (manifest.name === undefined) continue
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        manifest.name,
      ])
      const dir = path.dirname(file)
      // a nested package owns its own subtree; this one stops where that begins
      const nested = manifests
        .map((other) => path.dirname(other.file))
        .filter((other) => other !== dir && other.startsWith(`${dir}${path.sep}`))
      for (const source of walkSources(dir)) {
        if (nested.some((inner) => source.startsWith(`${inner}${path.sep}`))) continue
        for (const match of fs.readFileSync(source, 'utf8').matchAll(NAMES_A_PACKAGE)) {
          const used = packageOf(match[1] ?? match[2]!)
          if (!workspace.has(used) || declared.has(used)) continue
          offenders.push(`${path.relative(ROOT, source)} imports ${used}, undeclared`)
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([])
  })

  // The image installs with a filter written in the Dockerfile, where no
  // module can be imported; this is what keeps that filter the one the
  // pruner and the gate below ask pnpm with.
  it('installs the image from the closure this gate scans', () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')
    const install =
      /RUN pnpm install --frozen-lockfile --ignore-scripts --prod\s*\\?\s*([^&]+?)\s*\\?\s*&&/.exec(
        dockerfile,
      )?.[1]
    expect(install, 'the runtime stage installs production dependencies').toBeDefined()
    const filters = [...install!.matchAll(/--filter-prod\s+'([^']+)'/g)].flatMap((match) => [
      '--filter-prod',
      match[1]!,
    ])
    expect(filters).toEqual(runtimeFilter())
  })

  // Each sandbox image installs one app's production closure and prunes to
  // it; the install filter in the Dockerfile and the app the pruner is told
  // about are two spellings of one name, kept equal here.
  it('installs and prunes each sandbox image from the one app it names', () => {
    for (const dockerfile of [
      'apps/sandbox-runtime/Dockerfile',
      'apps/sandbox-authoring/Dockerfile',
    ]) {
      const text = fs.readFileSync(path.join(ROOT, dockerfile), 'utf8')
      const installed = /--filter-prod\s+'?(@qualy\/[a-z-]+)\.\.\.'?/.exec(text)?.[1]
      const pruned = /prune-image-tree\.mjs\s+(@qualy\/[a-z-]+)/.exec(text)?.[1]
      expect(installed, `${dockerfile} installs one app's closure`).toBeDefined()
      expect(pruned, `${dockerfile} prunes to one app's closure`).toBe(installed)
    }
  })

  // The release image installs the runtime closure with production
  // dependencies only, and node resolves a workspace package's imports from
  // its own node_modules. So an import a package needs at runtime but declares
  // for development resolves in every checkout, where the development
  // dependencies are linked too, and fails on the first start of the image.
  // This walks the closure the image installs and reads the sources the image
  // keeps: not the browser halves, not the development supervisor's process
  // modules, not the test support a package publishes under `./testkit`.
  it('declares what its runtime sources import as a dependency, not a development one', () => {
    // pnpm's answer, through the module the image's pruner asks through:
    // a closure walked here by hand could disagree with the install about an
    // optional or a peer edge, and this would vouch for a tree the image
    // never had
    const closure = runtimeClosure(ROOT).filter((project) => project.name !== 'qualy')
    expect(closure.length).toBeGreaterThan(3)
    const byName = new Map(
      closure.map((project) => [
        project.name,
        {
          file: path.join(project.dir, 'package.json'),
          manifest: read(path.join(project.dir, 'package.json')),
        },
      ]),
    )

    const builtins = new Set(builtinModules)
    const offenders: string[] = []
    for (const [name, { file, manifest }] of byName) {
      const dir = path.dirname(file)
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        name,
      ])
      // the test support: the exported file, or the whole directory when the
      // export is that directory's index
      const testkit = manifest.exports?.['./testkit']
      const testSupport = typeof testkit === 'string' ? path.resolve(dir, testkit) : undefined
      const testSupportDir =
        testSupport !== undefined && path.basename(path.dirname(testSupport)) === 'testkit'
          ? path.dirname(testSupport)
          : undefined
      for (const source of walkSources(path.join(dir, 'src'), ['client', 'dev'])) {
        if (!source.endsWith('.ts')) continue
        if (source === testSupport) continue
        if (testSupportDir !== undefined && source.startsWith(`${testSupportDir}${path.sep}`))
          continue
        for (const used of runtimeImports(fs.readFileSync(source, 'utf8'))) {
          if (used.startsWith('.') || used.startsWith('/') || used.startsWith('virtual:')) continue
          if (used.startsWith('node:') || builtins.has(used)) continue
          const dependency = used.startsWith('@')
            ? used.split('/').slice(0, 2).join('/')
            : used.split('/')[0]!
          if (declared.has(dependency)) continue
          const how =
            manifest.devDependencies?.[dependency] === undefined
              ? 'does not declare it'
              : 'declares it for development only'
          offenders.push(`${path.relative(ROOT, source)} imports ${dependency}; ${name} ${how}`)
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([])
  })
})

/** what a module loads when node runs it: every specifier bar the type-only statements */
const runtimeImports = (source: string): string[] => {
  const runtime = source.replace(/^\s*(?:import|export)\s+type\s[^;]*?\bfrom\s+'[^']+'/gm, '')
  const found: string[] = []
  for (const match of runtime.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^import\s+)'([^']+)'/gm)) {
    found.push(match[1]!)
  }
  return found
}

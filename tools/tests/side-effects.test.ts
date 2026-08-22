import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A module that only registers itself has to be allowed to run.
//
// `Ui.browser` names a module the aggregate imports for its side effect: an
// upload driver announcing which grants it can spend. The generated aggregate
// therefore emits a bare `import "..."` with nothing bound - and a package
// that says `"sideEffects": false` is telling every bundler that such an
// import may be dropped. Vite's dev server evaluates it anyway, so the
// contradiction is invisible until a release build, where the driver
// silently disappears and every upload fails with "no driver for this
// grant". That is exactly what shipped: both storage providers declared
// themselves side-effect free while contributing a self-registering module.
//
// The declaration is per package and the contribution is per plugin, so
// nothing in either file can notice the other. This asks the question once,
// over every plugin in the repository.

const ROOT = path.resolve(import.meta.dirname, '../..')
const PLUGINS = path.join(ROOT, 'packages/plugins')

/** every plugin package directory, found rather than listed */
const packageDirs = (): string[] =>
  fs
    .readdirSync(PLUGINS, { withFileTypes: true })
    .filter((group) => group.isDirectory())
    .flatMap((group) =>
      fs
        .readdirSync(path.join(PLUGINS, group.name), { withFileTypes: true })
        .filter((one) => one.isDirectory())
        .map((one) => path.join(PLUGINS, group.name, one.name)),
    )

/** the modules a descriptor asks the browser to import for their side effect */
const browserModulesOf = (dir: string): string[] => {
  const descriptor = path.join(dir, 'src/index.ts')
  if (!fs.existsSync(descriptor)) return []
  // as the package declares its own paths: rooted at the package, with the
  // leading './' npm's grammar writes and path.join would normalise away
  return [...fs.readFileSync(descriptor, 'utf8').matchAll(/Ui\.browser\(\s*'([^']+)'/g)].map(
    (match) => `./${path.posix.join('src', match[1]!.replace(/^\.\//, ''))}`,
  )
}

/**
 * Whether a package's `sideEffects` lets this file run.
 *
 * Absent means "everything has side effects", which is the safe default.
 * `false` means nothing does. An array is a list of paths or globs, and npm's
 * grammar only needs `*` here - no package in this repository writes more.
 */
const mayRun = (declared: unknown, file: string): boolean => {
  if (declared === undefined || declared === true) return true
  if (declared === false) return false
  if (!Array.isArray(declared)) return true
  return declared.some((pattern) => {
    const text = String(pattern)
    const rooted = text.startsWith('./') || text.startsWith('*') ? text : `./${text}`
    const expression = new RegExp(
      `^${rooted.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    )
    return expression.test(file)
  })
}

describe('what a release bundle is allowed to drop', () => {
  it('lets every self-registering browser module survive its own package', () => {
    const guilty: string[] = []
    for (const dir of packageDirs()) {
      const modules = browserModulesOf(dir)
      if (modules.length === 0) continue
      const manifest = path.join(dir, 'package.json')
      const declared = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { sideEffects?: unknown })
        .sideEffects
      for (const module of modules) {
        if (!mayRun(declared, module)) {
          guilty.push(`${path.relative(ROOT, manifest)} drops ${module}`)
        }
      }
    }
    // named, so the failure says which package to edit and what to add
    expect(guilty).toEqual([])
  })

  // the pattern matcher is the whole judgement, so it is worth its own case
  it('reads the sideEffects grammar the way a bundler does', () => {
    expect(mayRun(undefined, './src/client/upload.ts')).toBe(true)
    expect(mayRun(false, './src/client/upload.ts')).toBe(false)
    expect(mayRun(['./src/client/upload.ts'], './src/client/upload.ts')).toBe(true)
    expect(mayRun(['./src/client/other.ts'], './src/client/upload.ts')).toBe(false)
    expect(mayRun(['**/*.css'], './src/client/upload.ts')).toBe(false)
    expect(mayRun(['./src/client/*.ts'], './src/client/upload.ts')).toBe(true)
  })
})

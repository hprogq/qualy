// Prunes the server image's build tree to what the runtime needs.
//
// Runs inside the image build, after a production-only install of the
// runtime closure: the application (the root package, whose dependencies are
// the plugins), the server host and the deploy CLI, with every workspace
// package they depend on. Everything else in the checkout - tests, the
// browser halves' sources, the dev toolchain, the tools, the documents - is
// removed. The closure is asked of pnpm rather than written down, so a plugin
// added to the manifest and the root package.json is in the image without
// anybody editing this file - and asked through the one module the dependency
// gate asks through too (runtime-closure.ts), so the tree the gate vouches for
// is the tree kept here.
//
// Plain .mjs, like the sandbox images' pruner: it is a build step, not part
// of the application. The module it imports is TypeScript node runs directly.
import fs from 'node:fs'
import path from 'node:path'
import { runtimeClosure } from './runtime-closure.ts'

const root = process.cwd()

/** the workspace packages the runtime is made of, as directories relative to the root */
const keep = new Set(
  runtimeClosure(root)
    .map((project) => path.relative(root, project.dir))
    .filter((dir) => dir !== '')
    .map((dir) => path.normalize(dir)),
)
if (keep.size === 0) throw new Error('the runtime closure is empty; is this the workspace root?')

// The root files a release is: what installed it, what selected it, and the
// lineage it deploys. The lock is the reviewed assembly the image was built
// from and the server checks the manifest against at every start.
const TOP_KEEP = new Set([
  'apps',
  'packages',
  'node_modules',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'qualy.yml',
  'qualy.lock.json',
  'db',
  'LICENSE',
])

const remove = (target) => fs.rmSync(target, { recursive: true, force: true })

for (const entry of fs.readdirSync(root)) {
  if (!TOP_KEEP.has(entry)) remove(path.join(root, entry))
}
// the lineage, and only the lineage, under db/
for (const entry of fs.readdirSync(path.join(root, 'db'))) {
  if (entry !== 'migrations') remove(path.join(root, 'db', entry))
}

// Workspace packages outside the closure. A directory with a package.json is
// a package and stays or goes as a whole; any other directory is a family of
// packages (packages/core, packages/plugins/infra, ...) and is walked, then
// dropped once nothing in it is left.
const isPackage = (dir) => fs.existsSync(path.join(dir, 'package.json'))
const pruneFamily = (relative) => {
  const dir = path.join(root, relative)
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir)) {
    const member = path.join(relative, entry)
    const at = path.join(dir, entry)
    if (!fs.statSync(at).isDirectory()) {
      remove(at)
      continue
    }
    if (isPackage(at)) {
      if (!keep.has(member)) remove(at)
      continue
    }
    pruneFamily(member)
    if (fs.readdirSync(at).length === 0) remove(at)
  }
}
pruneFamily('apps')
pruneFamily('packages')

// Inside what stays: tests, the browser halves' sources (the browser is served
// from its built bundle), and files only a development checkout reads. The
// server side has no .tsx; a .tsx anywhere here is browser code.
const PRUNED_DIRS = new Set(['tests', '__screenshots__', '.vitest'])
const PRUNED_FILES =
  /(\.test\.tsx?|\.browser\.test\.tsx|\.tsx|tsconfig[\w.-]*\.json|vitest[\w.-]*\.ts|README\.md)$/
let removedFiles = 0

// A package's test support is published under its `./testkit` export and
// nothing in production may import it, so it goes with the tests.
for (const dir of keep) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'))
  const testkit = manifest.exports?.['./testkit']
  if (typeof testkit !== 'string') continue
  const target = path.join(root, dir, testkit)
  const owned = path.basename(path.dirname(target)) === 'testkit' ? path.dirname(target) : target
  if (fs.existsSync(owned)) {
    remove(owned)
    removedFiles += 1
  }
}
const sweep = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      if (
        PRUNED_DIRS.has(entry.name) ||
        (entry.name === 'client' && path.basename(dir) === 'src')
      ) {
        remove(at)
        continue
      }
      sweep(at)
      continue
    }
    if (PRUNED_FILES.test(entry.name)) {
      remove(at)
      removedFiles += 1
    }
  }
}
for (const dir of keep) sweep(path.join(root, dir))

console.log(
  `pruned to ${String(keep.size)} workspace package(s); removed ${String(removedFiles)} development file(s)`,
)

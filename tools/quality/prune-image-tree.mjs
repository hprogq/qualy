// Prunes a sandbox image's build tree down to the app's production closure
// (isolation spec §14: the image carries its own closure, not the
// repository). Everything outside apps/, packages/ and the pnpm machinery
// goes too. The closure is asked of pnpm through the same module the server
// image's pruner and the dependency gate use, from the one app package the
// Dockerfile names: a workspace dependency the app gains is in the image
// without anybody editing an allow-list here, and one the app drops leaves.
// Plain .mjs: it runs inside the image build; the module it imports is
// TypeScript node runs directly.
import fs from 'node:fs'
import path from 'node:path'
import { workspaceClosure } from '../release/runtime-closure.ts'

const [app] = process.argv.slice(2)
if (!app || process.argv.length !== 3) {
  throw new Error('usage: node tools/quality/prune-image-tree.mjs <app package name>')
}

const root = process.cwd()
const keep = new Set(
  workspaceClosure(root, [app])
    .map((project) => path.relative(root, project.dir))
    .filter((dir) => dir !== '')
    .map((dir) => path.normalize(dir)),
)
const TOP_KEEP = new Set([
  'apps',
  'packages',
  'node_modules',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
])

for (const entry of fs.readdirSync(root)) {
  if (!TOP_KEEP.has(entry)) fs.rmSync(path.join(root, entry), { recursive: true, force: true })
}

// A directory with a package.json is a package and stays or goes as a whole;
// any other directory is a family of packages (packages/core,
// packages/plugins/infra, ...) and is walked, then dropped once empty.
const isPackage = (dir) => fs.existsSync(path.join(dir, 'package.json'))
const pruneFamily = (relative) => {
  const dir = path.join(root, relative)
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir)) {
    const member = path.join(relative, entry)
    const at = path.join(dir, entry)
    if (!fs.statSync(at).isDirectory()) {
      fs.rmSync(at, { force: true })
      continue
    }
    if (isPackage(at)) {
      if (!keep.has(member)) fs.rmSync(at, { recursive: true, force: true })
      continue
    }
    pruneFamily(member)
    if (fs.readdirSync(at).length === 0) fs.rmSync(at, { recursive: true, force: true })
  }
}
pruneFamily('apps')
pruneFamily('packages')

// The dependency store, cut to what the kept packages reach.
//
// `pnpm install --filter <app>...` installs the selected projects' dependencies
// and, whatever the filter says, the workspace root's - which for this
// repository are the application's plugins and everything they pull in
// (measured: 258 store entries for a closure that needs 32). The store is
// content the image ships, so it is walked from the kept packages: every
// symlink under a kept package's node_modules names a store entry, every
// store entry's own node_modules names the entries it depends on, and what
// nothing reaches is removed.
const store = path.join(root, 'node_modules', '.pnpm')
const storeEntryOf = (target) => {
  const relative = path.relative(store, target)
  if (relative.startsWith('..') || relative === '') return undefined
  const [entry] = relative.split(path.sep)
  return entry === 'node_modules' ? undefined : entry
}
/** the symlinks directly under a node_modules directory, scoped ones included */
const links = (nodeModules) => {
  if (!fs.existsSync(nodeModules)) return []
  const found = []
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const at = path.join(nodeModules, entry.name)
    if (entry.isSymbolicLink()) found.push(at)
    else if (entry.isDirectory() && entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(at, { withFileTypes: true })) {
        if (scoped.isSymbolicLink()) found.push(path.join(at, scoped.name))
      }
    }
  }
  return found
}
const reachable = new Set()
const pending = [...keep].map((dir) => path.join(root, dir, 'node_modules'))
while (pending.length > 0) {
  const nodeModules = pending.pop()
  for (const link of links(nodeModules)) {
    let target
    try {
      target = fs.realpathSync(link)
    } catch {
      continue
    }
    const entry = storeEntryOf(target)
    if (entry === undefined || reachable.has(entry)) continue
    reachable.add(entry)
    pending.push(path.join(store, entry, 'node_modules'))
  }
}
let removedEntries = 0
if (fs.existsSync(store)) {
  for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || reachable.has(entry.name)) continue
    fs.rmSync(path.join(store, entry.name), { recursive: true, force: true })
    removedEntries += 1
  }
  // the links left pointing at nothing: the root's, and the hoisted ones
  for (const dir of [path.join(root, 'node_modules'), path.join(store, 'node_modules')]) {
    for (const link of links(dir)) {
      if (!fs.existsSync(link)) fs.rmSync(link, { force: true })
    }
  }
}

console.log(
  `pruned to: ${[...keep].join(', ')}; store kept ${String(reachable.size)} entr${reachable.size === 1 ? 'y' : 'ies'}, removed ${String(removedEntries)}`,
)

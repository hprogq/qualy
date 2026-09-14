import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// convenience scaffold for a new workspace plugin: host workspace dependency
// plus qualy.yml entry, then install and resolve.
//
// Every path here is a path this repository moved once already, and the last
// move left this script running a CLI that no longer existed - after it had
// edited two manifests and installed. Re-running it on a plugin it has
// already added is safe, which is what makes that recoverable.

/** the assembly CLI, as `pnpm qualy` invokes it */
const CLI = 'apps/cli/src/main.ts'

const name = process.argv[2]
if (!name?.startsWith('@qualy/plugin-')) {
  throw new Error('usage: pnpm plugin:add @qualy/plugin-<name>')
}

function workspacePackageExists(id: string): boolean {
  const stack = ['packages']
  while (stack.length > 0) {
    const dir = stack.pop()!
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
      if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === id) return true
      continue
    }
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (child.isDirectory() && child.name !== 'node_modules')
        stack.push(path.join(dir, child.name))
    }
  }
  return false
}

if (!workspacePackageExists(name)) throw new Error(`${name} not found under packages/`)

const rootManifestPath = 'apps/server/package.json'
const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'))
rootManifest.dependencies = Object.fromEntries(
  Object.entries({ ...rootManifest.dependencies, [name]: 'workspace:*' }).sort(([a], [b]) =>
    a.localeCompare(b),
  ),
)
fs.writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2) + '\n')

// The manifest entry is the product command's to write, not this script's:
// `qualy plugin add` is what a deployment runs for a published plugin, and
// having a second writer here meant two answers to "what does adding a
// plugin do". This script's own job is the part that is only true inside
// this repository - the workspace dependency.
const manifestPath = 'qualy.yml'
const selected = new RegExp(`^\\s*'?${name}'?:`, 'm').test(fs.readFileSync(manifestPath, 'utf8'))

const pluginManifest = (() => {
  const stack = ['packages']
  while (stack.length > 0) {
    const dir = stack.pop()!
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      if (pkg.name === name) return pkg
      continue
    }
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (child.isDirectory() && child.name !== 'node_modules')
        stack.push(path.join(dir, child.name))
    }
  }
  return {}
})()

// The browser half needs no declaration anywhere. A plugin's modules are
// found through the assembly - the manifest names a workspace, the resolver
// finds the package, the collector writes relative imports - so the
// composition root never has to name a plugin for one to be built. It used
// to, and that list was a second copy of what the resolution already knew.
void pluginManifest

execSync('pnpm install', { stdio: 'inherit' })
// after the install, because the product command asks whether the package is
// actually installed before it writes anything; re-running on a plugin that
// is already selected skips straight to resolving, which is why this is safe
// to run twice
execSync(`node ${CLI} ${selected ? 'resolve' : `plugin add ${name}`}`, { stdio: 'inherit' })
console.log(
  `${name} added; declare what it contributes on its descriptor (Db.entities, Ui.surfaces, ...)`,
)

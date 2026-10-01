import { ensureIdeProject } from '../../packages/build/messages/src/ide.ts'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// convenience scaffold for a new workspace plugin: product package dependency
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

function workspacePackageRoot(id: string): string | undefined {
  const stack = ['packages']
  while (stack.length > 0) {
    const dir = stack.pop()!
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
      if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === id) return dir
      continue
    }
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (child.isDirectory() && child.name !== 'node_modules')
        stack.push(path.join(dir, child.name))
    }
  }
  return undefined
}

const pluginRoot = workspacePackageRoot(name)
if (!pluginRoot) throw new Error(`${name} not found under packages/`)

// The product package is the repository root: the package holding qualy.yml
// is the one whose dependencies its plugin ids resolve against, and the
// server is a generic host that names no product plugin.
const rootManifestPath = 'package.json'
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
// the name as written, not as a pattern: a plugin name may carry a dot
const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const selected = new RegExp(`^\\s*'?${literal}'?:`, 'm').test(fs.readFileSync(manifestPath, 'utf8'))

ensureIdeProject(pluginRoot)

execSync('pnpm install', { stdio: 'inherit' })
// after the install, because the product command asks whether the package is
// actually installed before it writes anything; re-running on a plugin that
// is already selected skips straight to resolving, which is why this is safe
// to run twice
execSync(`node ${CLI} ${selected ? 'resolve' : `plugin add ${name}`}`, { stdio: 'inherit' })
console.log(
  `${name} added; declare what it contributes on its descriptor (Db.entities, Ui.surfaces, ...)`,
)

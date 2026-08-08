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

// appended rather than rewritten through the parser, so a hand-maintained
// manifest keeps its comments, blank lines and grouping
const manifestPath = 'qualy.yml'
const manifest = fs.readFileSync(manifestPath, 'utf8')
if (!new RegExp(`^\\s*'?${name}'?:`, 'm').test(manifest)) {
  fs.writeFileSync(manifestPath, `${manifest.trimEnd()}\n  '${name}': {}\n`)
}

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

// Aggregators own their inputs: the browser collector hard-fails on a plugin
// that contributes components without apps/web declaring it. A brand new
// plugin declares no component yet, so the signal available here is whether it
// ships browser code at all - and running this command again on an existing
// plugin is what fixes up the dependency later, which is exactly what the
// collector's own error tells the author to do.
const pluginName: string = name
function declareIn(manifestPath: string) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.dependencies = Object.fromEntries(
    Object.entries({ ...manifest.dependencies, [pluginName]: 'workspace:*' }).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  )
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}
const shipsBrowserCode = Object.keys(pluginManifest.exports ?? {}).some((entry) =>
  entry.startsWith('./client'),
)
if (shipsBrowserCode) declareIn('apps/web/package.json')

execSync('pnpm install', { stdio: 'inherit' })
execSync(`pnpm exec tsx ${CLI} resolve`, { stdio: 'inherit' })
console.log(
  `${name} added; declare what it contributes on its descriptor (Db.entities, Ui.surfaces, ...)`,
)

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// convenience scaffold for a new workspace plugin: root workspace dependency
// plus qualy.yml entry, then install

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

const rootManifestPath = 'packages/app/package.json'
const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'))
rootManifest.dependencies = Object.fromEntries(
  Object.entries({ ...rootManifest.dependencies, [name]: 'workspace:*' }).sort(([a], [b]) =>
    a.localeCompare(b),
  ),
)
fs.writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2) + '\n')

// appended rather than rewritten through the parser, so a hand-maintained
// manifest keeps its comments, blank lines and grouping
const manifestPath = 'packages/app/qualy.yml'
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

// aggregators own their inputs: contract consumers and component consumers
// must declare the plugin, the generators hard-fail otherwise
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
if (pluginManifest.exports?.['./contract']) declareIn('packages/api-client/package.json')
if (pluginManifest.exports?.['./client']) declareIn('apps/web/package.json')

execSync('pnpm install', { stdio: 'inherit' })
execSync('pnpm exec tsx scripts/qualy.ts resolve', { stdio: 'inherit' })
execSync('pnpm exec tsx scripts/gen.ts', { stdio: 'inherit' })
console.log(
  `${name} added; declare qualy.database.schemaEntry in its package.json if it owns tables`,
)

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { readInstalledLock, type InstalledEntry } from './lib/installed.ts'

// one-step plugin installation: root workspace dependency + installed.lock
// entry + cordis.yml entry, with dependency-closure validation. Editing
// installed.lock.json by hand is reserved for the purge flow.

const name = process.argv[2]
if (!name?.startsWith('@qualy/plugin-')) {
  throw new Error('usage: pnpm plugin:add @qualy/plugin-<name>')
}

function findWorkspacePackage(id: string): { dir: string; version: string; dependsOn: string[] } {
  const stack = ['packages']
  while (stack.length > 0) {
    const dir = stack.pop()!
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      if (pkg.name === id) {
        return { dir, version: pkg.version ?? '0.0.0', dependsOn: pkg.qualy?.dependsOn ?? [] }
      }
      continue
    }
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (child.isDirectory() && child.name !== 'node_modules') stack.push(path.join(dir, child.name))
    }
  }
  throw new Error(`${id} not found under packages/`)
}

const found = findWorkspacePackage(name)
const installed = readInstalledLock()
if (installed.some((entry) => entry.id === name)) {
  throw new Error(`${name} is already installed`)
}
const installedIds = new Set(installed.map((entry) => entry.id))
for (const dep of found.dependsOn) {
  if (!installedIds.has(dep)) {
    throw new Error(`dependency closure violation: ${name} depends on ${dep}, install it first`)
  }
}

const rootManifestPath = 'package.json'
const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'))
rootManifest.dependencies = Object.fromEntries(
  Object.entries({ ...rootManifest.dependencies, [name]: 'workspace:*' }).sort(([a], [b]) =>
    a.localeCompare(b),
  ),
)
fs.writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2) + '\n')

const nextEntry: InstalledEntry = { id: name, version: found.version, dependsOn: found.dependsOn }
const lock = { plugins: [...installed, nextEntry].sort((a, b) => a.id.localeCompare(b.id)) }
fs.writeFileSync('installed.lock.json', JSON.stringify(lock, null, 2) + '\n')

const yml = fs.readFileSync('cordis.yml', 'utf8')
if (!yml.includes(`name: "${name}"`) && !yml.includes(`name: '${name}'`)) {
  fs.writeFileSync('cordis.yml', yml.trimEnd() + `\n- name: '${name}'\n`)
}

execSync('pnpm install', { stdio: 'inherit' })
console.log(`${name} installed; run 'pnpm db:gen' if it contributes database schema`)

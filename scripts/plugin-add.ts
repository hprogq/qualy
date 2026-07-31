import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// convenience scaffold for a new workspace plugin: root workspace dependency
// plus cordis.yml entry, then install

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
      if (child.isDirectory() && child.name !== 'node_modules') stack.push(path.join(dir, child.name))
    }
  }
  return false
}

if (!workspacePackageExists(name)) throw new Error(`${name} not found under packages/`)

const rootManifestPath = 'package.json'
const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'))
rootManifest.dependencies = Object.fromEntries(
  Object.entries({ ...rootManifest.dependencies, [name]: 'workspace:*' }).sort(([a], [b]) =>
    a.localeCompare(b),
  ),
)
fs.writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2) + '\n')

const yml = fs.readFileSync('cordis.yml', 'utf8')
if (!yml.includes(`name: "${name}"`) && !yml.includes(`name: '${name}'`)) {
  fs.writeFileSync('cordis.yml', yml.trimEnd() + `\n- name: '${name}'\n`)
}

execSync('pnpm install', { stdio: 'inherit' })
console.log(`${name} added; declare qualy.database.schemaEntry in its package.json if it owns tables`)

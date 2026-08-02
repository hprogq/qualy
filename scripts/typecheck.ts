import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// no plugin names in root scripts: web-side programs are discovered from the
// packages tree (every plugin client directory owns a tsconfig.json)

function findClientProjects(root: string): string[] {
  const projects: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!child.isDirectory() || child.name === 'node_modules') continue
      const full = path.join(dir, child.name)
      if (child.name === 'client' && fs.existsSync(path.join(full, 'tsconfig.json'))) {
        projects.push(full)
        continue
      }
      stack.push(full)
    }
  }
  return projects.sort()
}

const projects = [
  '.',
  'packages/web-runtime',
  'packages/ui',
  'apps/web',
  ...findClientProjects('packages'),
]
for (const project of projects) {
  console.log(`typecheck ${project}`)
  execSync(`./node_modules/.bin/tsc -p ${project} --noEmit`, { stdio: 'inherit' })
}

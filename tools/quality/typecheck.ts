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
  'packages/web-i18n',
  'packages/ui',
  'apps/web',
  ...findClientProjects('packages'),
]
// every program runs even after one fails: aborting on the first meant the
// web-side programs went unchecked whenever the root had an error, so a
// green run of the earlier projects was never evidence about the later ones
const failed: string[] = []
for (const project of projects) {
  console.log(`typecheck ${project}`)
  try {
    execSync(`./node_modules/.bin/tsc -p ${project} --noEmit`, { stdio: 'inherit' })
  } catch {
    failed.push(project)
  }
}
// the compiler cannot resolve a module named by a string in Ui.react(...);
// this asks it to, against each plugin's own client program
console.log('typecheck client component references')
const { checkClientComponents } = await import('./check-client-components.ts')
const broken = await checkClientComponents()
for (const failure of broken) console.error(failure)
if (broken.length > 0) failed.push('client component references')

if (failed.length > 0) {
  console.error(`\ntypecheck failed: ${failed.join(', ')}`)
  process.exit(1)
}

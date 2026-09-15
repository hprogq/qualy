import { execFile } from 'node:child_process'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

// no plugin names in root scripts: web-side programs are discovered from the
// packages tree (every plugin client directory owns a tsconfig.json, and so
// does every browser-side package)

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

// A browser test renders the same code the browser runs, so it is checked by
// a browser program rather than the node one - discovered the way client
// directories are, by the directory that owns one.
//
// The file is `tsconfig.json` and not some name of our own, because an editor
// finds a file's project by walking up for exactly that name: under any other
// name the program exists for this script alone, the editor falls back to its
// own defaults, and every `import './x.css'` in a moved test is underlined as
// a missing module while `pnpm typecheck` stays green.
function findBrowserTestProjects(root: string): string[] {
  const projects: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!child.isDirectory() || child.name === 'node_modules') continue
      const full = path.join(dir, child.name)
      if (child.name === 'tests' && fs.existsSync(path.join(full, 'tsconfig.json'))) {
        projects.push(full)
        continue
      }
      stack.push(full)
    }
  }
  return projects.sort()
}

/** the browser-side packages, each its own program: whatever has a tsconfig */
function findPackageProjects(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (child) => child.isDirectory() && fs.existsSync(path.join(root, child.name, 'tsconfig.json')),
    )
    .map((child) => path.join(root, child.name))
    .sort()
}

// Discovered rather than listed. The list was five names long and went stale
// the first time a sixth package arrived: it was added, it compiled locally,
// and nothing would have told anybody that the type gate never opened it.
const projects = [
  '.',
  ...findPackageProjects('packages/web'),
  ...findPackageProjects('packages/testkit'),
  'apps/web',
  ...findClientProjects('packages'),
  ...findBrowserTestProjects('packages'),
  ...findBrowserTestProjects('tools/fixtures'),
]
// Build info per project, so a second run rechecks what changed rather than
// every program from scratch - the difference between nine seconds and one.
// It lives under node_modules because it is derived, machine-local and
// disposable; the compiler falls back to a full check whenever it cannot use
// what it finds there.
const cache = 'node_modules/.cache/qualy-typecheck'
fs.mkdirSync(cache, { recursive: true })
const buildInfo = (project: string) =>
  path.join(
    cache,
    `${project.replaceAll(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}.tsbuildinfo`,
  )

// Every program runs even after one fails: aborting on the first meant the
// web-side programs went unchecked whenever the root had an error, so a green
// run of the earlier projects was never evidence about the later ones.
//
// And they run a few at a time. Twenty-nine programs in a row is twenty-nine
// compiler startups on one core while the rest of the machine waits - cold,
// that was twenty-eight seconds of mostly idle cpu. Bounded rather than all
// at once: each `tsc` holds a whole program in memory, and enough of them at
// once turns a cpu win into a swapping loss. Half the cores, at least two,
// because the smallest runner has two and one at a time is where this
// started.
const LANES = Math.max(2, Math.min(8, Math.floor((os.availableParallelism?.() ?? 4) / 2)))

const failed: string[] = []
const said: string[] = []
let next = 0
const lane = async (): Promise<void> => {
  while (next < projects.length) {
    const project = projects[next++]!
    await new Promise<void>((resolve) => {
      execFile(
        './node_modules/.bin/tsc',
        ['-p', project, '--noEmit', '--incremental', '--tsBuildInfoFile', buildInfo(project)],
        // the output of one program at a time, kept together: interleaved
        // diagnostics from three compilers name no file a reader can act on
        (error, stdout, stderr) => {
          said.push(`typecheck ${project}`, `${stdout}${stderr}`.trimEnd())
          if (error) failed.push(project)
          resolve()
        },
      )
    })
  }
}
await Promise.all(Array.from({ length: LANES }, lane))
for (const line of said) if (line !== '') console.log(line)
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

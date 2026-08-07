import fs from 'node:fs'
import path from 'node:path'
import { lockPathFor, readLock } from '@qualy/assembly'
import { manifestPath, repoRoot } from './manifest.ts'

// the web build stays in apps/web (composition root), the runtime artifact
// belongs to the web plugin: stage dist into its package directory

const source = path.join(repoRoot, 'apps/web/dist')
const target = path.join(repoRoot, 'packages/plugins/infra/web/client-dist')

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error(`${source} is missing; run the web build first`)
}
// The bundle carries the hash of the assembly it was built from. A dotfile,
// so the static server never serves it; production boot compares it against
// the running lock and refuses assets built from a different assembly -
// nothing inside either half can notice that mismatch on its own.
const lock = readLock(lockPathFor(manifestPath()))
if (!lock) {
  throw new Error('no assembly lock; run `pnpm qualy resolve` before staging web assets')
}
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(source, target, { recursive: true })
fs.writeFileSync(
  path.join(target, '.qualy-assembly.json'),
  `${JSON.stringify({ resolutionHash: lock.resolutionHash }, null, 2)}\n`,
)
console.log(`staged web assets -> ${path.relative(process.cwd(), target)}`)

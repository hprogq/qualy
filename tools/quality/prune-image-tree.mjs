// Prunes a sandbox image's build tree down to an allow-list of workspace
// directories (isolation spec §14: the image carries its own closure, not
// the repository). Everything outside apps/, packages/ and the pnpm
// machinery goes too. Plain .mjs: it runs inside the image build, where no
// TypeScript loader exists yet.
import fs from 'node:fs'
import path from 'node:path'

const keep = new Set(process.argv.slice(2).map((p) => path.normalize(p)))
if (keep.size === 0) throw new Error('nothing to keep?')

const root = process.cwd()
const TOP_KEEP = new Set(['apps', 'packages', 'node_modules', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])

for (const entry of fs.readdirSync(root)) {
  if (!TOP_KEEP.has(entry)) fs.rmSync(path.join(root, entry), { recursive: true, force: true })
}
for (const base of ['apps', 'packages/core', 'packages/contracts', 'packages/web', 'packages/build', 'packages/plugins']) {
  const dir = path.join(root, base)
  if (!fs.existsSync(dir)) continue
  for (const entry of fs.readdirSync(dir)) {
    const relative = path.join(base, entry)
    const nested = path.join(dir, entry)
    if (keep.has(relative)) continue
    // plugin families nest one level deeper
    if (base === 'packages/plugins' && fs.statSync(nested).isDirectory()) {
      for (const plugin of fs.readdirSync(nested)) {
        if (!keep.has(path.join(relative, plugin)))
          fs.rmSync(path.join(nested, plugin), { recursive: true, force: true })
      }
      continue
    }
    fs.rmSync(nested, { recursive: true, force: true })
  }
}
console.log('pruned to:', [...keep].join(', '))

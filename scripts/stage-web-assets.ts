import fs from 'node:fs'

// the web build stays in apps/web (composition root), the runtime artifact
// belongs to the web plugin: stage dist into its package directory

const source = 'apps/web/dist'
const target = 'packages/plugins/infra/web/client-dist'

if (!fs.existsSync(`${source}/index.html`)) {
  throw new Error(`${source} is missing; run the web build first`)
}
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(source, target, { recursive: true })
console.log(`staged web assets -> ${target}`)

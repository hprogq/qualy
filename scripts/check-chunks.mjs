// tree-shaking sentinel: asserts whether PingPage is (or is not) an
// independent chunk in the web build output.
// NOTE: this assertion relies on the bundler's default [name]-[hash] chunk
// naming; configuring manualChunks/chunkFileNames would silently break it.
import fs from 'node:fs'

const dir = 'apps/web/dist/assets'
const hit = fs.existsSync(dir) && fs.readdirSync(dir).some((file) => /PingPage/.test(file))
console.log(hit ? 'PingPage chunk present' : 'PingPage chunk absent')
process.exit(hit ? 0 : 1)

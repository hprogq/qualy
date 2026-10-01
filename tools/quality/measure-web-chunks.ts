import fs from 'node:fs'
import path from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import { build, type Plugin } from 'vite'
import { staticClosure } from '../../packages/build/web/src/chunk-graph.ts'
import { screenBudgets, messagePoolBytes } from '../../apps/web/performance-budget.ts'
import { repoRoot } from '../lib/manifest.ts'

// Explicit benchmark invocation; normal builds never read an environment override.
const pools = process.argv.includes('--sweep') ? [16, 32, 48, 64, 96] : [messagePoolBytes / 1024]
const results: unknown[] = []
for (const pool of pools) {
  let report: unknown
  const measure: Plugin = {
    name: 'qualy-measure-web',
    enforce: 'post',
    config(config) {
      const output = config.build?.rollupOptions?.output
      if (!output || Array.isArray(output)) throw new Error('expected one output configuration')
      const splitting = output.codeSplitting
      const groups = typeof splitting === 'object' ? splitting.groups : undefined
      const messages = groups?.find((group) => group.name === 'messages')
      if (!messages) throw new Error('message pool not found')
      messages.entriesAwareMergeThreshold = pool * 1024
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((output) => output.type === 'chunk')
      const imports = new Map(chunks.map((chunk) => [chunk.fileName, chunk.imports]))
      const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      const entry = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName)
      const br = new Map(
        chunks.map((chunk) => [chunk.fileName, brotliCompressSync(chunk.code).length]),
      )
      const asset = bundle['.qualy-browser-surfaces.json']
      if (!asset || asset.type !== 'asset') throw new Error('surface map missing')
      const surfaces = JSON.parse(String(asset.source)) as Record<string, { chunk: string }>
      const pages = Object.fromEntries(
        screenBudgets.map((screen) => [screen.name, screen.surfaces]),
      )
      const metrics = Object.fromEntries(
        Object.entries(pages).map(([page, roots]) => {
          const files = [
            ...staticClosure(imports, [
              ...entry,
              ...roots.map((root) => {
                if (!surfaces[root]) throw new Error(`missing benchmark surface ${root}`)
                return surfaces[root].chunk
              }),
            ]),
          ]
          return [
            page,
            {
              requests: files.length,
              small1: files.filter((file) => Buffer.byteLength(byName.get(file)!.code) < 1024)
                .length,
              small2: files.filter((file) => Buffer.byteLength(byName.get(file)!.code) < 2048)
                .length,
              brotli: files.reduce((sum, file) => sum + br.get(file)!, 0),
            },
          ]
        }),
      )
      report = {
        pool,
        chunks: chunks.length,
        pages: metrics,
        entries: entry.map((file) => ({
          file,
          brotli: br.get(file),
          contributors: Object.entries(byName.get(file)!.modules)
            .sort((a, b) => b[1].renderedLength - a[1].renderedLength)
            .slice(0, 10)
            .map(([id, value]) => ({
              module: path.relative(repoRoot, id),
              bytes: value.renderedLength,
            })),
        })),
      }
    },
  }
  const started = performance.now()
  await build({
    root: path.join(repoRoot, 'apps/web'),
    configFile: path.join(repoRoot, 'apps/web/vite.config.ts'),
    mode: 'production',
    logLevel: 'warn',
    plugins: [measure],
    build: { write: false },
  })
  results.push(report)
  console.log(
    JSON.stringify({ seconds: ((performance.now() - started) / 1000).toFixed(1), report }),
  )
}
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length)
if (output) fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n')

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isFileServingAllowed, resolveConfig, loadConfigFromFile } from 'vite'

// What the development server hands out under /@fs/.
//
// It listens beyond this machine (a phone on the same network, a tunnel to a
// public hostname), so whatever it will read is readable by whoever reaches
// it. Vite's default is the whole workspace root, and the workspace root here
// holds database dumps, backups and a collector's credentials next to the
// source. The application's config narrows it to what a page actually loads.

const repo = fileURLToPath(new URL('../..', import.meta.url))

const resolved = async (file = 'apps/web/vite.config.ts') => {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    path.join(repo, file),
    `${repo}apps/web`,
    'silent',
  )
  if (!loaded) throw new Error('web configuration not found')
  // This gate checks file permissions, not message compilation. Running the
  // config hooks here would replace artifacts other concurrent suites read.
  const config = await resolveConfig(
    {
      ...loaded.config,
      configFile: false,
      plugins: [],
      root: `${repo}apps/web`,
      logLevel: 'silent',
    },
    'serve',
    'development',
  )
  return config
}

const served = async () => {
  const config = await resolved()
  return (file: string) => isFileServingAllowed(config, `/@fs${repo}${file}`)
}

it('includes the host HTML entry in dependency discovery alongside plugin entries', async () => {
  const config = await resolved()
  expect(config.optimizeDeps.entries).toContain('index.html')
})

describe('what the development server serves from the file system', () => {
  it('serves the application, the workspace packages and the installed dependencies', async () => {
    const allowed = await served()
    for (const file of [
      'apps/web/src/main.tsx',
      // generated at build time, so absent from a fresh checkout
      path.posix.join('apps/web/.qualy', 'plugins.ts'),
      'packages/web/ui/package.json',
      'packages/plugins/assessment/core/src/client/items/scoring-refusals.ts',
      'node_modules/.pnpm/react@19.0.0/node_modules/react/index.js',
    ]) {
      expect(allowed(file), file).toBe(true)
    }
  })

  it('refuses the rest of the repository, and dumps and credentials wherever they sit', async () => {
    const allowed = await served()
    for (const file of [
      'data/backups/qualy-dev.dump',
      'data/demo-baseline/qualy-demo.dump',
      'ops/observability/collector.env',
      'docs/seed/users/students.xlsx',
      'qualy.yml',
      '.env',
      '.mcp.json',
      'packages/plugins/infra/database/stray.dump',
      'packages/web/ui/.env.local',
      'packages/web/ui/collector.env',
    ]) {
      expect(allowed(file), file).toBe(false)
    }
  })
})

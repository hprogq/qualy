import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { isFileServingAllowed, resolveConfig } from 'vite'

// What the development server hands out under /@fs/.
//
// It listens beyond this machine (a phone on the same network, a tunnel to a
// public hostname), so whatever it will read is readable by whoever reaches
// it. Vite's default is the whole workspace root, and the workspace root here
// holds database dumps, backups and a collector's credentials next to the
// source. The application's config narrows it to what a page actually loads.

const repo = fileURLToPath(new URL('../..', import.meta.url))

const served = async () => {
  const config = await resolveConfig(
    { configFile: `${repo}apps/web/vite.config.ts`, root: `${repo}apps/web`, logLevel: 'silent' },
    'serve',
    'development',
  )
  return (file: string) => isFileServingAllowed(config, `/@fs${repo}${file}`)
}

describe('what the development server serves from the file system', () => {
  it('serves the application, the workspace packages and the installed dependencies', async () => {
    const allowed = await served()
    for (const file of [
      'apps/web/src/main.tsx',
      'apps/web/.qualy/plugins.ts',
      'packages/web/ui/package.json',
      'packages/plugins/assessment/core/src/client/i18n.ts',
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

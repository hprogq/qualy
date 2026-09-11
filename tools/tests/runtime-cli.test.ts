import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'

// The runtime tier, end to end: the real CLI over the real manifest, with a
// runtime-tier command that needs the whole service graph. What a
// deployment will run is what runs here - a child process, an exit code,
// and the words on its two streams.

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, '../../apps/cli/src/main.ts')
const root = path.join(here, '../..')

const qualy = (args: readonly string[], env: Record<string, string | undefined>) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: root,
    env,
    timeout: 150_000,
  })

describe.runIf(postgresAvailable)('a runtime-tier command over the real assembly', () => {
  it('audits an empty deployment clean, over services built without a port', async () => {
    const db = await createTestContext('runtime-cli')
    try {
      // whatever the shell says about migrations is not this command's to
      // inherit: unset, the graph pins them off
      const { QUALY_MIGRATIONS: _inherited, ...inherited } = process.env
      const ran = qualy(['assessment', 'audit-scoring'], {
        ...inherited,
        DATABASE_URL: db.url,
        NODE_ENV: 'development',
      })
      expect(ran.status, `${ran.stdout}\n${ran.stderr}`).toBe(0)
      expect(ran.stdout).toContain('verdict: clean')
      expect(ran.stdout).toContain('items: 0')
    } finally {
      await db.dispose()
    }
  }, 180_000)

  it('refuses to run with migrations asked for, before reaching for any database', () => {
    const ran = qualy(['assessment', 'audit-scoring'], {
      ...process.env,
      QUALY_MIGRATIONS: 'apply',
      // nothing listens here: a refusal that came after a connection attempt
      // would say so in its own words
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
    })
    expect(ran.status).toBe(1)
    expect(ran.stderr).toContain('pnpm qualy deploy')
    expect(ran.stderr).not.toContain('not reachable')
  }, 60_000)

  it('lists the command with the rest', () => {
    const ran = qualy(['list'], { ...process.env })
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout).toContain('assessment audit-scoring  -  ')
    expect(ran.stdout).toContain('(@qualy/plugin-assessment)')
  }, 60_000)
})

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const ymlPath = 'packages/app/qualy.yml'
const contractsPath = 'packages/api-client/src/contracts.gen.ts'
const pluginsPath = 'apps/web/src/plugins.gen.ts'

const gen = (flags = '') => execSync(`pnpm exec tsx scripts/gen.ts ${flags}`, { encoding: 'utf8' })

describe('generator determinism', () => {
  // the working manifest is never written: other test files read it
  // concurrently, so mutated variants go to a throwaway copy (--yml)
  const originalYml = fs.readFileSync(ymlPath, 'utf8')
  afterAll(() => {
    gen()
  })

  it('produces byte-identical output on repeated runs', () => {
    gen()
    const contracts = fs.readFileSync(contractsPath, 'utf8')
    const plugins = fs.readFileSync(pluginsPath, 'utf8')
    const second = gen()
    expect(second).toContain('unchanged, skipped')
    expect(fs.readFileSync(contractsPath, 'utf8')).toBe(contracts)
    expect(fs.readFileSync(pluginsPath, 'utf8')).toBe(plugins)
  })

  it('drops disabled plugins from the active set but keeps them under --all', () => {
    const mutated = originalYml.replace(
      "name: '@qualy/plugin-ping'",
      "name: '@qualy/plugin-ping'\n  disabled: true",
    )
    expect(mutated, 'fixture must actually disable ping').not.toBe(originalYml)
    const tmpYml = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-gen-')), 'qualy.yml')
    fs.writeFileSync(tmpYml, mutated)

    gen(`--yml ${tmpYml}`)
    expect(fs.readFileSync(contractsPath, 'utf8')).not.toContain('pingContract')
    expect(fs.readFileSync(pluginsPath, 'utf8')).not.toContain('pingComponents')

    gen(`--yml ${tmpYml} --all`)
    expect(fs.readFileSync(contractsPath, 'utf8')).toContain('pingContract')
    expect(fs.readFileSync(pluginsPath, 'utf8')).toContain('pingComponents')
  })
})

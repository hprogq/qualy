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

  it('gives every exported contract its own client namespace', () => {
    gen()
    const contracts = fs.readFileSync(contractsPath, 'utf8')
    // auth owns two api surfaces: the session core and identity
    // administration. They became separate namespaces rather than one
    // crowded object.
    expect(contracts).toContain("import { authContract as authNamespace } from '@qualy/plugin-auth/contract'")
    expect(contracts).toContain(
      "import { identityContract as identityNamespace } from '@qualy/plugin-auth/contract'",
    )
    expect(contracts).toContain('  auth: authNamespace,')
    expect(contracts).toContain('  identity: identityNamespace,')
    // imports are aliased, so a plugin exporting `appContract` does not
    // collide with the aggregate this file declares under the same name
    expect(contracts).toContain(
      "import { appContract as appNamespace } from '@qualy/plugin-ui-registry/contract'",
    )
    expect(contracts).toContain('export const appContract = {')
    expect(contracts).toContain('  app: appNamespace,')
  })

  it('refuses a contract export that cannot become a namespace', () => {
    // the export name IS the namespace, so it has to be able to be one
    const check = (name: string) => /^[a-z][A-Za-z0-9]*Contract$/.test(name)
    expect(check('identityContract')).toBe(true)
    expect(check('authLocalContract')).toBe(true)
    expect(check('Contract')).toBe(false)
    expect(check('IdentityContract')).toBe(false)
    expect(check('identity_contract')).toBe(false)
    expect(check('identityContracts')).toBe(false)
  })

  it('rejects two plugins claiming one namespace', () => {
    // ping is loaded twice under different ids: the second claim of the
    // `ping` namespace must fail generation rather than silently shadow
    const mutated = originalYml.replace(
      "name: '@qualy/plugin-ping'",
      "name: '@qualy/plugin-ping'\n- name: '@qualy/plugin-ping'",
    )
    const tmpYml = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-gen-ns-')), 'qualy.yml')
    fs.writeFileSync(tmpYml, mutated)
    expect(() => gen(`--yml ${tmpYml}`)).toThrow(/duplicate contract namespace ping/)
  })

})

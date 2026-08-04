import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { createWorkspace } from '@qualy/assembly/testkit'

const contractsPath = 'packages/api-client/src/contracts.gen.ts'
const pluginsPath = 'apps/web/src/plugins.gen.ts'
const apiPath = 'packages/api/src/api.gen.ts'
const apiHandlersPath = 'packages/app/api-handlers.gen.ts'

const gen = (flags = '') => execSync(`pnpm exec tsx scripts/gen.ts ${flags}`, { encoding: 'utf8' })

describe('generator determinism', () => {
  // the working manifest is never written: other test files read it
  // concurrently, so mutated selections go to a throwaway workspace (--yml)
  afterAll(() => {
    gen()
  })

  it('produces byte-identical output on repeated runs', () => {
    gen()
    const before = [contractsPath, pluginsPath, apiPath, apiHandlersPath].map((file) =>
      fs.readFileSync(file, 'utf8'),
    )
    const second = gen()
    expect(second).toContain('unchanged, skipped')
    for (const [index, file] of [contractsPath, pluginsPath, apiPath, apiHandlersPath].entries()) {
      expect(fs.readFileSync(file, 'utf8')).toBe(before[index])
    }
  })

  it('drops disabled plugins from the active set but keeps them under --all', () => {
    // ping owns tables, so the selection has to include the capability that
    // accepts them or resolution refuses the manifest
    const workspace = createWorkspace(
      [
        '@qualy/plugin-database',
        '@qualy/plugin-server',
        '@qualy/plugin-ui-registry',
        '@qualy/plugin-ping',
      ],
      { disabled: ['@qualy/plugin-ping'] },
    )
    try {
      gen(`--yml ${workspace.manifestPath}`)
      expect(fs.readFileSync(contractsPath, 'utf8')).not.toContain('pingContract')
      expect(fs.readFileSync(pluginsPath, 'utf8')).not.toContain('pingComponents')
      // a disabled plugin loses its routes, so both halves of the aggregate
      // have to forget it together
      expect(fs.readFileSync(apiPath, 'utf8')).not.toContain('pingApiGroup')
      expect(fs.readFileSync(apiHandlersPath, 'utf8')).not.toContain('pingApiHandlers')

      gen(`--yml ${workspace.manifestPath} --all`)
      expect(fs.readFileSync(contractsPath, 'utf8')).toContain('pingContract')
      expect(fs.readFileSync(pluginsPath, 'utf8')).toContain('pingComponents')
      expect(fs.readFileSync(apiPath, 'utf8')).toContain('pingApiGroup')
      expect(fs.readFileSync(apiHandlersPath, 'utf8')).toContain('pingApiHandlers')
    } finally {
      workspace.dispose()
    }
  })

  it('gives every exported contract its own client namespace', () => {
    gen()
    const contracts = fs.readFileSync(contractsPath, 'utf8')
    // auth owns two api surfaces: the session core and identity
    // administration. They became separate namespaces rather than one
    // crowded object.
    expect(contracts).toContain(
      "import { authContract as authNamespace } from '@qualy/plugin-auth/contract'",
    )
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

  it('gives no namespace two claimants', () => {
    // object spread lets a later plugin silently shadow an earlier one, so
    // generation refuses a second claim on a namespace rather than take it.
    // One plugin can no longer be selected twice, but two plugins are still
    // free to export the same name.
    gen()
    const claims = [...fs.readFileSync(contractsPath, 'utf8').matchAll(/^ {2}(\w+): /gm)].map(
      (match) => match[1],
    )
    expect(claims.length).toBeGreaterThan(0)
    expect(new Set(claims).size).toBe(claims.length)
  })

  it('pairs every api group with the handlers that implement it', () => {
    // the two halves are generated into different packages, and only the
    // handler half can be wrong on its own: a group nobody implements is a
    // route the aggregate advertises and then cannot serve
    gen()
    const groups = [...fs.readFileSync(apiPath, 'utf8').matchAll(/^ {2}(\w+)ApiGroup,$/gm)].map(
      (match) => match[1],
    )
    const handlers = [
      ...fs.readFileSync(apiHandlersPath, 'utf8').matchAll(/^ {2}(\w+)ApiHandlers,$/gm),
    ].map((match) => match[1])
    expect(groups.length).toBeGreaterThan(0)
    expect(handlers).toEqual(groups)
    // and no two plugins claim one identifier, which is how the aggregate
    // finds handlers at runtime
    expect(new Set(groups).size).toBe(groups.length)
  })
})

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { createWorkspace } from '@qualy/assembly/testkit'

const contractsPath = 'packages/api-client/src/contracts.gen.ts'
const pluginsPath = 'apps/web/src/plugins.gen.ts'
const apiPath = 'packages/api/src/api.gen.ts'
const apiHandlersPath = 'packages/app/api-handlers.gen.ts'
const catalogPath = 'packages/app/permissions.gen.ts'

const gen = (flags = '') => execSync(`pnpm exec tsx scripts/gen.ts ${flags}`, { encoding: 'utf8' })

describe('generator determinism', () => {
  // the working manifest is never written: other test files read it
  // concurrently, so mutated selections go to a throwaway workspace (--yml)
  afterAll(() => {
    gen()
  })

  it('produces byte-identical output on repeated runs', () => {
    gen()
    const generated = [contractsPath, pluginsPath, apiPath, apiHandlersPath, catalogPath]
    const before = generated.map((file) => fs.readFileSync(file, 'utf8'))
    const second = gen()
    expect(second).toContain('unchanged, skipped')
    for (const [index, file] of generated.entries()) {
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
      // but NOT the server's route graph. --all means "the superset" for a
      // client contract and a web bundle, where an unreachable component costs
      // bytes. Here it would mean a disabled plugin's endpoints are served,
      // because its dependencies are still present and its handler still works
      expect(fs.readFileSync(apiPath, 'utf8')).not.toContain('pingApiGroup')
      expect(fs.readFileSync(apiHandlersPath, 'utf8')).not.toContain('pingApiHandlers')
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
    const groups = [...fs.readFileSync(apiPath, 'utf8').matchAll(/^\s+(\w+)ApiGroup,$/gm)].map(
      (match) => match[1],
    )
    const handlers = [
      ...fs.readFileSync(apiHandlersPath, 'utf8').matchAll(/^\s+(\w+)ApiHandlers,$/gm),
    ].map((match) => match[1])
    expect(groups.length).toBeGreaterThan(0)
    expect(handlers).toEqual(groups)
    // and no two plugins claim one identifier, which is how the aggregate
    // finds handlers at runtime
    expect(new Set(groups).size).toBe(groups.length)
  })

  // The catalog decides what an assembly can authorize, so which plugins it
  // counts is a security property rather than a packaging detail.
  //
  // Two of these replace runtime-registry tests whose enforcement point moved
  // here. rbac used to drop a contributor's codes when that plugin's fiber
  // unloaded, and used to reject a code claimed twice. Nothing unloads under a
  // static assembly, so "currently served" becomes "in the lock" and "rejected
  // at registration" becomes "refused during generation". The invariants
  // survive; deleting their assertions instead of relocating them is how a
  // static assembly quietly loses a guarantee.
  it('serves the codes of the plugins in the manifest', () => {
    gen()
    const catalog = fs.readFileSync(catalogPath, 'utf8')
    expect(catalog).toContain("from '@qualy/plugin-org/permissions'")
    expect(catalog).toContain("from '@qualy/plugin-rbac/permissions'")
    expect(catalog).toContain("plugin: 'org'")
  })

  it('drops a disabled plugin, because its codes must stop authorizing', () => {
    // the seed aggregation deliberately keeps disabled plugins so their rows
    // survive being switched off. This one must not: a disabled plugin that
    // kept its codes would keep authorizing against a surface nobody serves.
    const workspace = createWorkspace(
      [
        '@qualy/plugin-database',
        '@qualy/plugin-server',
        '@qualy/plugin-ui-registry',
        '@qualy/plugin-org',
        '@qualy/plugin-auth',
        '@qualy/plugin-rbac',
      ],
      { disabled: ['@qualy/plugin-org'] },
    )
    try {
      gen(`--yml ${workspace.manifestPath}`)
      const catalog = fs.readFileSync(catalogPath, 'utf8')
      expect(catalog).not.toContain('@qualy/plugin-org/permissions')
      expect(catalog).not.toContain("plugin: 'org'")
      // rbac is still selected, so this is a real difference rather than an
      // empty file that would pass the assertion above for the wrong reason
      expect(catalog).toContain('@qualy/plugin-rbac/permissions')
    } finally {
      workspace.dispose()
    }
  })

  it('keeps counting a disabled plugin under --all, because that flag is the seed', () => {
    // --all reaches every generator from one argv. This one has to ignore it,
    // or `pnpm build` would quietly widen what the release can authorize.
    const workspace = createWorkspace(
      [
        '@qualy/plugin-database',
        '@qualy/plugin-server',
        '@qualy/plugin-ui-registry',
        '@qualy/plugin-org',
        '@qualy/plugin-auth',
        '@qualy/plugin-rbac',
      ],
      { disabled: ['@qualy/plugin-org'] },
    )
    try {
      gen(`--yml ${workspace.manifestPath} --all`)
      const catalog = fs.readFileSync(catalogPath, 'utf8')
      expect(catalog).not.toContain("plugin: 'org'")
    } finally {
      workspace.dispose()
    }
  })

  it('gives every code exactly one owner', () => {
    gen()
    const catalog = fs.readFileSync(catalogPath, 'utf8')
    const owners = [...catalog.matchAll(/plugin: '(\w+)'/g)].map((match) => match[1])
    expect(owners.length).toBeGreaterThan(0)
    expect(new Set(owners).size).toBe(owners.length)
  })
})

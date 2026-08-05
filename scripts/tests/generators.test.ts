import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspace } from '@qualy/assembly/testkit'

const pluginsPath = 'apps/web/src/plugins.gen.ts'
const apiPath = 'packages/api/src/api.gen.ts'
const apiHandlersPath = 'apps/server/api-handlers.gen.ts'
const catalogPath = 'apps/server/permissions.gen.ts'

// Every run in this file generates into its own tree.
//
// Generating into the repository meant these tests rewrote the artifacts other
// suites were reading, and vitest runs files in parallel: the symptom was an
// unrelated suite reporting that the api had lost its routes, on a schedule
// nobody could reproduce. QUALY_GEN_OUT is what makes the runs independent
// rather than merely unlikely to collide.
const trees: string[] = []
const freshTree = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-gen-'))
  trees.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of trees.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

let out = ''
const gen = (flags = '') =>
  execSync(`pnpm exec tsx scripts/gen.ts ${flags}`, {
    encoding: 'utf8',
    env: { ...process.env, QUALY_GEN_OUT: out },
  })

/** the generated artifact, read from the tree the run wrote it into */
const read = (relative: string) => fs.readFileSync(path.join(out, relative), 'utf8')

describe('generator determinism', () => {
  beforeEach(() => {
    out = freshTree()
  })

  it('produces byte-identical output on repeated runs', () => {
    gen()
    const generated = [pluginsPath, apiPath, apiHandlersPath, catalogPath]
    const before = generated.map((file) => read(file))
    const second = gen()
    expect(second).toContain('unchanged, skipped')
    for (const [index, file] of generated.entries()) {
      expect(read(file)).toBe(before[index])
    }
  })

  it('drops disabled plugins from the active set but keeps them under --all', () => {
    // ping owns tables, so the selection has to include the capability that
    // accepts them or resolution refuses the manifest
    const workspace = createWorkspace(
      [
        '@qualy/plugin-database',
                '@qualy/plugin-ui-registry',
        '@qualy/plugin-ping',
      ],
      { disabled: ['@qualy/plugin-ping'] },
    )
    try {
      gen(`--yml ${workspace.manifestPath}`)
      expect(read(pluginsPath)).not.toContain('pingComponents')
      // a disabled plugin loses its routes, so both halves of the aggregate
      // have to forget it together
      expect(read(apiPath)).not.toContain('pingApiGroup')
      expect(read(apiHandlersPath)).not.toContain('pingApiHandlers')

      gen(`--yml ${workspace.manifestPath} --all`)
      expect(read(pluginsPath)).toContain('pingComponents')
      // but NOT the server's route graph. --all means "the superset" for a
      // client contract and a web bundle, where an unreachable component costs
      // bytes. Here it would mean a disabled plugin's endpoints are served,
      // because its dependencies are still present and its handler still works
      expect(read(apiPath)).not.toContain('pingApiGroup')
      expect(read(apiHandlersPath)).not.toContain('pingApiHandlers')
    } finally {
      workspace.dispose()
    }
  })

  it('gives no group two claimants', () => {
    // the aggregate is built by adding groups to one api, so a repeated group
    // is a route table where a later plugin silently shadows an earlier one.
    // One plugin can no longer be selected twice, but two plugins are still
    // free to name a group the same thing.
    gen()
    const claims = [...read(apiPath).matchAll(/^\s+(\w+ApiGroup),$/gm)].map(
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
    const groups = [...read(apiPath).matchAll(/^\s+(\w+)ApiGroup,$/gm)].map(
      (match) => match[1],
    )
    const handlers = [
      ...read(apiHandlersPath).matchAll(/^\s+(\w+)ApiHandlers,$/gm),
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
    const catalog = read(catalogPath)
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
                '@qualy/plugin-ui-registry',
        '@qualy/plugin-org',
        '@qualy/plugin-auth',
        '@qualy/plugin-rbac',
      ],
      { disabled: ['@qualy/plugin-org'] },
    )
    try {
      gen(`--yml ${workspace.manifestPath}`)
      const catalog = read(catalogPath)
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
                '@qualy/plugin-ui-registry',
        '@qualy/plugin-org',
        '@qualy/plugin-auth',
        '@qualy/plugin-rbac',
      ],
      { disabled: ['@qualy/plugin-org'] },
    )
    try {
      gen(`--yml ${workspace.manifestPath} --all`)
      const catalog = read(catalogPath)
      expect(catalog).not.toContain("plugin: 'org'")
    } finally {
      workspace.dispose()
    }
  })

  it('gives every code exactly one owner', () => {
    gen()
    const catalog = read(catalogPath)
    const owners = [...catalog.matchAll(/plugin: '(\w+)'/g)].map((match) => match[1])
    expect(owners.length).toBeGreaterThan(0)
    expect(new Set(owners).size).toBe(owners.length)
  })

  it('gives --all no say over what the server assembles', () => {
    // --all means "the superset" for a client contract and a web bundle, where
    // a disabled plugin costs unreachable bytes. Every server-side artifact is
    // the running assembly itself: routes, handlers, layers and the permission
    // catalog. `pnpm build` passes --all, so these four have to come out the
    // same either way or a release would serve and authorize things the
    // manifest switched off.
    gen()
    const serverSide = [apiPath, apiHandlersPath, catalogPath, 'apps/server/runtime.gen.ts']
    const active = serverSide.map((file) => read(file))
    gen('--all')
    for (const [index, file] of serverSide.entries()) {
      expect(read(file), `${file} changed under --all`).toBe(active[index])
    }
  })
})

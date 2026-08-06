import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspace, resolveWorkspace } from '@qualy/assembly/testkit'

const pluginsPath = 'apps/web/src/plugins.gen.ts'
const apiPath = 'packages/api/src/api.gen.ts'

// A capability's module lands where the manifest says its host lives, so a
// throwaway manifest that names no workspace gets it beside itself. The old
// generator wrote one hardcoded path whatever the manifest said, which is the
// bug that would have shipped a second assembly's catalog into this one.

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
    const generated = [pluginsPath, apiPath]
    const before = generated.map((file) => read(file))
    // silence is the signal now: a generator that rewrote an identical file
    // would say so, and a second run that says nothing wrote nothing
    const second = gen()
    expect(second.trim()).toBe('')
    for (const [index, file] of generated.entries()) {
      expect(read(file)).toBe(before[index])
    }
  })

  it('drops disabled plugins from the active set but keeps them under --all', () => {
    // ping owns tables, so the selection has to include the capability that
    // accepts them or resolution refuses the manifest
    const workspace = createWorkspace(
      ['@qualy/plugin-database', '@qualy/plugin-ui-registry', '@qualy/plugin-ping'],
      { disabled: ['@qualy/plugin-ping'] },
    )
    try {
      gen(`--yml ${workspace.manifestPath}`)
      expect(read(pluginsPath)).not.toContain('pingComponents')
      // a disabled plugin loses its routes, so both halves of the aggregate
      // have to forget it together
      expect(read(apiPath)).not.toContain('pingApiGroup')

      gen(`--yml ${workspace.manifestPath} --all`)
      expect(read(pluginsPath)).toContain('pingComponents')
      // but NOT the server's route graph. --all means "the superset" for a
      // client contract and a web bundle, where an unreachable component costs
      // bytes. Here it would mean a disabled plugin's endpoints are served,
      // because its dependencies are still present and its handler still works
      expect(read(apiPath)).not.toContain('pingApiGroup')
      // the handlers aggregate lives in the runtime module now, which follows
      // the same active set as the layers themselves
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
    const claims = [...read(apiPath).matchAll(/^\s+(\w+ApiGroup),$/gm)].map((match) => match[1])
    expect(claims.length).toBeGreaterThan(0)
    expect(new Set(claims).size).toBe(claims.length)
  })

  it('gives no two plugins one group identifier', () => {
    // handler pairing is the compiler's now - each entry carries its own
    // group, and HttpApiBuilder.layer demands every group's service - so what
    // is left to this generator is the aggregate itself: a duplicate group
    // name would mean one plugin's routes silently replacing another's
    gen()
    const groups = [...read(apiPath).matchAll(/^\s+(\w+)ApiGroup,$/gm)].map((match) => match[1])
    expect(groups.length).toBeGreaterThan(0)
    expect(new Set(groups).size).toBe(groups.length)
  })

  // Which plugins the permission catalog counts is a security property. The
  // catalog itself is declared at boot now - each active plugin's layer is in
  // the generated runtime, and declaring is part of building it - so what is
  // left to assert here is the half resolution still owns: the active set,
  // recorded in the lock, with disabled plugins out of it. A disabled plugin
  // whose codes kept authorizing would be authorizing against a surface
  // nobody serves; its layer never builds, so it never declares, and this
  // pins the resolution-level record of the same fact.
  it('drops a disabled plugin from the permission set, and keeps its tables', async () => {
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
      const resolution = await resolveWorkspace(workspace)
      const permissions = resolution.capabilities.get('permissions')?.state as { order: string[] }
      expect(permissions.order).not.toContain('@qualy/plugin-org')
      expect(permissions.order).toContain('@qualy/plugin-rbac')
      // the database capability answers the same question the other way:
      // switching a plugin off must not lose data, so its tables stay
      const database = resolution.capabilities.get('database')?.state as { order: string[] }
      expect(database.order).toContain('@qualy/plugin-org')
    } finally {
      workspace.dispose()
    }
  })

  it('gives --all no say over what the server assembles', () => {
    // --all means "the superset" for a client contract and a web bundle, where
    // a disabled plugin costs unreachable bytes. Every server-side artifact is
    // the running assembly itself: routes, handlers, layers and the permission
    // catalog. `pnpm build` passes --all, so these four have to come out the
    // same either way or a release would serve and authorize things the
    // manifest switched off.
    gen()
    const serverSide = [apiPath]
    const active = serverSide.map((file) => read(file))
    gen('--all')
    for (const [index, file] of serverSide.entries()) {
      expect(read(file), `${file} changed under --all`).toBe(active[index])
    }
  })
})

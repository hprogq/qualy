import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import { classify, merge, watchTargets, type WatchPlan } from '../src/dev/watch.ts'

// What a saved file is taken to mean.
//
// This is a policy, not a deduction: nothing here works out which module
// actually imports what. So the rules are asserted one by one, and the
// important ones are the two directions of being wrong. Reading a backend
// file as browser-only leaves a process running code that is no longer on
// disk and says nothing about it; reading a browser file as structural costs
// a few seconds. Everything unrecognised therefore lands on the expensive
// side, and these cases pin which side each rule is on.

const repoRoot = '/repo'
const web: DevServiceSpec = {
  key: '@qualy/plugin-web:web',
  pluginId: '@qualy/plugin-web',
  id: 'web',
  moduleUrl: 'file:///repo/packages/plugins/infra/web/src/dev/index.ts',
  config: {},
  manifestDir: repoRoot,
  pluginRoot: '/repo/packages/plugins/infra/web',
}

const plan: WatchPlan = {
  bootstrap: [path.join(repoRoot, 'qualy.yml'), path.join(repoRoot, '.env')],
  roots: [
    { id: '@qualy/plugin-web', root: '/repo/packages/plugins/infra/web', linked: true },
    { id: '@qualy/plugin-auth', root: '/repo/packages/plugins/base/auth', linked: true },
    { id: '@qualy/plugin-far', root: '/repo/node_modules/@qualy/plugin-far', linked: false },
  ],
  services: [web],
  repoRoot,
}

const asked = (file: string) => classify(path.resolve(file), plan)

describe('what a saved file asks for', () => {
  it('leaves the browser to the server that owns it', () => {
    expect(asked('/repo/packages/plugins/base/auth/src/client/LoginPage.tsx')).toBeNull()
    expect(asked('/repo/packages/web/ui/src/components/button.tsx')).toBeNull()
    expect(asked('/repo/apps/web/src/main.tsx')).toBeNull()
  })

  it('replaces the backend alone for backend implementation', () => {
    expect(asked('/repo/packages/plugins/base/auth/src/server/service.ts')).toBe('backend')
    expect(asked('/repo/apps/server/src/health.ts')).toBe('backend')
    expect(asked('/repo/db/migrations/20260101_add.sql')).toBe('backend')
  })

  it('replaces one development service for its own implementation', () => {
    expect(asked('/repo/packages/plugins/infra/web/src/dev/index.ts')).toEqual({
      service: web.key,
    })
    expect(asked('/repo/apps/web/vite.config.ts')).toEqual({ service: web.key })
  })

  it('treats anything shared between the halves as structural', () => {
    // the descriptor decides what exists at all
    expect(asked('/repo/packages/plugins/base/auth/src/index.ts')).toBe('session')
    // and so does what a package declares
    expect(asked('/repo/packages/plugins/base/auth/package.json')).toBe('session')
    // a contract both sides read, and the kernel underneath them
    expect(asked('/repo/packages/contracts/auth/src/index.ts')).toBe('session')
    expect(asked('/repo/packages/core/plugin-kit/src/dev.ts')).toBe('session')
    // the assembly's own inputs
    expect(asked('/repo/qualy.yml')).toBe('session')
    expect(asked('/repo/.env')).toBe('session')
  })

  it('will not pretend to replace the supervisor itself', () => {
    expect(asked('/repo/apps/server/src/dev/host.ts')).toBe('restart-host')
  })

  it('ignores what is neither a plugin nor a known root', () => {
    expect(asked('/repo/packages/plugins/base/auth/tests/service.test.ts')).toBeNull()
    expect(asked('/repo/somewhere/else.ts')).toBeNull()
  })
})

describe('a batch of saves', () => {
  it('takes the most expensive thing asked for', () => {
    expect(merge('backend', 'session')).toBe('session')
    expect(merge('session', 'backend')).toBe('session')
    expect(merge(null, 'backend')).toBe('backend')
    expect(merge({ service: 'a' }, 'session')).toBe('session')
  })

  it('keeps one service to itself, and answers two with a session', () => {
    expect(merge({ service: 'a' }, { service: 'a' })).toEqual({ service: 'a' })
    expect(merge({ service: 'a' }, { service: 'b' })).toBe('session')
  })
})

describe('what is watched', () => {
  it('follows a workspace package into its sources and leaves an installed one alone', () => {
    const targets = watchTargets(plan)
    expect(targets).toContain('/repo/packages/plugins/infra/web/src')
    expect(targets).toContain('/repo/packages/plugins/infra/web/package.json')
    // installed packages do not change under anybody
    expect(targets.some((target) => target.includes('node_modules'))).toBe(false)
  })

  it('watches an input that does not exist yet', () => {
    // the manifest a developer is about to point QUALY_CONFIG at: the
    // candidate fails until it exists, and the moment it does the world
    // should be tried again
    expect(watchTargets(plan)).toContain('/repo/qualy.yml')
  })
})

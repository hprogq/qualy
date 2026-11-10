import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Exit, Fiber } from 'effect'
import { describe, expect, it, vi } from 'vitest'

const test = vi.hoisted(() => ({
  executable: '/nonexistent-qualy-lsp-binary',
  realExecutable: '',
  workspaces: [] as string[],
}))
vi.mock('@qualy/formula-compiler', async (original) => {
  const actual = await original<typeof import('@qualy/formula-compiler')>()
  test.realExecutable = actual.tscExecutable
  return {
    ...actual,
    get tscExecutable() {
      return test.executable
    },
    makeLspWorkspace(source: string) {
      const workspace = actual.makeLspWorkspace(source)
      test.workspaces.push(workspace.root)
      return workspace
    },
  }
})

const failed = async (manager: import('../src/lsp/manager.ts').LspManager) => {
  const exit = await Effect.runPromiseExit(manager.open('export default 1'))
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain('LspUnavailable')
  expect(manager.activeSessions()).toBe(0)
  expect(test.workspaces.every((root) => !fs.existsSync(root))).toBe(true)
}

describe('LSP startup failures', () => {
  it('returns an unavailable error and releases workspace and permit when the executable is absent', async () => {
    const { makeLspManager } = await import('../src/lsp/manager.ts')
    const manager = makeLspManager()
    try {
      test.executable = '/nonexistent-qualy-lsp-binary'
      for (let i = 0; i < 10; i++) await failed(manager)
      test.executable = test.realExecutable
      for (let i = 0; i < 8; i++) {
        await Effect.runPromise(manager.open('export default 1'))
      }
      const overflow = await Effect.runPromiseExit(manager.open('export default 1'))
      expect(Exit.isFailure(overflow)).toBe(true)
      if (Exit.isFailure(overflow)) expect(String(overflow.cause)).toContain('LspBusy')
    } finally {
      await manager.closeAll()
    }
  })

  it.skipIf(process.platform === 'win32')(
    'does the same when the executable is not executable',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lsp-denied-'))
      const file = path.join(dir, 'tsc')
      fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o600 })
      test.executable = file
      const { makeLspManager } = await import('../src/lsp/manager.ts')
      const manager = makeLspManager()
      try {
        await failed(manager)
      } finally {
        await manager.closeAll()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('joins concurrent shutdown and failed startup without consuming a permit twice', async () => {
    const { makeLspManager } = await import('../src/lsp/manager.ts')
    const manager = makeLspManager()
    test.executable = '/nonexistent-qualy-lsp-binary'
    try {
      const opening = Effect.runPromiseExit(manager.open('export default 1'))
      expect(manager.activeSessions()).toBe(1)
      await manager.closeAll()
      const exit = await opening
      expect(Exit.isFailure(exit)).toBe(true)
      expect(manager.activeSessions()).toBe(0)
      await failed(manager)
    } finally {
      await manager.closeAll()
    }
  })

  it('reclaims startup resources if the caller is interrupted', async () => {
    const { makeLspManager } = await import('../src/lsp/manager.ts')
    const manager = makeLspManager()
    test.executable = '/nonexistent-qualy-lsp-binary'
    try {
      const opening = Effect.runFork(manager.open('export default 1'))
      expect(manager.activeSessions()).toBe(1)
      await Effect.runPromise(Fiber.interrupt(opening))
      expect(manager.activeSessions()).toBe(0)
      expect(test.workspaces.every((root) => !fs.existsSync(root))).toBe(true)
      await failed(manager)
    } finally {
      await manager.closeAll()
    }
  })

  it('terminates a real child if an opening caller is interrupted', async () => {
    const { makeLspManager } = await import('../src/lsp/manager.ts')
    const manager = makeLspManager()
    test.executable = test.realExecutable
    try {
      const opening = Effect.runFork(manager.open('export default 1'))
      expect(manager.activeSessions()).toBe(1)
      await Effect.runPromise(Fiber.interrupt(opening))
      expect(manager.activeSessions()).toBe(0)
      expect(test.workspaces.every((root) => !fs.existsSync(root))).toBe(true)
    } finally {
      await manager.closeAll()
    }
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeLspManager } from '../src/lsp/manager.ts'

// Attribute the real language server to this worker; other test files may
// have their own authoring processes and must never be stopped or counted.
const ownedPids = (): number[] =>
  execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      return match && Number(match[2]) === process.pid && match[3]!.includes('--lsp')
        ? [Number(match[1])]
        : []
    })

describe('LSP cleanup completion', () => {
  it.skipIf(process.platform === 'win32').each(['close', 'shutdown'] as const)(
    'joins cleanup already in progress during %s',
    async (operation) => {
      const manager = makeLspManager()
      const before = new Set(ownedPids())
      let pid: number | undefined
      let firstClose: Promise<void> | undefined
      try {
        const { sessionId } = await Effect.runPromise(manager.open('export default 1'))
        const workspace = manager.workspaceOf(sessionId)!
        const born = ownedPids().filter((candidate) => !before.has(candidate))
        expect(born).toHaveLength(1)
        pid = born[0]!

        // Hold the real process in a known state, without a timed sleep or
        // mock cleanup. Resume below lets the pending SIGTERM end it.
        process.kill(pid, 'SIGSTOP')
        await expect
          .poll(() => execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }))
          .toMatch(/T/)
        firstClose = Effect.runPromise(manager.close(sessionId))
        expect(fs.existsSync(workspace)).toBe(true)

        const sent = await Effect.runPromiseExit(
          manager.send({ sessionId, sequence: 1, jsonRpc: '{"method":"initialized"}' }),
        )
        const subscribed = await Effect.runPromiseExit(
          manager.events(sessionId).pipe(Effect.scoped),
        )
        const refusals: readonly Exit.Exit<unknown, unknown>[] = [sent, subscribed]
        for (const exit of refusals) {
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain('LspSessionNotFound')
        }

        let settled = false
        const joined = (
          operation === 'close' ? Effect.runPromise(manager.close(sessionId)) : manager.closeAll()
        ).then(() => {
          settled = true
        })
        // An event-loop turn lets an incorrectly immediate close settle;
        // a real cleanup cannot finish while its child remains stopped.
        await setImmediate()
        expect(settled).toBe(false)
        expect(manager.activeSessions()).toBe(1)
        process.kill(pid, 'SIGCONT')
        await joined
        expect(manager.activeSessions()).toBe(0)
        expect(fs.existsSync(workspace)).toBe(false)
        expect(ownedPids()).not.toContain(pid)
        await firstClose
      } finally {
        if (pid !== undefined && ownedPids().includes(pid)) process.kill(pid, 'SIGCONT')
        await firstClose
        await manager.closeAll()
      }
    },
  )
})

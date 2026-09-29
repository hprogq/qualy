import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Effect, Fiber, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { WorkerPool } from '@qualy/sandbox-engine'
import { Pool, runtimeServer } from '../src/serve.ts'

// The property the process owes a deployment: nothing can connect before the
// pool it answers from is up. Proved against the composition the entry runs,
// with a pool that comes up when the test says so.

const connects = (socketPath: string) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(socketPath)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

describe('the runtime sandbox', () => {
  it('opens its socket only once the pool it answers from is up', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-serve-'))
    const socketPath = path.join(dir, 'runtime.sock')
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slowPool = Layer.effect(
      Pool,
      Effect.acquireRelease(
        Effect.promise(async () => {
          await gate
          return new WorkerPool({ size: 1, variant: 'release' })
        }),
        (pool) => Effect.promise(() => pool.shutdown()),
      ),
    )
    const serving = Effect.runFork(Layer.launch(runtimeServer(socketPath, slowPool)))
    try {
      await new Promise((settle) => setTimeout(settle, 300))
      // the pool is still coming up: there is no socket to reach
      expect(fs.existsSync(socketPath)).toBe(false)
      expect(await connects(socketPath)).toBe(false)
      release()
      await expect.poll(() => connects(socketPath), { timeout: 5_000 }).toBe(true)
    } finally {
      await Effect.runPromise(Fiber.interrupt(serving))
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

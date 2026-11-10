import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Effect, Fiber } from 'effect'
import { expect, it, vi } from 'vitest'
import { makeCompileQueue } from '../src/compile-queue.ts'

it('keeps the compiler slot until an interrupted child exits and its workspace is removed', async () => {
  const queue = makeCompileQueue(2)
  const children: ChildProcess[] = []
  const directories: string[] = []
  const started = vi.fn()
  const work = () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'qualy-compile-queue-'))
      directories.push(directory)
      const child = spawn(
        process.execPath,
        ['-e', "process.send('ready'); process.on('message', () => process.exit(0))"],
        {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      children.push(child)
      const exited = once(child, 'exit')
      try {
        await once(child, 'message')
        started()
        await exited
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  try {
    const first = Effect.runFork(queue.run(work))
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1))
    const interrupted = Effect.runPromise(Fiber.interrupt(first))
    const second = Effect.runFork(queue.run(work))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(started).toHaveBeenCalledTimes(1)
    expect((await stat(directories[0]!)).isDirectory()).toBe(true)
    children[0]!.send('stop')
    await interrupted
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2))
    await expect(stat(directories[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    children[1]!.send('stop')
    await Effect.runPromise(Fiber.join(second))
    await expect(stat(directories[1]!)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    for (const child of children) child.kill()
    for (const directory of directories) await rm(directory, { recursive: true, force: true })
  }
})

it('bounds the queue and removes a cancelled waiter without starting it', async () => {
  const queue = makeCompileQueue(2)
  let release!: () => void
  let started!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const first = Effect.runFork(
    queue.run(() =>
      Effect.promise(async () => {
        started()
        await held
      }),
    ),
  )
  await ready
  const waiting = vi.fn()
  const second = Effect.runFork(queue.run(() => Effect.sync(waiting)))
  const refused = await Effect.runPromise(queue.run(() => Effect.void).pipe(Effect.result))
  expect(refused).toMatchObject({ _tag: 'Failure', failure: { _tag: 'CompileBusy' } })
  await Effect.runPromise(Fiber.interrupt(second))
  expect(waiting).not.toHaveBeenCalled()
  const third = Effect.runFork(queue.run(() => Effect.sync(waiting)))
  release()
  await Effect.runPromise(Fiber.join(first))
  await Effect.runPromise(Fiber.join(third))
  expect(waiting).toHaveBeenCalledTimes(1)
})

it('releases the slot after the compiler promise rejects', async () => {
  const queue = makeCompileQueue(1)
  const failed = await Effect.runPromiseExit(
    queue.run(() => Effect.promise(() => Promise.reject(new Error('compiler failed')))),
  )
  expect(failed._tag).toBe('Failure')
  expect(await Effect.runPromise(queue.run(() => Effect.succeed('next')))).toBe('next')
})

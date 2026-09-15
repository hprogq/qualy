import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { developmentEnv } from '../src/dev/env.ts'

// What one development session's environment is, and when it is read.
//
// The interesting case is not a file. `.env` may be a named PIPE that a
// secret manager mounts and writes into on every open, so the values never
// touch the disk - and a pipe is not a file that happens to be somewhere
// else. Each open takes one turn from the writer, and an open with no writer
// blocks with no timeout and no error. So "read it again" is not a cheap
// thing done twice; it is a different question, and sometimes no answer.
//
// These cases use a real pipe with a real writer, because the properties
// being asserted are the operating system's rather than this code's. The
// writer counts how many turns it has given, which is what makes "once"
// something observed rather than claimed.

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const workspace = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-env-'))
  made.push(dir)
  return dir
}

/**
 * A pipe at `.env` and something on the other end of it.
 *
 * One writer per open, the way a secret agent's hook behaves: the path holds
 * nothing until somebody reads it, and reading is what produces the content.
 */
const mountedEnv = (dir: string, body: string) => {
  const file = path.join(dir, '.env')
  execFileSync('mkfifo', [file])
  const writer: ChildProcess = spawn(
    'bash',
    ['-c', 'while true; do printf %s "$1" > "$2"; done', 'writer', body, file],
    { stdio: 'ignore' },
  )
  return { file, stop: () => writer.kill('SIGKILL') }
}

/**
 * Whether reading this path finishes at all, given a second to do it in.
 *
 * In a child, because the answer for a pipe with no writer is "no": the open
 * blocks with no timeout and no error, and a call in this process would hang
 * the suite rather than fail it.
 */
const readingFinishes = (file: string): boolean => {
  try {
    execFileSync(
      process.execPath,
      ['-e', `require('fs').readFileSync(${JSON.stringify(file)}, 'utf8')`],
      { timeout: 1_000, stdio: 'ignore' },
    )
    return true
  } catch {
    return false
  }
}

describe("a development session's environment", () => {
  it('reads a plain .env and lets the shell override it', () => {
    const dir = workspace()
    fs.writeFileSync(path.join(dir, '.env'), 'PORT=3111\nDATABASE_URL=postgres://file/x\n')
    const env = developmentEnv({
      envFile: path.join(dir, '.env'),
      manifest: '/repo/qualy.yml',
      shell: { PORT: '3222' },
    })
    // the file is the baseline and what somebody typed in front of the
    // command wins, which is the only order anyone expects
    expect(env.PORT).toBe('3222')
    expect(env.DATABASE_URL).toBe('postgres://file/x')
    expect(env.NODE_ENV).toBe('development')
    expect(env.QUALY_DEV_SUPERVISED).toBe('1')
    expect(env.QUALY_CONFIG).toBe('/repo/qualy.yml')
  })

  it('runs with no .env at all', () => {
    const env = developmentEnv({
      envFile: path.join(workspace(), '.env'),
      manifest: '/repo/qualy.yml',
      shell: {},
    })
    expect(env.NODE_ENV).toBe('development')
    expect(env.PORT).toBeUndefined()
  })

  it('reads a mounted .env, and says that it is one', () => {
    const dir = workspace()
    const mounted = mountedEnv(dir, 'PORT=3111\nQUALY_MOUNTED=yes\n')
    try {
      const notices: string[] = []
      const env = developmentEnv({
        envFile: mounted.file,
        manifest: '/repo/qualy.yml',
        shell: {},
        notice: (message) => notices.push(message),
      })
      expect(env.QUALY_MOUNTED).toBe('yes')
      expect(env.PORT).toBe('3111')
      // and the terminal is told, because this read is also the one thing here
      // that can hang - see the case below for why
      expect(notices).toEqual(['.env is a mounted environment; reading it once for this session'])
    } finally {
      mounted.stop()
    }
  })

  it('cannot be read a second time once the writer is gone', () => {
    // This is what makes reading ONCE a rule rather than a saving. A pipe hands
    // out one turn per open and there may be no next turn: with the writer gone
    // the open blocks, with no timeout and nothing said. A supervisor that
    // re-read `.env` per reload would stop there - measured against the real
    // `pnpm dev`, which went on answering on the old backend while every save
    // after that did nothing. Details in docs/notes/mounted-env.md.
    const dir = workspace()
    const mounted = mountedEnv(dir, 'PORT=3111\n')
    expect(readingFinishes(mounted.file)).toBe(true)
    mounted.stop()
    expect(readingFinishes(mounted.file)).toBe(false)
    // an ordinary file is readable as many times as anybody likes, which is
    // the contrast the rule exists for
    const plain = path.join(dir, 'plain.env')
    fs.writeFileSync(plain, 'PORT=3111\n')
    expect(readingFinishes(plain)).toBe(true)
    expect(readingFinishes(plain)).toBe(true)
  })

  it('says nothing about a .env that is an ordinary file', () => {
    const dir = workspace()
    fs.writeFileSync(path.join(dir, '.env'), 'PORT=3111\n')
    const notices: string[] = []
    developmentEnv({
      envFile: path.join(dir, '.env'),
      manifest: '/repo/qualy.yml',
      shell: {},
      notice: (message) => notices.push(message),
    })
    expect(notices).toEqual([])
  })
})

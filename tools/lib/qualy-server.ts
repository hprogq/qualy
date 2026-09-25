import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { HEALTH_READY_PATH } from '@qualy/api-kit'
import { repoRoot } from './manifest.ts'

// Starting the server the way a deployment does, and stopping it the way an
// orchestrator does.
//
// Four tools needed this and four tools wrote it: the production smoke, the
// enforced-policy gate, the brand recorder and the benchmark driver. The
// spawn was the same in all of them, and the parts that were NOT the same are
// the parts that matter - how long readiness may take, whether SIGTERM is
// given time to run the finalizers, whether a process that ignores it is
// killed. Those had already drifted: 90s and 10s deadlines for the same
// readiness, one tool waiting for the exit after SIGTERM and another not
// waiting at all.
//
// So this is not here to save the twenty lines. It is here so that "ready"
// and "stopped" mean one thing, and so that a change to either is made once.
// What stays with each caller is what it actually asserts.

export interface QualyServer {
  readonly pid: number
  /** `http://127.0.0.1:<port>`; the loopback literal, because that is what was bound */
  readonly base: string
  /** everything the process has written, in order */
  readonly output: () => string
  /** the exit code or signal once it is gone, and null while it is running */
  readonly exited: () => string | null
  /** resolves when the readiness probe answers, and throws if it never does */
  readonly waitUntilReady: (options?: { readonly timeoutMs?: number }) => Promise<void>
  /**
   * A stop signal, then the exit. A deployment's rolling restart waits for
   * this, so a tool that does not wait is not testing what a deployment does.
   *
   * SIGTERM unless a caller says otherwise: that is what a supervisor sends.
   * SIGINT is the same request from a keyboard, and the process answers it
   * differently in one respect only - what it says while starting.
   */
  readonly stop: (options?: {
    readonly timeoutMs?: number
    readonly signal?: 'SIGTERM' | 'SIGINT'
  }) => Promise<{
    readonly exitCode: number | null
    readonly timedOut: boolean
    readonly ms: number
  }>
  readonly kill: () => void
}

export interface QualyServerOptions {
  readonly port: number | string
  /**
   * Which runner mode. Production is the interesting one - it is what `pnpm
   * start` does, and the one where the frozen lock and the staged assets are
   * actually checked.
   */
  readonly mode?: 'production' | 'development'
  /** added to this process's environment; an explicit undefined removes a variable */
  readonly env?: Record<string, string | undefined>
  /** flags for the server's own node, never the caller's */
  readonly nodeArgs?: readonly string[]
  /** each complete line as it arrives, for a caller that parses the log */
  readonly onLine?: (line: string) => void
}

/** readiness includes migrations and the database probe, so it is given real time */
const READY_TIMEOUT = 90_000

/** long enough for the finalizers a deployment relies on, short enough to fail a hang */
const STOP_TIMEOUT = 25_000

export const startQualyServer = (options: QualyServerOptions): QualyServer => {
  const port = String(options.port)
  // A production process refuses to start without a master key for its
  // secrets, which is right and is not what any of these tools is about. One
  // is minted per run unless the caller says otherwise - passing the variable
  // explicitly, including as undefined, is how a tool tests that refusal.
  const secretsKey =
    'QUALY_SECRETS_MASTER_KEY' in (options.env ?? {}) ||
    process.env['QUALY_SECRETS_MASTER_KEY'] !== undefined
      ? {}
      : { QUALY_SECRETS_MASTER_KEY: randomBytes(32).toString('base64') }
  // Likewise a sender and a relay for mail. Nothing is sent at boot, so a
  // relay nobody listens on is enough for every tool that only starts the
  // process; a tool about mail passes its own.
  const mail =
    'QUALY_MAIL_SMTP_HOST' in (options.env ?? {}) ||
    process.env['QUALY_MAIL_SMTP_HOST'] !== undefined
      ? {}
      : {
          QUALY_MAIL_FROM: 'Qualy <no-reply@qualy.invalid>',
          QUALY_MAIL_SMTP_HOST: '127.0.0.1',
          QUALY_MAIL_SMTP_PORT: '1025',
          QUALY_MAIL_SMTP_TLS: 'none',
          QUALY_MAIL_SMTP_ALLOW_PLAINTEXT: '1',
          // and a key for resend, whichever of the two the manifest enables
          QUALY_MAIL_RESEND_API_KEY: 're_smoke_only',
        }
  // And an address it is reached at, which a production process also refuses
  // to start without. Nothing is mailed or redirected while these tools run,
  // so a name nobody resolves serves.
  const publicUrl =
    'QUALY_PUBLIC_URL' in (options.env ?? {}) || process.env['QUALY_PUBLIC_URL'] !== undefined
      ? {}
      : { QUALY_PUBLIC_URL: 'https://qualy.invalid' }
  const child: ChildProcess = spawn(
    process.execPath,
    [
      ...(options.nodeArgs ?? []),
      '--env-file-if-exists=.env',
      path.join(repoRoot, 'apps/server/src/run.ts'),
      options.mode ?? 'production',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, PORT: port, ...secretsKey, ...mail, ...publicUrl, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const chunks: string[] = []
  let pending = ''
  const consume = (chunk: Buffer) => {
    const text = chunk.toString()
    chunks.push(text)
    if (options.onLine === undefined) return
    pending += text
    const parts = pending.split('\n')
    pending = parts.pop() ?? ''
    for (const line of parts) if (line.trim() !== '') options.onLine(line)
  }
  child.stdout!.on('data', consume)
  child.stderr!.on('data', consume)

  let ended: string | null = null
  const exited = new Promise<number | null>((resolve) =>
    child.on('exit', (code, signal) => {
      // a fatal error in v8 ends the process by signal with no exit code:
      // both spellings mean gone, and a request must not go to a ghost
      ended = code === null ? String(signal) : String(code)
      resolve(code)
    }),
  )

  const base = `http://127.0.0.1:${port}`
  return {
    pid: child.pid!,
    base,
    output: () => chunks.join(''),
    exited: () => ended,
    waitUntilReady: async ({ timeoutMs = READY_TIMEOUT } = {}) => {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const status = await fetch(`${base}${HEALTH_READY_PATH}`).then(
          (response) => response.status,
          () => 0,
        )
        if (status === 200) return
        if (ended !== null) {
          throw new Error(`the server exited ${ended} before becoming ready`)
        }
        if (Date.now() > deadline) throw new Error('the server never became ready')
        await delay(500)
      }
    },
    stop: async ({ timeoutMs = STOP_TIMEOUT, signal = 'SIGTERM' } = {}) => {
      const started = performance.now()
      child.kill(signal)
      const code = await Promise.race([exited, delay(timeoutMs).then(() => 'timeout' as const)])
      const timedOut = code === 'timeout'
      if (timedOut) child.kill('SIGKILL')
      return {
        exitCode: timedOut ? null : code,
        timedOut,
        ms: Math.round(performance.now() - started),
      }
    },
    kill: () => child.kill('SIGKILL'),
  }
}

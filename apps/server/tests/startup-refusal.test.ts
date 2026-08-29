import { execFile } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A boot that refuses has to say so.
//
// The entry point reports a failed boot from inside the telemetry and logging
// layers, which is the right place for a failed APPLICATION: the report goes
// through the product logger and is exported like every other record. It is
// the wrong place for a failed LAYER. `Effect.provide` builds what it
// provides, so a layer that refuses its own configuration short-circuits
// before anything inside it runs, an `onExit` attached inside it included.
//
// Measured before the second reporter existed: `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`
// exited 1 with zero bytes on stdout and zero on stderr, and took with it a
// sentence written specifically to tell an operator which variable to change.
// Under a process manager that is a crash loop with empty logs, from the one
// subsystem whose job is saying what happened.
//
// Both inputs below are things an operator really types. The second is a
// capitalised `True`: `Config.boolean` is case-sensitive and `withDefault`
// rescues an absent value, not a rejected one, so one capital letter is the
// difference between a running server and a silent exit.

const entry = path.resolve(import.meta.dirname, '../src/run.ts')

interface Refusal {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

const boot = (env: NodeJS.ProcessEnv): Promise<Refusal> =>
  new Promise((resolve, reject) => {
    execFile(
      'node',
      [entry, 'development'],
      {
        env: {
          ...process.env,
          // nothing should reach the database: the refusal is raised while a
          // layer is being built, which is before the application is launched
          DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
          // the runner refuses a NODE_ENV that contradicts its command, and
          // the suite runs with NODE_ENV=test
          NODE_ENV: 'development',
          QUALY_LOG_FORMAT: 'json',
          QUALY_BOOT_TIMING: '0',
          ...env,
        },
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        // a refusal exits non-zero, so execFile reports it as an error
        const code = error && 'code' in error && typeof error.code === 'number' ? error.code : 0
        if (error && !('code' in error)) return reject(error)
        resolve({ code, stdout, stderr })
      },
    )
  })

const said = (refusal: Refusal): readonly string[] =>
  [...refusal.stdout.split('\n'), ...refusal.stderr.split('\n')]
    .filter((line) => line.includes('startup failed'))
    .map((line) => {
      try {
        return String((JSON.parse(line) as { message?: unknown }).message ?? line)
      } catch {
        return line
      }
    })

describe('a boot refused by a layer outside the application', () => {
  it('says which setting it refused, rather than exiting silently', async () => {
    const refusal = await boot({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
    })
    expect(refusal.code).toBe(1)
    expect(said(refusal)).toEqual([
      'startup failed: OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported: set http/protobuf or http/json',
    ])
  }, 90_000)

  it('names the variable a rejected value came from', async () => {
    // `True` is not in Config.boolean's accepted set; the point of the case is
    // that a rejected value is reported at all, and that the report carries
    // the variable's name so the operator can find it
    const refusal = await boot({ OTEL_SDK_DISABLED: 'True' })
    expect(refusal.code).toBe(1)
    const lines = said(refusal)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('OTEL_SDK_DISABLED')
  }, 90_000)
})

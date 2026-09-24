import { ConfigProvider, Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { Mailer } from '../src/plugin.ts'
import {
  config,
  DEVELOPMENT_FROM,
  MAIL_FROM_MISSING,
  MailConfig,
  senderValid,
} from '../src/server/config.ts'
import { MailBackends, offerBackend, registryLayer } from '../src/server/registry.ts'
import { mailBackendContract, mailerLayerWith, memoryMailBackend } from '../src/testkit/index.ts'

// Sending mail, as the rest of the product sees it: one call, the
// deployment's backend and sender, one kind of failure.

const configured = (env: Record<string, string>, manifest: unknown = {}) =>
  Effect.runPromiseExit(
    Effect.flatMap(MailConfig, (settings) => Effect.succeed(settings)).pipe(
      Effect.provide(
        config(manifest, { manifestDir: '/somewhere' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    ),
  )

describe('the mail settings', () => {
  it('send from a placeholder in development, and refuse to start production without a sender', async () => {
    const development = await configured({})
    expect(Exit.isSuccess(development) && development.value).toMatchObject({
      defaultBackend: 'smtp',
      from: DEVELOPMENT_FROM,
    })
    const production = await configured({ NODE_ENV: 'production' })
    expect(Exit.isFailure(production) && Cause.pretty(production.cause)).toContain(
      MAIL_FROM_MISSING,
    )
    const named = await configured(
      { NODE_ENV: 'production', QUALY_MAIL_FROM: 'Qualy <no-reply@school.edu>' },
      { defaultBackend: 'relay' },
    )
    expect(Exit.isSuccess(named) && named.value).toMatchObject({
      defaultBackend: 'relay',
      from: 'Qualy <no-reply@school.edu>',
    })
  })

  it('take a sender that is an address, with or without a name, and nothing that breaks a header', () => {
    for (const good of [
      'no-reply@school.edu',
      'Qualy <no-reply@school.edu>',
      '综测系统 <qualy@school.edu>',
    ]) {
      expect(senderValid(good), good).toBe(true)
    }
    for (const bad of ['school.edu', 'Qualy <>', 'a@b.edu\r\nBcc: c@d.edu', '']) {
      expect(senderValid(bad), bad).toBe(false)
    }
  })
})

describe('the sender', () => {
  it('sends through the backend, from the deployment’s address', async () => {
    const memory = memoryMailBackend()
    await Effect.runPromise(
      Effect.flatMap(Mailer, (mailer) =>
        mailer.send({ to: 'ada@school.edu', subject: 'hello', text: 'body' }),
      ).pipe(Effect.provide(mailerLayerWith(memory.backend))),
    )
    expect(memory.outbox).toEqual([
      { from: 'Qualy <no-reply@school.edu>', to: 'ada@school.edu', subject: 'hello', text: 'body' },
    ])
  })

  it('reports a refusal and an absent server as one failure the caller decides about', async () => {
    const memory = memoryMailBackend()
    const send = Effect.flatMap(Mailer, (mailer) =>
      mailer.send({ to: 'ada@school.edu', subject: 's', text: 't' }),
    ).pipe(Effect.provide(mailerLayerWith(memory.backend)))
    memory.failWith('rejected')
    const rejected = await Effect.runPromiseExit(send)
    memory.failWith('unavailable')
    const unavailable = await Effect.runPromiseExit(send)
    const reasonOf = (exit: Exit.Exit<unknown, { reason: string }>) =>
      Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === 'Fail'
        ? exit.cause.reasons[0].error.reason
        : undefined
    expect(reasonOf(rejected)).toBe('rejected')
    expect(reasonOf(unavailable)).toBe('unavailable')
  })

  it('holds the memory backend to the same contract a real one is held to', async () => {
    const memory = memoryMailBackend()
    const checks = mailBackendContract({
      backend: memory.backend,
      inbox: async (address) =>
        memory.outbox
          .filter((mail) => mail.to === address)
          .map((mail) => ({
            from: mail.from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            replyTo: mail.replyTo === undefined ? [] : [mail.replyTo],
          })),
    })
    for (const check of checks) await check.run()
    expect(checks.length).toBeGreaterThan(0)
  })
})

describe('a backend offering itself', () => {
  // the deployment sends through `selected`; the backend on offer is "relay"
  const offered = (selected: string, configured: { settings: string } | { refusal: string }) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* offerBackend('relay', configured, () =>
          Effect.succeed(memoryMailBackend('relay').backend),
        )
        return yield* Effect.flatMap(MailBackends, (registry) => registry.installed)
      }).pipe(
        Effect.provide(
          registryLayer.pipe(
            Layer.provide(
              Layer.succeed(
                MailConfig,
                MailConfig.of({
                  defaultBackend: selected,
                  from: DEVELOPMENT_FROM,
                  timeoutMs: 5_000,
                }),
              ),
            ),
          ),
        ),
      ),
    )

  it('registers when its settings are complete, picked or not', async () => {
    for (const selected of ['relay', 'other']) {
      const exit = await offered(selected, { settings: 'ok' })
      expect(Exit.isSuccess(exit) && exit.value).toEqual(['relay'])
    }
  })

  it('refuses to start without its settings only while it is the one that sends', async () => {
    const picked = await offered('relay', { refusal: 'RELAY_HOST must be set' })
    expect(Exit.isFailure(picked) && Cause.pretty(picked.cause)).toContain('RELAY_HOST must be set')
    // not picked: still registered, so the barrier's declared-backends check
    // holds, and never handed out for sending
    const spare = await offered('other', { refusal: 'RELAY_HOST must be set' })
    expect(Exit.isSuccess(spare) && spare.value).toEqual(['relay'])
  })
})

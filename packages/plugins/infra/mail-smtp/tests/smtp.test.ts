import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { mailBackendContract, type ReceivedMail } from '@qualy/plugin-mail/testkit'
import { reasonOf, smtpBackend } from '../src/backend.ts'
import {
  config,
  SMTP_AUTH_HALF,
  SMTP_HOST_MISSING,
  SMTP_PLAINTEXT_REFUSED,
  SMTP_TLS_MALFORMED,
  SmtpConfig,
} from '../src/config.ts'

// Handing mail to a relay: what the deployment has to say for it, and the
// same contract every backend is held to, run against a real SMTP server -
// the Mailpit the compose stack and CI run, read back through its api.

const MAILPIT = process.env['QUALY_TEST_MAILPIT_URL'] ?? 'http://127.0.0.1:8025'
const SMTP_PORT = Number(process.env['QUALY_TEST_MAILPIT_SMTP_PORT'] ?? '1025')

const mailpitAvailable = await fetch(`${MAILPIT}/api/v1/info`, { signal: AbortSignal.timeout(5_000) })
  .then((response) => response.ok)
  .catch(() => false)

// skipping the only suite that talks SMTP reads like passing it, so CI says out loud
if (!mailpitAvailable && process.env['QUALY_REQUIRE_MAILPIT_TESTS'] === '1') {
  throw new Error(`the smtp contract suite is required but Mailpit is unreachable at ${MAILPIT}`)
}

const configured = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    Effect.flatMap(SmtpConfig, (settings) => Effect.succeed(settings)).pipe(
      Effect.provide(
        config({}, { manifestDir: '/somewhere' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    ),
  )

const refusal = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'started'

describe('the relay settings', () => {
  it('hand development mail to the local catcher, in the clear', async () => {
    const exit = await configured({})
    expect(Exit.isSuccess(exit) && exit.value).toEqual({
      host: '127.0.0.1',
      port: 1025,
      tls: 'none',
      auth: undefined,
    })
  })

  it('want a relay in production, protected unless somebody says otherwise', async () => {
    expect(refusal(await configured({ NODE_ENV: 'production' }))).toContain(SMTP_HOST_MISSING)
    const relay = await configured({ NODE_ENV: 'production', QUALY_MAIL_SMTP_HOST: 'smtp.school.edu' })
    expect(Exit.isSuccess(relay) && relay.value).toMatchObject({ tls: 'starttls', port: 587 })
    const implicit = await configured({
      NODE_ENV: 'production',
      QUALY_MAIL_SMTP_HOST: 'smtp.school.edu',
      QUALY_MAIL_SMTP_TLS: 'implicit',
    })
    expect(Exit.isSuccess(implicit) && implicit.value).toMatchObject({ tls: 'implicit', port: 465 })
    const clear = { NODE_ENV: 'production', QUALY_MAIL_SMTP_HOST: 'smtp.school.edu', QUALY_MAIL_SMTP_TLS: 'none' }
    expect(refusal(await configured(clear))).toContain(SMTP_PLAINTEXT_REFUSED)
    expect(
      Exit.isSuccess(await configured({ ...clear, QUALY_MAIL_SMTP_ALLOW_PLAINTEXT: '1' })),
    ).toBe(true)
  })

  it('refuse a protection that is not one of the three, and half an account', async () => {
    expect(refusal(await configured({ QUALY_MAIL_SMTP_TLS: 'ssl' }))).toContain(SMTP_TLS_MALFORMED)
    expect(refusal(await configured({ QUALY_MAIL_SMTP_USER: 'qualy' }))).toContain(SMTP_AUTH_HALF)
  })

  it('tells a relay that said no for good from one that could not answer', () => {
    expect(reasonOf({ responseCode: 550 })).toBe('rejected')
    expect(reasonOf({ responseCode: 451 })).toBe('unavailable')
    expect(reasonOf({ code: 'EENVELOPE' })).toBe('rejected')
    expect(reasonOf({ code: 'ECONNECTION' })).toBe('unavailable')
    expect(reasonOf({ code: 'ETIMEDOUT' })).toBe('unavailable')
  })
})

interface MailpitAddress {
  readonly Address: string
  readonly Name: string
}

/** everything Mailpit holds for one address, read back through its api */
const inbox = async (address: string): Promise<readonly ReceivedMail[]> => {
  const search = (await (
    await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
  ).json()) as { messages: { ID: string }[] }
  const found: ReceivedMail[] = []
  for (const { ID } of [...search.messages].reverse()) {
    const message = (await (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()) as {
      From: MailpitAddress
      To: MailpitAddress[]
      ReplyTo: MailpitAddress[]
      Subject: string
      Text: string
      HTML: string
    }
    found.push({
      from: message.From.Name === '' ? message.From.Address : `${message.From.Name} <${message.From.Address}>`,
      to: message.To.map((one) => one.Address),
      subject: message.Subject,
      text: message.Text,
      html: message.HTML === '' ? undefined : message.HTML,
      replyTo: (message.ReplyTo ?? []).map((one) => one.Address),
    })
  }
  return found
}

describe.runIf(mailpitAvailable)('the smtp backend against a real server', () => {
  const smtp = smtpBackend({ host: '127.0.0.1', port: SMTP_PORT, tls: 'none', auth: undefined })
  for (const check of mailBackendContract({ backend: smtp.backend, inbox })) {
    it(check.name, check.run)
  }

  it('says a relay that is not there is unavailable, and sends nothing', async () => {
    const nowhere = smtpBackend({ host: '127.0.0.1', port: 1, tls: 'none', auth: undefined })
    const exit = await Effect.runPromiseExit(
      nowhere.backend.send({
        from: 'no-reply@school.edu',
        to: 'nobody@example.test',
        subject: 's',
        text: 't',
      }),
    )
    nowhere.close()
    expect(Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === 'Fail' && exit.cause.reasons[0].error.reason).toBe(
      'unavailable',
    )
  })
})

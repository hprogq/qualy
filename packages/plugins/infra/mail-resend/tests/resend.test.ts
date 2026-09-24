import { Cause, ConfigProvider, Effect, Exit, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { mailBackendContract, type ReceivedMail } from '@qualy/plugin-mail/testkit'
import { meaningOf, RESEND_EMAILS_URL, resendBackend, type ResendPost } from '../src/backend.ts'
import { config, RESEND_API_KEY_MISSING, ResendConfig } from '../src/config.ts'

// Handing mail to Resend: what the deployment has to say for it, what goes
// over the wire, what each answer means, and the contract every backend is
// held to - against a stand-in for the api that keeps what it was sent.

const configured = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    Effect.flatMap(ResendConfig, (settings) => Effect.succeed(settings)).pipe(
      Effect.provide(
        config({}, { manifestDir: '/somewhere' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    ),
  )

const refusal = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'started'

interface Sent {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Record<string, unknown>
}

/** a Resend that accepts everything, or answers with the status it is told */
const standIn = (status = 200, body: unknown = { id: 'accepted' }) => {
  const sent: Sent[] = []
  const post: ResendPost = (request) => {
    sent.push({ ...request, body: JSON.parse(request.body) as Record<string, unknown> })
    return Promise.resolve({ status, body })
  }
  return { sent, post }
}

const key = Redacted.make('re_test_key')
const mail = { from: 'Qualy <no-reply@school.edu>', to: 'a@example.test', subject: 's', text: 't' }

describe('the resend settings', () => {
  it('want an api key, and a blank one is none', async () => {
    expect(refusal(await configured({}))).toContain(RESEND_API_KEY_MISSING)
    expect(refusal(await configured({ QUALY_MAIL_RESEND_API_KEY: '  ' }))).toContain(
      RESEND_API_KEY_MISSING,
    )
    const exit = await configured({ QUALY_MAIL_RESEND_API_KEY: ' re_live \n' })
    expect(Exit.isSuccess(exit) && Redacted.value(exit.value.apiKey)).toBe('re_live')
  })

  it('refuse anything written for it in the manifest', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(ResendConfig, (settings) => Effect.succeed(settings)).pipe(
        Effect.provide(
          config({ apiKey: 're_committed' }, { manifestDir: '/somewhere' }).pipe(
            Layer.provide(
              ConfigProvider.layer(
                ConfigProvider.fromEnv({ env: { QUALY_MAIL_RESEND_API_KEY: 're_live' } }),
              ),
            ),
          ),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe('a message handed to resend', () => {
  it('goes to the emails endpoint with the key as a bearer token', async () => {
    const api = standIn()
    await Effect.runPromise(resendBackend({ apiKey: key }, api.post).send(mail))
    expect(api.sent).toHaveLength(1)
    expect(api.sent[0]!.url).toBe(RESEND_EMAILS_URL)
    expect(api.sent[0]!.headers).toMatchObject({
      authorization: 'Bearer re_test_key',
      'content-type': 'application/json',
    })
    // absent parts stay absent rather than going out as null
    expect(api.sent[0]!.body).toEqual({ from: mail.from, to: [mail.to], subject: 's', text: 't' })
  })

  it('carries the html alternative and the reply-to under resend names', async () => {
    const api = standIn()
    await Effect.runPromise(
      resendBackend({ apiKey: key }, api.post).send({ ...mail, html: '<p>h</p>', replyTo: 'o@school.edu' }),
    )
    expect(api.sent[0]!.body).toMatchObject({ html: '<p>h</p>', reply_to: 'o@school.edu' })
  })

  it('tells a message resend will not take from resend being out of reach', () => {
    expect(meaningOf(200)).toBeUndefined()
    expect(meaningOf(202)).toBeUndefined()
    expect(meaningOf(400)).toEqual({ reason: 'rejected', misconfigured: false })
    expect(meaningOf(422)).toEqual({ reason: 'rejected', misconfigured: false })
    for (const status of [409, 429, 500, 502, 503]) {
      expect(meaningOf(status)).toEqual({ reason: 'unavailable', misconfigured: false })
    }
    // the key, the domain, or this integration is wrong: no message is at fault
    for (const status of [401, 403, 404, 405, 418]) {
      expect(meaningOf(status)).toEqual({ reason: 'unavailable', misconfigured: true })
    }
  })

  it('fails with that reason, and with unavailable when nothing answers', async () => {
    const reasonOn = async (post: ResendPost) => {
      const exit = await Effect.runPromiseExit(resendBackend({ apiKey: key }, post).send(mail))
      if (Exit.isSuccess(exit)) return 'sent'
      const failure = Cause.findErrorOption(exit.cause)
      return failure._tag === 'Some' ? failure.value.reason : 'died'
    }
    expect(await reasonOn(standIn(422, { name: 'validation_error' }).post)).toBe('rejected')
    expect(await reasonOn(standIn(429, { name: 'rate_limit_exceeded' }).post)).toBe('unavailable')
    expect(await reasonOn(standIn(403, { name: 'invalid_from_address' }).post)).toBe('unavailable')
    expect(await reasonOn(() => Promise.reject(new Error('timed out')))).toBe('unavailable')
  })
})

describe('the resend backend contract', () => {
  const api = standIn()
  const inbox = (address: string): Promise<readonly ReceivedMail[]> =>
    Promise.resolve(
      api.sent
        .filter(({ body }) => (body['to'] as string[]).includes(address))
        .map(({ body }) => ({
          from: body['from'] as string,
          to: body['to'] as string[],
          subject: body['subject'] as string,
          text: body['text'] as string,
          html: body['html'] as string | undefined,
          replyTo: body['reply_to'] === undefined ? [] : [body['reply_to'] as string],
        })),
    )
  for (const check of mailBackendContract({ backend: resendBackend({ apiKey: key }, api.post), inbox })) {
    it(check.name, check.run)
  }
})

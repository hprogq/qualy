import { Effect, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import { Plugin } from '@qualy/plugin-kit'
import { ShellPolicy, shellPolicyLayer } from '@qualy/api-kit/shell-policy'
import { captchaPurpose } from '@qualy/plugin-captcha/contract'
import {
  Captcha,
  CaptchaProviderDeclarations,
  type CaptchaProviderDeclaration,
} from '@qualy/plugin-captcha/plugin'
import {
  CaptchaProviders,
  registryLayer,
  type CaptchaProviderContext,
} from '@qualy/plugin-captcha/server'
import altcha from '@qualy/plugin-captcha-altcha'
import turnstile from '../src/index.ts'
import {
  actionOfPurpose,
  registrationLayer,
  SiteverifyTransport,
  SiteverifyUnreachable,
  TURNSTILE_ORIGIN,
  TurnstileConfig,
} from '../src/server/index.ts'

// Siteverify answered in Cloudflare's place: a suite never reaches the
// public network. What is under test is what this provider trusts - never
// `success` alone - and what it makes of each way Siteverify can refuse.

const LOGIN = captchaPurpose('auth/login')
const BINDING = 'a'.repeat(64)

const context = (over: Partial<CaptchaProviderContext> = {}): CaptchaProviderContext => ({
  tenantId: '00000000-0000-4000-8000-000000000001',
  purpose: LOGIN,
  bindingHash: BINDING,
  clientIp: '203.0.113.8',
  publicHost: 'qualy.example.edu',
  ...over,
})

/** a token Cloudflare would call good, for this host, this action and this binding */
const good = {
  success: true,
  'error-codes': [],
  hostname: 'qualy.example.edu',
  action: actionOfPurpose(LOGIN),
  cdata: BINDING,
}

type Reply = { status: number; body: unknown } | 'unreachable'

const withProvider = async <A>(
  replies: readonly Reply[],
  body: (
    verify: (over?: Partial<CaptchaProviderContext>, token?: string) => Effect.Effect<string>,
  ) => Effect.Effect<A>,
) => {
  const sent: URLSearchParams[] = []
  let next = 0
  const transport = Layer.succeed(
    SiteverifyTransport,
    SiteverifyTransport.of({
      post: (form) =>
        Effect.suspend(() => {
          sent.push(form)
          const reply = replies[Math.min(next, replies.length - 1)]!
          next += 1
          return reply === 'unreachable'
            ? Effect.fail(new SiteverifyUnreachable({ reason: 'timeout' }))
            : Effect.succeed(reply)
        }),
    }),
  )
  const layer = registrationLayer.pipe(
    Layer.provideMerge(registryLayer),
    Layer.provideMerge(shellPolicyLayer),
    Layer.provideMerge(transport),
    Layer.provideMerge(
      Layer.succeed(TurnstileConfig, {
        siteKey: 'site-key',
        secretKey: Redacted.make('secret-key'),
      }),
    ),
  )
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const provider = (yield* Effect.flatMap(CaptchaProviders, (registry) => registry.selected))!
      const verify = (over: Partial<CaptchaProviderContext> = {}, token = 'token') =>
        provider
          .verify(context(over), token)
          .pipe(Effect.catchTag('CaptchaUnavailable', () => Effect.succeed('unavailable')))
      const answer = yield* body(verify)
      const issued = yield* provider.issue(context())
      const policy = yield* Effect.flatMap(ShellPolicy, (registry) => registry.entries)
      return { answer, issued, policy }
    }).pipe(Effect.provide(layer)),
  )
  return { ...result, sent }
}

describe('asking Siteverify', () => {
  it('trusts a token only for this host, this action and this binding', async () => {
    const { answer } = await withProvider(
      [
        { status: 200, body: good },
        { status: 200, body: { ...good, hostname: 'elsewhere.example' } },
        { status: 200, body: { ...good, action: 'auth_other' } },
        { status: 200, body: { ...good, cdata: 'b'.repeat(64) } },
        { status: 200, body: { ...good, hostname: 'QUALY.example.edu.' } },
      ],
      (verify) => Effect.all([verify(), verify(), verify(), verify(), verify()]),
    )
    expect(answer).toEqual(['verified', 'rejected', 'rejected', 'rejected', 'verified'])
  })

  it('sends the secret, the token and the address, and never an oversized token', async () => {
    const { answer, sent } = await withProvider([{ status: 200, body: good }], (verify) =>
      Effect.all([verify({}, 'x'.repeat(2049)), verify({}, 'real-token')]),
    )
    expect(answer).toEqual(['rejected', 'verified'])
    expect(sent).toHaveLength(1)
    expect(Object.fromEntries(sent[0]!)).toEqual({
      secret: 'secret-key',
      response: 'real-token',
      remoteip: '203.0.113.8',
    })
  })

  it('rejects when the host this request came to cannot be read, without asking', async () => {
    const { answer, sent } = await withProvider([{ status: 200, body: good }], (verify) =>
      Effect.all([verify({ publicHost: undefined }), verify({ publicHost: 'bad host' })]),
    )
    expect(answer).toEqual(['rejected', 'rejected'])
    expect(sent).toHaveLength(0)
  })

  it('lets the request through only when Cloudflare cannot be asked', async () => {
    const { answer } = await withProvider(
      [
        'unreachable',
        { status: 503, body: undefined },
        { status: 200, body: { success: false, 'error-codes': ['internal-error'] } },
        { status: 200, body: { success: false, 'error-codes': ['invalid-input-secret'] } },
        { status: 400, body: { success: false, 'error-codes': ['bad-request'] } },
        { status: 200, body: 'not json' },
        { status: 200, body: { success: false, 'error-codes': ['timeout-or-duplicate'] } },
        { status: 200, body: { success: false, 'error-codes': ['invalid-input-response'] } },
      ],
      (verify) => Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8], () => verify()),
    )
    expect(answer).toEqual([
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
      'rejected',
      'rejected',
    ])
  })
})

describe('the challenge it issues and the origin it trusts', () => {
  it('names the site key, the action and the binding, and opens the shell to Cloudflare alone', async () => {
    const { issued, policy } = await withProvider([{ status: 200, body: good }], () => Effect.void)
    expect(issued).toEqual({ siteKey: 'site-key', action: 'auth_login', cData: BINDING })
    expect(policy).toEqual([
      {
        owner: '@qualy/plugin-captcha-turnstile',
        'script-src': [TURNSTILE_ORIGIN],
        'frame-src': [TURNSTILE_ORIGIN],
      },
    ])
  })
})

describe('the assembly', () => {
  it('refuses Turnstile and ALTCHA together, naming both', () => {
    const contributions = [altcha, turnstile].flatMap((descriptor) =>
      Plugin.contributionsOf(descriptor, CaptchaProviderDeclarations).map(
        (value) => ({ pluginId: descriptor.id, value }) as Contributed<CaptchaProviderDeclaration>,
      ),
    )
    expect(contributions).toHaveLength(2)
    expect(() => (Captcha.owner as unknown as ProvideExtension).compile(contributions)).toThrow(
      /@qualy\/plugin-captcha-altcha, @qualy\/plugin-captcha-turnstile/,
    )
  })
})

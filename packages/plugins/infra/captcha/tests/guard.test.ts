import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestContext, databaseFor, postgresAvailable } from '@qualy/plugin-database/testkit'
import { entities as secretsEntities, secretsLayer } from '@qualy/plugin-secrets/testkit'
import {
  captchaProviderCode,
  captchaPurpose,
  CaptchaProof,
  CAPTCHA_RESPONSE_MAX_LENGTH,
} from '../src/contract.ts'
import { Captcha, type CaptchaGuardInput, type CaptchaGuardResult } from '../src/server/service.ts'
import { CaptchaUnavailable, type CaptchaProvider } from '../src/server/provider.ts'
import { captchaLayer, captchaLayerWith } from '../src/testkit/index.ts'
import { Schema } from 'effect'

// The policy every caller shares, one branch at a time. A stand-in provider
// whose challenge names the binding it was issued for and whose proof is that
// binding, so what a proof is bound to shows in the answers.

const LOGIN = captchaPurpose('test/login')

const stand = (over: Partial<CaptchaProvider> = {}): CaptchaProvider => ({
  code: 'fake',
  issue: (context) => Effect.succeed({ binding: context.bindingHash }),
  verify: (context, response) =>
    Effect.succeed(response === `solved:${context.bindingHash}` ? 'verified' : 'rejected'),
  ...over,
})

const guardWith = async (
  layer: ReturnType<typeof captchaLayerWith>,
  inputs: readonly CaptchaGuardInput[],
) => {
  const db = await createTestContext('captcha-guard')
  try {
    return await Effect.runPromiseExit(
      Effect.forEach(inputs, (input) =>
        Effect.flatMap(Captcha, (captcha) => captcha.guard(input)),
      ).pipe(
        Effect.provide(
          layer.pipe(
            Layer.provideMerge(secretsLayer),
            Layer.provideMerge(databaseFor(db.url, { entities: [...secretsEntities] })),
          ),
        ),
      ),
    )
  } finally {
    await db.dispose()
  }
}

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(Cause.pretty(exit.cause))
}

/** the binding a stand-in challenge names */
const bindingOf = (answer: CaptchaGuardResult | undefined) =>
  answer?.kind === 'required' ? String(answer.prompt.challenge['binding']) : undefined

const at = (bindingKey: string, over: Partial<CaptchaGuardInput> = {}): CaptchaGuardInput => ({
  tenantId: '00000000-0000-4000-8000-000000000001',
  purpose: LOGIN,
  bindingKey,
  ...over,
})

describe.runIf(postgresAvailable)('guarding a request', () => {
  it('lets it through when there is nobody to ask', async () => {
    const [answer] = ok(await guardWith(captchaLayer, [at('a')]))
    expect(answer).toEqual({ kind: 'passed', via: 'bypassed' })
  })

  it('asks for a challenge without a proof, and passes it with the right one', async () => {
    const [first] = ok(await guardWith(captchaLayerWith(stand()), [at('a')]))
    expect(first).toMatchObject({ kind: 'required', prompt: { provider: 'fake' } })
    const binding = bindingOf(first)
    expect(binding).toMatch(/^[0-9a-f]{64}$/)
    const [proved] = ok(
      await guardWith(captchaLayerWith(stand()), [
        at('a', { proof: { provider: 'fake', response: `solved:${binding}` } }),
      ]),
    )
    expect(proved).toEqual({ kind: 'passed', via: 'verified' })
  })

  it('answers a wrong proof, or one from another provider, with a fresh challenge', async () => {
    const answers = ok(
      await guardWith(captchaLayerWith(stand()), [
        at('a', { proof: { provider: 'fake', response: 'solved:nothing' } }),
        at('a', { proof: { provider: 'other', response: 'anything' } }),
      ]),
    )
    expect(answers.map((answer) => answer.kind)).toEqual(['required', 'required'])
  })

  it('binds a proof to its tenant, its purpose and its key', async () => {
    const answers = ok(
      await guardWith(captchaLayerWith(stand()), [
        at('a'),
        at('b'),
        at('a', { tenantId: '00000000-0000-4000-8000-000000000002' }),
        at('a', { purpose: captchaPurpose('test/other') }),
      ]),
    )
    const bindings = answers.map(bindingOf)
    expect(new Set(bindings).size).toBe(4)
  })

  it('lets it through when the provider cannot be asked, and only then', async () => {
    const down = stand({
      issue: () => Effect.fail(new CaptchaUnavailable({ reason: 'timeout' })),
      verify: () => Effect.fail(new CaptchaUnavailable({ reason: '503' })),
    })
    const answers = ok(
      await guardWith(captchaLayerWith(down), [
        at('a'),
        at('a', { proof: { provider: 'fake', response: 'anything' } }),
      ]),
    )
    expect(answers).toEqual([
      { kind: 'passed', via: 'bypassed' },
      { kind: 'passed', via: 'bypassed' },
    ])
  })

  it('does not swallow a provider that broke', async () => {
    const broken = stand({ issue: () => Effect.die(new Error('invariant broken')) })
    const exit = await guardWith(captchaLayerWith(broken), [at('a')])
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  })
})

describe('the words a challenge is named by', () => {
  it('takes a namespaced purpose and refuses anything else', () => {
    expect(captchaPurpose('auth/login')).toBe('auth/login')
    expect(captchaPurpose('assessment/entry-submit')).toBe('assessment/entry-submit')
    for (const bad of [
      'login',
      'Auth/login',
      'auth/',
      'auth//login',
      'auth/log_in',
      `a/${'x'.repeat(130)}`,
    ]) {
      expect(() => captchaPurpose(bad), bad).toThrow(/not a captcha purpose/)
    }
  })

  it('takes a provider code and refuses anything else', () => {
    expect(captchaProviderCode('altcha')).toBe('altcha')
    for (const bad of ['Turnstile ', '../foo', 'a_b', '']) {
      expect(() => captchaProviderCode(bad), bad).toThrow(/not a captcha provider code/)
    }
  })

  it('refuses a proof larger than any provider would send, or from no provider', () => {
    const decode = Schema.decodeUnknownExit(CaptchaProof)
    expect(Exit.isSuccess(decode({ provider: 'altcha', response: 'x' }))).toBe(true)
    expect(
      Exit.isFailure(
        decode({ provider: 'altcha', response: 'x'.repeat(CAPTCHA_RESPONSE_MAX_LENGTH + 1) }),
      ),
    ).toBe(true)
    expect(Exit.isFailure(decode({ provider: '../foo', response: 'x' }))).toBe(true)
    expect(Exit.isFailure(decode({ provider: 'altcha', response: '' }))).toBe(true)
  })
})

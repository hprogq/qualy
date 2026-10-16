import { ConfigProvider, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { compileDocumentContext, DocumentContext } from '@qualy/plugin-ui-registry/document-context'
import { siteRegistrationContext } from '../src/server/site-registration.ts'
import { SITE_REGISTRATION_CONTEXT } from '../src/site-registration.ts'

const ICP = '京ICP备00000000号-0'
const PUBLIC_SECURITY = '京公网安备00000000000000号'
const PUBLIC_SECURITY_URL = 'https://beian.mps.gov.cn/#/query/webSearch?code=00000000000000'

const configured = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const context = yield* DocumentContext
      const anonymous = yield* context.of({ principal: undefined, locale: 'zh-CN' })
      const authenticated = yield* context.of({
        principal: { tenantId: 'tenant-a', userId: 'person-a', sessionId: 'session-a' },
        locale: 'en-US',
      })
      return { anonymous, authenticated }
    }).pipe(
      Effect.provide(
        (
          compileDocumentContext([
            { pluginId: '@qualy/plugin-layout-default', value: siteRegistrationContext },
          ]) as Layer.Layer<DocumentContext>
        ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
      ),
    ),
  )

describe('the deployment registration carried by each page', () => {
  it.each<Record<string, string>>([
    {},
    {
      QUALY_ICP_RECORD: ' ',
      QUALY_PUBLIC_SECURITY_RECORD: '',
      QUALY_PUBLIC_SECURITY_RECORD_URL: '\n',
    },
  ])('has no entries when the deployment has not configured them', async (env) => {
    const context = { [SITE_REGISTRATION_CONTEXT]: {} }
    expect(await configured(env)).toEqual(
      Exit.succeed({ anonymous: context, authenticated: context }),
    )
  })

  it('publishes the same ICP identity to anonymous and signed-in readers in either language', async () => {
    const context = {
      [SITE_REGISTRATION_CONTEXT]: { icp: { record: ICP, href: 'https://beian.miit.gov.cn/' } },
    }
    expect(
      await configured({ QUALY_ICP_RECORD: ` ${ICP} `, PRIVATE_DEPLOYMENT_VALUE: 'not-public' }),
    ).toEqual(Exit.succeed({ anonymous: context, authenticated: context }))
  })

  it.each([
    PUBLIC_SECURITY_URL,
    'https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=00000000000000',
  ])('carries the public security record and its official link together', async (href) => {
    const context = {
      [SITE_REGISTRATION_CONTEXT]: {
        icp: { record: ICP, href: 'https://beian.miit.gov.cn/' },
        publicSecurity: { record: PUBLIC_SECURITY, href },
      },
    }
    expect(
      await configured({
        QUALY_ICP_RECORD: ICP,
        QUALY_PUBLIC_SECURITY_RECORD: PUBLIC_SECURITY,
        QUALY_PUBLIC_SECURITY_RECORD_URL: href,
      }),
    ).toEqual(Exit.succeed({ anonymous: context, authenticated: context }))
  })

  it.each<Record<string, string>>([
    { QUALY_PUBLIC_SECURITY_RECORD: PUBLIC_SECURITY },
    { QUALY_PUBLIC_SECURITY_RECORD_URL: PUBLIC_SECURITY_URL },
  ])('refuses a half-configured public security record while binding', async (env) => {
    const exit = await configured(env)
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
      'QUALY_PUBLIC_SECURITY_RECORD and QUALY_PUBLIC_SECURITY_RECORD_URL together, or neither',
    )
  })

  it.each<Record<string, string>>([
    { QUALY_ICP_RECORD: '<script>alert(1)</script>' },
    { QUALY_ICP_RECORD: 'not a filing number' },
    { QUALY_ICP_RECORD: '京ICP备00000000号-0\nextra' },
    { QUALY_ICP_RECORD: '京'.repeat(65) },
    {
      QUALY_PUBLIC_SECURITY_RECORD: '京公网安备123号',
      QUALY_PUBLIC_SECURITY_RECORD_URL: PUBLIC_SECURITY_URL,
    },
    {
      QUALY_PUBLIC_SECURITY_RECORD: '京'.repeat(65),
      QUALY_PUBLIC_SECURITY_RECORD_URL: PUBLIC_SECURITY_URL,
    },
  ])('refuses malformed registration text', async (env) => {
    expect(Exit.isFailure(await configured(env))).toBe(true)
  })

  it.each([
    'http://beian.mps.gov.cn/',
    'javascript:alert(1)',
    'https://example.com/',
    'https://beian.mps.gov.cn.example.com/',
    'https://example.com@beian.mps.gov.cn/',
    'https://beian.mps.gov.cn:444/',
    'https://beian.mps.gov.cn/with space',
    `https://beian.mps.gov.cn/${'a'.repeat(512)}`,
    `https://beian.mps.gov.cn/${'中'.repeat(60)}`,
  ])('refuses an unsafe or oversized public security URL', async (href) => {
    const exit = await configured({
      QUALY_PUBLIC_SECURITY_RECORD: PUBLIC_SECURITY,
      QUALY_PUBLIC_SECURITY_RECORD_URL: href,
    })
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain('QUALY_PUBLIC_SECURITY_RECORD_URL')
  })

  it.each([
    { length: 512, accepted: true },
    { length: 513, accepted: false },
  ])('bounds public security URLs at $length characters', async ({ length, accepted }) => {
    const prefix = `${PUBLIC_SECURITY_URL}&padding=`
    const href = prefix + 'a'.repeat(length - prefix.length)
    const exit = await configured({
      QUALY_PUBLIC_SECURITY_RECORD: PUBLIC_SECURITY,
      QUALY_PUBLIC_SECURITY_RECORD_URL: href,
    })
    expect(Exit.isSuccess(exit)).toBe(accepted)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.anonymous[SITE_REGISTRATION_CONTEXT]).toEqual({
        publicSecurity: { record: PUBLIC_SECURITY, href },
      })
    }
  })
})

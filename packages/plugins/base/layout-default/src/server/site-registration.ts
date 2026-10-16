import { Config, Effect, Schema } from 'effect'
import type { DocumentContextProvider } from '@qualy/plugin-ui-registry/plugin'
import { SITE_REGISTRATION_CONTEXT, type SiteRegistration } from '../site-registration.ts'

// These identify the deployment, not a tenant or a translated business term.
// Bind once at startup; every reader receives the same small public projection.
const IcpRecord = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[\u4e00-\u9fff]{1,8}ICP备[0-9]{6,12}号(?:-[0-9]{1,6})?$/u, {
    expected: 'an ICP filing number, such as 京ICP备00000000号-0',
  }),
)

const PublicSecurityRecord = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[\u4e00-\u9fff]{1,8}公网安备 ?[0-9]{14}号$/u, {
    expected: 'a public security filing number with 14 digits',
  }),
)

const Settings = Schema.Struct({
  QUALY_ICP_RECORD: Schema.Union([Schema.Literal(''), IcpRecord]),
  QUALY_MPS_RECORD: Schema.Union([Schema.Literal(''), PublicSecurityRecord]),
  QUALY_MPS_RECORD_URL: Schema.String.check(
    Schema.isMaxLength(512),
    Schema.isPattern(/^\S*$/u, { expected: 'a URL without whitespace' }),
  ),
}).check(
  Schema.makeFilter(
    (settings) => (settings.QUALY_MPS_RECORD === '') === (settings.QUALY_MPS_RECORD_URL === ''),
    {
      expected: 'QUALY_MPS_RECORD and QUALY_MPS_RECORD_URL together, or neither',
    },
  ),
)

const PublicSecurityUrl = Schema.Struct({
  QUALY_MPS_RECORD_URL: Schema.URLFromString.check(
    Schema.makeFilter((url) => url.href.length <= 512, {
      expected: 'a serialized URL no longer than 512 characters',
    }),
    Schema.makeFilter(
      (url) =>
        url.protocol === 'https:' &&
        (url.hostname === 'beian.mps.gov.cn' || url.hostname === 'www.beian.gov.cn') &&
        url.port === '' &&
        url.username === '' &&
        url.password === '',
      { expected: 'an HTTPS URL on beian.mps.gov.cn or www.beian.gov.cn without credentials' },
    ),
    // The query page routes by fragment, and an unquoted `#` in a .env file
    // starts a comment: the link arrives as the bare home page, with no error.
    Schema.makeFilter((url) => url.pathname !== '/' || url.search !== '' || url.hash !== '', {
      expected: "this record's query page, not the home page (quote a value containing # in .env)",
    }),
  ),
})

export const siteRegistrationContext: DocumentContextProvider = {
  key: SITE_REGISTRATION_CONTEXT,
  bind: Effect.gen(function* () {
    const settings = yield* Schema.decodeEffect(Settings)({
      QUALY_ICP_RECORD: (yield* Config.String('QUALY_ICP_RECORD').pipe(
        Config.withDefault(''),
      )).trim(),
      QUALY_MPS_RECORD: (yield* Config.String('QUALY_MPS_RECORD').pipe(
        Config.withDefault(''),
      )).trim(),
      QUALY_MPS_RECORD_URL: (yield* Config.String('QUALY_MPS_RECORD_URL').pipe(
        Config.withDefault(''),
      )).trim(),
    })
    const publicSecurityUrl =
      settings.QUALY_MPS_RECORD_URL === ''
        ? undefined
        : (yield* Schema.decodeEffect(PublicSecurityUrl)(settings)).QUALY_MPS_RECORD_URL.href
    // Spell out the public fields. No environment object or tenant data crosses
    // this boundary, even if this provider acquires other settings later.
    const registration: SiteRegistration = {
      ...(settings.QUALY_ICP_RECORD === ''
        ? {}
        : { icp: { record: settings.QUALY_ICP_RECORD, href: 'https://beian.miit.gov.cn/' } }),
      ...(publicSecurityUrl === undefined
        ? {}
        : {
            publicSecurity: {
              record: settings.QUALY_MPS_RECORD,
              href: publicSecurityUrl,
            },
          }),
    }
    return Effect.fn('SiteRegistration.read')(() => Effect.succeed(registration))
  }).pipe(Effect.orDie),
}

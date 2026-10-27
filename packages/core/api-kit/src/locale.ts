import { Effect } from 'effect'
import { HttpServerRequest } from 'effect/http'
import {
  defaultLocale,
  localeOfAcceptLanguage,
  supportedLocales,
  type SupportedLocale,
} from '@qualy/i18n-contract'
import { QUALY_LOCALE_COOKIE, QUALY_LOCALE_HEADER } from './index.ts'

// Which language an answer is written in.
//
// The page names its own: a document keeps one language from the moment it
// opens, and sends it with every request. What the browser was told to use
// comes next - a request that is not the page's own (a link followed, a form
// posted from elsewhere) still carries the cookie a choice wrote. Then what
// the browser's settings ask for, then the product's own language.

const isSupported = (value: string | undefined): value is SupportedLocale =>
  value !== undefined && (supportedLocales as readonly string[]).includes(value)

export { localeOfAcceptLanguage }

/** the locale a request's answer is written in, from its headers and cookies */
export const localeOfRequest = (request: {
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly cookies: Readonly<Record<string, string | undefined>>
}): SupportedLocale => {
  const page = request.headers[QUALY_LOCALE_HEADER]
  if (isSupported(page)) return page
  const chosen = request.cookies[QUALY_LOCALE_COOKIE]
  if (isSupported(chosen)) return chosen
  return localeOfAcceptLanguage(request.headers['accept-language']) ?? defaultLocale
}

/** the same, for the request being answered */
export const requestLocale: Effect.Effect<
  SupportedLocale,
  never,
  HttpServerRequest.HttpServerRequest
> = Effect.gen(function* () {
  return localeOfRequest(yield* HttpServerRequest.HttpServerRequest)
})

/** the locale this browser was explicitly told to use, if it was */
export const chosenLocaleOf = (cookies: Readonly<Record<string, string | undefined>>) => {
  const chosen = cookies[QUALY_LOCALE_COOKIE]
  return isSupported(chosen) ? chosen : undefined
}

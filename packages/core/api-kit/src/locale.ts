import { Effect } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { defaultLocale, supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
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

/** a supported locale an Accept-Language header asks for, by rank, then by language alone */
export const localeOfAcceptLanguage = (header: string | undefined): SupportedLocale | undefined => {
  if (header === undefined) return undefined
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...parameters] = part.trim().split(';')
      const quality = parameters
        .map((parameter) => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(parameter)?.[1])
        .find((found) => found !== undefined)
      return { tag: tag.trim(), weight: quality === undefined ? 1 : Number(quality), index }
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  for (const { tag } of ranked) {
    const exact = supportedLocales.find((locale) => locale.toLowerCase() === tag.toLowerCase())
    if (exact !== undefined) return exact
    const language = tag.split('-')[0]?.toLowerCase()
    const near = supportedLocales.find((locale) => locale.split('-')[0]?.toLowerCase() === language)
    if (near !== undefined) return near
  }
  return undefined
}

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

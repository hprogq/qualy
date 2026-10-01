// The locales and message types every side of the product shares
// (docs/adr/0011-i18n-paraglide.md). Framework-free on purpose: no react, no
// message compiler. What a server says is a Text (@qualy/text), said into a
// string before it leaves; nothing on the wire names a message.

/** A compiled message held as a value; direct calls keep their facade's exact inputs. */
export type Message = (inputs?: any, options?: { readonly locale?: SupportedLocale }) => string

/**
 * A value as an ICU `select` branch can name it.
 *
 * A branch is a bare word, and a hyphen is not part of one: a message with a
 * `light-first` branch does not parse, and the browser then shows the whole
 * ICU source. Codes that travel kebab-cased are handed over camel-cased, and
 * the message names its branches the same way.
 */
export const selectKey = (value: string): string =>
  value.replace(/-([a-z0-9])/g, (_, next: string) => next.toUpperCase())

export type SupportedLocale = 'zh-CN' | 'en-US'
export const supportedLocales: readonly SupportedLocale[] = ['zh-CN', 'en-US']
export const defaultLocale: SupportedLocale = 'zh-CN'
// codes owned by the runtime; a plugin localizes its own codes only
export const commonErrorCodes = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'ACCESS_DENIED',
  'BAD_REQUEST',
  'TOO_MANY_ATTEMPTS',
  'REQUEST_ORIGIN_REFUSED',
  'API_ROUTE_NOT_FOUND',
  'QUALY_CLIENT_PROTOCOL_UNSUPPORTED',
  'QUALY_CLIENT_ASSEMBLY_UNSUPPORTED',
  'QUALY_CLIENT_RELEASE_UNSUPPORTED',
  'SERVICE_UNAVAILABLE',
] as const

export type CommonErrorCode = (typeof commonErrorCodes)[number]

import { Schema } from 'effect'

// the serializable text protocol between server-side plugins and the web
// runtime: plugins never pick the display language. A MessageRef names a
// translatable message (stable namespaced id plus its English fallback), a
// LiteralText carries business data verbatim (an org name, a provider name
// configured by an administrator) that must never be machine-translated.
// This package is framework-free on purpose: no react, no i18n engine.

export type MessageId = string

export interface MessageRef {
  kind: 'message'
  id: MessageId
  defaultMessage: string
}

export interface LiteralText {
  kind: 'literal'
  value: string
}

export type UiText = MessageRef | LiteralText

export type MessageValues = Record<string, unknown>

/**
 * A message held as a value: a compiled message function (a package's
 * `#messages`), passed along until something says it.
 *
 * Its inputs are loose here because a table of messages of different shapes
 * is exactly what this type is for; a message called where it is imported
 * keeps the exact inputs its facade declares.
 */
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

export const message = (id: MessageId, defaultMessage: string): MessageRef => ({
  kind: 'message',
  id,
  defaultMessage,
})

export const literal = (value: string): LiteralText => ({
  kind: 'literal',
  value,
})

/**
 * The text with no reader to choose for: a message's own default, or a
 * literal as it stands.
 *
 * For the places that are not a screen - a mirror row, a log line, a
 * server-side search over authored copy. A browser must never use this: it
 * has a reader, and the catalog is how their language is chosen.
 */
export const plainText = (text: UiText): string =>
  text.kind === 'literal' ? text.value : text.defaultMessage

// message ids are namespaced like every other cross-plugin identifier:
// <plugin>/<segment>(/<segment>)*, lowercase kebab-case segments
const messageIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/

// The one runtime schema of UiText, for every boundary a text crosses: a
// plugin's contribution at registration, an api response, a manifest. A
// bad contribution fails at the plugin, not in the browser. Effect Schema,
// as every other contract's runtime schema is - the api layer declares its
// shapes in it, and a second schema language for the same type is what the
// migration set out to end.
export const UiTextSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('message'),
    id: Schema.String.check(Schema.isPattern(messageIdPattern)),
    defaultMessage: Schema.String.check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal('literal'),
    value: Schema.String,
  }),
])

export type SupportedLocale = 'zh-CN' | 'en-US'
export const supportedLocales: readonly SupportedLocale[] = ['zh-CN', 'en-US']
export const defaultLocale: SupportedLocale = 'zh-CN'
// --- typed api error localization ---

/**
 * The failures a module declares, keyed by the code they travel under.
 *
 * Written as `ErrorsByCode<typeof import('../src/server/errors.ts')>`, so a
 * translation table is checked against the classes themselves: a new failure
 * is a missing key, a deleted one is an excess key, and neither can be
 * declared anywhere else.
 *
 * There used to be a second table - the same codes, statuses and messages
 * written again in a second schema language, for the contract layer that no
 * longer exists - and by
 * the time it was only feeding these types it had drifted: two codes nothing
 * could raise were still being translated into two languages.
 *
 * The value is the error instance, because that is what the client receives
 * and hands to `values()`: an http error decodes back into its class, fields
 * and all.
 */
export type ErrorsByCode<Module> = {
  [Name in keyof Module as ErrorCodeOf<Module[Name]>]: ErrorPayloadOf<Module[Name]>
}

/** the tag a tagged error class carries, or never for anything else exported */
type ErrorCodeOf<Exported> = Exported extends abstract new (...args: never[]) => {
  readonly _tag: infer Code extends string
}
  ? Code
  : never

type ErrorPayloadOf<Exported> = Exported extends abstract new (...args: never[]) => infer Instance
  ? Instance
  : never

// values() receives the data of its own code, never `unknown`
export interface ErrorMessageRegistration<Data = unknown> {
  message: Message
  values?: (data: Data) => MessageValues
}

// the erased aggregate the runtime holds: values() is contravariant in its
// data, so `never` is the supertype every typed registration fits into. The
// runtime pays one documented cast for this at the point of call, instead
// of every plugin casting its own data.
export type ErrorMessageMap = Record<string, ErrorMessageRegistration<never>>

/** a message that reads nothing, the only kind registered bare */
type PlainMessage = (
  inputs?: Record<string, never>,
  options?: { readonly locale?: SupportedLocale },
) => string

// a translation entry is either a message that reads nothing, or a message
// plus the projection from the error's typed data to what it reads. A
// message that reads something cannot take the plain form: its inputs are
// required, and a required parameter does not fit an optional one.
export type ErrorTranslation<Data> =
  | PlainMessage
  | { message: (inputs: any) => string; values: (data: Data) => MessageValues }

// second pass over the table the compiler already inferred: now that each
// entry's message type is concrete, the projection's return type can be
// pinned to what that message reads. A single-pass parameter cannot express
// this - an object literal has no way to say "my values returns whatever my
// sibling message reads".
type CheckedTranslations<Table, Errors> = {
  [Code in keyof Table]: Code extends keyof Errors
    ? Table[Code] extends { message: infer Said extends (inputs: never) => string }
      ? { message: Said; values: (data: Errors[Code]) => Parameters<Said>[0] }
      : Table[Code]
    : // a code nothing can raise has no valid translation
      never
}

export interface ErrorTranslationSet {
  registry: ErrorMessageMap
}

// translations for one module's failures: every code must be translated, a
// code the module cannot raise is rejected by excess property checking, and
// each values() receives exactly the error it belongs to. The parameter is
// the mapped type itself (not an inferred subtype): that is what gives
// values(data) its contextual type and makes extra keys fail.
//
// Curried because the error set is named rather than passed. The classes live
// in a server module, and the browser needs nothing from it but the types -
// `import type` costs no bytes, while a value parameter would have pulled the
// whole module into the bundle to be read once and discarded.
export const defineErrorTranslations =
  <Errors>() =>
  <const Table extends { [Code in keyof Errors]: ErrorTranslation<Errors[Code]> }>(
    translations: Table & CheckedTranslations<Table, Errors>,
  ): ErrorTranslationSet => {
    const registry: Record<string, ErrorMessageRegistration<never>> = {}
    for (const [code, entry] of Object.entries(translations) as [
      string,
      ErrorTranslation<unknown>,
    ][]) {
      registry[code] = typeof entry === 'function' ? { message: entry } : entry
    }
    return { registry }
  }

// a plugin may translate errors from more than one declaration set - its own
// and a shared invariant it can raise - so they are joined here rather than
// by hand at each call site
export function mergeErrorTranslations(
  ...sets: readonly ErrorTranslationSet[]
): ErrorTranslationSet {
  const registry: ErrorMessageMap = {}
  for (const set of sets) {
    for (const code of Object.keys(set.registry)) {
      if (Object.hasOwn(registry, code)) {
        throw new Error(`error code ${code} is translated twice`)
      }
      registry[code] = set.registry[code]!
    }
  }
  return { registry }
}

// codes owned by the runtime; a plugin localizes its own codes only
export const commonErrorCodes = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'ACCESS_DENIED',
  'BAD_REQUEST',
] as const

export type CommonErrorCode = (typeof commonErrorCodes)[number]

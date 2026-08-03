import { z } from 'zod'
import type { DomainErrors, ErrorDataOf, ErrorDefinitions } from '@qualy/api-contract'

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

// a translatable message reference used by frontend code directly (error
// registries, page copy); MessageRef is its serialized form for manifests
export interface MessageDescriptor<Id extends MessageId = MessageId> {
  id: Id
  defaultMessage: string
}

// a message whose icu source interpolates: __values is a phantom carrying
// the placeholders it needs. It is required (never assigned at runtime) so
// "declares placeholders" stays decidable at the type level — an optional
// property cannot be told apart from an absent one.
export interface ValuedMessageDescriptor<
  Values extends MessageValues,
  Id extends MessageId = MessageId,
> extends MessageDescriptor<Id> {
  readonly __values: Values
}

// the placeholders a descriptor demands, or none
export type ValuesOf<Descriptor> = Descriptor extends { __values: infer Values }
  ? Values extends MessageValues
    ? Values
    : Record<never, never>
  : Record<never, never>

// declares a message and the values it expects:
// defineMessage<{ count: number }>()({ id, defaultMessage }). Typescript
// cannot parse the icu source, so the declaration is the contract and a
// formatting test proves the string agrees with it.
export const defineMessage =
  <Values extends MessageValues>() =>
  <Id extends MessageId>(descriptor: { id: Id; defaultMessage: string }) =>
    descriptor as ValuedMessageDescriptor<Values, Id>

export const message = (id: MessageId, defaultMessage: string): MessageRef => ({
  kind: 'message',
  id,
  defaultMessage,
})

export const literal = (value: string): LiteralText => ({
  kind: 'literal',
  value,
})

// message ids are namespaced like every other cross-plugin identifier:
// <plugin>/<segment>(/<segment>)*, lowercase kebab-case segments
const messageIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/

// registration-time validation for text carried through manifests: a bad
// contribution fails at the plugin, not in the browser
export const uiTextSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    id: z.string().regex(messageIdPattern, 'message id must be namespaced kebab-case'),
    defaultMessage: z.string().min(1),
  }),
  z.object({
    kind: z.literal('literal'),
    value: z.string(),
  }),
])

// locale catalogs are plain records from message id to an icu message string
// (typescript modules, so they ride the normal typecheck and test pipeline;
// po interchange can be layered on later without changing this contract)
export type MessageCatalog = Record<MessageId, string>

// the exact key set a message table requires of its catalogs: a missing key,
// an orphan key or a typo fails typecheck instead of waiting for the runtime
export type CatalogFor<Messages extends Record<string, MessageDescriptor>> = {
  [Id in Messages[keyof Messages]['id']]: string
}

export type SupportedLocale = 'zh-CN' | 'en-US'
export const supportedLocales: readonly SupportedLocale[] = ['zh-CN', 'en-US']
export const defaultLocale: SupportedLocale = 'zh-CN'

// what a plugin's client module may export as `catalogs`: its namespace and
// lazy per-locale catalogs (only non-english catalogs are required; the
// defaultMessage in each reference is the english fallback)
export interface PluginCatalogs {
  namespace: string
  // every message the plugin declares, so completeness can be checked
  // without guessing which exports hold descriptors
  messages: readonly MessageDescriptor[]
  locales: Partial<Record<SupportedLocale, () => Promise<{ default: MessageCatalog }>>>
}

// --- typed api error localization ---

// values() receives the data of its own code, never `unknown`
export interface ErrorMessageRegistration<Data = unknown> {
  message: MessageDescriptor
  values?: (data: Data) => MessageValues
}

// the erased aggregate the runtime holds: values() is contravariant in its
// data, so `never` is the supertype every typed registration fits into. The
// runtime pays one documented cast for this at the point of call, instead
// of every plugin casting its own data.
export type ErrorMessageMap = Record<string, ErrorMessageRegistration<never>>

// a translation entry is either a plain descriptor (static sentence) or a
// valued message plus the projection from the error's typed data to its icu
// placeholders. A ValuedMessageDescriptor cannot take the plain form: its
// required __values phantom collides with the never-typed exclusion, so a
// message that interpolates cannot be registered without its values().
type PlainDescriptor = MessageDescriptor & { __values?: never }

// a valued entry pairs a message with the projection from the error's data
// to that message's placeholders
export interface ValuedErrorTranslation<Data, Message extends MessageDescriptor> {
  message: Message
  values: (data: Data) => ValuesOf<Message>
}

export type ErrorTranslation<Data> =
  | PlainDescriptor
  | { message: ValuedMessageDescriptor<MessageValues>; values: (data: Data) => MessageValues }

// second pass over the table the compiler already inferred: now that each
// entry's message type is concrete, the projection's return type can be
// pinned to that message's declared placeholders. A single-pass parameter
// cannot express this — an object literal has no way to say "my values
// returns whatever my sibling message declares".
type CheckedTranslations<Table, Defs extends ErrorDefinitions> = {
  [Code in keyof Table]: Code extends keyof Defs & string
    ? Table[Code] extends { message: infer Message extends MessageDescriptor }
      ? ValuedErrorTranslation<ErrorDataOf<Defs[Code]>, Message>
      : Table[Code]
    : // a code the definitions never declare has no valid translation
      never
}

export interface ErrorTranslationSet {
  registry: ErrorMessageMap
  descriptors: Record<string, MessageDescriptor>
}

// translations for a domain error set: every code must be translated, a
// code outside the definitions is rejected by excess property checking, and
// each values() receives exactly the data its definition's zod schema
// declares — all inferred from the dsl value, no contract type inference.
// The parameter is the mapped type itself (not an inferred subtype): that
// is what gives values(data) its contextual type and makes extra keys fail.
export function defineErrorTranslations<
  Defs extends ErrorDefinitions,
  const Table extends { [Code in keyof Defs & string]: ErrorTranslation<ErrorDataOf<Defs[Code]>> },
>(
  errors: DomainErrors<Defs>,
  translations: Table & CheckedTranslations<Table, Defs>,
): ErrorTranslationSet {
  void errors
  const registry: Record<string, ErrorMessageRegistration<never>> = {}
  const descriptors: Record<string, MessageDescriptor> = {}
  for (const [code, entry] of Object.entries(translations)) {
    const registration =
      'message' in entry && typeof entry.message === 'object'
        ? (entry as { message: MessageDescriptor; values: (data: never) => MessageValues })
        : { message: entry as MessageDescriptor }
    registry[code] = registration as ErrorMessageRegistration<never>
    descriptors[code] = registration.message
  }
  return { registry, descriptors }
}

// a plugin may translate errors from more than one declaration set — its own
// and a shared invariant it can raise — and definePluginMessages takes one
// set, so they are joined here rather than by hand at each call site
export function mergeErrorTranslations(
  ...sets: readonly ErrorTranslationSet[]
): ErrorTranslationSet {
  const registry: ErrorMessageMap = {}
  const descriptors: Record<string, MessageDescriptor> = {}
  for (const set of sets) {
    for (const code of Object.keys(set.registry)) {
      if (Object.hasOwn(registry, code)) {
        throw new Error(`error code ${code} is translated twice`)
      }
      registry[code] = set.registry[code]!
      descriptors[code] = set.descriptors[code]!
    }
  }
  return { registry, descriptors }
}

// what a plugin's client declares in ONE call: its copy, its error
// translations and its locale catalogs. Everything else — the runtime error
// registry, the declared-descriptor table the catalogs are checked against
// and the PluginCatalogs the host aggregates — is derived.
export interface PluginMessages<Messages extends Record<string, MessageDescriptor>> {
  messages: Messages
  errorMessages: ErrorMessageMap
  catalogs: PluginCatalogs
}

export function definePluginMessages<const Messages extends Record<string, MessageDescriptor>>(options: {
  namespace: string
  messages: Messages
  errors?: ErrorTranslationSet
  locales: PluginCatalogs['locales']
}): PluginMessages<Messages> {
  const declared: Record<string, MessageDescriptor> = {
    ...options.messages,
    ...(options.errors?.descriptors ?? {}),
  }
  const outside = Object.values(declared).filter(
    (descriptor) => !(descriptor as MessageDescriptor).id.startsWith(`${options.namespace}/`),
  )
  if (outside.length > 0) {
    throw new Error(
      `plugin ${options.namespace} declares messages outside its namespace: ${outside
        .map((descriptor) => (descriptor as MessageDescriptor).id)
        .join(', ')}`,
    )
  }
  return {
    messages: options.messages,
    errorMessages: options.errors?.registry ?? {},
    catalogs: {
      namespace: options.namespace,
      messages: Object.values(declared),
      locales: options.locales,
    },
  }
}

// codes owned by the runtime; a plugin may localize its own codes only
export const commonErrorCodes = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INPUT_VALIDATION_FAILED',
  'INTERNAL_SERVER_ERROR',
] as const

export type CommonErrorCode = (typeof commonErrorCodes)[number]

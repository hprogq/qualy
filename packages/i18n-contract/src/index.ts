import { z } from 'zod'

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

// the shape every api error union member has; the transport's own bare
// Error members drop out of the helpers below
export interface ApiErrorLike {
  code: string
  data?: unknown
}

// these are distributive on purpose: the checked type is a naked type
// parameter, so a union like `Error | ORPCError<...>` filters member by
// member instead of collapsing to never (probed against beta.21)
export type DefinedApiError<Union> = Union extends { defined: boolean; code: string }
  ? Union
  : never
export type ApiErrorCode<Union> = Union extends { code: infer Code } ? Code : never
export type ApiErrorData<Union, Code> = Union extends { code: Code; data: infer Data }
  ? Data
  : never

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

// the exact registry shape a contract's error union allows: every code must
// be present, no code outside the union is accepted, and each values()
// receives that code's data type
export type TypedErrorMessageMap<Union, Codes extends ApiErrorCode<Union> & string> = {
  [Code in Codes]: ErrorMessageRegistration<ApiErrorData<Union, Code>>
}

// defineErrorMessages<ContractErrorUnion, OwnedCodes>()({ ... }). The map
// parameter is the constrained type itself rather than an inferred subtype,
// which is what gives each values(data) its contextual type.
export const defineErrorMessages =
  <Union, Codes extends ApiErrorCode<Union> & string = ApiErrorCode<Union> & string>() =>
  (map: TypedErrorMessageMap<Union, Codes>): TypedErrorMessageMap<Union, Codes> =>
    map

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

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

// a translatable message reference used by frontend code directly (error
// registries, page copy); MessageRef is its serialized form for manifests
export interface MessageDescriptor {
  id: MessageId
  defaultMessage: string
}

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

// what a plugin's client module may export as `errorMessages`: typed api
// error codes mapped to translatable descriptors; values() projects the
// typed error data into icu placeholder values
export interface ErrorMessageRegistration {
  message: MessageDescriptor
  values?: (data: unknown) => Record<string, unknown>
}

export type ErrorMessageMap = Record<string, ErrorMessageRegistration>

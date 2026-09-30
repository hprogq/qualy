import { Schema } from 'effect'
import type { SupportedLocale } from '@qualy/i18n-contract'

// What the server says, before it is said in anybody's language
// (docs/adr/0011-i18n-paraglide.md).
//
// A plugin's declarations and answers hold a Text: a message of its own with
// what fills it, a term the tenant may have renamed, or business data said as
// it stands. Nothing on the wire is a Text - an answer renders every one it
// carries into a string, in the language of the page that asked, when it
// answers. Rendering is synchronous and pure over its context; the compiled
// messages it reads are the process's own (./node installs them at start).
//
// Server-side: a browser says its own sentences through its package's
// #messages. This root imports nothing of Node, so a contract that declares a
// Text field can be shared with a browser that never renders one.

/** one of a package's messages, by name: what `messageRefs` (./node) hands out */
export interface MessageRef<Inputs = Record<string, never>> {
  readonly namespace: string
  readonly key: string
  /** a phantom: what the message reads, from the package's facade */
  readonly inputs?: Inputs
}

/** a term the tenant may have renamed, by its id */
export interface TermRef {
  readonly id: string
}

/** what a message input may be: a value as it stands, or a text rendered first */
export type TextInput = string | number | Date | Text

export type Text =
  | {
      readonly kind: 'message'
      readonly ref: MessageRef<unknown>
      readonly inputs: Readonly<Record<string, TextInput>>
    }
  | { readonly kind: 'term'; readonly term: TermRef }
  | { readonly kind: 'literal'; readonly value: string }

/** where a message reads a string, a Text may stand: it is rendered first */
type Accepting<Inputs> = {
  readonly [Name in keyof Inputs]: string extends Inputs[Name] ? Inputs[Name] | Text : Inputs[Name]
}

/** a message of the declaring package, with what fills it */
export function text(ref: MessageRef<Record<string, never>>): Text
export function text<Inputs>(ref: MessageRef<Inputs>, inputs: Accepting<Inputs>): Text
export function text(ref: MessageRef<unknown>, inputs: Record<string, TextInput> = {}): Text {
  return { kind: 'message', ref, inputs }
}

export const term = (ref: TermRef): Text => ({ kind: 'term', term: ref })

export const literal = (value: string): Text => ({ kind: 'literal', value })

export const isText = (value: unknown): value is Text => {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { kind?: unknown; ref?: unknown; term?: unknown; value?: unknown }
  switch (candidate.kind) {
    case 'message':
      return typeof candidate.ref === 'object' && candidate.ref !== null
    case 'term':
      return typeof candidate.term === 'object' && candidate.term !== null
    case 'literal':
      return typeof candidate.value === 'string'
    default:
      return false
  }
}

/** the one schema a contribution's text is checked against where it is declared */
export const TextSchema = Schema.declare<Text>(isText)

type Say = (inputs: unknown, options: { readonly locale: SupportedLocale }) => string

/** the compiled messages, by namespace and key */
export interface MessageTable {
  readonly lookup: (namespace: string, key: string) => Say | undefined
}

let installed: MessageTable | undefined

/** the process's compiled messages, installed once when it starts (./node) */
export const installMessageTable = (table: MessageTable): void => {
  installed = table
}

export interface RenderContext {
  readonly locale: SupportedLocale
  /** the tenant's words for its terms, in this locale */
  readonly terms?: ReadonlyMap<string, string>
  /** a term's own words where the tenant has not renamed it */
  readonly termDefault?: (term: TermRef, locale: SupportedLocale) => string
}

/** a text in one language: synchronous, pure, and never cached */
export const render = (said: Text, context: RenderContext): string => {
  switch (said.kind) {
    case 'literal':
      return said.value
    case 'term': {
      const own = context.terms?.get(said.term.id)
      if (own !== undefined) return own
      if (context.termDefault === undefined)
        throw new Error(`no words for the term ${said.term.id}`)
      return context.termDefault(said.term, context.locale)
    }
    case 'message': {
      if (installed === undefined) {
        throw new Error('no compiled messages are installed in this process')
      }
      const say = installed.lookup(said.ref.namespace, said.ref.key)
      if (say === undefined) throw new Error(`${said.ref.namespace} has no message ${said.ref.key}`)
      const inputs: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(said.inputs)) {
        inputs[name] = isText(value) ? render(value, context) : value
      }
      return say(inputs, { locale: context.locale })
    }
  }
}

/** a value's shape once every Text in it is said */
export type Rendered<T> = T extends Text
  ? string
  : T extends Date
    ? T
    : T extends readonly (infer One)[]
      ? readonly Rendered<One>[]
      : T extends object
        ? { readonly [Key in keyof T]: Rendered<T[Key]> }
        : T

const isPlainObject = (value: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * A value with every Text in it said in one language: what an answer does to
 * whatever a service handed it, however deep its texts sit - a collection
 * another plugin filled, the fields of a sign-in method's form.
 */
export const renderTexts = <T>(value: T, context: RenderContext): Rendered<T> =>
  renderAny(value, context) as Rendered<T>

const renderAny = (value: unknown, context: RenderContext): unknown => {
  if (isText(value)) return render(value, context)
  if (Array.isArray(value)) return value.map((one) => renderAny(one, context))
  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, one]) => [key, renderAny(one, context)]),
    )
  }
  return value
}

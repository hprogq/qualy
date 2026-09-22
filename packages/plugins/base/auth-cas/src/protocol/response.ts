import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { ResponseFormat } from './settings.ts'

// What a CAS server answered about one ticket, read strictly.
//
// The answer comes from a server an administrator named, over the network, so
// it is input like any other. Before the parser sees it: a size limit, no
// document type and no entity declarations at all (every recent parser
// advisory about entity expansion starts there), and a nesting limit. The
// parser then only splits elements; it expands no entities, infers no types
// and keeps every prefix and every repeat. Of entities only the five XML
// predefines and numeric references are read, by hand.
//
// Prefixes are not trusted - a server may answer in `cas:`, in `sso:` or in
// none - but the structure is: the root is `serviceResponse`, its one child
// is `authenticationSuccess` or `authenticationFailure`, and the person is
// the success's own `user`. An `authenticationSuccess` found anywhere deeper
// is not one. Attributes keep their names exactly as sent and every value of
// a repeated one.

export interface CasPrincipal {
  /** the name the server knows the person by */
  readonly principal: string
  readonly attributes: Readonly<Record<string, readonly string[]>>
}

export type CasAnswer =
  | { readonly kind: 'success'; readonly principal: CasPrincipal }
  /** the server refused the ticket; the code is the server's own */
  | { readonly kind: 'failure'; readonly code: string }
  /** not an answer this driver can read */
  | { readonly kind: 'unreadable' }

/** a validation answer is a few kilobytes; anything near this is not one */
export const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_DEPTH = 32
const MAX_PRINCIPAL = 255

const unreadable: CasAnswer = { kind: 'unreadable' }

interface Element {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly Element[]
  readonly text: string
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1)

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
}

/** a reference: the five predefined names, or a number */
const REFERENCE = /&(#[0-9]{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z]{1,8});/g
const BARE_AMPERSAND = /&(?!(?:#[0-9]{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z]{1,8});)/

/** the five predefined entities and numeric references; anything else is not ours to read */
const decodeEntities = (raw: string): string | undefined => {
  if (BARE_AMPERSAND.test(raw)) return undefined
  let failed = false
  const decoded = raw.replace(REFERENCE, (_whole, body: string) => {
    if (!body.startsWith('#')) {
      const known = PREDEFINED[body]
      if (known === undefined) failed = true
      return known ?? ''
    }
    const code =
      body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
    if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      failed = true
      return ''
    }
    return String.fromCodePoint(code)
  })
  return failed ? undefined : decoded
}

/** how deep the elements go, counted before anything is built from them */
const deeperThan = (xml: string, limit: number) => {
  let depth = 0
  for (const tag of xml.matchAll(/<(\/?)[A-Za-z_][^>]*?(\/?)>/g)) {
    if (tag[1] === '/') depth -= 1
    else if (tag[2] !== '/') {
      depth += 1
      if (depth > limit) return true
    }
  }
  return false
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // no entity is expanded by the parser, including the predefined ones
  processEntities: false,
  // the pre-scan already refused anything deeper; this is the parser's own
  maxNestedTags: MAX_DEPTH,
  // every value stays the text that was sent
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
})

type Ordered = Record<string, unknown>

/** the parser's ordered output as elements, entities decoded; undefined when unreadable */
const elementsOf = (nodes: readonly Ordered[]): Element[] | undefined => {
  const elements: Element[] = []
  for (const node of nodes) {
    const name = Object.keys(node).find((key) => key !== ':@')
    if (name === undefined || name === '#text' || name.startsWith('#') || name.startsWith('?')) {
      continue
    }
    const raw = (node[':@'] ?? {}) as Record<string, unknown>
    const attributes: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw)) {
      const decoded = decodeEntities(String(value))
      if (decoded === undefined) return undefined
      attributes[localName(key)] = decoded
    }
    const inner = node[name] as readonly Ordered[]
    const children = elementsOf(inner)
    if (children === undefined) return undefined
    let text = ''
    for (const child of inner) {
      if ('#text' in child) {
        const decoded = decodeEntities(String(child['#text']))
        if (decoded === undefined) return undefined
        text += decoded
      }
    }
    elements.push({ name: localName(name), attributes, children, text: text.trim() })
  }
  return elements
}

const principalFrom = (value: string | undefined) => {
  const principal = value?.trim()
  return principal === undefined || principal === '' || principal.length > MAX_PRINCIPAL
    ? undefined
    : principal
}

/** both ways servers write attributes: an element per value, or name and value on one element */
const attributesFrom = (container: Element | undefined) => {
  const attributes: Record<string, string[]> = {}
  for (const entry of container?.children ?? []) {
    const named = entry.name === 'attribute' && entry.attributes['name'] !== undefined
    const name = named ? entry.attributes['name']! : entry.name
    const value = named ? (entry.attributes['value'] ?? entry.text) : entry.text
    // an attribute that is itself a structure is not a value this driver reads
    if (!named && entry.children.length > 0) continue
    ;(attributes[name] ??= []).push(value)
  }
  return attributes
}

export const readXml = (xml: string): CasAnswer => {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) return unreadable
  if (deeperThan(xml, MAX_DEPTH)) return unreadable
  if (XMLValidator.validate(xml) !== true) return unreadable
  let parsed: readonly Ordered[]
  try {
    parsed = parser.parse(xml) as readonly Ordered[]
  } catch {
    return unreadable
  }
  const roots = elementsOf(parsed)
  if (roots === undefined || roots.length !== 1 || roots[0]!.name !== 'serviceResponse') {
    return unreadable
  }
  const outcomes = roots[0]!.children
  if (outcomes.length !== 1) return unreadable
  const outcome = outcomes[0]!
  if (outcome.name === 'authenticationFailure') {
    return { kind: 'failure', code: outcome.attributes['code']?.trim() || 'UNKNOWN' }
  }
  if (outcome.name !== 'authenticationSuccess') return unreadable
  const users = outcome.children.filter((child) => child.name === 'user')
  const containers = outcome.children.filter((child) => child.name === 'attributes')
  if (users.length !== 1 || containers.length > 1) return unreadable
  const principal = principalFrom(users[0]!.text)
  if (principal === undefined) return unreadable
  return {
    kind: 'success',
    principal: { principal, attributes: attributesFrom(containers[0]) },
  }
}

/** the JSON form CAS 3 defines, for a server configured to answer in it */
export const readJson = (body: string): CasAnswer => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return unreadable
  }
  const response = (parsed as { serviceResponse?: unknown } | null)?.serviceResponse
  if (response === null || typeof response !== 'object') return unreadable
  const outcome = response as Record<string, unknown>
  const keys = Object.keys(outcome)
  if (keys.length !== 1) return unreadable
  if (keys[0] === 'authenticationFailure') {
    const code = (outcome['authenticationFailure'] as { code?: unknown } | null)?.code
    return { kind: 'failure', code: typeof code === 'string' && code.trim() !== '' ? code.trim() : 'UNKNOWN' }
  }
  if (keys[0] !== 'authenticationSuccess') return unreadable
  const success = outcome['authenticationSuccess'] as Record<string, unknown> | null
  const principal = principalFrom(typeof success?.['user'] === 'string' ? success['user'] : undefined)
  if (principal === undefined) return unreadable
  const attributes: Record<string, string[]> = {}
  const raw = success?.['attributes']
  if (raw !== undefined) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return unreadable
    for (const [name, value] of Object.entries(raw)) {
      const values = Array.isArray(value) ? value : [value]
      // a nested object is not a value
      const strings = values.filter(
        (one): one is string | number | boolean =>
          typeof one === 'string' || typeof one === 'number' || typeof one === 'boolean',
      )
      if (strings.length > 0) attributes[name] = strings.map(String)
    }
  }
  return { kind: 'success', principal: { principal, attributes } }
}

/** CAS 1: `yes` and the name on the next line, or `no` */
export const readText = (body: string): CasAnswer => {
  const lines = body.split(/\r?\n/)
  if (lines[0]?.trim() === 'no') return { kind: 'failure', code: 'INVALID_TICKET' }
  if (lines[0]?.trim() !== 'yes') return unreadable
  const principal = principalFrom(lines[1])
  return principal === undefined
    ? unreadable
    : { kind: 'success', principal: { principal, attributes: {} } }
}

/**
 * One answer, read in the format it was asked for.
 *
 * `auto` looks at this answer alone and reads it once. There is no asking a
 * second time in another format: a service ticket is spent by the first
 * validation, whatever that validation made of the reply.
 */
export const readAnswer = (bytes: Uint8Array, format: ResponseFormat): CasAnswer => {
  if (bytes.byteLength > MAX_RESPONSE_BYTES) return unreadable
  let body: string
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return unreadable
  }
  const start = body.trimStart()
  const detected: ResponseFormat =
    format !== 'auto' ? format : start.startsWith('<') ? 'xml' : start.startsWith('{') ? 'json' : 'text'
  if (detected === 'xml') return readXml(start)
  if (detected === 'json') return readJson(start)
  return readText(start)
}

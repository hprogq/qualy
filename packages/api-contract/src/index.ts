import { oc } from '@orpc/contract'
import { ORPCError } from '@orpc/client'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'

// the api foundations every plugin builds on. A plugin declares its domain
// errors ONCE — code, http status, english protocol message and an optional
// zod data schema — and everything else is derived from that single source:
// the contract's .errors() config, the http status map the beta.21 handler
// needs, the typed error class the service throws and the data types the
// client's translations receive. Plugin authors never write status tables,
// data maps or conditional types.

export interface ErrorDefinition {
  status: number
  // english developer/protocol message: openapi docs, logs, non-browser
  // clients and the missing-translation fallback — never the display text
  message: string
  // safe, structured payload the frontend formats into a localized
  // sentence; never role codes, constraint names or raw sql detail
  data?: z.ZodType
}

export type ErrorDefinitions = Record<string, ErrorDefinition>

// the payload type a definition carries, derived from its zod schema — the
// schema is the single source, so contract and domain can never drift
export type ErrorDataOf<Definition> = Definition extends { data: infer Schema extends z.ZodType }
  ? z.output<Schema>
  : undefined

// keyed on whether the definition declares a schema, exactly like the
// runtime branch below — deriving it from the output type instead would
// disagree for a schema whose output includes undefined
type CreateArgs<Definition> = Definition extends { data: infer Schema extends z.ZodType }
  ? [data: z.output<Schema>, message?: string]
  : [message?: string]

// errors cross package boundaries, so recognition rides a global symbol
// rather than instanceof: a plugin resolving its own copy of this package
// (a different version, a bundled inline, a duplicated module graph) still
// produces errors the server's boundary recognizes
const DOMAIN_ERROR = Symbol.for('qualy.api.domain-error')
const ACCESS_DENIED = Symbol.for('qualy.api.access-denied')

// what a service throws; the server's error boundary maps it onto the
// procedure's typed contract errors. Only the structural type is exported:
// the sole way to build one is defineDomainErrors().create(), which is what
// enforces that a code exists and carries the data its schema declares.
export interface DomainError<Code extends string = string, Data = unknown> extends Error {
  readonly code: Code
  readonly data: Data
}

class DomainErrorImpl<Code extends string, Data> extends Error implements DomainError<Code, Data> {
  readonly [DOMAIN_ERROR] = true

  constructor(
    readonly code: Code,
    message: string,
    readonly data: Data,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof Error &&
    (error as Partial<Record<typeof DOMAIN_ERROR, boolean>>)[DOMAIN_ERROR] === true
  )
}

// an in-service authorization verdict (for example the in-lock re-check
// after the router's fast-path requireAt); the error boundary turns it into
// the transport's common FORBIDDEN
export class AccessDeniedError extends Error {
  readonly [ACCESS_DENIED] = true

  constructor(message = 'access denied') {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

export function isAccessDeniedError(error: unknown): error is AccessDeniedError {
  return (
    error instanceof Error &&
    (error as Partial<Record<typeof ACCESS_DENIED, boolean>>)[ACCESS_DENIED] === true
  )
}

export interface DomainErrors<Defs extends ErrorDefinitions> {
  readonly definitions: Defs
  // the subset a procedure declares: oc.errors(errors.pick('A', 'B'))
  pick<Codes extends keyof Defs & string>(...codes: Codes[]): Pick<Defs, Codes>
  // constructs the typed error; a code that declares data demands it, a
  // dataless code refuses it, and the message defaults to the definition's
  create<Code extends keyof Defs & string>(
    code: Code,
    ...args: CreateArgs<Defs[Code]>
  ): DomainError<Code, ErrorDataOf<Defs[Code]>>
  is(error: unknown): error is DomainError<keyof Defs & string, unknown>
}

const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/

export function defineDomainErrors<const Defs extends ErrorDefinitions>(
  definitions: Defs,
): DomainErrors<Defs> {
  // a malformed declaration fails when the plugin loads, not when the error
  // it describes is finally raised in production
  for (const [code, definition] of Object.entries(definitions)) {
    if (!ERROR_CODE.test(code)) {
      throw new Error(`error code "${code}" must be SCREAMING_SNAKE_CASE`)
    }
    if (!Number.isInteger(definition.status) || definition.status < 400 || definition.status > 599) {
      throw new Error(`error ${code}: status must be an integer http error status`)
    }
    if (definition.message.trim() === '') {
      throw new Error(`error ${code}: message must not be blank`)
    }
  }
  // deep enough to protect what the dsl owns: the definition objects it
  // hands to pick() and create(), not the zod schemas inside them
  for (const definition of Object.values(definitions)) Object.freeze(definition)
  Object.freeze(definitions)
  return {
    definitions,
    pick: (...codes) =>
      Object.fromEntries(codes.map((code) => [code, definitions[code]])) as never,
    create: (code, ...args) => {
      const definition = definitions[code]!
      // whether the first argument is data or a message override is decided
      // by the definition, never by guessing at the value's shape
      const rest = args as unknown[]
      const [data, message] = definition.data ? [rest[0], rest[1]] : [undefined, rest[0]]
      return new DomainErrorImpl(
        code,
        (message as string | undefined) ?? definition.message,
        data,
      ) as never
    },
    is: (error): error is never =>
      isDomainError(error) && Object.hasOwn(definitions, error.code),
  }
}

// --- contract route helpers ---

type HttpPath = `/${string}`
const route = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: HttpPath) =>
  oc.meta(openapi({ method, path }))

export const get = (path: HttpPath) => route('GET', path)
export const post = (path: HttpPath) => route('POST', path)
export const put = (path: HttpPath) => route('PUT', path)
export const patch = (path: HttpPath) => route('PATCH', path)
export const del = (path: HttpPath) => route('DELETE', path)

// the ubiquitous "it worked" response: a handler that fails throws, so the
// client never has to consider a false
export const okOutput = z.object({ ok: z.literal(true) })

// --- pagination ---

// Keyset pagination, in the foundation because the alternative is what every
// list started as: a bare `limit 200` that drops the rest in silence. A page
// either says where the next one starts or says there is no next one.
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

export const pageInput = {
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
}

// a page of T plus where to resume; absent nextCursor means the end
export const pageOutput = <Item extends z.ZodType>(item: Item) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

// the cursor is opaque to clients on purpose: it encodes the sort key of the
// last row, which is an implementation detail of the query behind it. Encoded
// through the web primitives rather than Buffer — this module is bundled into
// the browser, and sort keys are display names, so utf-8 is not optional.
const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const fromBase64Url = (value: string) => {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

// The cursor carries a fingerprint of the query it came from, because a
// cursor is only meaningful against the filter that produced it: resuming a
// search for A with a cursor from a search for B silently skips or repeats
// rows, and looks like data loss rather than misuse.
export function encodeQueryCursor(
  queryFingerprint: string,
  key: readonly (string | number)[],
): string {
  return toBase64Url(
    new TextEncoder().encode(JSON.stringify({ v: 1, q: queryFingerprint, k: key })),
  )
}

// A cursor that cannot be read is the caller's error, answered as one. It
// used to fall back to the first page, which turns "load more" into an
// endless loop of the same rows and reports nothing wrong.
export function decodeQueryCursor(
  cursor: string | undefined,
  queryFingerprint: string,
  arity: number,
): string[] | undefined {
  if (cursor === undefined) return undefined
  const reject = () => {
    throw new ORPCError('BAD_REQUEST', { message: 'the pagination cursor is not usable here' })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(cursor)))
  } catch {
    return reject()
  }
  const payload = parsed as { v?: unknown; q?: unknown; k?: unknown } | null
  if (!payload || payload.v !== 1 || payload.q !== queryFingerprint) return reject()
  if (!Array.isArray(payload.k) || payload.k.length !== arity) return reject()
  if (!payload.k.every((part) => typeof part === 'string')) return reject()
  return payload.k as string[]
}


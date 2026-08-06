import { z } from 'zod'

// How a plugin declares a domain failure, for the browser.
//
// The server declares its failures as tagged schema classes, which is what the
// api document and the derived client are built from. This is the other half:
// a client catalog is keyed by code and its values are typed by that failure's
// data, so the translation for a code cannot take a field the failure does not
// carry. The two agree because both are generated from the same codes, and the
// error-shape gates check that they still do.
//
// Everything oRPC-shaped that used to live here - route builders, page inputs,
// the cursor codec - went with oRPC itself.

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
    if (
      !Number.isInteger(definition.status) ||
      definition.status < 400 ||
      definition.status > 599
    ) {
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
    pick: (...codes) => Object.fromEntries(codes.map((code) => [code, definitions[code]])) as never,
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
    is: (error): error is never => isDomainError(error) && Object.hasOwn(definitions, error.code),
  }
}

// --- contract route helpers ---

type HttpPath = `/${string}`

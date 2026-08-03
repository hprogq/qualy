import { oc } from '@orpc/contract'
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

type CreateArgs<Data> = Data extends undefined
  ? [message?: string]
  : [data: Data, message?: string]

// what a service throws; the server's error boundary maps it onto the
// procedure's typed contract errors
export class DomainError<Code extends string = string, Data = unknown> extends Error {
  constructor(
    readonly code: Code,
    message: string,
    readonly data: Data,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

// an in-service authorization verdict (for example the in-lock re-check
// after the router's fast-path requireAt); the error boundary turns it into
// the transport's common FORBIDDEN
export class AccessDeniedError extends Error {
  constructor(message = 'access denied') {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

export interface DomainErrors<Defs extends ErrorDefinitions> {
  readonly definitions: Defs
  // http status per code, for the beta.21 handler's errorStatusMap (the
  // contract-level status is ignored by that version, probed)
  readonly statuses: { [Code in keyof Defs]: Defs[Code]['status'] }
  // the subset a procedure declares: oc.errors(errors.pick('A', 'B'))
  pick<Codes extends keyof Defs & string>(...codes: Codes[]): Pick<Defs, Codes>
  // constructs the typed error; a code that declares data demands it, a
  // dataless code refuses it, and the message defaults to the definition's
  create<Code extends keyof Defs & string>(
    code: Code,
    ...args: CreateArgs<ErrorDataOf<Defs[Code]>>
  ): DomainError<Code, ErrorDataOf<Defs[Code]>>
  is(error: unknown): error is DomainError<keyof Defs & string, unknown>
}

export function defineDomainErrors<const Defs extends ErrorDefinitions>(
  definitions: Defs,
): DomainErrors<Defs> {
  const statuses = Object.fromEntries(
    Object.entries(definitions).map(([code, definition]) => [code, definition.status]),
  ) as { [Code in keyof Defs]: Defs[Code]['status'] }
  return {
    definitions,
    statuses,
    pick: (...codes) =>
      Object.fromEntries(codes.map((code) => [code, definitions[code]])) as never,
    create: (code, ...args) => {
      const definition = definitions[code]!
      // whether the first argument is data or a message override is decided
      // by the definition, never by guessing at the value's shape
      const rest = args as unknown[]
      const [data, message] = definition.data ? [rest[0], rest[1]] : [undefined, rest[0]]
      return new DomainError(
        code,
        (message as string | undefined) ?? definition.message,
        data,
      ) as never
    },
    is: (error): error is never => error instanceof DomainError && error.code in definitions,
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

// the ubiquitous "it worked" response
export const okOutput = z.object({ ok: z.boolean() })

import { Cause, Effect, Result } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { HttpApiError } from 'effect/unstable/httpapi'
import { BadRequest } from './schema.ts'

// A request the endpoint's own schema would not read, answered in the one
// shape every other refusal here is answered in.
//
// The platform turns a decoding failure into a defect and renders it as an
// EMPTY 400 - no body, no content type (repos/effect/packages/effect/src/
// unstable/httpapi/HttpApiError.ts, `badRequestResponse`; the die is in
// HttpApiBuilder's handler). Measured: `{status: 400, contentType: null,
// body: ''}`. That is the one JSON error under `/api` with no `_tag` on it,
// so the browser's error translation has nothing to key on and a stale tab
// sending yesterday's shape gets a blank failure instead of a sentence.
//
// This has to be a ROUTER middleware rather than one of the serve chain:
// upstream says a serve middleware runs around the sending of the response
// and changes to it are not reflected in what the client receives.
//
// What goes back names the part that would not read - params, query,
// headers, payload - and nothing else. The detail belongs in the log: which
// field and what was expected is the caller's own input coming back at them,
// and a decoder's message is not a translated string.

const PART: Record<HttpApiError.HttpApiSchemaError['kind'], string> = {
  Params: 'the address',
  Headers: 'the request headers',
  Query: 'the query',
  Body: 'the request body',
  Payload: 'the request payload',
  ResponseHeaders: 'the response headers',
}

/**
 * The refusal as this product spells refusals, built without an api context.
 *
 * The tag is read off an instance rather than written out again, so it can
 * only ever be the tag `BadRequest` actually carries. The field is written
 * out: `message` is an own but NON-enumerable property on an Error, so
 * spreading the instance silently drops it and leaves a body with a tag and
 * nothing in it.
 */
const refusal = (kind: HttpApiError.HttpApiSchemaError['kind']) => {
  const message = `${PART[kind] ?? 'the request'} is not in the shape this endpoint accepts`
  return HttpServerResponse.text(
    JSON.stringify({ _tag: new BadRequest({ message })._tag, message }),
    { status: 400, contentType: 'application/json' },
  )
}

/**
 * Mounted once, next to the routes, so every endpoint answers alike.
 *
 * Global because it is about the shape of an answer rather than about any
 * one route, and it re-raises everything it did not recognise: a domain
 * error rendered as a bad request would be a far worse lie than the blank
 * one this exists to remove.
 */
export const schemaRefusals = HttpRouter.middleware(
  (app) =>
    Effect.catchCause(app, (cause) => {
      const found = Cause.findDefect(cause)
      if (!Result.isSuccess(found) || !HttpApiError.HttpApiSchemaError.is(found.success)) {
        return Effect.failCause(cause)
      }
      const refused = found.success
      return Effect.as(
        Effect.logDebug('request refused by its own schema', {
          kind: refused.kind,
          reason: String(refused.cause),
        }),
        refusal(refused.kind),
      )
    }),
  { global: true },
)

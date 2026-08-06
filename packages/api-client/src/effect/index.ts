import { Effect } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'
import { qualyApi } from '@qualy/api'

// The client is derived from the same definition the server implements, so a
// route that changed shape is a compile error here rather than a runtime
// surprise in a page.

/**
 * A client for this api.
 *
 * `baseUrl` is an ORIGIN, not a mount point. The mount lives in the definition
 * already - `qualyApi` applies the prefix - so every declared path is the full
 * path, and passing the prefix here asks for `/api/api/...`. Which is exactly
 * what happened, and the failure surfaced as a 404 in a browser rather than
 * anywhere near this line.
 *
 * Omitting it entirely is the browser case: the paths are absolute and
 * same-origin, so fetch resolves them against the page.
 */
export const makeClient = (baseUrl?: string) =>
  HttpApiClient.make(qualyApi, baseUrl === undefined ? {} : { baseUrl }).pipe(
    Effect.provide(FetchHttpClient.layer),
  )

export type QualyClient = Effect.Success<ReturnType<typeof makeClient>>

/**
 * What one endpoint answers with.
 *
 * A screen that renders a row should be typed from the api that produced it,
 * not from a hand-written copy: `RoleEditor` took the oRPC DTO and kept
 * compiling after the api's own shape moved, because the two happened to agree.
 */
export type ApiResult<
  Group extends keyof QualyClient,
  Endpoint extends keyof QualyClient[Group],
> = QualyClient[Group][Endpoint] extends (...args: never[]) => Effect.Effect<infer A, unknown>
  ? A
  : never

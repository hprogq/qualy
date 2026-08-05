import { Effect } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'
import { qualyApi } from '@qualy/api'

// The client is derived from the same definition the server implements, so a
// route that changed shape is a compile error here rather than a runtime
// surprise in a page.

export const makeClient = (baseUrl: string) =>
  HttpApiClient.make(qualyApi, { baseUrl }).pipe(Effect.provide(FetchHttpClient.layer))

export type QualyClient = Effect.Success<ReturnType<typeof makeClient>>

/**
 * What one endpoint answers with.
 *
 * A screen that renders a row should be typed from the api that produced it,
 * not from a hand-written copy: `RoleEditor` took the oRPC DTO and kept
 * compiling after the api's own shape moved, because the two happened to agree.
 */
export type ApiResult<Group extends keyof QualyClient, Endpoint extends keyof QualyClient[Group]> =
  QualyClient[Group][Endpoint] extends (...args: never[]) => Effect.Effect<infer A, unknown>
    ? A
    : never

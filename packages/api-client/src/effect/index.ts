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

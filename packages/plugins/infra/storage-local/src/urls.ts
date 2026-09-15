import { HttpApiClient } from 'effect/unstable/httpapi'
import { Api, apiRouteTemplates } from '@qualy/api-kit/local'
import { storageLocalApiGroup } from './api.ts'

// Where a grant sends the browser, built from the contract the server serves.
//
// The prefix is the local api's, so nothing here spells it, and the
// parameter goes through the endpoint's own schema. A renamed route or a
// renamed parameter is a compile error rather than a grant pointing at a
// door that moved.

const localApi = Api.local(storageLocalApiGroup)

const buildUrl = HttpApiClient.urlBuilder(localApi)

/** relative, so the browser resolves it against whichever host answered */
export const localUploadUrl = (reservationId: string): string =>
  buildUrl.storageLocal.uploadObject({ params: { reservationId } })

/**
 * The same routes as plain data, for reporting.
 *
 * The upload is the one api call in the browser that no typed client makes -
 * it is an XHR, for the progress events - so the route it will be reported as
 * has to be declared rather than picked up as a client is built. Here because
 * this is already where the contract is turned into an address.
 */
export const localUploadRoutes = apiRouteTemplates(localApi)

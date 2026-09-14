import { HttpApiClient } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/local'
import { storageLocalApiGroup } from './api.ts'

// Where a grant sends the browser, built from the contract the server serves.
//
// The prefix is the local api's, so nothing here spells it, and the
// parameter goes through the endpoint's own schema. A renamed route or a
// renamed parameter is a compile error rather than a grant pointing at a
// door that moved.

const buildUrl = HttpApiClient.urlBuilder(Api.local(storageLocalApiGroup))

/** relative, so the browser resolves it against whichever host answered */
export const localUploadUrl = (reservationId: string): string =>
  buildUrl.storageLocal.uploadObject({ params: { reservationId } })

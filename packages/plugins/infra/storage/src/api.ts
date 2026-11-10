import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { uuidInput } from '@qualy/api-kit/schema'
import { Authenticated } from '@qualy/auth-contract/session'

export class ContentUnavailable extends Schema.TaggedError<ContentUnavailable>()(
  'STORAGE_CONTENT_UNAVAILABLE',
  {},
  { httpApiStatus: 404 },
) {}

export const storageContentApiGroup = HttpApiGroup.make('storageContents').add(
  HttpApiEndpoint.get('getContent', '/contents/:attachmentId', {
    params: Schema.Struct({ attachmentId: uuidInput }),
    query: Schema.Struct({
      context: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
      params: Schema.String.check(Schema.isMaxLength(2048)),
      identity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
      purpose: Schema.Literals(['original', 'thumbnail']),
    }),
    success: HttpApiSchema.StreamUint8Array(),
    error: [ContentUnavailable],
  }).middleware(Authenticated),
)

import { Schema } from 'effect'
import { HttpApiClient } from 'effect/http-api'
import { Api } from '@qualy/api-kit/local'
import { storageContentApiGroup } from './api.ts'
import type { ContentPurpose } from './content-metadata.ts'

const urls = HttpApiClient.urlBuilder(Api.local(storageContentApiGroup))

/** Each business plugin augments this interface from its browser-safe contract. */
export interface ReadContextTypes {}
export type ReadContextKey = Extract<keyof ReadContextTypes, string>

export interface ReadReference<K extends ReadContextKey = ReadContextKey> {
  readonly key: K
  readonly context: ReadContextTypes[K]
  readonly contentUrl: (attachmentId: string, identity: string, purpose?: ContentPurpose) => string
}

export interface ReadContext<K extends ReadContextKey> {
  readonly key: K
  readonly schema: Schema.ConstraintDecoder<ReadContextTypes[K]>
  readonly at: (context: NoInfer<ReadContextTypes[K]>) => ReadReference<K>
}

/** Defines a contract, not an authorization decision or a React context. */
export const defineReadContext = <const K extends ReadContextKey>(
  key: K,
  schema: Schema.ConstraintDecoder<NoInfer<ReadContextTypes[K]>>,
): ReadContext<K> => ({
  key,
  schema,
  at: (context) => ({
    key,
    context,
    contentUrl: (attachmentId, identity, purpose = 'original') =>
      urls.storageContents.getContent({
        params: { attachmentId },
        query: { context: key, params: JSON.stringify(context), identity, purpose },
      }),
  }),
})

export {
  contentDescriptor,
  type ContentDescriptor,
  type ContentPurpose,
} from './content-metadata.ts'

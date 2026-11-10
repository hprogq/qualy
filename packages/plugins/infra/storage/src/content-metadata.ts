import { Schema } from 'effect'

/** Metadata is independent of the delivery backend and the browser session. */
export const contentDescriptor = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  declaredMime: Schema.String,
  size: Schema.String,
  status: Schema.Literals(['staged', 'bound', 'retired']),
})
export type ContentDescriptor = typeof contentDescriptor.Type
export type ContentPurpose = 'original' | 'thumbnail'

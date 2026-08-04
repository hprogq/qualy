import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

// The API this plugin contributes, as a definition only: no handler, no
// database, nothing a browser cannot import. The client is built from this
// file, so it must stay free of anything server side.
//
// The path is frozen (scripts/tests/api-surface.test.ts). It is what a client
// that already exists depends on, so it survives the transport change.

export const pingApiGroup = HttpApiGroup.make('ping').add(
  HttpApiEndpoint.get('hello', '/ping/hello', {
    query: Schema.Struct({ name: Schema.optional(Schema.String) }),
    success: Schema.Struct({ msg: Schema.String }),
  }),
)

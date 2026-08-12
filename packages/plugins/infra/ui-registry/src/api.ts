import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { Viewer } from '@qualy/plugin-auth/server/session-contract'

// The authorized projection of the application shell for one viewer.
//
// /app rather than /ui-registry or /ui: the registry is how it is built, but
// what a browser asks for here is the application it may see.

const namespaced = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/i),
)

const layout = Schema.Struct({
  contract: namespaced,
  provider: namespaced,
  component: Schema.String,
})

// the same two shapes the i18n contract calls UiText: a message the browser
// translates, or business data that must not be translated at all
const uiText = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('message'),
    id: Schema.String,
    defaultMessage: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal('literal'), value: Schema.String }),
])

const page = Schema.Struct({
  id: namespaced,
  path: Schema.String,
  component: Schema.String,
  layout: namespaced,
  title: Schema.optional(uiText),
})

const slotItem = Schema.Struct({
  id: namespaced,
  component: Schema.String,
  order: Schema.Number,
})

export const appApiGroup = HttpApiGroup.make('app').add(
  // anonymous callers are served on purpose: the login page and every other
  // public surface is discovered through this same manifest
  // Viewer, not Authenticated: this is served to anonymous visitors on
  // purpose, since the login page is discovered through it. Declaring nothing
  // is not the same thing - nothing provides a principal unless a middleware
  // does, so a signed-in administrator was served the anonymous manifest.
  HttpApiEndpoint.get('getManifest', '/app/manifest', {
    success: Schema.Struct({
      layouts: Schema.Array(layout),
      pages: Schema.Array(page),
      collections: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
      slots: Schema.Record(Schema.String, Schema.Array(slotItem)),
    }),
  }).middleware(Viewer),
)

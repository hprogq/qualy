import { Schema } from 'effect'
import { UiTextSchema } from '@qualy/i18n-contract'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { Viewer } from '@qualy/plugin-auth/server/session-contract'

// The authorized projection of the application shell for one viewer.
//
// /app rather than /ui-registry or /ui: the registry is how it is built, but
// what a browser asks for here is the application it may see.
//
// Every identity here is a product one - a page id, a layout contract, a slot
// and the item under it - and the browser resolves its renderer from that.
// Naming the package and the source file instead is what this stopped doing;
// the shape change rides on the client protocol, which is what a breaking
// browser wire change is for.

const namespaced = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/i),
)

// A layout is the contract it satisfies. Which plugin provides it, and which
// module renders it, are the assembly's business: the browser resolves the
// shell by the contract its pages name.
const layout = Schema.Struct({ contract: namespaced })

// a message the browser translates, or business data that must not be
// translated at all: the i18n contract's own schema of it
const uiText = UiTextSchema

const page = Schema.Struct({
  id: namespaced,
  path: Schema.String,
  layout: namespaced,
  title: Schema.optional(uiText),
})

// its id under its slot: the pair the browser resolves a renderer by, and
// the whole of what it is told about the contribution
const slotItem = Schema.Struct({
  id: namespaced,
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

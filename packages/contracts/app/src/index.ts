import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Viewer } from '@qualy/auth-contract/session'

// The authorized projection of the application shell for one viewer.
//
// /app rather than /ui-registry or /ui: the registry is how it is built, but
// what a browser asks for here is the application it may see.
//
// A CONTRACT rather than the plugin that serves it. The shell's runtime reads
// this endpoint on every page - it is how a browser learns what it may open -
// and reaching it through the plugin that happens to implement it made the
// platform depend on an optional plugin. The plugin implements this; the
// runtime consumes it; neither imports the other.
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

const page = Schema.Struct({
  id: namespaced,
  path: Schema.String,
  layout: namespaced,
  // what a tab calls the page, in the reader's language
  title: Schema.optional(Schema.String),
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
      // whether the server recognised a live session: which way an address
      // this manifest cannot place is taken - to sign in first, or as a page
      // this identity cannot open - and nothing about what it may see
      viewer: Schema.Literals(['anonymous', 'authenticated']),
      // who the session is, as a key that is the same for one person in every
      // session and tells two people apart, and nothing else: a page whose
      // session ran out asks for it again and carries on only if the person
      // who signed back in is the one it was working for. Absent for nobody.
      identity: Schema.optional(Schema.String),
      layouts: Schema.Array(layout),
      pages: Schema.Array(page),
      collections: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
      slots: Schema.Record(Schema.String, Schema.Array(slotItem)),
      // what the whole page reads while it is open, by the key of the plugin
      // that provides it, already said in the page's language: a tenant's
      // words for its terms
      context: Schema.Record(Schema.String, Schema.Unknown),
    }),
  }).middleware(Viewer),
)

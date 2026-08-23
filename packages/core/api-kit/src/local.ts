import { HttpApi, type HttpApiGroup } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from './index.ts'

// The one piece of the api surface a browser is allowed to reach.
//
// Deriving a typed client from a group needs the aggregate's identity, which
// used to mean importing the module that also serves the api - and that one
// names `HttpApiScalar`, whose module carries an embedded copy of the whole
// reference ui. Nothing dropped it: the docs layer is a property of an object
// the browser does use, so tree shaking kept the lot, and every page load
// carried 3.1 MB of api documentation nobody could see.
//
// So the split is by audience, not by taste: what a browser needs lives here,
// with no import that leads to a server, and `tools/tests/browser-graph.test.ts`
// bundles a real client entry to keep it that way.

export const Api = {
  /**
   * The local api a plugin implements its group against.
   *
   * It exists so a plugin builds handlers without importing the aggregate
   * that will contain them, and it carries the aggregate's identity - the
   * api id, which brands the handler layer, and the prefix, which places the
   * routes. Both are the aggregate's business: a plugin that spelled them
   * would be repeating somebody else's decision, and a typo would surface as
   * a handler layer the aggregate cannot accept or a route the document does
   * not describe.
   */
  local: <const A extends readonly [HttpApiGroup.Constraint, ...HttpApiGroup.Constraint[]]>(
    ...groups: A
  ) =>
    HttpApi.make(QUALY_API_ID)
      .add(...groups)
      .prefix(QUALY_API_PREFIX),
}

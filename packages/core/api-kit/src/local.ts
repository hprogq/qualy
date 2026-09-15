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

/** one endpoint as the contract declares it: the method and the path with its parameters named */
export interface ApiRouteTemplate {
  readonly method: string
  readonly template: string
}

/**
 * Every route an api declares, as plain data.
 *
 * Here because this is where a browser gets an api value at all, and because
 * the walk is about the contract rather than about whoever wants it. What
 * wants it is browser reporting: a request's address carries the row, and the
 * only thing that knows which segment IS the row is the declaration that
 * named it. Handing over `{method, template}` keeps that knowledge on this
 * side of the line - nothing downstream has to know what Effect is.
 *
 * `HttpApi.reflect` is the published way to enumerate an api, and the two
 * fields read off each endpoint - `method` and `path` - are declared on the
 * public `HttpApiEndpoint` interface. The prefix is already in `path`,
 * because `local` applied it before anybody could ask.
 */
export const apiRouteTemplates = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
): readonly ApiRouteTemplate[] => {
  const routes: ApiRouteTemplate[] = []
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({ endpoint }) => {
      routes.push({ method: endpoint.method, template: endpoint.path })
    },
  })
  return routes
}

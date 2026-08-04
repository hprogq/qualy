/**
 * The identifier of the API every plugin contributes to.
 *
 * A plugin implements its own group against a local API holding only that
 * group, so no plugin depends on the aggregate that is generated from every
 * plugin:
 *
 * ```ts
 * const local = HttpApi.make(QUALY_API_ID).add(pingApiGroup)
 * export const pingApiHandlers = HttpApiBuilder.group(local, 'ping', ...)
 * ```
 *
 * The two agree at runtime because the aggregate looks handlers up by group
 * identifier alone, and they agree in the type system because
 * `HttpApiBuilder.group` brands its output with the api id as well: a handler
 * layer built under a different id does not satisfy the aggregate that serves
 * it, so a typo here is a compile error rather than a missing route.
 *
 * The consequence worth knowing is that group identifiers are global. Two
 * plugins claiming the same one would resolve to whichever layer merged last,
 * so the generator rejects duplicates rather than letting one replace the
 * other silently.
 */
export const QUALY_API_ID = 'qualy'

/**
 * Where the business API is mounted.
 *
 * The prefix has to be applied in two places: the local API a plugin
 * implements against, and the aggregate that serves it. `HttpApiBuilder.layer`
 * takes its routes from the group layer and uses the aggregate only to
 * generate the document, so prefixing one and not the other moves the document
 * without moving the routes. Nothing in the type system catches that, which is
 * why there is a test asserting the served paths and the generated document
 * agree.
 *
 * Health probes deliberately live outside it: they answer orchestrators, not
 * API clients, and they stay out of the generated document.
 */
export const QUALY_API_PREFIX = '/api'

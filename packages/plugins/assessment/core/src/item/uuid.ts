// What an opaque identifier looks like, for the places that take one out of
// a payload.
//
// On its own because several doors read ids out of a `Schema.Unknown` body
// and hand them straight to a query. A `::uuid[]` cast refuses anything that
// is not one, and the refusal arrives as a database fault - a 500 for what
// is simply a malformed request - so the shape is checked where the value
// enters instead.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value)

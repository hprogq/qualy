import { Schema } from 'effect'
import { MAX_PAGE_SIZE } from './index.ts'

// The page shape, as schemas. Its own module because the kit's root is
// imported by the browser bundle through the oRPC contract package, and that
// bundle has no reason to carry Effect.

/**
 * A list request.
 *
 * Both fields arrive as strings because they are search parameters; the
 * handler is what decides the default size, not the schema, so an absent limit
 * stays absent rather than becoming a number the client did not send.
 */
export const pageQuery = {
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
  limit: Schema.optional(Schema.String),
}

/**
 * A page of items plus where to resume; a null nextCursor means the end.
 *
 * The item is constrained to a schema that needs no services, not to
 * `Schema.Top`: Top carries `unknown` in both service channels, and an
 * endpoint built from it leaks an `unknown` requirement all the way to the
 * root layer, where it is reported as a missing service with no name.
 */
export const pageOf = <T, E>(item: Schema.Codec<T, E, never, never>) =>
  Schema.Struct({ items: Schema.Array(item), nextCursor: Schema.NullOr(Schema.String) })

/**
 * A cursor that cannot be read here.
 *
 * The tag is the code oRPC already puts on the wire for this, deliberately:
 * while both runtimes serve, a client must see the same failure whichever one
 * answered, and precision here would buy nothing a client could act on.
 */
export class BadRequest extends Schema.TaggedErrorClass<BadRequest>()(
  'BAD_REQUEST',
  { message: Schema.String },
  { httpApiStatus: 400, identifier: 'BadRequest' },
) {}

export const cursorUnusable = () =>
  new BadRequest({ message: 'the pagination cursor is not usable here' })

/**
 * The page size a request asked for.
 *
 * A limit that is not a usable number is treated as absent rather than
 * refused: it arrives as a search parameter, and the failure mode of guessing
 * is one page of the default size, while the failure mode of refusing is a
 * list screen that will not load.
 */
export const pageSize = (limit: string | undefined, fallback: number): number => {
  const parsed = Number(limit)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, MAX_PAGE_SIZE)
}

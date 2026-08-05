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

// --- the primitives every plugin's payloads are built from ---
//
// Mirrors of the zod constants the oRPC contracts declare. They live here
// rather than per plugin because the failure they prevent is systemic: an
// input schema that accepts more than the contract did does not fail at the
// boundary, it fails at the database, where a check violation is not a
// translatable sqlstate and so becomes a 500 rather than a 400.

/** lowercase kebab-case, the shape every stable code in the system has */
export const kebabCode = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(63),
)

/**
 * A human-readable name, trimmed on the way in.
 *
 * `Schema.Trim` is a decode-time transform, matching zod's `.trim()`.
 * `Schema.isTrimmed` would instead REFUSE padded input, which the oRPC side
 * accepts and normalizes: that would be a new divergence in the other
 * direction, and would leave the two runtimes storing different rows for the
 * same request rather than agreeing.
 */
export const trimmedName = (max: number) =>
  Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(max))

/** free text with a ceiling, not trimmed: the contract does not trim it either */
export const boundedText = (max: number) => Schema.String.check(Schema.isMaxLength(max))

/** an integer inside the range the column can actually hold */
export const boundedInt = (min: number, max: number) =>
  Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(min),
    Schema.isLessThanOrEqualTo(max),
  )

/** the version a set replacement was written against; never optional */
export const expectedVersion = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)

/**
 * Refuses a patch that changes nothing.
 *
 * A no-op patch is a mistake, not a free request: every one of these bodies
 * carries an optimistic-concurrency version, and the statements behind them
 * bump it unconditionally. Accepting `{version: 3}` therefore commits version
 * 4, and a concurrent administrator's genuine edit against version 3 is then
 * refused although nothing changed.
 */
export const changed = <Fields extends Schema.Struct.Fields>(
  fields: Fields,
  keys: readonly (keyof Fields & string)[],
) =>
  Schema.Struct(fields).check(
    Schema.makeFilter<Schema.Struct.Type<Fields>>(
      (value) =>
        keys.some((key) => (value as Record<string, unknown>)[key] !== undefined) ||
        'at least one field must be present',
    ),
  )

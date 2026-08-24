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
/**
 * Text on its way to a browser, in the only two shapes the boundary allows:
 * a message the reader's own catalog translates, or business data that must
 * not be translated at all. Shared, because a second copy of these two
 * shapes is a second thing to keep in step with the i18n contract.
 */
export const uiText = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('message'),
    id: Schema.String,
    defaultMessage: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal('literal'), value: Schema.String }),
])

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
 * A page that also carries how many rows match the filter.
 *
 * Keyset paging needs no total to work, so this is not the default: the count
 * is a second query, and most lists are read forwards until they end. A list a
 * person navigates by page number is the case that has to know, and it pays
 * for the count knowingly.
 */
export const countedPageOf = <T, E>(item: Schema.Codec<T, E, never, never>) =>
  Schema.Struct({
    items: Schema.Array(item),
    nextCursor: Schema.NullOr(Schema.String),
    total: Schema.Number,
  })

/**
 * A cursor that cannot be read here.
 *
 * The tag is the code oRPC already puts on the wire for this, deliberately:
 * while both runtimes serve, a client must see the same failure whichever one
 * answered, and precision here would buy nothing a client could act on.
 */
export class BadRequest extends Schema.TaggedError<BadRequest>()(
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
 * A machine key derived from whatever somebody typed.
 *
 * Codes are stable identifiers that outlive renames, which is why they exist
 * at all - and exactly why nobody should have to invent one while naming
 * something. A latin name becomes its own slug; a name with no latin letters
 * in it (which is most of them here) falls back to the prefix and a random
 * tail, because a key nobody reads may as well be one nobody can collide on.
 */
export const codeFrom = (name: string, prefix: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  // globalThis.crypto, not node:crypto - this module travels to the browser
  // through every plugin's api.ts, and a node import there breaks the build
  return slug === '' ? `${prefix}-${crypto.randomUUID().slice(0, 8)}` : slug
}

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
export const expectedVersion = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))

/**
 * Refuses a patch that names no field at all.
 *
 * This is as far as a schema can see: whether a stated value differs from the
 * stored one is a question only the write path can answer, holding the locked
 * row. It answers it - an update whose every stated field already matches
 * returns the current version untouched - because these bodies carry an
 * optimistic-concurrency version and the statements behind them bump it
 * unconditionally, so a re-saved unchanged form would commit a new version and
 * refuse a concurrent administrator's genuine edit against the old one.
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

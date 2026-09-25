import { Schema } from 'effect'
import { UiTextSchema } from '@qualy/i18n-contract'
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
export const uiText = UiTextSchema

/**
 * How long a page cursor may be on the way back in.
 *
 * It has to be at least as long as `encodeQueryCursor` can mint, or a page
 * hands back a cursor its own contract then refuses and paging stops dead.
 * The widest key in the product is a display name, 100 characters - which in
 * Chinese is 300 bytes, and base64url of the enclosing json came to 540. The
 * old ceiling was 512, so a list sorted by a full-width name paged exactly
 * once. What bounds the work is not this number but the decoder, which
 * refuses anything not minted for the query being asked.
 */
export const MAX_CURSOR_LENGTH = 2048

export const pageQuery = {
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_CURSOR_LENGTH))),
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
 * A page asked for by its number, for a list a person walks around in.
 *
 * Keyset paging reads forwards and is what a feed wants. A roster somebody
 * administers is not a feed: they go to the last page, back to the third,
 * and want to be told there are forty. That needs an offset and a count, and
 * both are paid for knowingly - these lists are bounded by an organization's
 * size, not by time, and the sort key is total so a page cannot shuffle
 * under the reader between two requests for it.
 */
export const numberedPageQuery = {
  page: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String),
}

export const numberedPageOf = <T, E>(item: Schema.Codec<T, E, never, never>) =>
  Schema.Struct({
    items: Schema.Array(item),
    /** how many rows match the filter, across every page */
    total: Schema.Number,
    /** the page this is, counted from one; clamped to the last when asked past it */
    page: Schema.Number,
    pageSize: Schema.Number,
  })

/** a page number off the wire: anything unusable is the first page, not a refusal */
export const pageNumber = (page: string | undefined): number => {
  const parsed = Number(page)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

/**
 * Where a numbered page starts, clamped so a page past the end is the last
 * one rather than an empty screen - which is what a reader who deleted the
 * only row of page nine should land on.
 */
export const pageWindow = (page: number, size: number, total: number) => {
  const last = Math.max(1, Math.ceil(total / size))
  const at = Math.min(page, last)
  return { page: at, offset: (at - 1) * size }
}

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
 * An unsafe request that did not come from this application's own pages.
 *
 * Raised by the origin guard in front of the router, never by a handler;
 * declared here because every endpoint can answer with it and the browser
 * translates it once, centrally.
 */
export class RequestOriginRefused extends Schema.TaggedError<RequestOriginRefused>()(
  'REQUEST_ORIGIN_REFUSED',
  { message: Schema.String },
  { httpApiStatus: 403, identifier: 'RequestOriginRefused' },
) {}

/**
 * A request inside the api mount that names no route.
 *
 * Raised by the host's fallback, never by a handler: the router matched
 * nothing, and the answer is the same tagged shape every other refusal has,
 * so the browser reads it the way it reads the rest - by its tag - rather
 * than meeting an empty body or the html shell.
 */
export class ApiRouteNotFound extends Schema.TaggedError<ApiRouteNotFound>()(
  'API_ROUTE_NOT_FOUND',
  { message: Schema.String },
  { httpApiStatus: 404, identifier: 'ApiRouteNotFound' },
) {}

/**
 * A web page whose protocol generation this api no longer speaks.
 *
 * Raised by the host's compatibility check in front of the router. The
 * browser branches on the HEADER beside it, never on the body, so the body
 * is the tag alone: the generation the page sent and the window this server
 * serves are in the log, where the operator is, and telling every caller
 * the window was a disclosure that bought nothing the page does.
 */
export class ClientProtocolUnsupported extends Schema.TaggedError<ClientProtocolUnsupported>()(
  'QUALY_CLIENT_PROTOCOL_UNSUPPORTED',
  {},
  { httpApiStatus: 409, identifier: 'ClientProtocolUnsupported' },
) {}

/**
 * The page was built from a different set of plugins than this process runs.
 *
 * Possible at all because a build carries only the active assembly: the
 * page has screens whose api is not here, or will ask a manifest for
 * surfaces its own bundle does not contain. Which assemblies, and how they
 * differ, stays on the server - the page reloads either way.
 */
export class ClientAssemblyUnsupported extends Schema.TaggedError<ClientAssemblyUnsupported>()(
  'QUALY_CLIENT_ASSEMBLY_UNSUPPORTED',
  {},
  { httpApiStatus: 409, identifier: 'ClientAssemblyUnsupported' },
) {}

/**
 * The page names a release this host cannot identify.
 *
 * Normally a tab left open past the store's retention, which is a fact about
 * retention rather than about the tab; the page cannot be judged, so it is
 * not served.
 */
export class ClientReleaseUnsupported extends Schema.TaggedError<ClientReleaseUnsupported>()(
  'QUALY_CLIENT_RELEASE_UNSUPPORTED',
  {},
  { httpApiStatus: 409, identifier: 'ClientReleaseUnsupported' },
) {}

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
// The payload constants every api declares. They live here
// rather than per plugin because the failure they prevent is systemic: an
// input schema that accepts more than the contract did does not fail at the
// boundary, it fails at the database, where a check violation is not a
// translatable sqlstate and so becomes a 500 rather than a 400.

/**
 * An identifier a caller supplies, validated at the boundary.
 *
 * Checked before any work happens, so a malformed id is a 400 rather than a
 * query that finds nothing and answers 404 - two very different things to
 * whoever is reading the failure.
 *
 * Deliberately named for the direction it travels. A response is NOT built
 * from this: a row written before the check existed is still a legitimate
 * row, and a stricter encoder would make it unserializable - the api would
 * answer 500 for data it is perfectly able to read. Inputs get the narrow
 * schema; outputs stay `Schema.String`.
 */
export const uuidInput = Schema.String.check(Schema.isUUID())

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
 * A substring somebody typed, as a `like` pattern that means it literally.
 *
 * `%` and `_` are wildcards, so an unescaped search for `%` matched every
 * row and one for `_` matched any single character - a search box quietly
 * answering something other than what was typed. The backslash goes first
 * or it would escape the escapes.
 */
export const likeContains = (text: string): string =>
  `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`

/**
 * PostgreSQL stores no NUL byte in a text column, and refuses the row rather
 * than dropping it. Admitted here, the refusal arrives from the database as
 * a fault - a 500 for a request that a schema can see is malformed. It is
 * checked on the primitives rather than field by field, because every text
 * field in the product is built from one of them.
 */
const noNulByte = Schema.makeFilter((value: string) =>
  value.includes('\u0000') ? 'text may not carry a NUL byte' : undefined,
)

/**
 * A human-readable name, trimmed on the way in.
 *
 * `Schema.Trim` is a decode-time transform: the stored value is the trimmed one.
 * `Schema.isTrimmed` would instead REFUSE padded input, which the oRPC side
 * accepts and normalizes: that would be a new divergence in the other
 * direction, and would leave the two runtimes storing different rows for the
 * same request rather than agreeing.
 */
export const trimmedName = (max: number) =>
  Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(max), noNulByte)

/** free text with a ceiling, not trimmed: the contract does not trim it either */
export const boundedText = (max: number) => Schema.String.check(Schema.isMaxLength(max), noNulByte)

/** an integer inside the range the column can actually hold */
export const boundedInt = (min: number, max: number) =>
  Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(min),
    Schema.isLessThanOrEqualTo(max),
  )

/**
 * The largest value an int4 column holds, which is what every version and
 * revision column here is. Past it a lookup is not an empty answer but a
 * database error (22003), which is a 500 for a malformed request.
 */
export const INT4_MAX = 2_147_483_647

/** the version a set replacement was written against; never optional */
export const expectedVersion = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(INT4_MAX),
)

/**
 * A positive whole number written in the address - a version or a revision
 * number - that the int4 column it is looked up in can hold. It stays a
 * string: an address segment is one, and the handler reads the number off it.
 */
export const positiveIntParam = Schema.String.check(
  Schema.isPattern(/^[1-9]\d{0,9}$/),
  Schema.makeFilter((value: string) =>
    Number(value) <= INT4_MAX ? undefined : `must be at most ${String(INT4_MAX)}`,
  ),
)

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

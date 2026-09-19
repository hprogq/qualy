// What a download is willing to say the bytes are.
//
// The uploader picks the declared type, so repeating it back on the way out
// would let a stored file put `text/html` on an origin somebody trusts. The
// answer belongs here rather than to any one consumer: every delivery route
// this plugin offers - the streamed one and the signed url a backend mints -
// goes out through it, and a route that forgot would be a hole nobody could
// see from the outside.
//
// Refusing every type is not an option: `nosniff` holds a browser to exactly
// what is said here, and a certificate photograph has to keep drawing in an
// `<img>`. So a type is repeated only from this list and everything else is
// bytes. The list holds what a browser renders without running it - no svg,
// whose scripting is only disabled on the `<img>` path, and no xml or html at
// all. The disposition is a second, independent lock: a download is never a
// document, whatever this says.

const INERT: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'application/pdf',
])

export const BYTES = 'application/octet-stream'

export const servedTypeOf = (declared: string): string => {
  const said = declared.trim().toLowerCase()
  return INERT.has(said) ? said : BYTES
}

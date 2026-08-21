// What the door is willing to say a cited file is (§19).
//
// The uploader picks the type, so repeating it back would let a claim put
// `text/html` on the application's own origin. Refusing every type is not
// an option either: `nosniff` holds the browser to exactly what is said
// here, and a certificate photograph has to keep drawing in an `<img>`.
//
// So the door repeats a type only from this list, and calls everything
// else bytes. The list holds what a browser renders without running it -
// no svg, whose scripting is only disabled on the `<img>` path, and no
// xml or html at all. The disposition is a second, independent lock: a
// download is never a document, whatever this says.

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

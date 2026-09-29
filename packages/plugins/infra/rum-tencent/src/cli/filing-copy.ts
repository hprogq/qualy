// The copy of a map the reporting platform is given.
//
// A map's `sourcesContent` carries every source it maps to, dependencies
// included: in v0.1.0-rc.15 that was 18 of the maps' 32 MiB, and the largest
// map (the editor chunk, 9.7 MiB) was 7 MiB of monaco-editor's own source and
// not one byte of ours. Carried across an ocean to a bucket that drops a slow
// connection, that is what stalled the upload. So a dependency's content is
// left out: its entry becomes null, which the source map format allows, and
// a frame in it still resolves to the dependency's file, line and column,
// because `sources`, `names` and `mappings` are not touched. This product's
// own sources keep their content.
//
// The build's own maps are not changed; this is only what is filed. A map
// with nothing to leave out is filed as the very bytes the build wrote, so its
// hash, and any earlier version's upload of it, stays what it was.

const DEPENDENCY = /(^|\/)node_modules\//

interface SourceMap {
  readonly sources?: readonly (string | null)[]
  readonly sourcesContent?: readonly (string | null)[]
}

/** the map as the platform receives it: dependencies' source content left out */
export const filingCopyOf = (bytes: Buffer): Buffer => {
  const map = JSON.parse(bytes.toString('utf8')) as SourceMap & Record<string, unknown>
  const sources = map.sources ?? []
  const contents = map.sourcesContent
  if (contents === undefined) return bytes
  const kept = contents.map((content, index) =>
    content !== null && DEPENDENCY.test(sources[index] ?? '') ? null : content,
  )
  if (kept.every((content, index) => content === contents[index])) return bytes
  return Buffer.from(JSON.stringify({ ...map, sourcesContent: kept }), 'utf8')
}

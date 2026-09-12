// The eight segments of the Q, as the mark and the wordmark both draw them:
// one path each, in the same order, the tail first. `data-seg` is the
// stable handle - 0 is the tail, 1 to 7 go clockwise from the bottom round
// to the right - so that a style, a test or an animation can name a segment
// without counting siblings.

export function Segments({ paths }: { paths: readonly string[] }) {
  return (
    <>
      {paths.map((d, k) => (
        <path key={k} data-seg={k} d={d} />
      ))}
    </>
  )
}

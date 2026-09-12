import type * as React from 'react'

// The Q, drawn two ways from the same numbers.
//
// Whole: sectors 1 to 7 as one path and the tail as another, which is how
// the static mark and wordmark draw it - one fill has no seams. Segmented:
// eight paths, one per sector, the tail first, which is what the loader
// and the live wordmark need, because there every sector carries its own
// opacity; they only ever appear at sizes where the hairlines between
// neighbouring fills cannot be seen. `data-seg` is the stable handle - 0
// is the tail, 1 to 7 go clockwise from the bottom round to the right,
// "1-7" is the whole band - so a style, a test or an animation can name a
// part without counting siblings.

export function WholeQ({ band, tail }: { band: string; tail: string }) {
  return (
    <>
      <path data-seg="1-7" d={band} />
      <path data-seg="0" d={tail} />
    </>
  )
}

export function SegmentedQ({
  paths,
  propsFor,
}: {
  paths: readonly string[]
  /** what each segment wears besides its path, by index */
  propsFor?: (k: number) => React.SVGProps<SVGPathElement>
}) {
  return (
    <>
      {paths.map((d, k) => (
        <path key={k} data-seg={k} d={d} {...propsFor?.(k)} />
      ))}
    </>
  )
}

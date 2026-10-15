/**
 * Whether no ancestor of this element is still carried by a transform, such
 * as a section's entrance rise. A test that measures a layout before and
 * after something arrives takes its first reading once this holds, or a
 * slow machine reads the entrance itself as the layout moving.
 */
export const atRest = (node: Element) => {
  for (let at: Element | null = node; at !== null; at = at.parentElement) {
    const transform = getComputedStyle(at).transform
    if (transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)') return false
  }
  return true
}

// How wide a line of words is drawn, for a roster that sizes its columns to
// what a page of rows actually says.
//
// Every row of the roster is a grid of its own, so a track cannot size
// itself to the rows around it; the page measures its own words instead and
// hands every row the same template.

let pen: CanvasRenderingContext2D | null | undefined

/** how wide a line of words is drawn in the page's own face, at a size and weight */
export const widthOf = (words: string, size: number, weight: number): number => {
  if (pen === undefined) {
    try {
      pen = document.createElement('canvas').getContext('2d')
    } catch {
      pen = null
    }
  }
  // no canvas to measure with: a generous guess, a full em a character
  if (pen === null) return words.length * size
  pen.font = `${String(weight)} ${String(size)}px ${getComputedStyle(document.body).fontFamily}`
  return pen.measureText(words).width
}

/** the size a unit path is said at on a roster row, and the room between its steps */
const PATH_SIZE = 12.5
const PATH_GAP = 4

/** how wide a unit path is on one line, every step said, the slashes between them */
export const pathWidthOf = (steps: readonly string[]): number => {
  if (steps.length === 0) return 0
  const slash = widthOf('/', PATH_SIZE, 400)
  return (
    steps.reduce((sum, step) => sum + widthOf(step, PATH_SIZE, 400), 0) +
    (steps.length - 1) * (slash + 2 * PATH_GAP)
  )
}

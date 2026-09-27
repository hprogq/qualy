import type { InboxItemDto } from './model.ts'

// How the queue is laid out in the room it is given.
//
// Read off the queue's own width, never the window's: beside the shell's
// rail a laptop's window is a quarter narrower than the page, and the
// window's answer put a list and a table side by side in room for one of
// them - the answers squeezed to nothing, a column head one character a
// line.

/**
 * As many filings as are shown whole, every answer under its own label,
 * rather than as rows of a table: a table of one or two rows is a strip
 * across an empty page, and the few that are waiting are all there is to
 * read. Counted for whatever is open - one question, one person - and for
 * the whole queue where it is that small.
 */
export const SPREAD_MOST = 3

/** below this, the list and the picked one's filings do not fit side by side */
export const BESIDE_MIN = 880

/**
 * Below this, the list and the picked one's filings are one screen after the
 * other. Between it and BESIDE_MIN they are one above the other: the list
 * drawn as a strip of keys over the filings of the one picked, so a desk
 * narrowed by the rail opens on work rather than on a list to step into.
 */
export const STACK_MIN = 640

/** the column the list takes beside the filings: a quarter of the room, within bounds */
export const masterWidthOf = (room: number): number =>
  Math.round(Math.min(288, Math.max(224, room * 0.24)))

/** the gap between the list and the filings */
export const SPLIT_GAP = 16

/** how wide the filings are, given the queue's room and whether the list stands beside them */
export const paneWidthOf = (room: number, beside: boolean): number =>
  beside ? room - masterWidthOf(room) - SPLIT_GAP : room

// what a table row spends before its answers get anything: the padding at
// its edges and the gaps between its tracks are the table's own (surface.tsx)
const ROW_PADDING = 32
const TRACK_GAP = 16
const WAY_IN = 20
/** who filed it, at its narrowest: eight characters of name, the number under it */
export const WHO_MIN = 112
/** who filed it, at its widest: past this a name gives way to the answers */
const WHO_MOST = 176
/** when it arrived: "9月20日 10:17", "Sep 20, 10:17"; where a round stands under it */
export const WHEN_WIDTH = 112
/**
 * Room to spare before the answers are given a column each: at the bare
 * floor of every column each answer shows its first few characters and the
 * name its first eight, which reads worse than the answers sharing a line.
 */
const SPARE = 64

// One character at a size, a little generous: a han character is a square
// of the font's size, latin letters and digits about half of one. Estimated
// rather than measured, because the columns have to be decided before
// anything is drawn in them.
const CELL_SIZE = 12.5
const NAME_SIZE = 13.5
const NUMBER_SIZE = 12
/** a name and its number on one line, at their widest */
const WHO_LINE_MOST = 280
const isWide = (character: string) => (character.codePointAt(0) ?? 0) >= 0x2e80

/** about how wide a piece of text is drawn at a font size */
const widthOfText = (text: string, size = CELL_SIZE): number =>
  [...text].reduce((sum, character) => sum + (isWide(character) ? size * 1.04 : size * 0.6), 0)

/** "1 个文件", "12 files": what a field of files says in a cell */
const FILES_WIDTH = 56

/** about how wide the longest answer to one of a question's fields is drawn */
export const answerWidthOf = (index: number, rows: readonly InboxItemDto[]): number =>
  Math.ceil(
    Math.max(
      0,
      ...rows.map((row) => {
        const pair = row.values[index]
        return pair === undefined ? 0 : pair.files !== null ? FILES_WIDTH : widthOfText(pair.value)
      }),
    ),
  )

/**
 * The least an answer column is given: its longest answer, up to about
 * twelve characters of it. Past that an answer is cut rather than every
 * other column made to give way to it.
 */
export const answerFloorOf = (index: number, rows: readonly InboxItemDto[]): number =>
  Math.round(
    Math.min(12 * CELL_SIZE * 1.04, Math.max(4 * CELL_SIZE * 0.6, answerWidthOf(index, rows))),
  )

/**
 * How wide the column of who filed it has to be for the longest name in
 * it: no wider, so the room goes to the answers, and no narrower than eight
 * characters. The number beside a name moves under it before the name gives
 * way.
 */
export const whoWidthOf = (rows: readonly InboxItemDto[]): number =>
  Math.round(
    Math.min(
      WHO_MOST,
      Math.max(WHO_MIN, ...rows.map((row) => widthOfText(row.participantName, NAME_SIZE) + 4)),
    ),
  )

/** a name with its number beside it rather than under it, where there is room to spare */
const whoLineOf = (rows: readonly InboxItemDto[]): number =>
  Math.round(
    Math.min(
      WHO_LINE_MOST,
      Math.max(
        WHO_MIN,
        ...rows.map(
          (row) =>
            widthOfText(row.participantName, NAME_SIZE) +
            (row.businessNo === null ? 0 : 8 + widthOfText(row.businessNo, NUMBER_SIZE)) +
            4,
        ),
      ),
    ),
  )

/** what a table of a question's filings spends on everything but who and the answers */
const fixedWidthOf = (answers: number): number =>
  ROW_PADDING + TRACK_GAP * (answers + 2) + WHEN_WIDTH + WAY_IN

/**
 * Whether a question's answers can each have a column of their own in the
 * room the filings have: every answer at its floor, beside who filed it and
 * when. Where they cannot, the answers share one column, a line or two of
 * what was filed, rather than every column being cut to its first word.
 */
export const answersFitIn = (
  paneWidth: number,
  count: number,
  rows: readonly InboxItemDto[],
): boolean => {
  const floors = Array.from({ length: count }, (_, index) => answerFloorOf(index, rows)).reduce(
    (sum, floor) => sum + floor,
    0,
  )
  return paneWidth >= fixedWidthOf(count) + WHO_MIN + floors + SPARE
}

/**
 * The widths the columns of who filed it and of each answer are given.
 *
 * Every column starts at its floor, and the room left over is poured in
 * evenly: a column stops taking once it holds its longest entry, so a
 * grade and a date are whole long before a competition's name, and the
 * name takes what they leave. Room past what every column needs puts a
 * number beside its name rather than under it, and the rest goes to the
 * answers, by how long they run. Given as weights for the grid, so a row a
 * few pixels wider or narrower than reckoned keeps the proportions.
 */
export const tableColumnsOf = (
  paneWidth: number,
  count: number,
  rows: readonly InboxItemDto[],
): { readonly floors: readonly number[]; readonly widths: readonly number[] } => {
  const floors = [
    WHO_MIN,
    ...Array.from({ length: count }, (_, index) => answerFloorOf(index, rows)),
  ]
  const needs = [
    whoWidthOf(rows),
    ...Array.from({ length: count }, (_, index) =>
      Math.max(answerFloorOf(index, rows), answerWidthOf(index, rows) + 2),
    ),
  ]
  const widths = [...floors]
  let spare = paneWidth - fixedWidthOf(count) - floors.reduce((sum, width) => sum + width, 0)
  while (spare > 0.5) {
    const open = widths.flatMap((width, index) => (width < needs[index]! ? [index] : []))
    if (open.length === 0) break
    const step = Math.min(
      spare / open.length,
      ...open.map((index) => needs[index]! - widths[index]!),
    )
    for (const index of open) widths[index] = widths[index]! + step
    spare -= step * open.length
  }
  // then the number beside its name, rather than under it
  if (spare > 0.5) {
    const grow = Math.min(spare, Math.max(0, whoLineOf(rows) - widths[0]!))
    widths[0] = widths[0]! + grow
    spare -= grow
  }
  if (spare > 0.5 && count > 0) {
    const answers = needs.slice(1)
    const total = answers.reduce((sum, need) => sum + need, 0)
    answers.forEach((need, index) => {
      widths[index + 1] =
        widths[index + 1]! + (total === 0 ? spare / count : (spare * need) / total)
    })
  }
  return { floors, widths }
}

// a filing laid out whole: its inset either side, and the gap between two
// of its answers (QueueViews' spread rows)
const SPREAD_INSET = 16
const ANSWER_GAP = 24
const LABEL_SIZE = 11.5
const VALUE_SIZE = 13.5

/** one answer of a filing laid out whole, as far as its width goes */
interface SpreadAnswer {
  readonly label: string
  readonly value: string
  readonly files: number | null
}

/**
 * The columns a filing laid out whole gives its answers, where every one of
 * them fits on one line: each as wide as its label or its longest answer,
 * whichever is wider, and the room left over shared by the same measure.
 * Filings of one question are measured together, so their answers line up
 * under each other. Null where they do not fit, and the answers wrap to as
 * many lines as they need instead.
 */
export const spreadColumnsOf = (
  filings: readonly (readonly SpreadAnswer[])[],
  room: number,
): string | null => {
  const count = Math.max(0, ...filings.map((answers) => answers.length))
  if (count === 0) return null
  const needs = Array.from({ length: count }, (_, index) =>
    Math.ceil(
      Math.max(
        0,
        ...filings.map((answers) => {
          const answer = answers[index]
          if (answer === undefined) return 0
          const value =
            answer.files !== null
              ? FILES_WIDTH * (VALUE_SIZE / CELL_SIZE)
              : widthOfText(answer.value, VALUE_SIZE)
          return Math.max(widthOfText(answer.label, LABEL_SIZE), value) + 2
        }),
      ),
    ),
  )
  const total = needs.reduce((sum, need) => sum + need, 0) + ANSWER_GAP * (count - 1)
  if (total > room - 2 * SPREAD_INSET) return null
  return needs.map((need) => `minmax(${String(need)}px, ${String(need)}fr)`).join(' ')
}

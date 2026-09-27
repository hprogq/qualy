import type { InboxItemDto } from './model.ts'

// How the queue is laid out in the room it is given.
//
// Read off the queue's own width, never the window's: beside the shell's
// rail a laptop's window is a quarter narrower than the page, and the
// window's answer put a list and a table side by side in room for one of
// them - the answers squeezed to nothing, a column head one character a
// line.

/**
 * As many filings as the queue shows whole, every answer under its own
 * label, rather than as rows of a table: a table of one or two rows is a
 * strip across an empty page, and the few that are waiting are all there is
 * to read.
 */
export const SPREAD_MOST = 3

/** below this, the list and the picked one's filings are one screen after the other */
export const BESIDE_MIN = 880

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
/** when it arrived: "9月20日 10:17", "Sep 20, 10:17"; where a round stands under it */
export const WHEN_WIDTH = 112
/**
 * Room to spare before the answers are given a column each: at the bare
 * floor of every column each answer shows its first few characters and the
 * name its first eight, which reads worse than the answers sharing a line.
 */
const SPARE = 64

// One character of an answer at the table's size, a little generous: a
// han character is a square of the font's size, latin letters and digits
// about half of one. Estimated rather than measured, because the columns
// have to be decided before anything is drawn in them.
const WIDE = 13
const NARROW = 7.5
const isWide = (character: string) => (character.codePointAt(0) ?? 0) >= 0x2e80

/** about how wide a piece of text is drawn in a cell */
const widthOfText = (text: string): number =>
  [...text].reduce((sum, character) => sum + (isWide(character) ? WIDE : NARROW), 0)

/** "1 个文件", "12 files": what a field of files says in a cell */
const FILES_WIDTH = 56

/** about how wide the longest answer to one of a question's fields is drawn */
export const answerWidthOf = (index: number, rows: readonly InboxItemDto[]): number =>
  Math.max(
    0,
    ...rows.map((row) => {
      const pair = row.values[index]
      return pair === undefined ? 0 : pair.files !== null ? FILES_WIDTH : widthOfText(pair.value)
    }),
  )

/**
 * The least an answer column is given: its longest answer, up to about
 * twelve characters of it. Past that an answer is cut rather than every
 * other column made to give way to it.
 */
export const answerFloorOf = (index: number, rows: readonly InboxItemDto[]): number =>
  Math.round(Math.min(12 * WIDE, Math.max(4 * NARROW, answerWidthOf(index, rows))))

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
  // who, every answer, when, and the way in
  const tracks = count + 3
  const floors = Array.from({ length: count }, (_, index) => answerFloorOf(index, rows)).reduce(
    (sum, floor) => sum + floor,
    0,
  )
  const needed =
    ROW_PADDING + TRACK_GAP * (tracks - 1) + WHO_MIN + WHEN_WIDTH + WAY_IN + floors + SPARE
  return paneWidth >= needed
}

import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The columns of the examples table, shared by its header and its rows so
// the two can never disagree about where a column starts. A phone does not
// use them at all: there an example is a card, not a line.

export const exampleStyles = stylex.create({
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr) 5rem 5rem 6rem 5.5rem',
    columnGap: 16,
    alignItems: 'center',
    paddingInline: 16,
  },
  head: {
    height: 30,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.mutedForeground,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  // every cell centres against the row: the input column may be one line or
  // three, and the name beside it should sit level with it either way
  row: { alignItems: 'center', paddingBlock: 8 },
  end: { textAlign: 'right' },
})

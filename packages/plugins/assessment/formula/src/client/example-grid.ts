import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

// The columns of the examples table, shared by its header and its rows so
// the two can never disagree about where a column starts.

export const exampleStyles = stylex.create({
  columns: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1.1fr) minmax(0, 1.3fr) 4.5rem 4.5rem 5.5rem 1.75rem',
      [breakpoints.phone]: 'minmax(0, 1fr) 4.5rem 1.75rem',
    },
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
  wide: { display: { default: null, [breakpoints.phone]: 'none' } },
  end: { textAlign: 'right' },
})

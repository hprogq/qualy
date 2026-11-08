import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

export const recordTable = stylex.create({
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    // Draw the hairline inside the table so drill clipping cannot cut it off.
    outlineWidth: 1,
    outlineOffset: -1,
    outlineStyle: 'solid',
    outlineColor: tokens.border,
    backgroundColor: tokens.surface,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.04)',
    containerType: 'inline-size',
  },
})

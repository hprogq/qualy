import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

/** the fill a bar is drawn in: full in the colour of what counts, the rest quiet */
export const meterStyles = stylex.create({
  fill: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 58%, ${tokens.background})` },
  full: { backgroundColor: tokens.success },
})

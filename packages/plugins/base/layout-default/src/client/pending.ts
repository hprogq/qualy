import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// A press heard before the page it asked for has arrived.
//
// The entry that is open stays lit until the page changes: lighting the
// pressed one as well said two pages were open at once. The pressed one
// instead shows a light passing across it, for as long as the page's code
// is on its way, and becomes the lit one when the page does.

const REDUCE = '@media (prefers-reduced-motion: reduce)'

/** a band of light crossing from one edge to the other */
const sweep = stylex.keyframes({
  from: { backgroundPosition: '150% 0' },
  to: { backgroundPosition: '-50% 0' },
})

export const pending = stylex.create({
  // a chip on its way: its own ground, the light crossing it, the word in ink
  chip: {
    color: tokens.foreground,
    backgroundColor: {
      default: tokens.surfaceMuted,
      [REDUCE]: `color-mix(in oklch, ${tokens.surfaceMuted} 80%, ${tokens.foreground})`,
    },
    backgroundImage: {
      default: `linear-gradient(100deg, transparent 25%, color-mix(in oklch, ${tokens.foreground} 16%, transparent) 50%, transparent 75%)`,
      [REDUCE]: 'none',
    },
    backgroundSize: '220% 100%',
    backgroundRepeat: 'no-repeat',
    animationName: { default: sweep, [REDUCE]: 'none' },
    animationDuration: '1.1s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
})

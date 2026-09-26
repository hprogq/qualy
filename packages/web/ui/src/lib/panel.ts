import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'

// One material for every panel that opens from a trigger - a select's list,
// a menu, a popover, a calendar - so they read as one family.
//
// The widget library draws each of them on its own ground: a neutral grey a
// step lighter than the product's warm dark surfaces, a bluish hairline in
// the light scheme, no shadow and a smaller radius than a card. Each adapter
// states that ground away with this material instead. A row inside such a
// panel answers the pointer and the keyboard with the hover-surface token.

export const panel = stylex.create({
  // the raised surface, a hairline edge, a soft shadow that says it stands
  // over the page, and the card radius
  material: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklch, ${tokens.foreground} 8%, transparent)`,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceElevated,
    boxShadow: `0 2px 6px -2px oklch(0 0 0 / 0.06), 0 18px 36px -14px oklch(0 0 0 / 0.22), inset 0 1px 0 color-mix(in oklch, ${tokens.surface} 35%, transparent)`,
    color: tokens.foreground,
  },
})

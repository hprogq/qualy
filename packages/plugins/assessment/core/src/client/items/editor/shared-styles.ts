import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The few styles more than one panel of the editor reaches for. Kept out of
// the component modules so those export components and nothing else, which
// is what lets the editor hot-reload without losing the draft on screen.

export const rowWords = stylex.create({
  quiet: { fontSize: 13, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  plain: { fontSize: 13 },
  pair: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minWidth: 0 },
  icon14: { width: 14, height: 14 },
  icon12: { width: 12, height: 12 },
})

export const sheetStyles = stylex.create({
  footerSpacer: { flexGrow: 1 },
})

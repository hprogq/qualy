import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

export const batchProgressControl = stylex.defineMarker()

export const countdownColors = stylex.create({
  calm: { color: tokens.mutedForeground },
  soon: { color: tokens.warningForeground },
  urgent: { color: tokens.danger },
})

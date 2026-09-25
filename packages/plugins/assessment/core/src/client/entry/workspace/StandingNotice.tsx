import * as stylex from '@stylexjs/stylex'
import { isApiErrorCode, useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'

// The score's absence over the entries workspace, said once above everything.
//
// The workspace draws every figure as unknown while the score cannot be
// read; this is the line that says so, and offers to ask again. Asking again
// is only offered where it can help: an account too large to evaluate stays
// too large however often it is asked.

const styles = stylex.create({
  notice: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 10%, ${tokens.background})`,
    paddingInline: 16,
    paddingBlock: 8,
  },
  words: { flexGrow: 1, fontSize: 13, color: tokens.surfaceMutedForeground },
})

export function StandingNotice({
  error,
  stale,
  retrying,
  onRetry,
}: {
  /** why the last read of the score failed */
  error: unknown
  /** a score read earlier is still shown, and may be behind */
  stale: boolean
  retrying: boolean
  onRetry: () => void
}) {
  const { format } = useI18n()
  const tooLarge = isApiErrorCode(error, 'ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE')
  return (
    <div
      role="status"
      data-testid="standing-unavailable"
      data-standing={stale ? 'stale' : 'unavailable'}
      data-reason={tooLarge ? 'too-large' : 'unavailable'}
      {...stylex.props(styles.notice)}
    >
      <span {...stylex.props(styles.words)}>
        {format(
          stale ? m.resultStaleTitle : tooLarge ? m.resultTooLargeTitle : m.resultUnavailableTitle,
        )}
      </span>
      {!tooLarge && (
        <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
          {format(m.resultRecalculate)}
        </Button>
      )}
    </div>
  )
}

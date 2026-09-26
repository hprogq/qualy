import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'

// Small marks the workspace sets beside a row's name.
//
// The dot at the head of a question's row says where it stands, and nothing
// else: news the reader has not looked at is a word of its own after the
// name, so opening the question takes the news away and leaves the standing
// exactly as it was.

const styles = stylex.create({
  news: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 16,
    borderRadius: 4,
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 12%, transparent)`,
    paddingInline: 5,
    fontSize: 10.5,
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: tokens.danger,
  },
})

/** the one mark of news the reader has not looked at; the name carries the rest */
export function UnreadMark() {
  const { format } = useI18n()
  return (
    <span data-testid="unread-mark" {...stylex.props(styles.news)}>
      <span aria-hidden>{format(m.rowUnreadMark)}</span>
      <VisuallyHidden>{format(m.rowUnread)}</VisuallyHidden>
    </span>
  )
}

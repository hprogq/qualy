import { useLocale } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import { inZone, useBatchZone } from '../batch/zone.ts'
import { type DraftKeeper } from './use-draft.ts'
import * as m from '#messages'

// Said where a panel opened with words already in it: whose they are, when
// they were written, and the way to be rid of them. Without this line the
// reviewer meets a half-written refusal with no account of where it came
// from - which reads as the system having written it.

const styles = stylex.create({
  bar: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    borderRadius: tokens.radiusLg,
    paddingInline: 12,
    paddingBlock: 8,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  words: { minWidth: 0, flexGrow: 1 },
  again: {
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12.5,
    color: tokens.foreground,
    cursor: 'pointer',
    textDecorationLine: 'underline',
    textUnderlineOffset: 2,
  },
})

export function DraftNote({ draft, onDiscard }: { draft: DraftKeeper; onDiscard: () => void }) {
  const locale = useLocale()
  const zone = useBatchZone()
  if (!draft.restored) return null
  const when =
    draft.at === null
      ? ''
      : new Intl.DateTimeFormat(locale, {
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          ...inZone(zone),
        }).format(new Date(draft.at))
  return (
    <div {...stylex.props(styles.bar)} data-testid="draft-note">
      <span {...stylex.props(styles.words)}>{m.review_draftRestored({ when })}</span>
      <button
        type="button"
        data-testid="draft-discard"
        {...stylex.props(styles.again)}
        onClick={() => {
          draft.discard()
          onDiscard()
        }}
      >
        {m.review_draftDiscard()}
      </button>
    </div>
  )
}

import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { RecognitionValues } from '../entry/RecognitionValues.tsx'
import { sourceLabelOf } from '../entry/source.ts'
import { useEntryHistory, timeLabel } from './model.ts'
import { useBatchZone } from '../batch/zone.ts'
import { useLocale } from '@qualy/web-i18n'
import * as m from '#messages'

const styles = stylex.create({
  history: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 12,
  },
  title: { fontSize: 13, fontWeight: 500, color: tokens.mutedForeground },
  entry: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
  },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
})

export function ReviewRecognitions({
  entryId,
  currentRound,
}: {
  entryId: string
  currentRound: string
}) {
  const history = useEntryHistory(entryId, true)
  const locale = useLocale()
  const zone = useBatchZone()
  const previous = (history.data?.recognitions ?? []).filter(
    (one) => one.reviewInstanceId !== currentRound,
  )
  if (previous.length === 0) return null
  return (
    <section {...stylex.props(styles.history)} data-testid="prior-recognitions">
      <h4 {...stylex.props(styles.title)}>{m.recognition_prior()}</h4>
      {previous.toReversed().map((one) => (
        <div key={one.id} {...stylex.props(styles.entry)}>
          <div {...stylex.props(styles.head)}>
            <span>
              {sourceLabelOf(one.source)()}
              {one.actorName === null ? '' : `（${one.actorName}）`}
            </span>
            <span>{timeLabel(one.createdAt, locale, zone)}</span>
          </div>
          <RecognitionValues snapshot={one} />
        </div>
      ))}
    </section>
  )
}

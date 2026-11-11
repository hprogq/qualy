import * as stylex from '@stylexjs/stylex'
import { useLocale } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { recognitionRows, type RecognitionSnapshot } from './recognition-values.ts'

const styles = stylex.create({
  row: { display: 'contents' },
  fields: {
    display: 'grid',
    gridTemplateColumns: 'fit-content(10rem) minmax(0, 1fr)',
    gap: 8,
    margin: 0,
    fontSize: 13,
  },
  label: { color: tokens.mutedForeground, overflowWrap: 'anywhere' },
  value: { margin: 0, overflowWrap: 'anywhere' },
})

export function RecognitionValues({ snapshot }: { snapshot: RecognitionSnapshot }) {
  const locale = useLocale()
  return (
    <dl {...stylex.props(styles.fields)} data-testid="recognition-values">
      {recognitionRows(snapshot, locale).map((row) => (
        <div key={row.id} {...stylex.props(styles.row)}>
          <dt {...stylex.props(styles.label)}>{row.label}</dt>
          <dd {...stylex.props(styles.value)}>{row.text}</dd>
        </div>
      ))}
    </dl>
  )
}

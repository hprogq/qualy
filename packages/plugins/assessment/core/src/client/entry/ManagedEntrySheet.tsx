import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { EntryDetail } from './EntryDetail.tsx'
import { ReasonDialog } from '../items/ReasonDialog.tsx'
import { sourceLabelOf } from './source.ts'
import type { EntryDto, ItemDto } from './model.ts'

// The staff drawer: somebody else's claim, read in full, with the two acts
// that correct it.
//
// The reading surface is `EntryDetail`, shared with the owner's own drawer -
// one claim has one description. What differs is the footer, and it differs
// because the acts do: the owner hands a claim on, takes it back or gives it
// up, none of which is anybody else's to do. Staff either send it back for
// the participant to fix, or take an administrative determination off it.
//
// Neither act deletes anything. Returning leaves the filing where it is and
// asks for a new version; withdrawing stops the claim counting and keeps the
// determination and its whole history, because "recognised as provincial,
// then withdrawn" is two facts in order and not a value somebody overwrote.
//
// Re-opening a settled review is deliberately NOT here. The model has a
// place for it - a new round with `reopen` as its origin - and a button that
// pretended to be it by moving the claim's status backwards would be the
// wrong fact recorded permanently.

const styles = stylex.create({
  spacer: { flexGrow: 1 },
  ghostInk: { color: tokens.mutedForeground },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 16,
    paddingBlock: 14,
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: 600 },
  cardWhen: { fontSize: 12, color: tokens.mutedForeground },
  values: { display: 'flex', flexDirection: 'column', gap: 6 },
  valueRow: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 },
  valueKey: { color: tokens.mutedForeground },
  valueOne: { minWidth: 0, overflowWrap: 'anywhere' },
  quiet: { fontSize: 13, color: tokens.mutedForeground },
  stale: { fontSize: 12, color: tokens.warning },
})

/** what a determination carries, as the staff read model answers it */
export interface RecognitionDto {
  readonly id: string
  readonly source: 'review' | 'record' | 'import' | 'system'
  readonly entryRevisionId: string
  readonly values: unknown
  readonly createdAt: number
  readonly createdByName: string | null
}

export function ManagedEntrySheet({
  open,
  entry,
  item,
  recognition,
  trail,
  busy,
  onClose,
  onIntervene,
}: {
  open: boolean
  entry: EntryDto
  item: ItemDto
  /** what it currently stands recognised as, if anything has been determined */
  recognition: RecognitionDto | null
  /** the groups above the question, outermost first */
  trail: readonly string[]
  busy: boolean
  onClose: () => void
  /** both acts take a reason, and the api refuses an empty one */
  onIntervene: (kind: 'return-for-revision' | 'void', reason: string) => void
}) {
  const { format } = useI18n()
  const [asking, setAsking] = useState<'return-for-revision' | 'void' | null>(null)
  // Which correction fits is a fact about where the claim came from. A
  // participant's own filing is theirs to change, so it goes back to them; an
  // administrative record has no author to return it to, so the fix is to
  // withdraw it. Offering both on everything would be offering one wrong
  // answer every time.
  const administrative = entry.source === 'record' || entry.source === 'import'
  const settled = entry.status !== 'voided'

  return (
    <>
      <EntryDetail
        open={open}
        entry={entry}
        item={item}
        trail={trail}
        onClose={onClose}
        aside={<Determination recognition={recognition} entry={entry} />}
        footer={
          <>
            <span {...stylex.props(styles.spacer)} />
            {settled && administrative && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                className={stylex.props(styles.ghostInk).className}
                onClick={() => setAsking('void')}
              >
                {format(m.staffVoidEntry)}
              </Button>
            )}
            {settled && !administrative && entry.status !== 'draft' && (
              <Button size="sm" disabled={busy} onClick={() => setAsking('return-for-revision')}>
                {format(m.staffReturnEntry)}
              </Button>
            )}
          </>
        }
      />

      {/* the reason is required by the contract, not decorated here: both
          acts are things somebody will have to account for later */}
      <ReasonDialog
        open={asking !== null}
        title={format(asking === 'void' ? m.staffVoidTitle : m.staffReturnTitle)}
        description={format(asking === 'void' ? m.staffVoidHint : m.staffReturnHint)}
        confirmLabel={format(asking === 'void' ? m.staffVoidEntry : m.staffReturnEntry)}
        busy={busy}
        onConfirm={(reason) => {
          const act = asking
          setAsking(null)
          if (act !== null) onIntervene(act, reason)
        }}
        onClose={() => setAsking(null)}
      />
    </>
  )
}

/**
 * What this claim currently stands recognised as.
 *
 * First in the drawer, above the claim's own fields, because it is what the
 * reader came to check: the filing says what was claimed, and this says what
 * the round decided about it. The values are printed as the rule named them,
 * with no amount beside them - what a determination is worth is the ledger's
 * to say, and a second number here would be a second answer.
 */
function Determination({
  recognition,
  entry,
}: {
  recognition: RecognitionDto | null
  entry: EntryDto
}) {
  const { format } = useI18n()
  if (recognition === null) {
    return (
      <div {...stylex.props(styles.card)} data-testid="entry-recognition" data-state="none">
        <p {...stylex.props(styles.cardTitle)}>{format(m.recognitionTitle)}</p>
        <p {...stylex.props(styles.quiet)}>{format(m.recognitionNone)}</p>
      </div>
    )
  }
  const values = (recognition.values ?? {}) as Record<string, unknown>
  const shown = Object.entries(values).filter(([, value]) => value !== null && value !== undefined)
  // a determination judges one version of a filing; if the participant has
  // revised since, the reader is looking at a decision about older material
  const stale =
    entry.currentRevision !== null && entry.currentRevision.id !== recognition.entryRevisionId
  return (
    <div
      {...stylex.props(styles.card)}
      data-testid="entry-recognition"
      data-source={recognition.source}
    >
      <div {...stylex.props(styles.cardHead)}>
        <p {...stylex.props(styles.cardTitle)}>{format(m.recognitionTitle)}</p>
        <Badge variant="outline">{format(sourceLabelOf(recognition.source))}</Badge>
        <span {...stylex.props(styles.spacer)} />
        <span {...stylex.props(styles.cardWhen)}>
          {format(m.recognitionBy, {
            who: recognition.createdByName ?? format(m.eventSomebody),
            when: new Date(recognition.createdAt).toLocaleString(),
          })}
        </span>
      </div>
      {shown.length > 0 && (
        <div {...stylex.props(styles.values)}>
          {shown.map(([key, value]) => (
            <p key={key} {...stylex.props(styles.valueRow)}>
              <span {...stylex.props(styles.valueKey)}>{key}</span>
              <span {...stylex.props(styles.valueOne)}>{String(value)}</span>
            </p>
          ))}
        </div>
      )}
      {stale && <p {...stylex.props(styles.stale)}>{format(m.recognitionStale)}</p>}
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { choiceLabel, displayTitle, kindOf, type AtomicSchema } from '@qualy/value-schema'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
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
  values: { display: 'flex', flexDirection: 'column', gap: 6, margin: 0 },
  valueRow: { display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13 },
  valueKey: { flexShrink: 0, minWidth: '5rem', color: tokens.mutedForeground },
  valueOne: { minWidth: 0, margin: 0, overflowWrap: 'anywhere', fontWeight: 500 },
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
        aside={<Determination recognition={recognition} entry={entry} itemId={item.id} />}
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
 * the round decided about it. No amount beside it - what a determination is
 * worth is the ledger's to say, and a second number here would be a second
 * answer.
 *
 * The values are addressed by opaque recognition ids, which is how the
 * contract stores them and exactly what a reader must never be shown: a
 * question scored by a formula answers `01a05acf-… 0.88`, which names
 * nothing. The question's own frozen contract is what turns those ids back
 * into the words the person determining saw, so it is read here and the
 * fields are drawn in its order. An id the contract does not know is not
 * printed at all: a value whose meaning is gone says less than nothing.
 */
function Determination({
  recognition,
  entry,
  itemId,
}: {
  recognition: RecognitionDto | null
  entry: EntryDto
  itemId: string
}) {
  const query = useApiQuery(assessmentApi)
  const { format, locale } = useI18n()
  const contract = useQuery({
    ...query.assessment.getRecognitionContract.queryOptions({ params: { itemId } }),
    enabled: recognition !== null,
    staleTime: 60_000,
  })

  if (recognition === null) {
    return (
      <div {...stylex.props(styles.card)} data-testid="entry-recognition" data-state="none">
        <p {...stylex.props(styles.cardTitle)}>{format(m.recognitionTitle)}</p>
        <p {...stylex.props(styles.quiet)}>{format(m.recognitionNone)}</p>
      </div>
    )
  }

  const values = (recognition.values ?? {}) as Record<string, unknown>
  const fields = contract.data?.contract?.fields ?? []
  // in the contract's own order, which is the order the determination was
  // made in; anything the contract does not name is left out
  const shown = fields.flatMap((field) => {
    if (!Object.hasOwn(values, field.id)) return []
    const value = values[field.id]
    if (value === null || value === undefined || value === '') return []
    const schema = field.schema as AtomicSchema
    return [
      {
        id: field.id,
        label: displayTitle(schema, field.id, locale),
        text:
          kindOf(schema) === 'choice'
            ? choiceLabel(schema as never, String(value), locale)
            : typeof value === 'boolean'
              ? format(value ? m.recognitionYes : m.recognitionNo)
              : String(value),
      },
    ]
  })
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
      {shown.length > 0 ? (
        <dl {...stylex.props(styles.values)}>
          {shown.map((field) => (
            <div key={field.id} {...stylex.props(styles.valueRow)}>
              <dt {...stylex.props(styles.valueKey)}>{field.label}</dt>
              <dd {...stylex.props(styles.valueOne)}>{field.text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        // determined, but nothing the contract still names: the fact stands
        // and its detail no longer has words, which is worth saying plainly
        !contract.isPending && <p {...stylex.props(styles.quiet)}>{format(m.recognitionOpaque)}</p>
      )}
      {stale && <p {...stylex.props(styles.stale)}>{format(m.recognitionStale)}</p>}
    </div>
  )
}

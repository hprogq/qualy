import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { choiceLabel, displayTitle, kindOf, type AtomicSchema } from '@qualy/value-schema'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EntryDetail } from './EntryDetail.tsx'
import { ReasonDialog } from '../items/ReasonDialog.tsx'
import { sourceLabelOf } from './source.ts'
import { entryRefusalReason } from './refusals.ts'
import { RedetermineDialog, type RedetermineInput } from './RedetermineDialog.tsx'
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
// A concluded claim has two more corrections, each its own power: reopening
// it (the escalation workflow again, on the participant's behalf) and
// re-determining it (a new result, directly). The server says which of them
// this reader may offer on this claim; neither moves the status backwards.

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
  readonly source: 'review' | 'record' | 'import' | 'system' | 'redetermination'
  readonly entryRevisionId: string
  readonly values: unknown
  readonly createdAt: number
  readonly createdByName: string | null
  /** a sitting of several reviewers determined it, not one person */
  readonly byPanel: boolean
}

export function ManagedEntrySheet({
  open,
  entry,
  item,
  recognition,
  corrections,
  correctionProblem = null,
  onReopen,
  onRedetermine,
  trail,
  busy,
  may,
  onClose,
  onIntervene,
  provenance,
}: {
  open: boolean
  entry: EntryDto
  item: ItemDto
  /** what it currently stands recognised as, if anything has been determined */
  recognition: RecognitionDto | null
  /** the corrections of a concluded claim this reader may offer, as the server decided */
  corrections?: {
    /** the server's word on handing it back; absent where no server offer was read */
    readonly returnForRevision?: { readonly state: string; readonly reason: string | null }
    readonly reopen: { readonly state: string; readonly reason: string | null }
    readonly redetermine: { readonly state: string; readonly reason: string | null }
  }
  /** what the last correction was refused for, in the reader's words */
  correctionProblem?: string | null
  onReopen?: (reason: string) => void
  /** resolves true once the claim has its new result, and the dialog closes */
  onRedetermine?: (input: RedetermineInput) => Promise<boolean>
  /** the groups above the question, outermost first */
  trail: readonly string[]
  busy: boolean
  /**
   * The corrections open to this reader in this round at all: none in an
   * archived round, and withdrawing a record takes the power that makes one.
   * What the claim itself allows is read off the claim here.
   */
  may: { readonly returnForRevision: boolean; readonly withdraw: boolean }
  onClose: () => void
  /** both acts take a reason, and the api refuses an empty one */
  onIntervene: (kind: 'return-for-revision' | 'void', reason: string) => void
  /** where the claim came from, as a way to go there: the import it arrived in */
  provenance?: ReactNode
}) {
  const { format } = useI18n()
  const [asking, setAsking] = useState<'return-for-revision' | 'void' | null>(null)
  const [correcting, setCorrecting] = useState<'reopen' | 'redetermine' | null>(null)
  // a correction offered but not open now carries the server's reason; the
  // same code reads differently on this desk for a question without a route
  const why = (reason: string | null) =>
    reason === 'no-appeal-route'
      ? format(m.staffReopenNoRoute)
      : format(entryRefusalReason(reason ?? '') ?? m.refuseOther)
  // Which correction fits is a fact about where the claim came from. A
  // participant's own filing is theirs to change, so it goes back to them; an
  // administrative record has no author to return it to, so the fix is to
  // withdraw it. Offering both on everything would be offering one wrong
  // answer every time.
  const administrative = entry.source === 'record' || entry.source === 'import'
  // only what the api would take: a withdrawn record stays withdrawn, and
  // only a filing under review or approved goes back to its owner
  const withdrawable = may.withdraw && administrative && entry.status !== 'voided'
  // Handing back is the server's to offer where it said (an approved claim
  // goes back only while its owner could take it up again, which no screen
  // can work out); the claim's own state decides where it did not.
  const returnOffer = corrections?.returnForRevision
  const returnable =
    may.returnForRevision &&
    (returnOffer !== undefined
      ? returnOffer.state !== 'hidden'
      : !administrative && (entry.status === 'in_review' || entry.status === 'approved'))
  const returnBlocked =
    returnOffer !== undefined && returnOffer.state === 'blocked' ? why(returnOffer.reason) : null

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
            {provenance}
            <span {...stylex.props(styles.spacer)} />
            {corrections !== undefined && corrections.redetermine.state !== 'hidden' && (
              <CorrectionKey
                act="redetermine"
                label={format(m.staffRedetermine)}
                blocked={
                  corrections.redetermine.state === 'blocked'
                    ? why(corrections.redetermine.reason)
                    : null
                }
                busy={busy}
                onPress={() => setCorrecting('redetermine')}
              />
            )}
            {corrections !== undefined && corrections.reopen.state !== 'hidden' && (
              <CorrectionKey
                act="reopen"
                label={format(m.staffReopen)}
                blocked={
                  corrections.reopen.state === 'blocked' ? why(corrections.reopen.reason) : null
                }
                busy={busy}
                onPress={() => setCorrecting('reopen')}
              />
            )}
            {withdrawable && (
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
            {returnable && (
              <CorrectionKey
                act="return"
                variant="default"
                label={format(m.staffReturnEntry)}
                blocked={returnBlocked}
                busy={busy}
                onPress={() => setAsking('return-for-revision')}
              />
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
      <ReasonDialog
        open={correcting === 'reopen'}
        title={format(m.staffReopenTitle)}
        description={format(m.staffReopenHint)}
        confirmLabel={format(m.staffReopen)}
        busy={busy}
        onConfirm={(reason) => {
          setCorrecting(null)
          onReopen?.(reason)
        }}
        onClose={() => setCorrecting(null)}
      />
      {correcting === 'redetermine' && (
        <RedetermineDialog
          open
          itemId={item.id}
          standing={{
            status: entry.status,
            values:
              recognition === null ? null : ((recognition.values ?? {}) as Record<string, unknown>),
          }}
          running={entry.openRound !== null}
          busy={busy}
          problem={correctionProblem}
          onConfirm={(input) => {
            void onRedetermine?.(input).then((done) => {
              if (done) setCorrecting(null)
            })
          }}
          onClose={() => setCorrecting(null)}
        />
      )}
    </>
  )
}

/**
 * One correction of a concluded claim: offered, or standing disabled with
 * the server's reason on hover.
 */
function CorrectionKey({
  act,
  variant = 'outline',
  label,
  blocked,
  busy,
  onPress,
}: {
  act: 'return' | 'reopen' | 'redetermine'
  variant?: 'default' | 'outline'
  label: string
  /** why it is not open now, or null when it is */
  blocked: string | null
  busy: boolean
  onPress: () => void
}) {
  const key = (
    <Button
      variant={variant}
      size="sm"
      data-testid={`staff-${act}`}
      data-offer={blocked === null ? 'available' : 'blocked'}
      disabled={busy || blocked !== null}
      onClick={onPress}
    >
      {label}
    </Button>
  )
  if (blocked === null) return key
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{key}</span>
        </TooltipTrigger>
        <TooltipContent>{blocked}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  // the reader's own calendar and clock, to the minute: seconds and a
  // machine's default ordering were never read here
  const when = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(recognition.createdAt))

  return (
    <div
      {...stylex.props(styles.card)}
      data-testid="entry-recognition"
      data-source={recognition.source}
      data-by-panel={recognition.byPanel}
    >
      <div {...stylex.props(styles.cardHead)}>
        <p {...stylex.props(styles.cardTitle)}>{format(m.recognitionTitle)}</p>
        <Badge variant="outline">{format(sourceLabelOf(recognition.source))}</Badge>
        <span {...stylex.props(styles.spacer)} />
        <span {...stylex.props(styles.cardWhen)}>
          {recognition.byPanel
            ? format(m.recognitionByPanel, { when })
            : format(m.recognitionBy, {
                who: recognition.createdByName ?? format(m.eventSomebody),
                when,
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
        // Two different silences. A determination that carried values which
        // the contract can no longer name is a lost version, and worth
        // saying. A question that never had values to determine is not -
        // it is simply that kind of question, and calling that a lost
        // version accuses the round of something that never happened.
        !contract.isPending && (
          <p {...stylex.props(styles.quiet)}>
            {format(Object.keys(values).length > 0 ? m.recognitionOpaque : m.recognitionNoValues)}
          </p>
        )
      )}
      {stale && <p {...stylex.props(styles.stale)}>{format(m.recognitionStale)}</p>}
    </div>
  )
}

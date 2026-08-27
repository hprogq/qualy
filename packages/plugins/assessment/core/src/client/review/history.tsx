import { useEffect, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Kbd } from '@qualy/ui/kbd'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { Skeleton } from '@qualy/ui/skeleton'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { reviewOutcomeMessage } from './events.ts'
import { timeLabel, useEntryHistory, type HistoryRevision } from './model.ts'
import { useFinePointer } from './pointer.ts'

// Choosing which version of a filing to read the judged one against.
//
// The account itself is not here: a claim has one story, and both the person
// who filed it and whoever is judging it read the same rendering of it
// (entry/EntryHistory). This is the other half of that - the list of what
// there is to compare against, which only a reviewer ever needs.

/** the shape the entry-history endpoint answers with, as these screens read it */
type History = {
  revisions: readonly HistoryRevision[]
  rounds: readonly {
    id: string
    roundNo: number
    outcome: string | null
    revisionId: string
    submittedAt: string
    events: readonly {
      kind: string
      actorName: string | null
      reason: string | null
      comment: string | null
      at: string
    }[]
  }[]
}

const sm = '@media (min-width: 640px)'

const styles = stylex.create({
  panel: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    gap: 0,
    padding: 0,
  },
  panelUp: { maxHeight: '85vh' },
  panelBeside: { maxWidth: { default: null, '@media (min-width: 640px)': '28rem' } },
  head: { borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: tokens.border },
  headTitle: { fontSize: 14, lineHeight: '1.25rem' },
  subtitle: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  scroller: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  body: {
    padding: 16,
  },
  skeleton: {
    height: 128,
    width: '100%',
  },
  blank: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 10,
    textAlign: 'left',
    transitionProperty: 'color, background-color, border-color',
  },
  rowJudged: {
    cursor: 'not-allowed',
    borderColor: 'transparent',
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    color: tokens.mutedForeground,
  },
  rowComparing: {
    cursor: 'pointer',
    borderColor: tokens.foreground,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
  },
  rowOffered: {
    cursor: 'pointer',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  rowWords: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 2,
  },
  rowLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  versionName: {
    fontSize: 14,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  versionWhen: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  versionNote: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  rowChips: {
    display: 'flex',
    minWidth: 0,
    flexShrink: 1,
    alignItems: 'center',
    gap: 8,
  },
  chipNowrap: {
    whiteSpace: 'nowrap',
  },
  outcomeChip: {
    minWidth: 0,
    fontWeight: 400,
  },
  truncate: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  foot: {
    display: 'flex',
    flexDirection: {
      default: 'column',
      [sm]: 'row',
    },
    alignItems: {
      default: null,
      [sm]: 'center',
    },
    gap: {
      default: 8,
      [sm]: 12,
    },
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    padding: 12,
  },
  footHint: {
    minWidth: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    flexGrow: {
      default: null,
      [sm]: 1,
    },
    flexShrink: {
      default: null,
      [sm]: 1,
    },
    flexBasis: {
      default: null,
      [sm]: '0%',
    },
  },
  footActs: {
    display: 'flex',
    alignItems: 'center',
    gap: {
      default: 8,
      [sm]: 12,
    },
  },
  footButton: {
    flexGrow: {
      default: 1,
      [sm]: 0,
    },
    flexShrink: {
      default: 1,
      [sm]: 0,
    },
    flexBasis: {
      default: '0%',
      [sm]: 'auto',
    },
  },
})

/**
 * Which earlier version the filing is being read against (1j).
 *
 * Every version is listed, the one under judgement included: leaving it out
 * made the list disagree with the count above it, and a reader looking for
 * "which one am I reading" found nothing. It is not selectable - comparing a
 * filing against itself says nothing, and comparing forward would read it
 * against something that came after it - so it stands marked instead.
 *
 * Choosing is two steps rather than one. A press that both picks and closes
 * cannot be corrected without reopening, and what each version was is only
 * legible with the others beside it.
 */
export function VersionPicker({
  open,
  entryId,
  judgedRevisionNo,
  comparingId,
  participantName,
  itemTitle,
  onPick,
  onClose,
}: {
  open: boolean
  entryId: string
  judgedRevisionNo: number
  comparingId: string | null
  participantName: string
  itemTitle: string
  onPick: (revisionId: string) => void
  onClose: () => void
}) {
  const { format, formatError } = useI18n()
  // a phone gets the sheet where the thumb is; a keyboard gets the digits
  const narrow = useIsBelow(640)
  const fine = useFinePointer()
  const history = useEntryHistory(entryId, open)
  const data = history.data as History | undefined
  const revisions = data?.revisions ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  // reopened against a different comparison than last time: the list starts
  // where the screen behind it actually is
  useEffect(() => {
    if (open) setChosen(comparingId)
  }, [open, comparingId])
  // The screen behind says 'previous' rather than naming a version - the
  // default comparison exists before the history has loaded. Resolved here,
  // derived rather than stored: resolving into state would race the fetch,
  // and until it resolves the list showed no selection at all - every row
  // alike, the confirm button dead, nothing saying which version the
  // comparison on screen was reading.
  const previousId =
    [...revisions].reverse().find((one) => one.revisionNo < judgedRevisionNo)?.id ?? null
  const chosenId = chosen === 'previous' ? previousId : chosen

  /**
   * How the round that judged this version ended, in one phrase.
   *
   * A list of dates cannot be chosen from. What a reader is looking for is
   * "the one that came back", and that is a fact about the round, not the
   * version - so it is read off the rounds and shown on the version they
   * judged.
   */
  const outcomeOf = (revisionId: string) => {
    const round = [...(data?.rounds ?? [])]
      .reverse()
      .find((one) => one.revisionId === revisionId && one.outcome !== null)
    if (round === undefined) return null
    const said = [...round.events]
      .reverse()
      .find((event) => event.kind === 'rejected' || event.kind === 'approved')
    return { outcome: round.outcome!, who: said?.actorName ?? null }
  }

  const picked = revisions.find((one) => one.id === chosenId)

  // newest first, and the digits count only what can actually be chosen: a
  // key that lands on the greyed row is a key that does nothing
  const listed = useMemo(() => [...revisions].reverse(), [revisions])
  const pickable = useMemo(
    () => listed.filter((one) => one.revisionNo !== judgedRevisionNo),
    [listed, judgedRevisionNo],
  )
  // 1-9 chooses, cmd-enter confirms: the same two chords the decision dialog
  // beside this one answers to, so a reviewer working by keyboard never has
  // to learn a second set
  useEffect(() => {
    if (!open || !fine) return
    const down = (event: KeyboardEvent) => {
      if (event.altKey) return
      const typing =
        event.target instanceof HTMLElement && event.target.closest('input, textarea') !== null
      if (typing) return
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        if (picked !== undefined) {
          event.preventDefault()
          onPick(picked.id)
        }
        return
      }
      if (event.metaKey || event.ctrlKey) return
      const digit = event.code.startsWith('Digit') ? Number(event.code.slice(5)) : Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(9, pickable.length)) {
        event.preventDefault()
        setChosen(pickable[digit - 1]!.id)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [open, fine, pickable, picked, onPick])

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/* From the side on a desk, from the foot on a phone: a panel that
          slides in from the right of a 390px screen is the whole screen
          arriving sideways, and the list it carries is a thumb's job. */}
      <SheetContent
        side={narrow ? 'bottom' : 'right'}
        xstyle={[styles.panel, narrow ? styles.panelUp : styles.panelBeside]}
      >
        <SheetHeader className={stylex.props(styles.head).className}>
          <SheetTitle className={stylex.props(styles.headTitle).className}>
            {format(m.reviewVersionsTitle)}
          </SheetTitle>
          <p {...stylex.props(styles.subtitle)}>
            {format(m.reviewVersionsSubtitle, {
              name: participantName,
              item: itemTitle,
              count: revisions.length,
            })}
          </p>
        </SheetHeader>
        <ScrollArea className={stylex.props(styles.scroller).className}>
          <div {...stylex.props(styles.body)}>
            <AsyncSection
              pending={history.isPending}
              error={history.error ? formatError(history.error) : null}
              loadingLabel={format(commonMessages.loading)}
              retryLabel={format(commonMessages.retry)}
              onRetry={() => void history.refetch()}
              skeleton={<Skeleton className={stylex.props(styles.skeleton).className} />}
            >
              {revisions.length === 0 ? (
                <p {...stylex.props(styles.blank)}>{format(m.reviewCompareBlank)}</p>
              ) : (
                <ul {...stylex.props(styles.list)}>
                  {listed.map((revision) => {
                    const judged = revision.revisionNo === judgedRevisionNo
                    const ended = outcomeOf(revision.id)
                    const digit = pickable.indexOf(revision) + 1
                    return (
                      <li key={revision.id}>
                        {/* Three states a glance apart: the judged version is
                          greyed and refuses the cursor - it is what the
                          comparison reads, not something to read against;
                          the one being compared stands marked; the rest
                          offer themselves. */}
                        <button
                          type="button"
                          disabled={judged}
                          // the three standings as a fact, so a test asks
                          // which row is which rather than reading the chips
                          data-testid="version-row"
                          data-version={revision.revisionNo}
                          data-standing={
                            judged ? 'judged' : revision.id === chosenId ? 'comparing' : 'available'
                          }
                          onClick={() => setChosen(revision.id)}
                          {...stylex.props(
                            styles.row,
                            judged
                              ? styles.rowJudged
                              : revision.id === chosenId
                                ? styles.rowComparing
                                : styles.rowOffered,
                          )}
                        >
                          <span {...stylex.props(styles.rowWords)}>
                            {/* the version and its clock never break across
                                lines: at 390px the name wrapped to "第 1 /
                                版" and the timestamp split down the middle,
                                which is the row telling the reader it ran
                                out of room rather than saying anything */}
                            <span {...stylex.props(styles.rowLine)}>
                              <span {...stylex.props(styles.versionName)}>
                                {format(m.reviewVersionName, { no: revision.revisionNo })}
                              </span>
                              <span {...stylex.props(styles.versionWhen)}>
                                {timeLabel(revision.createdAt)}
                              </span>
                            </span>
                            {revision.note !== null && (
                              <span {...stylex.props(styles.versionNote)}>{revision.note}</span>
                            )}
                          </span>
                          <span {...stylex.props(styles.rowChips)}>
                            {judged ? (
                              <Badge
                                variant="outline"
                                className={stylex.props(styles.chipNowrap).className}
                              >
                                {format(m.reviewVersionJudged)}
                              </Badge>
                            ) : revision.id === chosenId ? (
                              <Badge className={stylex.props(styles.chipNowrap).className}>
                                {format(m.reviewVersionComparing)}
                              </Badge>
                            ) : (
                              ended !== null && (
                                <Badge
                                  variant="outline"
                                  className={stylex.props(styles.outcomeChip).className}
                                >
                                  <span {...stylex.props(styles.truncate)}>
                                    {format(reviewOutcomeMessage(ended.outcome))}
                                    {/* who decided is the second fact here, and
                                        the first one is what the reader came
                                        for: a phone keeps the verdict */}
                                    {!narrow && ended.who !== null && `\u3000${ended.who}`}
                                  </span>
                                </Badge>
                              )
                            )}
                            {fine && !judged && digit <= 9 && <Kbd>{digit}</Kbd>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </AsyncSection>
          </div>
        </ScrollArea>
        {/* the hint sits above the keys on a phone: three items on one line
            at 390px left the confirm button too narrow to say which version
            it would confirm */}
        <div {...stylex.props(styles.foot)}>
          <p {...stylex.props(styles.footHint)}>{format(m.reviewVersionsFoot)}</p>
          <div {...stylex.props(styles.footActs)}>
            <Button
              variant="outline"
              className={stylex.props(styles.footButton).className}
              onClick={onClose}
            >
              {format(commonMessages.close)}
            </Button>
            <Button
              className={stylex.props(styles.footButton).className}
              disabled={picked === undefined}
              onClick={() => picked !== undefined && onPick(picked.id)}
            >
              {picked === undefined
                ? format(m.reviewVersionsConfirmNone)
                : format(m.reviewVersionsConfirm, { no: picked.revisionNo })}
              {fine && picked !== undefined && <Kbd>⌘↵</Kbd>}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

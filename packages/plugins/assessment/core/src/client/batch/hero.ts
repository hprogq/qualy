import type { TimelineLike } from './progress.ts'

// What the card that leads the batch list is handed, apart from the card.
//
// A module of its own because the card next to it is a component module, and
// a component module that also exports a value cannot be swapped in place
// while somebody is looking at it: the dev server gives up on the whole file
// and reloads the page instead.

export interface BatchCardRow {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
  currentPhaseId: string | null
  currentPhaseName: string | null
  participantCount: number
  materialRange: { start: string; end: string }
  timeline: readonly TimelineLike[]
}

/**
 * One line of what this reader has to do about the round.
 *
 * `review` is other people's work waiting on them; `own` is their own
 * filing. **A line is drawn because the reader has the standing, not
 * because a count is above nought**: a judge with an empty queue is still
 * a judge here, and a participant who has filed nothing is still expected
 * to. Drawing by the counts instead gave a card whose number of lines -
 * and so whose height - changed from round to round, and left the two
 * commonest answers, "nothing waiting on you" and "you have not started",
 * as a blank where a sentence belongs.
 */
export type AgendaRow =
  | { readonly kind: 'review'; readonly waiting: number }
  | {
      readonly kind: 'own'
      /**
       * the earliest of the reader's own filings that is still in play; with
       * nothing filed, whether filing is open now (`none`), opens at a later
       * stage (`upcoming`) or is over (`missed`)
       */
      readonly state: OwnState
      readonly count: number
    }

export type OwnState =
  | 'toAnswer'
  | 'toFix'
  | 'draft'
  | 'rejected'
  | 'submitted'
  | 'approved'
  | 'none'
  | 'upcoming'
  | 'missed'

/** what a participant can get on with: every other own line only reports */
const ASKING: ReadonlySet<OwnState> = new Set(['toAnswer', 'toFix', 'draft', 'rejected', 'none'])

/** whether an own line asks something of the reader, or only reports */
export const ownLineAsks = (state: OwnState): boolean => ASKING.has(state)

/**
 * What this reader has to do in the round, in the order it is worth doing.
 *
 * The api that answers this arrives with the next step; until then a page
 * hands the card `NO_AGENDA` and the right column says only where the
 * round stands.
 */
export interface BatchAgenda {
  readonly rows: readonly AgendaRow[]
}

export const NO_AGENDA: BatchAgenda = { rows: [] }

/**
 * How much a line is asking of the reader.
 *
 * Three ranks, not six: what is waiting on them, what they can get on with,
 * and what is out of their hands. Finer ranking would reorder the two lines
 * between one card and the next in the same deck, which reads as the card
 * rearranging itself rather than as an order. Equal ranks keep the order
 * they were built in, where a queue that holds other people up comes before
 * one that holds up only the reader.
 */
const urgency = (row: AgendaRow): number =>
  row.kind === 'review' ? (row.waiting > 0 ? 3 : 0) : ASKING.has(row.state) ? 2 : 0

/** the reader's standing in one round, as the lines the card draws for it */
export const agendaOf = (
  items: readonly {
    batchId: string
    myEntries: {
      toAnswer: number
      toFix: number
      draft: number
      rejected: number
      submitted: number
      approved: number
      filing: 'open' | 'upcoming' | 'closed'
    } | null
    reviewsWaiting: number | null
  }[],
  batchId: string | undefined,
): BatchAgenda => {
  const mine = batchId === undefined ? undefined : items.find((row) => row.batchId === batchId)
  if (mine === undefined) return NO_AGENDA
  const rows: AgendaRow[] = []
  if (mine.reviewsWaiting !== null) rows.push({ kind: 'review', waiting: mine.reviewsWaiting })
  if (mine.myEntries !== null) {
    // one line, saying the earliest thing still in play: a reader with work
    // to redo does not also need telling what is out for judgement. What
    // waits on the reader comes first, a refusal (news they may answer)
    // before what is still with the reviewers, and what was accepted only
    // when nothing else is left. "Nothing filed" is three different lines,
    // because "start filing" is only true while filing is open.
    const own = mine.myEntries
    const first = (
      [
        ['toAnswer', own.toAnswer],
        ['toFix', own.toFix],
        ['draft', own.draft],
        ['rejected', own.rejected],
        ['submitted', own.submitted],
        ['approved', own.approved],
      ] as const
    ).find(([, count]) => count > 0)
    rows.push(
      first !== undefined
        ? { kind: 'own', state: first[0], count: first[1] }
        : {
            kind: 'own',
            state:
              own.filing === 'open' ? 'none' : own.filing === 'upcoming' ? 'upcoming' : 'missed',
            count: 0,
          },
    )
  }
  return { rows: rows.sort((one, other) => urgency(other) - urgency(one)) }
}

/** how the card says which of several running rounds it is showing */
export type HeroFrame =
  | { readonly kind: 'single' }
  | {
      readonly kind: 'arrows'
      readonly index: number
      readonly total: number
      readonly onPrevious: () => void
      readonly onNext: () => void
    }
  | {
      readonly kind: 'picker'
      readonly options: readonly { readonly id: string; readonly name: string }[]
      readonly onPick: (id: string) => void
    }

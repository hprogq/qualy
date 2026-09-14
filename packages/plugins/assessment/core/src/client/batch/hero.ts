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
      /** the earliest of the reader's own filings that is still in play */
      readonly state: 'toFix' | 'draft' | 'submitted' | 'none'
      readonly count: number
    }

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
  row.kind === 'review' ? (row.waiting > 0 ? 3 : 0) : row.state === 'submitted' ? 0 : 2

/** the reader's standing in one round, as the lines the card draws for it */
export const agendaOf = (
  items: readonly {
    batchId: string
    myEntries: { toFix: number; draft: number; submitted: number } | null
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
    // to redo does not also need telling what is out for judgement
    const { toFix, draft, submitted } = mine.myEntries
    rows.push(
      toFix > 0
        ? { kind: 'own', state: 'toFix', count: toFix }
        : draft > 0
          ? { kind: 'own', state: 'draft', count: draft }
          : submitted > 0
            ? { kind: 'own', state: 'submitted', count: submitted }
            : { kind: 'own', state: 'none', count: 0 },
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

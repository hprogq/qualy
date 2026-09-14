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
 * What this reader has to do in the round.
 *
 * `review` is other people's work waiting on them and is only ever present
 * for somebody who reviews here; `own` is their own filing. The api that
 * answers this arrives with the next step; until then a page hands the card
 * `NO_AGENDA` and the right column says only where the round stands.
 */
export interface BatchAgenda {
  readonly review: { readonly count: number } | null
  readonly own: { readonly count: number } | null
}

export const NO_AGENDA: BatchAgenda = { review: null, own: null }

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

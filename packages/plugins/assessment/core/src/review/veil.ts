import { Effect } from 'effect'

/**
 * The code a phase opens to name, to the person who filed a claim, the
 * people who judged it (§32.85). Closed unless a phase lists it.
 */
export const VIEW_REVIEWERS = 'assessment.review.view-reviewers'

/**
 * Whether this reader is kept from knowing who judged the claim.
 *
 * Only the claim's own participant is ever kept from it, and only while
 * the phase of the moment does not open `view-reviewers`. The names are
 * taken off on the server: a screen that received them and drew stars
 * over them would have published them to anybody who opens the network
 * panel. Every door the filer reads through asks this one question, so a
 * door added later cannot quietly answer it differently.
 */
export const reviewersVeiled = (
  phaseOpens: (tenantId: string, batchId: string, code: string) => Effect.Effect<boolean>,
  input: {
    readonly tenantId: string
    readonly batchId: string
    /** whose claim it is; null where the claim has no participant to ask about */
    readonly subjectUserId: string | null
    readonly readerUserId: string
  },
): Effect.Effect<boolean> =>
  input.subjectUserId === null || input.subjectUserId !== input.readerUserId
    ? Effect.succeed(false)
    : Effect.map(phaseOpens(input.tenantId, input.batchId, VIEW_REVIEWERS), (open) => !open)

/**
 * One act as a veiled reader is told it: their own acts keep their name,
 * everybody else's lose it. The id goes with the name, because an id is a
 * name one lookup away.
 */
export const unnamedUnlessOwn = <
  A extends { readonly actorId: string | null; readonly actorName: string | null },
>(
  veiled: boolean,
  readerUserId: string,
  act: A,
): A => (veiled && act.actorId !== readerUserId ? { ...act, actorId: null, actorName: null } : act)

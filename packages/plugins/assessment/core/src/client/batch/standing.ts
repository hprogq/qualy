// Which of the four things a batch is, for the screens that colour by it.
//
// Its own module rather than a second export beside the badge: a file that
// exports a component and something else cannot be hot-reloaded, and the
// warning about it is easy to live with until the day a stale component is
// what somebody is actually looking at.

/**
 * Where a batch stands, said the same way in the list and on the batch itself.
 *
 * Four words for three stored values: a batch that has promised to start but
 * has not arrived there yet is neither a draft nor under way, and calling it
 * "in progress" while nobody can do anything in it reads as a bug. It is the
 * absence of a current phase that says so, which is also what makes the batch
 * invisible to participants.
 *
 * The dot is not decoration either: a running batch is the only one whose
 * screen can change under the reader, and it is the only one whose dot moves.
 */

export type BatchStanding = 'draft' | 'pending' | 'active' | 'archived'

export const standingOf = (
  status: 'draft' | 'active' | 'archived',
  currentPhaseId: string | null,
): BatchStanding => (status === 'active' && currentPhaseId === null ? 'pending' : status)

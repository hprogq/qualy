// The codes the assessment plugin gates by name, apart from the permission
// catalog (./permissions.ts): a phase editor and the access screens name
// them in the browser, and the catalog carries the server's messages.

/**
 * What being on the roster is worth.
 *
 * These are actions, not permissions, and deliberately not in the catalog
 * above: no role grants them and no administrator can. A participant's
 * capabilities come from being one - the roster is the whole of the answer -
 * and a role that could hand out "submit an entry" would be claiming to make
 * somebody a participant in a round they are not in, which it cannot do. The
 * codes still exist because a phase opens and closes them by name, and
 * because the resource policy that checks ownership needs something to name.
 */
export const PARTICIPANT_ACTION_CODES = [
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  // giving a claim up for good - distinct from withdraw on purpose: the
  // window for taking work back to edit closes when review begins, while
  // the window for no longer claiming it closes with the phase plan
  // (typically at final publication)
  'assessment.entry.abandon',
  // contesting a decided entry is the participant's move (§32.14, §32.65):
  // a member of staff who wants another look reopens the review, which is a
  // different code and a different act. Named for what it gates - the
  // appeal - not for the resubmission that is plain entry.submit
  'assessment.entry.appeal',
  'assessment.result.view-self',
  // Who judged one's own claim. Reading the claim's account is always the
  // participant's; whether that account names the people in it is the
  // batch's to decide, phase by phase - hidden while judging is under way,
  // shown once it can no longer be leaned on, or never
  'assessment.review.view-reviewers',
] as const

/**
 * What a batch copies out of the tenant's authority when it is created.
 *
 * The work staff do inside a round, and only that. Administering the batch
 * itself (`assessment.batch.manage`, forcing a boundary) deliberately stays
 * live tenant authority: it is the capability that decides who may edit this
 * very list, and freezing it at creation would leave an administrator
 * appointed afterwards unable to touch rounds that already exist.
 */
/**
 * What a reviewer may do beyond deciding, and only while a phase says so.
 *
 * Not permissions either, for the same shape of reason as the participant
 * actions above: who may act on a round is already answered by
 * `assessment.review.process` together with the level the round is standing
 * at. A second grantable permission would mean maintaining two nearly
 * identical ticks against every reviewing role and would buy nothing - what
 * varies is not who, it is when.
 */
export const REVIEW_ACTION_CODES = [
  'assessment.review.escalate',
  // what stands after the level a reviewer is judging at: the levels still
  // to come and who holds them. Closed, a reviewer judges what is in front
  // of them without knowing who reads it next
  'assessment.review.view-chain',
] as const

export const BATCH_STAFF_CODES = [
  'assessment.entry.record',
  // not phase gated either: reading is not a window the calendar opens
  'assessment.entry.read-all',
  // not phase gated: correcting a conclusion is not a window the calendar
  // opens, and the batch's acceptance is what bounds it
  'assessment.entry.redetermine',
  'assessment.review.process',
  'assessment.review.reopen',
  'assessment.result.view-peers',
  'assessment.ranking.view',
] as const

/**
 * Codes the product has named but does not offer yet (ruling of 2026-09-25
 * #22): filing on a participant's behalf and managing publication have no
 * act behind them, so a tick that grants them promises nothing.
 *
 * Kept out of the catalog, so the role editor never lists them and a batch
 * never accepts them, and out of what a stage editor offers. Not deleted:
 * rows that already name them - a role's permissions, a batch's acceptance,
 * a stage's profile - stay as they are and inert, since a code the catalog
 * does not serve authorizes nothing, and a stage profile that names one is
 * still a valid profile. When an act arrives, the code returns to the
 * catalog under the same name.
 */
export const UNOFFERED_CODES: readonly string[] = [
  'assessment.entry.proxy',
  'assessment.publication.manage',
]

/**
 * Staff codes a role does not carry into a batch merely by holding every
 * permission by its mode (the canonical tenant administrator's
 * `all-active`). Re-determining a concluded claim is granted on purpose
 * (ruling of 2026-09-25): a system administrator who needs it gives it to
 * themselves through a role that names it, which the record then shows.
 */
export const EXPLICIT_ONLY_STAFF_CODES: readonly string[] = ['assessment.entry.redetermine']

export const PHASE_GATED_CODES = [
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  'assessment.entry.abandon',
  'assessment.entry.proxy',
  'assessment.entry.record',
  'assessment.entry.appeal',
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.review.reopen',
  'assessment.review.view-reviewers',
  'assessment.review.view-chain',
  'assessment.result.view-peers',
  'assessment.ranking.view',
] as const

export type PhaseGatedCode = (typeof PHASE_GATED_CODES)[number]

/** what a stage editor offers: the gated codes, less the ones not offered yet */
export const OFFERED_PHASE_CODES: readonly PhaseGatedCode[] = PHASE_GATED_CODES.filter(
  (code) => !UNOFFERED_CODES.includes(code),
)

export const PHASE_GATED: ReadonlySet<string> = new Set(PHASE_GATED_CODES)

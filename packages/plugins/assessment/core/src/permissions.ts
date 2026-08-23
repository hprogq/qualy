// The assessment domain's permission catalog, and beside it the phase gate's
// own registry of which of these codes a phase profile may open.
//
// PHASE_GATED lives here rather than on PermissionDefinition on purpose:
// "which codes are gated" is a property of the gate, not of the permission
// (rbac stays untouched). Every member is a code this plugin declares, so a
// global code can never appear in a phase editor - asserted below at import
// time, which is boot and resolve alike.
import { message } from '@qualy/i18n-contract'
import type { PermissionDefinition } from '@qualy/rbac-contract'

export const permissions = [
  {
    code: 'assessment.batch.manage',
    name: message('assessment/permission/batch-manage', 'Manage assessment batches'),
    description: message(
      'assessment/permission-hint/batch-manage',
      'The whole life of a batch: stages, questions and the roster.',
    ),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
  {
    code: 'assessment.batch.force-advance',
    name: message('assessment/permission/batch-force-advance', 'Force a stage change'),
    description: message(
      'assessment/permission-hint/batch-force-advance',
      'Move a batch past its guard conditions; a reason is required.',
    ),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
  {
    code: 'assessment.publication.manage',
    name: message('assessment/permission/publication-manage', 'Manage result publication'),
    description: message(
      'assessment/permission-hint/publication-manage',
      'Announce, publish, or withdraw the batch results.',
    ),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
  {
    code: 'assessment.entry.proxy',
    name: message('assessment/permission/entry-proxy', 'Submit on behalf of participants'),
    description: message(
      'assessment/permission-hint/entry-proxy',
      'File material a participant could have filed themselves; it takes the full review chain.',
    ),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
  {
    code: 'assessment.entry.record',
    name: message('assessment/permission/entry-record', 'Record recognized items'),
    description: message(
      'assessment/permission-hint/entry-record',
      'Record deductions and awards the organization has already decided; they take effect without review.',
    ),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
  {
    code: 'assessment.review.process',
    name: message('assessment/permission/review-process', 'Review submissions'),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
  {
    code: 'assessment.review.reopen',
    name: message('assessment/permission/review-reopen', 'Reopen completed reviews'),
    description: message(
      'assessment/permission-hint/review-reopen',
      'Reopen a review that has already ended.',
    ),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
  {
    code: 'assessment.result.view-peers',
    name: message(
      'assessment/permission/result-view-peers',
      'View other participants\u2019 results',
    ),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'tenant',
  },
  {
    code: 'assessment.ranking.view',
    name: message('assessment/permission/ranking-view', 'View ranking'),
    groupKey: 'assessment',
    group: message('assessment/permission-group/assessment', 'Assessment'),
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]

/**
 * The codes a phase's permission profile can open or withhold, in the order
 * the phase editor lists them.
 *
 * Anything outside this set passes the gate unconditionally; anything inside
 * it fails closed when absent from the current profile. A tuple rather than a
 * bare set because the editor's label map is keyed by it: a code added here
 * without a translation stops compiling.
 */
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
export const REVIEW_ACTION_CODES = ['assessment.review.escalate'] as const

export const BATCH_STAFF_CODES = [
  'assessment.entry.proxy',
  'assessment.entry.record',
  'assessment.review.process',
  'assessment.review.reopen',
  'assessment.result.view-peers',
  'assessment.ranking.view',
  'assessment.publication.manage',
] as const

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
  'assessment.result.view-peers',
  'assessment.ranking.view',
] as const

export type PhaseGatedCode = (typeof PHASE_GATED_CODES)[number]

export const PHASE_GATED: ReadonlySet<string> = new Set(PHASE_GATED_CODES)

const declared = new Set<string>(permissions.map((definition) => definition.code))

// Staff capabilities are permissions and have to be in the catalog: a batch
// accepts them from roles, and a role can only carry what the catalog knows.
for (const code of BATCH_STAFF_CODES) {
  if (!declared.has(code)) {
    throw new Error(`assessment: ${code} is not a declared permission`)
  }
}

// A participant action must NOT be in it. Registering one would put "create an
// entry" in the role editor, where ticking it promises something the domain
// refuses to honour - authority over one's own entries comes from the roster,
// and no grant can add somebody to a round.
for (const code of PARTICIPANT_ACTION_CODES) {
  if (declared.has(code)) {
    throw new Error(
      `assessment: ${code} is a participant action and must not be an rbac permission`,
    )
  }
}

// Same rule for a reviewer's own actions: standing at the level is what
// makes somebody a reviewer, and a grantable "may escalate" would offer
// to make somebody one who is not.
for (const code of REVIEW_ACTION_CODES) {
  if (declared.has(code)) {
    throw new Error(`assessment: ${code} is a review action and must not be an rbac permission`)
  }
}

// The gate spans both: it decides which actions are open now, and has no
// interest in where the authority for one comes from.
const gateable = new Set<string>([...declared, ...PARTICIPANT_ACTION_CODES, ...REVIEW_ACTION_CODES])
for (const code of PHASE_GATED) {
  if (!gateable.has(code)) {
    throw new Error(`PHASE_GATED lists '${code}', which @qualy/plugin-assessment does not declare`)
  }
}

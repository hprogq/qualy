// The assessment domain's permission catalog, and beside it the phase gate's
// own registry of which of these codes a phase profile may open.
//
// PHASE_GATED lives here rather than on PermissionDefinition on purpose:
// "which codes are gated" is a property of the gate, not of the permission
// (rbac stays untouched). Every member is a code this plugin declares, so a
// global code can never appear in a phase editor - asserted below at import
// time, which is boot and resolve alike.
import type { PermissionDefinition } from '@qualy/rbac-contract'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

export const permissions = [
  {
    code: 'assessment.batch.manage',
    name: text(m.permission_batchManage),
    description: text(m.permissionHint_batchManage),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
    target: 'org-node',
  },
  {
    code: 'assessment.batch.force-advance',
    name: text(m.permission_batchForceAdvance),
    description: text(m.permissionHint_batchForceAdvance),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
    target: 'org-node',
  },
  {
    code: 'assessment.entry.record',
    name: text(m.permission_entryRecord),
    description: text(m.permissionHint_entryRecord),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
    target: 'org-node',
  },
  {
    // Correcting a concluded claim outside any round (ruling of
    // 2026-09-25): granted on purpose - an inspection group, say - and never
    // implied by judging at the end of a route
    code: 'assessment.entry.redetermine',
    name: text(m.permission_entryRedetermine),
    description: text(m.permissionHint_entryRedetermine),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
    target: 'org-node',
  },
  {
    // Looking over a participant with no task in hand (ruling of
    // 2026-09-29): their whole account and every claim they have submitted,
    // within the reach the batch accepted - what a counsellor needs without
    // the power to change a result. Re-determining carries this reading too;
    // judging, re-examining and recording read only what their own task
    // puts in front of them.
    code: 'assessment.entry.read-all',
    name: text(m.permission_entryReadAll),
    description: text(m.permissionHint_entryReadAll),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
    target: 'org-node',
  },
  {
    code: 'assessment.review.process',
    name: text(m.permission_reviewProcess),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
    target: 'org-node',
  },
  {
    code: 'assessment.review.reopen',
    name: text(m.permission_reviewReopen),
    description: text(m.permissionHint_reviewReopen),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
    target: 'org-node',
  },
  {
    code: 'assessment.result.view-peers',
    name: text(m.permission_resultViewPeers),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
    target: 'tenant',
  },
  {
    code: 'assessment.ranking.view',
    name: text(m.permission_rankingView),
    groupKey: 'assessment',
    group: text(m.permissionGroup_assessment),
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
// the codes themselves are a module of their own: the screens that name them
// must not import the catalog's messages, which are the server's
export * from './permission-codes.ts'
import {
  BATCH_STAFF_CODES,
  PARTICIPANT_ACTION_CODES,
  PHASE_GATED,
  REVIEW_ACTION_CODES,
  UNOFFERED_CODES,
} from './permission-codes.ts'

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
// interest in where the authority for one comes from. A code not offered yet
// stays gateable, so a stage profile that already names one stays valid.
const gateable = new Set<string>([
  ...declared,
  ...PARTICIPANT_ACTION_CODES,
  ...REVIEW_ACTION_CODES,
  ...UNOFFERED_CODES,
])
for (const code of PHASE_GATED) {
  if (!gateable.has(code)) {
    throw new Error(`PHASE_GATED lists '${code}', which @qualy/plugin-assessment does not declare`)
  }
}

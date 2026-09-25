import { isUuid } from './uuid.ts'
// The review policy an item revision may store: the frozen policy language
// of assessment-design §14, and nothing outside it.
//
// Two routes per item, each ordered from the nearest reviewer outward: the
// ordinary one a submission walks, and the escalation one it is handed to when a
// reviewer says they cannot judge it - which is also the only route an
// appeal ever walks. They share no steps (§32.62). Every step carries a
// permanent id, so a later policy can be asked whether the step an in-flight
// round is standing at still exists.
//
// Selectors are `roleAt` (resolve the nearest unit of a kind and read the
// roles anchored exactly there) and `nearestRole` (walk up for the nearest
// holder of one role, for the roles that genuinely inherit). Quorum is
// any | all | atLeast(n). Unknown keys are refused at every level, so
// widening the engine later means accepting more configurations, never
// reinterpreting stored ones.
//
// Administrative items carry the same shape. Their entries never walk it on
// the way in - recording is trusted, no review instance is built - but an
// appeal or a staff-initiated reopen later resolves its remedy chain from
// the item revision the entry cites, and a revision without one would be
// immutable history with no way back (assessment-design §13/§15).

export interface PolicyIssue {
  readonly path: string
  readonly reason: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const unknownKeys = (
  issues: PolicyIssue[],
  value: Record<string, unknown>,
  path: string,
  known: readonly string[],
) => {
  const allowed = new Set(known)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push({ path: `${path}.${key}`, reason: 'policy-unknown-key' })
  }
}

/**
 * The longest route a policy may describe, and the most roles one step may
 * name. Every round frozen from a policy carries its steps, and every
 * reviewer lookup walks a step's roles: both are read far more often than
 * they are written.
 */
const STAGES_MOST = 10
const ROLES_MOST = 20

const checkSelector = (issues: PolicyIssue[], stage: Record<string, unknown>, at: string) => {
  const selector = stage['selector']
  if (!isRecord(selector)) {
    issues.push({ path: `${at}.selector`, reason: 'policy-selector-kind' })
    return
  }
  if (selector['kind'] === 'roleAt') {
    unknownKeys(issues, selector, `${at}.selector`, ['kind', 'nodeTypeId', 'roleIds'])
    if (!isUuid(selector['nodeTypeId'])) {
      issues.push({ path: `${at}.selector.nodeTypeId`, reason: 'policy-node-type-required' })
    }
    const roleIds = selector['roleIds']
    if (!Array.isArray(roleIds) || roleIds.length === 0 || !roleIds.every(isUuid)) {
      issues.push({ path: `${at}.selector.roleIds`, reason: 'policy-roles-required' })
    } else if (roleIds.length > ROLES_MOST) {
      issues.push({ path: `${at}.selector.roleIds`, reason: 'policy-roles-too-many' })
    }
    return
  }
  if (selector['kind'] === 'nearestRole') {
    unknownKeys(issues, selector, `${at}.selector`, ['kind', 'roleId'])
    if (!isUuid(selector['roleId'])) {
      issues.push({ path: `${at}.selector.roleId`, reason: 'policy-role-required' })
    }
    return
  }
  issues.push({ path: `${at}.selector`, reason: 'policy-selector-kind' })
}

const checkQuorum = (
  issues: PolicyIssue[],
  stage: Record<string, unknown>,
  at: string,
  place: { route: 'normal' | 'escalation'; last: boolean },
) => {
  const quorum = stage['quorum']
  if (!isRecord(quorum)) {
    issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-type' })
    return
  }
  if (quorum['type'] === 'any') {
    unknownKeys(issues, quorum, `${at}.quorum`, ['type'])
    return
  }
  if (quorum['type'] === 'all') {
    unknownKeys(issues, quorum, `${at}.quorum`, ['type'])
    // A panel is an escalation middle step's shape and nothing else's
    // (§32.66). The ordinary route is a chain of single confirmations; the
    // escalation route's last step must speak with one final voice - a
    // split there would have nowhere left to go.
    if (place.route === 'normal') {
      issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-all-normal' })
    } else if (place.last) {
      issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-all-terminal' })
    }
    return
  }
  if (quorum['type'] === 'atLeast') {
    // Named by the grammar, not yet counted by the engine: an `atLeast`
    // count is policy - it must hold even when eligibility shrinks the
    // room - and no aggregation rule for it has been ruled. Refused so
    // that building it later means deleting this branch, never
    // reinterpreting what somebody already saved.
    issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-not-counted' })
    return
  }
  issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-type' })
}

/**
 * The administrator's name for a step: short, spoken, optional. Optional
 * because policies written before names stay readable - the editor asks for
 * one on every step it saves.
 */
const checkLabel = (issues: PolicyIssue[], stage: Record<string, unknown>, at: string) => {
  const label = stage['label']
  if (label === undefined) return
  if (typeof label !== 'string' || label.trim() === '' || label.trim().length > 50) {
    issues.push({ path: `${at}.label`, reason: 'policy-label-invalid' })
  }
}

/** the one spelling of a step id: minted by the pen, never typed by anybody */
const STAGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const checkRoute = (
  issues: PolicyIssue[],
  policy: Record<string, unknown>,
  route: 'normal' | 'escalation',
  seen: Set<string>,
): void => {
  const held = policy[route]
  if (held === undefined) return
  if (!isRecord(held)) {
    issues.push({ path: `reviewPolicy.${route}`, reason: 'policy-not-an-object' })
    return
  }
  unknownKeys(issues, held, `reviewPolicy.${route}`, ['stages'])
  const stages = held['stages']
  if (!Array.isArray(stages)) {
    issues.push({ path: `reviewPolicy.${route}.stages`, reason: 'policy-stages-required' })
    return
  }
  if (stages.length > STAGES_MOST) {
    issues.push({ path: `reviewPolicy.${route}.stages`, reason: 'policy-stages-too-many' })
    return
  }
  for (const [index, stage] of stages.entries()) {
    const at = `reviewPolicy.${route}.stages[${index}]`
    if (!isRecord(stage)) {
      issues.push({ path: at, reason: 'policy-not-an-object' })
      continue
    }
    unknownKeys(issues, stage, at, ['id', 'label', 'selector', 'quorum'])
    const id = stage['id']
    if (typeof id !== 'string' || id === '' || id.length > 63 || !STAGE_ID.test(id)) {
      issues.push({ path: `${at}.id`, reason: 'policy-stage-id-required' })
    } else if (seen.has(id)) {
      // one name, one step - across both routes, because migrating an
      // in-flight round asks "is this step still here" of the whole policy
      issues.push({ path: `${at}.id`, reason: 'policy-stage-id-duplicate' })
    } else {
      seen.add(id)
    }
    checkSelector(issues, stage, at)
    checkLabel(issues, stage, at)
    checkQuorum(issues, stage, at, { route, last: index === stages.length - 1 })
  }
}

export const validateReviewPolicy = (policy: unknown): readonly PolicyIssue[] => {
  if (!isRecord(policy)) return [{ path: 'reviewPolicy', reason: 'policy-not-an-object' }]

  const issues: PolicyIssue[] = []
  // A policy written as one list with `normalTerminal` in it is still read
  // and still walked (§32.62); it may not be written again. Refusing it here
  // rather than quietly accepting both shapes is what keeps the two routes
  // from silently becoming a prefix of one another again.
  if ('stages' in policy || 'normalTerminal' in policy) {
    return [{ path: 'reviewPolicy', reason: 'policy-version-legacy' }]
  }
  // "no review" is said, never implied: an empty stage list stays an error,
  // because an administrator who forgot to configure the route must not
  // discover it as submissions scoring themselves (§32.65)
  if ('mode' in policy) {
    return policy['mode'] === 'none'
      ? Object.keys(policy).length === 1
        ? []
        : [{ path: 'reviewPolicy', reason: 'policy-not-an-object' }]
      : [{ path: 'reviewPolicy', reason: 'policy-not-an-object' }]
  }
  unknownKeys(issues, policy, 'reviewPolicy', ['normal', 'escalation'])
  const seen = new Set<string>()
  checkRoute(issues, policy, 'normal', seen)
  checkRoute(issues, policy, 'escalation', seen)

  const normal = (policy['normal'] as { stages?: unknown } | undefined)?.stages
  if (!Array.isArray(normal) || normal.length === 0) {
    // Every reviewed question carries an ordinary route, administrative ones
    // included. What an administrative question's appeals walk is its
    // escalation route, which the item's own validation requires of a
    // question that records facts (§15, §32.62).
    issues.push({ path: 'reviewPolicy.normal.stages', reason: 'policy-stages-required' })
  }
  return issues
}

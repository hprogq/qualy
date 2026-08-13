// The review policy an item revision may store, held to what the review
// engine actually implements.
//
// The grammar is deliberately a single shape: one roleAt stage, quorum any,
// terminal at that stage. Everything else in the frozen policy language
// (more stages, nearestRole, all/atLeast, later terminals) is rejected here
// - and so is any key the shape does not name, at every level - so that
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

export const validateReviewPolicy = (
  _entrySource: 'student' | 'administrative',
  policy: unknown,
): readonly PolicyIssue[] => {
  if (!isRecord(policy)) return [{ path: 'reviewPolicy', reason: 'policy-not-an-object' }]

  const issues: PolicyIssue[] = []
  const stages = policy['stages']
  if (!Array.isArray(stages) || stages.length !== 1) {
    issues.push({ path: 'reviewPolicy.stages', reason: 'policy-single-stage' })
  }
  if (policy['normalTerminal'] !== 0) {
    issues.push({ path: 'reviewPolicy.normalTerminal', reason: 'policy-terminal-first' })
  }
  unknownKeys(issues, policy, 'reviewPolicy', ['stages', 'normalTerminal'])
  if (!Array.isArray(stages)) return issues

  for (const [index, stage] of stages.entries()) {
    const at = `reviewPolicy.stages[${index}]`
    if (!isRecord(stage)) {
      issues.push({ path: at, reason: 'policy-not-an-object' })
      continue
    }
    unknownKeys(issues, stage, at, ['selector', 'quorum'])
    const selector = stage['selector']
    if (!isRecord(selector) || selector['kind'] !== 'roleAt') {
      issues.push({ path: `${at}.selector`, reason: 'policy-selector-role-at' })
    } else {
      unknownKeys(issues, selector, `${at}.selector`, ['kind', 'nodeTypeId', 'roleIds'])
      if (typeof selector['nodeTypeId'] !== 'string' || !UUID.test(selector['nodeTypeId'])) {
        issues.push({ path: `${at}.selector.nodeTypeId`, reason: 'policy-node-type-required' })
      }
      const roleIds = selector['roleIds']
      if (
        !Array.isArray(roleIds) ||
        roleIds.length === 0 ||
        roleIds.some((roleId) => typeof roleId !== 'string' || !UUID.test(roleId))
      ) {
        issues.push({ path: `${at}.selector.roleIds`, reason: 'policy-roles-required' })
      }
    }
    const quorum = stage['quorum']
    if (!isRecord(quorum) || quorum['type'] !== 'any') {
      issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-any' })
    } else {
      unknownKeys(issues, quorum, `${at}.quorum`, ['type'])
    }
  }
  return issues
}

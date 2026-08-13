// The review policy an item revision may store, held to what the review
// engine actually implements.
//
// The grammar is deliberately a single shape: one roleAt stage, quorum any,
// terminal at that stage. Everything else in the frozen policy language
// (more stages, nearestRole, all/atLeast, later terminals) is rejected here
// so that widening the engine later means accepting more configurations,
// never reinterpreting stored ones.
//
// Administrative items store an empty policy on purpose. Their entries are
// the organization's own assertions - recorded as confirmed fact, no review
// instance is ever built - and a chain nobody would walk is a config lie.

export interface PolicyIssue {
  readonly path: string
  readonly reason: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const validateReviewPolicy = (
  entrySource: 'student' | 'administrative',
  policy: unknown,
): readonly PolicyIssue[] => {
  if (!isRecord(policy)) return [{ path: 'reviewPolicy', reason: 'policy-not-an-object' }]

  if (entrySource === 'administrative') {
    return Object.keys(policy).length === 0
      ? []
      : [{ path: 'reviewPolicy', reason: 'policy-empty-for-administrative' }]
  }

  const issues: PolicyIssue[] = []
  const stages = policy['stages']
  if (!Array.isArray(stages) || stages.length !== 1) {
    issues.push({ path: 'reviewPolicy.stages', reason: 'policy-single-stage' })
  }
  if (policy['normalTerminal'] !== 0) {
    issues.push({ path: 'reviewPolicy.normalTerminal', reason: 'policy-terminal-first' })
  }
  const known = new Set(['stages', 'normalTerminal'])
  for (const key of Object.keys(policy)) {
    if (!known.has(key)) issues.push({ path: `reviewPolicy.${key}`, reason: 'policy-unknown-key' })
  }
  if (!Array.isArray(stages)) return issues

  for (const [index, stage] of stages.entries()) {
    const at = `reviewPolicy.stages[${index}]`
    if (!isRecord(stage)) {
      issues.push({ path: at, reason: 'policy-not-an-object' })
      continue
    }
    const selector = stage['selector']
    if (!isRecord(selector) || selector['kind'] !== 'roleAt') {
      issues.push({ path: `${at}.selector`, reason: 'policy-selector-role-at' })
    } else {
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
    }
  }
  return issues
}

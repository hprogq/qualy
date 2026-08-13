// The review policy an item revision may store: the frozen policy language
// of assessment-design §14, and nothing outside it.
//
// One chain per item, ordered from the nearest reviewer outward, with
// `normalTerminal` marking where the ordinary flow ends - the stages beyond
// it are the doubt chain the same list already describes, walked only when
// somebody escalates. Selectors are `roleAt` (resolve the nearest unit of a
// kind and read the roles anchored exactly there) and `nearestRole` (walk up
// for the nearest holder of one role, for the roles that genuinely inherit).
// Quorum is any | all | atLeast(n). Unknown keys are refused at every level,
// so widening the engine later means accepting more configurations, never
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

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

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

const checkQuorum = (issues: PolicyIssue[], stage: Record<string, unknown>, at: string) => {
  const quorum = stage['quorum']
  if (!isRecord(quorum)) {
    issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-type' })
    return
  }
  if (quorum['type'] === 'any') {
    unknownKeys(issues, quorum, `${at}.quorum`, ['type'])
    return
  }
  if (quorum['type'] === 'all' || quorum['type'] === 'atLeast') {
    // Named by the grammar, not yet counted by the engine: a panel is
    // snapshotted on arrival and votes are tallied against it (§14, §32.28),
    // and until that exists a stored `all` would be run as `any` - a
    // configuration that means something other than it says. Refused here so
    // that building the counting later means deleting this branch, never
    // reinterpreting what somebody already saved.
    issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-not-counted' })
    return
  }
  issues.push({ path: `${at}.quorum`, reason: 'policy-quorum-type' })
}

export const validateReviewPolicy = (
  _entrySource: 'student' | 'administrative',
  policy: unknown,
): readonly PolicyIssue[] => {
  if (!isRecord(policy)) return [{ path: 'reviewPolicy', reason: 'policy-not-an-object' }]

  const issues: PolicyIssue[] = []
  unknownKeys(issues, policy, 'reviewPolicy', ['stages', 'normalTerminal'])
  const stages = policy['stages']
  if (!Array.isArray(stages) || stages.length === 0) {
    issues.push({ path: 'reviewPolicy.stages', reason: 'policy-stages-required' })
  }
  const terminal = policy['normalTerminal']
  if (
    typeof terminal !== 'number' ||
    !Number.isInteger(terminal) ||
    terminal < 0 ||
    (Array.isArray(stages) && terminal > stages.length - 1)
  ) {
    // where the ordinary flow ends has to be a stage the chain actually has,
    // or an approval would have nowhere to land
    issues.push({ path: 'reviewPolicy.normalTerminal', reason: 'policy-terminal-in-chain' })
  }
  if (!Array.isArray(stages)) return issues

  for (const [index, stage] of stages.entries()) {
    const at = `reviewPolicy.stages[${index}]`
    if (!isRecord(stage)) {
      issues.push({ path: at, reason: 'policy-not-an-object' })
      continue
    }
    unknownKeys(issues, stage, at, ['selector', 'quorum'])
    checkSelector(issues, stage, at)
    checkQuorum(issues, stage, at)
  }
  return issues
}

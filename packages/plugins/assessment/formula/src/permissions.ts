import { message } from '@qualy/i18n-contract'
import type { PermissionDefinition } from '@qualy/rbac-contract'

// One permission: the whole life of a scoring function at its owning node.
// Which batches a published version may be BOUND to is a separate question
// answered when binding arrives (owner node against batch anchors), not a
// permission here.

export const permissions = [
  {
    code: 'assessment.formula.manage',
    name: message('assessment-formula/permission/manage', 'Manage scoring formulas'),
    description: message(
      'assessment-formula/permission-hint/manage',
      'Write, test, publish and archive scoring formulas owned by this node.',
    ),
    groupKey: 'assessment',
    group: message('assessment-formula/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
] as const satisfies readonly PermissionDefinition[]

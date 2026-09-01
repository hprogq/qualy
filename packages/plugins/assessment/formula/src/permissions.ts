import { message } from '@qualy/i18n-contract'
import type { PermissionDefinition } from '@qualy/rbac-contract'

// One permission: whether a person may write scoring formulas at all.
//
// Tenant-wide, because what somebody authors belongs to THEM rather than to
// a unit. Which formulas are theirs is a different question with a different
// answer - the row's own `created_by` - and merging the two is what the
// owning-node model used to do. Holding this grants nothing over anybody
// else's work; losing it closes the whole authoring plane, not just the
// create button.
//
// Binding a published version to a question is not here: that is configuring
// a round, answered by the round's own permission plus authorship.

export const permissions = [
  {
    code: 'assessment.formula.author',
    name: message('assessment-formula/permission/author', 'Write scoring formulas'),
    description: message(
      'assessment-formula/permission-hint/author',
      'Write, test, publish and archive your own scoring formulas.',
    ),
    groupKey: 'assessment',
    group: message('assessment-formula/permission-group/assessment', 'Assessment'),
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]

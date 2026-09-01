import { message } from '@qualy/i18n-contract'
import type { PermissionDefinition } from '@qualy/rbac-contract'

// Two permissions, answering two questions that must not merge.
//
// `author` is the first: whether a person may write scoring formulas at all.
// Tenant-wide, because what somebody authors belongs to THEM rather than to
// a unit. Which formulas are theirs is a different question with a different
// answer - the row's own `created_by` - and merging the two is what the
// owning-node model used to do. Holding this grants nothing over anybody
// else's work; losing it closes the whole authoring plane, not just the
// create button.
//
// `share` is the second: whether somebody may offer what they wrote to the
// authors working under a given unit. Org-node scoped, because an audience
// IS a place. Holding it grants nothing over anybody else's formulas either,
// and it is needed only to WIDEN an audience - narrowing one is always the
// author's to do, or revoking the permission would strand them unable to
// take back what they had offered.
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
  {
    code: 'assessment.formula.share',
    name: message('assessment-formula/permission/share', 'Share scoring formulas'),
    description: message(
      'assessment-formula/permission-hint/share',
      'Offer your published formulas to the authors working under this unit.',
    ),
    groupKey: 'assessment',
    group: message('assessment-formula/permission-group/assessment', 'Assessment'),
    target: 'org-node',
  },
] as const satisfies readonly PermissionDefinition[]

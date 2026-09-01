import { Schema } from 'effect'
import { message } from '@qualy/i18n-contract'
import { AuditAction } from '@qualy/audit-contract/action'

// Only what leaves no other trace. Publication is deliberately absent: a
// published version IS the domain history - immutable row, publisher and
// instant on it - and history is not copied into the trail. The draft, by
// contrast, is mutable in place, and archiving flips one column; without
// these actions neither would be answerable later.

export const FormulaFunctionCreated = AuditAction.define({
  code: 'assessment.formula.create',
  target: 'assessment.formula',
  // 2: the owning node it used to record is not a fact about a formula any
  // more - authorship is, and the audit row already carries the actor
  version: 2,
  name: message('assessment-formula/audit/create', 'Create scoring formula'),
  details: Schema.Struct({}),
})

export const FormulaDraftReplaced = AuditAction.define({
  code: 'assessment.formula.draft.update',
  target: 'assessment.formula',
  version: 1,
  name: message('assessment-formula/audit/draft-update', 'Update formula draft'),
  details: Schema.Struct({ draftRevision: Schema.Number }),
})

export const FormulaFunctionArchived = AuditAction.define({
  code: 'assessment.formula.archive',
  target: 'assessment.formula',
  version: 1,
  name: message('assessment-formula/audit/archive', 'Archive scoring formula'),
  details: Schema.Struct({}),
})

export const FormulaFunctionRestored = AuditAction.define({
  code: 'assessment.formula.restore',
  target: 'assessment.formula',
  version: 1,
  name: message('assessment-formula/audit/restore', 'Restore scoring formula'),
  details: Schema.Struct({}),
})

export const formulaActions = [
  FormulaFunctionCreated,
  FormulaDraftReplaced,
  FormulaFunctionArchived,
  FormulaFunctionRestored,
] as const

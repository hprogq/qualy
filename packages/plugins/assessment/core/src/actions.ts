import { Schema } from 'effect'
import { message } from '@qualy/i18n-contract'
import { AuditAction } from '@qualy/audit-contract/action'

// The assessment domain's audit actions - deliberately few. Nearly every
// administrative write here already leaves a domain-history row with its
// actor (config revisions, lifecycle events, phase events, roster imports),
// and the design rule is that history is not copied into the trail. What is
// declared here is exactly what leaves no trace at all: a batch coming into
// existence, and a draft leaving it.

export const BatchCreated = AuditAction.define({
  code: 'assessment.batch.create',
  target: 'assessment.batch',
  version: 1,
  name: message('assessment/audit/batch-create', 'Create assessment batch'),
  details: Schema.Struct({ scopeNodeCount: Schema.Number }),
})

export const BatchDeleted = AuditAction.define({
  code: 'assessment.batch.delete',
  target: 'assessment.batch',
  version: 1,
  name: message('assessment/audit/batch-delete', 'Delete assessment batch'),
  details: Schema.Struct({}),
})

export const assessmentActions = [BatchCreated, BatchDeleted] as const

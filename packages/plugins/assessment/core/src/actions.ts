import { Schema } from 'effect'
import { AuditAction } from '@qualy/audit-contract/action'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

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
  name: text(m.audit_batchCreate),
  details: Schema.Struct({ scopeNodeCount: Schema.Number }),
})

export const BatchDeleted = AuditAction.define({
  code: 'assessment.batch.delete',
  target: 'assessment.batch',
  version: 1,
  name: text(m.audit_batchDelete),
  details: Schema.Struct({}),
})

export const assessmentActions = [BatchCreated, BatchDeleted] as const

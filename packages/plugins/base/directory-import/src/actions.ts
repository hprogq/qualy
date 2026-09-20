import { Schema } from 'effect'
import { message } from '@qualy/i18n-contract'
import { AuditAction } from '@qualy/audit-contract/action'

// The directory import's audit actions. The people and units created are
// each audited by auth and org as they are created; these three record the
// bulk act itself - what one press did, and what was later done to it.

const id = Schema.String

export const ImportCommitted = AuditAction.define({
  code: 'directory.import.commit',
  target: 'directory.import',
  version: 1,
  name: message('directory-import/audit/commit', 'Import users'),
  details: Schema.Struct({
    userTypeId: id,
    anchorNodeId: id,
    createdUsers: Schema.Number,
    existingUsers: Schema.Number,
    createdNodes: Schema.Number,
    reusedNodes: Schema.Number,
  }),
})

export const ImportReversed = AuditAction.define({
  code: 'directory.import.reverse',
  target: 'directory.import',
  version: 1,
  name: message('directory-import/audit/reverse', 'Reverse a user import'),
  details: Schema.Struct({ retired: Schema.Number, skipped: Schema.Number }),
})

export const ImportNodesCleaned = AuditAction.define({
  code: 'directory.import.clean-nodes',
  target: 'directory.import',
  version: 1,
  name: message('directory-import/audit/clean-nodes', 'Remove unused units of an import'),
  details: Schema.Struct({ deleted: Schema.Number, retained: Schema.Number }),
})

export const directoryImportActions = [ImportCommitted, ImportReversed, ImportNodesCleaned] as const

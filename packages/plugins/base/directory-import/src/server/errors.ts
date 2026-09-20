import { Schema } from 'effect'

// The directory import's failures, as tagged errors on the wire.

/** one thing wrong with a file, a mapping or a row */
const importIssue = Schema.Struct({
  rowNo: Schema.NullOr(Schema.Number),
  field: Schema.NullOr(Schema.String),
  severity: Schema.Literals(['error', 'warning']),
  reason: Schema.String,
  detail: Schema.optional(Schema.String),
})

/** the import named does not exist, or is not this reader's to see */
export class UserImportNotFound extends Schema.TaggedError<UserImportNotFound>()(
  'USER_IMPORT_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserImportNotFound' },
) {}

/** the file, the mapping or the rows have problems; every one is listed */
export class UserImportInvalid extends Schema.TaggedError<UserImportInvalid>()(
  'USER_IMPORT_INVALID',
  { issues: Schema.Array(importIssue) },
  { httpApiStatus: 400, identifier: 'UserImportInvalid' },
) {}

/** the mapping cannot be read as a chain of units, in one word for why */
export class UserImportMappingInvalid extends Schema.TaggedError<UserImportMappingInvalid>()(
  'USER_IMPORT_MAPPING_INVALID',
  {
    reason: Schema.String,
    /** what the reason is about: a column letter, a type id, a node id */
    subject: Schema.NullOr(Schema.String),
  },
  { httpApiStatus: 400, identifier: 'UserImportMappingInvalid' },
) {}

/** the tree or the people moved since the preview: look again before committing */
export class UserImportPlanChanged extends Schema.TaggedError<UserImportPlanChanged>()(
  'USER_IMPORT_PLAN_CHANGED',
  {},
  { httpApiStatus: 409, identifier: 'UserImportPlanChanged' },
) {}

/** the staged file is not there to read, or is not this caller's */
export class UserImportSourceUnavailable extends Schema.TaggedError<UserImportSourceUnavailable>()(
  'USER_IMPORT_SOURCE_UNAVAILABLE',
  {},
  { httpApiStatus: 409, identifier: 'UserImportSourceUnavailable' },
) {}

/** the same upload was already imported; a new import needs a new upload */
export class UserImportSourceUsed extends Schema.TaggedError<UserImportSourceUsed>()(
  'USER_IMPORT_SOURCE_USED',
  {},
  { httpApiStatus: 409, identifier: 'UserImportSourceUsed' },
) {}

export const importConstraints = {
  uq_directory_imports_source: () => new UserImportSourceUsed(),
}

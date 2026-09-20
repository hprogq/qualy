import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import {
  BadRequest,
  boundedText,
  numberedPageOf,
  numberedPageQuery,
  trimmedName,
  uuidInput,
} from '@qualy/api-kit/schema'
import { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'
import { Authenticated } from '@qualy/auth-contract/session'
import {
  UserImportInvalid,
  UserImportMappingInvalid,
  UserImportNotFound,
  UserImportPlanChanged,
  UserImportSourceUnavailable,
  UserImportSourceUsed,
} from './server/errors.ts'

// The directory import api, as definitions only. Paths are frozen.
//
// The shape follows the administrative import's: a file is staged through a
// storage ticket, inspected, mapped, previewed, and committed under the
// fingerprint the preview handed back. What is committed is a record that
// never goes away; reversing it retires the people it created, and cleaning
// it takes away the units it created that nothing uses.

const configJson = Schema.Unknown

/** where a spreadsheet cell's letters point */
const column = Schema.String.check(Schema.isPattern(/^[A-Z]{1,3}$/))

/** one level of the tree read per row: a unit type and the column its names are in */
const orgLevel = Schema.Struct({ orgTypeId: uuidInput, column })

export const importMapping = Schema.Struct({
  displayName: Schema.Struct({ column }),
  businessNo: Schema.Struct({ column }),
  organization: Schema.Struct({
    /** the unit every row stands under; null for the tenant's root */
    anchorNodeId: Schema.NullOr(uuidInput),
    /** the levels below the anchor, in any order: the grammar fixes it */
    levels: Schema.Array(orgLevel).check(Schema.isMaxLength(16)),
  }),
})

const importRequest = Schema.Struct({
  attachmentId: uuidInput,
  sheet: trimmedName(255),
  headerRow: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  userTypeId: uuidInput,
  mapping: importMapping,
})

const importIssue = Schema.Struct({
  rowNo: Schema.NullOr(Schema.Number),
  field: Schema.NullOr(Schema.String),
  severity: Schema.Literals(['error', 'warning']),
  reason: Schema.String,
  detail: Schema.optional(Schema.String),
})

const chainLevel = Schema.Struct({
  orgTypeId: Schema.String,
  orgTypeName: Schema.String,
  source: Schema.Literals(['root', 'fixed-node', 'column']),
  /** the fixed unit's name, or the column letter */
  detail: Schema.String,
})

const importPreview = Schema.Struct({
  chain: Schema.Array(chainLevel),
  nodes: Schema.Struct({
    reused: Schema.Number,
    created: Schema.Number,
    conflicts: Schema.Number,
  }),
  users: Schema.Struct({
    create: Schema.Number,
    existing: Schema.Number,
    warnings: Schema.Number,
    errors: Schema.Number,
  }),
  rowCount: Schema.Number,
  /** the first hundred problems, row by row */
  issues: Schema.Array(importIssue),
  /** what would be created, as paths under the anchor; the first hundred */
  createdNodes: Schema.Array(Schema.String),
  planFingerprint: Schema.String,
})

const importSummary = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  sizeBytes: Schema.String,
  actorId: Schema.NullOr(Schema.String),
  actorName: Schema.NullOr(Schema.String),
  userTypeName: Schema.NullOr(Schema.String),
  anchorPath: Schema.String,
  chain: Schema.Array(Schema.String),
  sourceRowCount: Schema.Number,
  createdUserCount: Schema.Number,
  existingUserCount: Schema.Number,
  createdNodeCount: Schema.Number,
  reusedNodeCount: Schema.Number,
  createdAt: Schema.String,
  /** what the people it created are now */
  standing: Schema.Struct({ living: Schema.Number, deleted: Schema.Number }),
})

const importEvent = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['reversed', 'nodes-cleaned']),
  actorId: Schema.NullOr(Schema.String),
  actorName: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  affectedUserCount: Schema.Number,
  deletedNodeCount: Schema.Number,
  retainedNodeCount: Schema.Number,
  createdAt: Schema.String,
})

const importNode = Schema.Struct({
  id: Schema.String,
  orgNodeId: Schema.NullOr(Schema.String),
  path: Schema.String,
  depth: Schema.Number,
  disposition: Schema.Literals(['created', 'reused']),
  /** whether the unit is still there */
  present: Schema.Boolean,
})

const importRow = Schema.Struct({
  sourceRowNo: Schema.Number,
  userId: Schema.NullOr(Schema.String),
  businessNo: Schema.String,
  displayName: Schema.String,
  orgPath: Schema.String,
  disposition: Schema.Literals(['created', 'existing']),
  standing: Schema.Literals(['active', 'disabled', 'deleted', 'missing']),
})

export const directoryApiGroup = HttpApiGroup.make('directory')
  .add(
    // what the screen needs to map a file: the kinds of person, the type
    // grammar and the root, in one answer behind the one permission
    HttpApiEndpoint.get('getUserImportOptions', '/iam/user-import-options', {
      success: Schema.Struct({
        userTypes: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
        orgTypes: Schema.Array(
          Schema.Struct({ id: Schema.String, name: Schema.String, sortOrder: Schema.Number }),
        ),
        rules: Schema.Array(
          Schema.Struct({ parentTypeId: Schema.String, childTypeId: Schema.String }),
        ),
        root: Schema.NullOr(
          Schema.Struct({ id: Schema.String, name: Schema.String, orgTypeId: Schema.String }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('prepareUserImportUpload', '/iam/user-import-uploads', {
      payload: Schema.Struct({
        filename: trimmedName(255),
        declaredMime: boundedText(127),
        /** decimal bytes; a string because numbers this size deserve exactness */
        size: Schema.String.check(Schema.isPattern(/^[1-9]\d{0,11}$/)),
      }),
      success: Schema.Struct({
        reservationId: Schema.String,
        attachmentId: Schema.String,
        grant: Schema.Struct({ driver: Schema.String, payload: configJson }),
        expiresAt: Schema.String,
      }),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post(
      'completeUserImportUpload',
      '/iam/user-import-uploads/:reservationId/complete',
      {
        params: Schema.Struct({ reservationId: uuidInput }),
        success: Schema.Struct({
          id: Schema.String,
          filename: Schema.String,
          size: Schema.String,
        }),
        error: [UserImportSourceUnavailable, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    // the file's sheets, and one of them read as a table from a header row
    HttpApiEndpoint.get(
      'inspectUserImportUpload',
      '/iam/user-import-uploads/:attachmentId/workbook',
      {
        params: Schema.Struct({ attachmentId: uuidInput }),
        query: Schema.Struct({
          sheet: Schema.optional(Schema.String.check(Schema.isMaxLength(255))),
          headerRow: Schema.optional(Schema.String.check(Schema.isPattern(/^[1-9]\d{0,3}$/))),
        }),
        success: Schema.Struct({
          sheets: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              rowCount: Schema.Number,
              columnCount: Schema.Number,
            }),
          ),
          table: Schema.Struct({
            sheet: Schema.String,
            headerRow: Schema.Number,
            headers: Schema.Array(Schema.Struct({ column, text: Schema.String })),
            rowCount: Schema.Number,
            sample: Schema.Array(
              Schema.Struct({
                rowNo: Schema.Number,
                cells: Schema.Record(Schema.String, Schema.String),
              }),
            ),
          }),
        }),
        error: [
          UserImportInvalid,
          UserImportSourceUnavailable,
          UserImportSourceUsed,
          AccessDenied,
          BadRequest,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('previewUserImport', '/iam/user-import-previews', {
      payload: importRequest,
      success: importPreview,
      error: [
        UserImportInvalid,
        UserImportMappingInvalid,
        UserImportSourceUnavailable,
        UserImportSourceUsed,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('commitUserImport', '/iam/user-imports', {
      payload: Schema.Struct({
        ...importRequest.fields,
        expectedPlanFingerprint: Schema.String,
      }),
      success: Schema.Struct({
        importId: Schema.String,
        createdUsers: Schema.Number,
        existingUsers: Schema.Number,
        createdNodes: Schema.Number,
        reusedNodes: Schema.Number,
      }),
      error: [
        UserImportInvalid,
        UserImportMappingInvalid,
        UserImportPlanChanged,
        UserImportSourceUnavailable,
        UserImportSourceUsed,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listUserImports', '/iam/user-imports', {
      // walked by page number: somebody looking for last term's import goes
      // to the last page, not through every one before it
      query: Schema.Struct({ ...numberedPageQuery }),
      success: numberedPageOf(importSummary),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getUserImport', '/iam/user-imports/:importId', {
      params: Schema.Struct({ importId: uuidInput }),
      success: Schema.Struct({
        import: importSummary,
        events: Schema.Array(importEvent),
        nodes: Schema.Array(importNode),
      }),
      error: [UserImportNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listUserImportRows', '/iam/user-imports/:importId/rows', {
      params: Schema.Struct({ importId: uuidInput }),
      query: Schema.Struct({ ...numberedPageQuery }),
      success: numberedPageOf(importRow),
      error: [UserImportNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // what reversing would do, before it is done: nothing is written
    HttpApiEndpoint.post(
      'previewUserImportReversal',
      '/iam/user-imports/:importId/reversal-previews',
      {
        params: Schema.Struct({ importId: uuidInput }),
        success: Schema.Struct({
          toRetire: Schema.Number,
          alreadyGone: Schema.Number,
          withIdentities: Schema.Number,
          withGrants: Schema.Number,
        }),
        error: [UserImportNotFound, AccessDenied],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('reverseUserImport', '/iam/user-imports/:importId/reversals', {
      params: Schema.Struct({ importId: uuidInput }),
      payload: Schema.Struct({ reason: boundedText(500) }),
      success: Schema.Struct({ retired: Schema.Number, skipped: Schema.Number }),
      error: [UserImportNotFound, LastAdministrator, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // garbage collection, retryable: every unit this import created that
    // nothing uses any more goes; the rest are named with why they stay
    HttpApiEndpoint.post('cleanUserImportNodes', '/iam/user-imports/:importId/node-cleanups', {
      params: Schema.Struct({ importId: uuidInput }),
      success: Schema.Struct({
        deleted: Schema.Number,
        retained: Schema.Array(
          Schema.Struct({
            orgNodeId: Schema.String,
            path: Schema.String,
            reason: Schema.Literals(['has-children', 'in-use', 'missing']),
          }),
        ),
      }),
      error: [UserImportNotFound, AccessDenied],
    }).middleware(Authenticated),
  )

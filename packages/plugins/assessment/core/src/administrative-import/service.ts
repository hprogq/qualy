import { Clock, Effect, Result } from 'effect'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import type { AttachmentOpen, Storage } from '@qualy/plugin-storage/server'
import type { UploadTicket } from '@qualy/plugin-storage/upload'
import type { Principal } from '@qualy/rbac-contract'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
  AdministrativeImportInvalid,
  AdministrativeImportNotFound,
  AttachmentUnavailable,
  BatchNotFound,
  BatchReadOnly,
  DeterminationRefused,
  EntryActionRefused,
  ItemNotFound,
  ItemRevisionConflict,
  ScoringUnavailable,
} from '../errors.ts'
import type { AttachmentDescriptor } from '../attachment/service.ts'
import {
  recordAdministrativeEntryTx,
  voidAdministrativeEntryTx,
} from '../entry/administrative-write.ts'
import type { EntryStatus } from '../entry/db.ts'
import { itemOf, revisionOf as itemRevisionOf, revisionsByIdOf } from '../item/db.ts'
import { opensTo } from '../item/channels.ts'
import { boundEvidenceKeys, fillBoundEvidence } from '../scoring/bound-evidence.ts'
import { announce } from '../live/events.ts'
import {
  ScoringRuntimeCatalog,
  type BatchContext,
  type ItemPayloadInvalid,
  type ItemTypeDriver,
} from '../plugin.ts'
import { proveSettlements } from '../scoring/failure-boundary.ts'
import { readScoringPlan, type ScoringPlan } from '../scoring/plan.ts'
import { currentRecognitionsOfEntries } from '../scoring/recognition-db.ts'
import {
  canonicalRecognition,
  judgeRecognition,
  recognitionFormFields,
} from '../scoring/recognition.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import {
  effectiveEntryCounts,
  eventsOfImport,
  importDetailOf,
  importOf,
  importReachable,
  importRowsPage,
  importsOfBatchPage,
  insertImport,
  importOfAttachment,
  insertImportEvent,
  insertImportRows,
  resolveImportParticipants,
  reversalCandidatesOf,
  standingOfImports,
  type ImportStanding,
} from './db.ts'
import { provenColumns } from './columns.ts'
import { judgeRows, markDuplicateFacts, summarise } from './preview.ts'
import { readSourceBytes, SourceUnreadable } from './read-source.ts'
import {
  buildAdministrativeWorkbook,
  parseAdministrativeWorkbook,
  WorkbookUnreadable,
} from './workbook.ts'

// Administrative facts in bulk: a workbook in, a whole import out or nothing,
// and afterwards the history of what each import did and the one way to take
// what is left of it back.
//
// Nothing here decides a fact a single record would decide differently. The
// writes and the withdrawals go through the same primitives the one-at-a-time
// doors use; what this module adds is reading a file, judging every row of it
// before any of it is written, and keeping the provenance.

/** one act's answer from the batch's authority and the phase gate */
export type ActionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly layer: string; readonly reason: string }

export interface AdministrativeImportDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  /** authority in the batch, then the phase gate, for one act */
  readonly authorize: (
    principal: Principal,
    code: string,
    batchId: string,
    ctx?: { readonly itemId?: string; readonly participantId?: string },
  ) => Effect.Effect<ActionDecision, BatchNotFound>
  /**
   * The recording authority and the phase gate for one question, asked once
   * and then answered per person: a phase that admits only some people is a
   * different answer for each row, and asking the database once a row would
   * price a two-thousand-row file at two thousand gate reads.
   */
  readonly recordGate: (
    principal: Principal,
    batchId: string,
    itemId: string,
  ) => Effect.Effect<(participantId: string) => ActionDecision, BatchNotFound>
  /** whether this person holds the recording authority in this round at all */
  readonly holdsRecord: (
    tenantId: string,
    batchId: string,
    userId: string,
  ) => Effect.Effect<boolean>
  readonly storage: Pick<
    Storage['Service'],
    'prepareUpload' | 'completeUpload' | 'open' | 'metadata' | 'bind'
  >
  /** the kinds of question, each the only reader of its own payloads */
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
  readonly parseRange: (text: string) => { start: string; end: string }
}

interface ImportIssue {
  readonly severity: 'error' | 'warning'
  readonly field: string | null
  readonly reason: string
  /** a calculator's own words, when the refusal is its */
  readonly detail?: string
}

/** what a preview answers, assembled */
export interface AdministrativeImportPreview {
  readonly item: { readonly id: string; readonly title: string; readonly revisionId: string }
  readonly summary: {
    readonly rows: number
    readonly valid: number
    readonly warnings: number
    readonly errors: number
  }
  readonly rows: readonly {
    readonly rowNo: number
    readonly businessNo: string
    readonly displayNameFromFile: string
    readonly matchedParticipant: {
      readonly id: string
      readonly displayName: string
      readonly businessNo: string | null
    } | null
    readonly payloadPreview: Record<string, unknown>
    readonly recognitionPreview: Record<string, unknown>
    readonly basis: string
    readonly issues: readonly ImportIssue[]
  }[]
  readonly canCommit: boolean
}

type Standing = Omit<ImportStanding, 'importId'>

/** the original file's identity, which is part of the list of names it holds */
export type AdministrativeImportSource =
  | { readonly available: false }
  | {
      readonly available: true
      readonly filename: string
      readonly size: string
      readonly integrity: { readonly algorithm: string; readonly value: string } | null
    }

/** one import in the history of a round */
export interface AdministrativeImportView {
  readonly id: string
  readonly item: { readonly id: string; readonly title: string }
  readonly source: AdministrativeImportSource
  readonly actor: { readonly id: string; readonly name: string } | null
  readonly createdAt: string
  readonly importedCount: number
  readonly standing: Standing
  /** what the next page starts after, in the order this list is read */
  readonly cursor: readonly [string, string]
}

/** one import, whole */
export interface AdministrativeImportDetail {
  readonly id: string
  readonly batchId: string
  readonly item: { readonly id: string; readonly title: string }
  readonly itemRevision: { readonly id: string; readonly revisionNo: number }
  readonly source: AdministrativeImportSource
  readonly actor: { readonly id: string; readonly name: string } | null
  readonly createdAt: string
  readonly defaultBasis: string | null
  readonly importedCount: number
  readonly standing: Standing
  readonly reversals: readonly {
    readonly id: string
    readonly actor: { readonly id: string; readonly name: string } | null
    readonly reason: string | null
    readonly affectedCount: number
    readonly createdAt: string
  }[]
  readonly capabilities: {
    /** something is still in effect and this reader may withdraw all of it now */
    readonly reverse: boolean
  }
}

/** one row of an import, and the fact it became */
export interface AdministrativeImportRowView {
  readonly rowNo: number
  readonly entryId: string
  readonly participant: {
    readonly id: string
    readonly displayName: string
    readonly businessNo: string | null
  }
  /** what the file said, kept as written */
  readonly businessNoSnapshot: string | null
  readonly displayNameSnapshot: string | null
  readonly status: EntryStatus
  readonly recognition: {
    readonly id: string
    readonly itemRevisionId: string
    readonly values: Record<string, unknown>
    readonly fields: readonly { readonly id: string; readonly schema: unknown }[]
  } | null
}

export interface AdministrativeImportMethods {
  /**
   * The workbook for one question as it stands, built rather than stored.
   *
   * Admission is the same one the recording itself asks for: a live
   * administrative question in a round this caller may record on. A
   * template is a projection of the current version and carries which
   * version that was, which is what lets the import refuse a file filled
   * in against a question that has since moved.
   */
  readonly administrativeImportTemplate: (
    tenantId: string,
    itemId: string,
    locale: string,
    as: Principal,
  ) => Effect.Effect<
    { bytes: Uint8Array; filename: string },
    ItemNotFound | EntryActionRefused | AccessDenied
  >
  /** a door for the workbook itself, which is not evidence backing a claim */
  readonly prepareAdministrativeImportUpload: (
    tenantId: string,
    batchId: string,
    input: {
      itemId: string
      filename: string
      declaredMime: string
      size: string
    },
    as: Principal,
  ) => Effect.Effect<
    UploadTicket,
    BatchNotFound | ItemNotFound | BatchReadOnly | EntryActionRefused | AccessDenied
  >
  readonly completeAdministrativeImportUpload: (
    tenantId: string,
    reservationId: string,
    as: Principal,
  ) => Effect.Effect<
    { id: string; filename: string; declaredMime: string; size: string; status: string },
    AttachmentUnavailable | EntryActionRefused
  >
  /**
   * What a workbook would do, worked out and thrown away.
   *
   * Creates no import: an import is a thing that happened, and nothing has
   * happened yet. The file is re-read from the staged attachment rather
   * than taken from the browser, or the original kept as provenance and
   * the rows actually written are two different documents.
   */
  readonly previewAdministrativeImport: (
    tenantId: string,
    batchId: string,
    input: {
      attachmentId: string
      itemId: string
      expectedItemRevisionId: string
      defaultBasis?: string
    },
    as: Principal,
  ) => Effect.Effect<
    AdministrativeImportPreview,
    | BatchNotFound
    | ItemNotFound
    | ItemRevisionConflict
    | BatchReadOnly
    | EntryActionRefused
    | AttachmentUnavailable
    | AdministrativeImportInvalid
    | ScoringUnavailable
    | AccessDenied,
    ScoringRuntimeCatalog
  >
  /**
   * The import itself: every row, or none of them.
   *
   * The preview is a courtesy to whoever filled the file in, never an
   * authorization to write what it said - so the workbook is opened,
   * parsed and judged again here, and everything that could have moved
   * while it was being read is asked a second time under the batch lock.
   */
  readonly commitAdministrativeImport: (
    tenantId: string,
    batchId: string,
    input: {
      attachmentId: string
      itemId: string
      expectedItemRevisionId: string
      defaultBasis?: string
      confirmWarnings?: boolean
    },
    as: Principal,
  ) => Effect.Effect<
    { importId: string; importedCount: number },
    | BatchNotFound
    | ItemNotFound
    | ItemRevisionConflict
    | BatchReadOnly
    | EntryActionRefused
    | AttachmentUnavailable
    | AdministrativeImportInvalid
    | DeterminationRefused
    | ScoringUnavailable
    | AccessDenied,
    ScoringRuntimeCatalog
  >
  /**
   * The imports of a round, newest first, to anybody who may record in it.
   *
   * An import is the round's record: the office decided these facts, and the
   * person who uploaded the file is its provenance, not its owner. A later
   * administrator sees what was imported before their time, and the person
   * who imported it losing their post or their account changes nothing here.
   */
  readonly listAdministrativeImports: (
    tenantId: string,
    batchId: string,
    page: { after?: readonly [string, string]; limit: number },
    as: Principal,
  ) => Effect.Effect<readonly AdministrativeImportView[], BatchNotFound | AccessDenied>
  /**
   * One import, by the same rule the history is read by. An import in a
   * round this reader may not record in does not exist for them: telling
   * "not yours" from "no such import" would say where files are.
   */
  readonly getAdministrativeImport: (
    tenantId: string,
    importId: string,
    as: Principal,
  ) => Effect.Effect<AdministrativeImportDetail, AdministrativeImportNotFound>
  /** the rows of one import in the file's own order, each with the fact it became */
  readonly listAdministrativeImportRows: (
    tenantId: string,
    importId: string,
    page: { afterRowNo?: number; limit: number },
    as: Principal,
  ) => Effect.Effect<
    readonly AdministrativeImportRowView[],
    AdministrativeImportNotFound | AccessDenied
  >
  /**
   * The original workbook, opened.
   *
   * A class list is personal data a spreadsheet at a time, so the door is
   * stricter than the import's own: the reader must reach every person in
   * it, today. Knowing the import happened is the round's history; reading
   * the names is not, for somebody whose reach covers only part of the round.
   */
  readonly openAdministrativeImportSource: (
    tenantId: string,
    importId: string,
    as: Principal,
  ) => Effect.Effect<
    AttachmentOpen,
    AdministrativeImportNotFound | AccessDenied | AttachmentUnavailable
  >
  readonly describeAdministrativeImportSource: (
    tenantId: string,
    importId: string,
    as: Principal,
  ) => Effect.Effect<
    AttachmentDescriptor,
    AdministrativeImportNotFound | AccessDenied | AttachmentUnavailable
  >
  /**
   * Withdrawing everything an import created that is still in effect, all
   * of it or none.
   *
   * Only the facts the import's own rows point at: a fact recorded again by
   * hand after one of these was withdrawn is somebody's correction, and is
   * never reached by asking for "the current claim" of a person. Each
   * withdrawal is the single one, rule for rule; one that would be refused
   * refuses the whole reversal, and nothing moves.
   */
  readonly reverseAdministrativeImport: (
    tenantId: string,
    importId: string,
    input: { reason: string },
    as: Principal,
  ) => Effect.Effect<
    { affectedCount: number },
    AdministrativeImportNotFound | BatchReadOnly | EntryActionRefused | AdministrativeImportInvalid
  >
}

/**
 * The columns a workbook offers for a question's own fields.
 *
 * Asked of the question's driver, which is the only thing that knows what
 * its fields are: a key the payload keeps the answer under, and the schema
 * the answer is judged by - a choice with its words, a decimal with its
 * scale, a date held to the round. A field no cell can carry, such as a
 * file, is simply not offered.
 */
const evidenceFieldsOf = (
  driver: ItemTypeDriver,
  formConfig: unknown,
  batch: BatchContext,
  plan: ScoringPlan,
) =>
  (driver.bindableFields?.(formConfig, batch) ?? [])
    // a field the determination stands for is the determination's column,
    // not a second column that could only agree with it or contradict it
    .filter((one) => !boundEvidenceKeys(plan).has(one.payloadKey))
    .map((one) => ({
      key: one.payloadKey,
      schema: one.schema,
    }))

/** whether the question insists on material a workbook cannot carry */
const requiresAttachment = (formConfig: unknown): boolean => {
  const fields = (formConfig as { fields?: unknown } | null)?.fields
  if (!Array.isArray(fields)) return false
  return fields.some((raw) => {
    const field = raw as { type?: unknown; required?: unknown }
    return field.type === 'attachment' && field.required === true
  })
}

const standingOf = (counted: ImportStanding | undefined): Standing => ({
  approved: counted?.approved ?? 0,
  inReview: counted?.inReview ?? 0,
  rejected: counted?.rejected ?? 0,
  voided: counted?.voided ?? 0,
  other: counted?.other ?? 0,
})

const personOf = (id: string | null, name: string | null) =>
  id === null ? null : { id, name: name ?? '' }

const refusalOf = (issues: readonly (ImportIssue & { rowNo: number | null })[]) =>
  new AdministrativeImportInvalid({
    issues: issues.map((one) => ({
      rowNo: one.rowNo,
      field: one.field,
      severity: one.severity,
      reason: one.reason,
    })),
  })

export const makeAdministrativeImportMethods = (
  deps: AdministrativeImportDeps,
): AdministrativeImportMethods => {
  const { withDb, storage } = deps

  const dieQuery = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, Exclude<E, { _tag: 'QueryFailed' }>, R> =>
    effect.pipe(
      Effect.catchIf(
        (error): error is E & { _tag: 'QueryFailed' } =>
          typeof error === 'object' &&
          error !== null &&
          (error as { _tag?: string })._tag === 'QueryFailed',
        (error) => Effect.die(error),
      ),
    ) as never

  /**
   * The one admission every bulk administrative act passes through.
   *
   * Asked once, before a file is read, rather than per row: a live
   * administrative question in a round this caller may record on, with a
   * compiled plan to judge determinations against. Everything downstream is
   * about VALUES, and a value cannot be judged until it is known whose
   * question it answers.
   *
   * The phase gate is in here too, which is what stops a closed round being
   * written to through a spreadsheet after the form has stopped offering it.
   * A phase that admits only some people is not a refusal of the question:
   * which people it admits is asked of each row by name.
   */
  const administrativeQuestion = Effect.fn('Assessment.administrativeQuestion')(function* (
    tenantId: string,
    itemId: string,
    as: Principal,
  ) {
    const item = yield* dieQuery(withDb(itemOf(tenantId, itemId)))
    if (item === null) return yield* new ItemNotFound()
    if (item.status !== 'active') {
      return yield* new EntryActionRefused({ action: 'import', reason: 'item-not-active' })
    }
    const revision =
      item.currentRevisionId === null
        ? null
        : yield* dieQuery(withDb(itemRevisionOf(tenantId, item.currentRevisionId)))
    if (revision === null) {
      return yield* new EntryActionRefused({ action: 'import', reason: 'item-not-configured' })
    }
    if (!opensTo(revision.entryChannels, 'administrative')) {
      return yield* new EntryActionRefused({ action: 'import', reason: 'item-not-administrative' })
    }
    const driver = deps.itemTypes.get(item.itemType)
    if (driver === undefined) {
      return yield* new EntryActionRefused({ action: 'import', reason: 'item-type-not-installed' })
    }
    const batch = yield* dieQuery(withDb(oneBatch(tenantId, item.batchId)))
    if (batch === null) return yield* new ItemNotFound()
    const context: BatchContext = { materialRange: deps.parseRange(batch.materialRange) }
    const decision = yield* deps
      .authorize(as, 'assessment.entry.record', item.batchId, { itemId })
      .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', Effect.die))
    if (!decision.allowed && decision.reason !== 'participant-out-of-scope') {
      return yield* new EntryActionRefused({ action: 'import', reason: decision.reason })
    }
    const plan = yield* Effect.orDie(readScoringPlan(revision))
    return { item, revision, plan, driver, context }
  })

  /**
   * The part of an import a preview stops after and a commit carries on
   * from.
   *
   * Reading the file, judging every row and proving the arithmetic all
   * happen here, outside any transaction. That is the whole reason a commit
   * can afford to hold the batch lock: by the time it takes one, the only
   * work left is writing and one more look at what could have moved.
   */
  const previewOf = Effect.fn('Assessment.administrativeImportPreview')(function* (
    tenantId: string,
    batchId: string,
    input: {
      attachmentId: string
      itemId: string
      expectedItemRevisionId: string
      defaultBasis?: string
    },
    as: Principal,
    runtime: ScoringRuntimeCatalog['Service'],
  ) {
    const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
    if (!batch) return yield* new BatchNotFound()
    if (batch.status === 'archived') return yield* new BatchReadOnly()
    const ready = yield* administrativeQuestion(tenantId, input.itemId, as)
    if (ready.item.batchId !== batchId) return yield* new ItemNotFound()
    // the question the file was filled in against, before its contents
    // are read: a newly required field must say "the paper moved", not
    // "this cell is missing"
    if (ready.revision.id !== input.expectedItemRevisionId) {
      return yield* new ItemRevisionConflict({
        itemId: ready.item.id,
        currentRevisionId: ready.item.currentRevisionId,
      })
    }
    // no import can carry a file it cannot attach material for
    if (requiresAttachment(ready.revision.formConfig)) {
      return yield* new EntryActionRefused({ action: 'import', reason: 'attachment-required' })
    }

    // the bytes, read back from the store rather than taken from anybody
    const opened = yield* storage
      .open({ tenantId, attachmentId: input.attachmentId }, (meta) =>
        meta.ownerUserId === as.userId ? Effect.void : Effect.fail(new AttachmentUnavailable()),
      )
      .pipe(
        Effect.catchTags({
          STORAGE_ATTACHMENT_NOT_FOUND: () => new AttachmentUnavailable(),
          STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
        }),
      )
    const bytes = yield* readSourceBytes(opened).pipe(
      Effect.catch((error: SourceUnreadable) =>
        Effect.fail(
          new AdministrativeImportInvalid({
            issues: [{ rowNo: null, field: null, severity: 'error', reason: error.reason }],
          }),
        ),
      ),
    )
    const parsed = yield* Effect.tryPromise({
      try: () => parseAdministrativeWorkbook(bytes),
      catch: (error) =>
        new AdministrativeImportInvalid({
          issues: [
            {
              rowNo: error instanceof WorkbookUnreadable ? error.rowNo : null,
              field: error instanceof WorkbookUnreadable ? error.column : null,
              severity: 'error',
              reason: error instanceof WorkbookUnreadable ? error.reason : 'not-xlsx',
            },
          ],
        }),
    })
    // A template with nothing filled in is not an import of nothing, it is a
    // file the reader has not finished. Judged here rather than in the
    // parser, which reads a workbook without knowing what it is for - the
    // template this very endpoint hands out has no rows either.
    if (parsed.rows.length === 0) {
      return yield* new AdministrativeImportInvalid({
        issues: [{ rowNo: null, field: null, severity: 'error', reason: 'no-rows' }],
      })
    }
    // The metadata is not a credential, but it does say which question the
    // file believes it answers, and disagreement is the reader's mistake
    // rather than something to reconcile.
    //
    // Two different mistakes, and they are told apart because the way out
    // differs: a file built for another question was never this question's
    // to import, while a file built for this one whose form has since moved
    // is answering a version that no longer exists. Calling the first of
    // those "the form changed" sends somebody looking for a change nobody
    // made.
    if (parsed.metadata.batchId !== batchId || parsed.metadata.itemId !== ready.item.id) {
      return yield* new AdministrativeImportInvalid({
        issues: [
          { rowNo: null, field: null, severity: 'error', reason: 'template-for-another-item' },
        ],
      })
    }
    if (parsed.metadata.itemRevisionId !== ready.revision.id) {
      return yield* new ItemRevisionConflict({
        itemId: ready.item.id,
        currentRevisionId: ready.item.currentRevisionId,
      })
    }

    const numbers = [
      ...new Set(parsed.rows.map((row) => row.businessNo).filter((one) => one !== '')),
    ]
    const found = yield* dieQuery(
      withDb(
        resolveImportParticipants({
          tenantId,
          batchId,
          actorId: as.userId,
          businessNos: numbers,
        }),
      ),
    )
    const reachable = new Map(
      found.map((one) => [
        one.businessNo,
        { id: one.participantId, displayName: one.displayName, businessNo: one.businessNo },
      ]),
    )
    const held = yield* dieQuery(
      withDb(
        effectiveEntryCounts({
          tenantId,
          itemId: ready.item.id,
          participantIds: found.map((one) => one.participantId),
        }),
      ),
    )

    const recognitionFields = recognitionFormFields(ready.plan) ?? []
    const evidenceFields = evidenceFieldsOf(
      ready.driver,
      ready.revision.formConfig,
      ready.context,
      ready.plan,
    )
    // What each column MEANS, decided from the frozen revision rather than
    // read out of the file. The workbook may say where a field was put; a
    // hidden sheet saying what a word stands for is a hidden sheet rewriting
    // the reading the person saw.
    const layout = provenColumns(parsed, {
      locale: parsed.metadata.locale,
      evidence: evidenceFields,
      recognition: recognitionFields.map((field) => ({ id: field.id, schema: field.schema })),
    })
    if ('refusals' in layout) {
      return yield* new AdministrativeImportInvalid({
        issues: layout.refusals.map((refusal) => ({
          rowNo: null,
          field: refusal.field,
          severity: 'error' as const,
          reason: refusal.reason,
        })),
      })
    }
    const rows = judgeRows({
      parsed,
      columns: layout.columns,
      defaultBasis: input.defaultBasis ?? '',
      reachable,
      evidenceSchemas: new Map(evidenceFields.map((one) => [one.key, one.schema])),
      recognitionSchemas: new Map(recognitionFields.map((one) => [one.id, one.schema as never])),
      requiredRecognitionIds: recognitionFields.map((one) => one.id),
      held,
      maxEntries: ready.item.maxEntries,
      actorUserId: as.userId,
      participantUserIds: new Map(found.map((one) => [one.participantId, one.userId])),
    })

    // the phase, asked of each person by name: a supplementary phase that
    // admits some people refuses the others row by row, the way the single
    // record would refuse each of them
    const gate = yield* deps
      .recordGate(as, batchId, ready.item.id)
      .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', Effect.die))
    const admitted = rows.map((row) => {
      if (row.matchedParticipant === null) return row
      const decision = gate(row.matchedParticipant.id)
      if (decision.allowed) return row
      return {
        ...row,
        issues: [
          ...row.issues,
          { severity: 'error' as const, field: 'businessNo', reason: decision.reason },
        ],
      }
    })

    // The material held to the question's own form, by the same decoder the
    // single record passes through: required answers, dates inside the
    // round, a decimal's scale. What it hands back is the canonical payload,
    // and that - not the cell text - is what gets written.
    const decoded = yield* Effect.forEach(admitted, (row) =>
      row.issues.some((one) => one.severity === 'error')
        ? Effect.succeed(row)
        : Effect.result(
            ready.driver.decodePayload(
              ready.revision.formConfig,
              // the columns the file did not have: what the office
              // determined is what the filing side of a bound field says
              fillBoundEvidence(ready.plan, row.payload, row.recognition),
              ready.context,
            ),
          ).pipe(
            Effect.map((result) =>
              Result.isSuccess(result)
                ? { ...row, payload: result.success as Record<string, unknown> }
                : {
                    ...row,
                    issues: [
                      ...row.issues,
                      ...(result.failure as ItemPayloadInvalid).issues.map((issue) => ({
                        severity: 'error' as const,
                        field: `evidence.${issue.field}`,
                        reason: issue.reason,
                      })),
                    ],
                  },
            ),
          ),
    )

    // The determination held to the question's own contract, the one way the
    // single record is: judged by the same judge, then stored the one way it
    // means. A spreadsheet does not get a second validator - "3.0" and "3.00"
    // written by two doors would make every later comparison a fact about who
    // typed it. And a question that asks nothing still gets a determination,
    // `{}`, because the table refuses an approved fact without one.
    const settled = decoded.map((row) => {
      if (row.issues.some((one) => one.severity === 'error')) return row
      const wrong = judgeRecognition(ready.plan.recognitionSchemas, row.recognition)
      if (wrong.length > 0) {
        return {
          ...row,
          issues: [
            ...row.issues,
            ...wrong.map((issue) => ({
              severity: 'error' as const,
              field:
                issue.recognitionId === '' ? 'recognition' : `recognition.${issue.recognitionId}`,
              reason: issue.reason,
            })),
          ],
        }
      }
      const canonical = canonicalRecognition(ready.plan.recognitionSchemas, row.recognition)
      return { ...row, recognition: canonical, recognitionHash: hashCanonicalJson(canonical) }
    })

    // here rather than in the row reader, because only now are two rows
    // comparable: the payload has been through the question's own decoder
    // and the determination through its canonicaliser
    const marked = markDuplicateFacts(settled)

    // the arithmetic, proven for every distinct determination before any
    // of it could be written - never inside a transaction, never once
    // per row. What is proven is exactly what will be written.
    const provable = marked
      .filter((row) => !row.issues.some((one) => one.severity === 'error'))
      .map((row) => row.recognition)
    const proven = yield* proveSettlements(
      runtime,
      {
        tenantId,
        batchId,
        itemId: ready.item.id,
        revisionId: ready.revision.id,
        plan: ready.plan,
      },
      provable,
    )
    const judged = marked.map((row) => {
      const answer = proven.get(row.recognitionHash)
      if (answer === undefined || 'identity' in answer) return row
      return {
        ...row,
        issues: [
          ...row.issues,
          {
            severity: 'error' as const,
            field: 'recognition',
            reason: 'determination-refused',
            detail: answer.refused.reason,
          },
        ],
      }
    })

    const summary = summarise(judged)
    return {
      item: { id: ready.item.id, title: ready.item.title, revisionId: ready.revision.id },
      summary,
      rows: judged.map((row) => ({
        rowNo: row.rowNo,
        businessNo: row.businessNo,
        displayNameFromFile: row.displayNameFromFile,
        matchedParticipant: row.matchedParticipant,
        payloadPreview: row.payload,
        recognitionPreview: row.recognition,
        basis: row.basis,
        issues: row.issues as readonly ImportIssue[],
      })),
      canCommit: summary.errors === 0 && summary.rows > 0,
    } satisfies AdministrativeImportPreview
  })

  /**
   * An import this reader may look back on, or nothing.
   *
   * An import is the round's record, not the uploader's: the office decided
   * these facts, and whoever pressed the button is provenance. So the door is
   * the recording authority in the round, held now - by whoever holds it now,
   * whatever became of the person who made the import or of the people in
   * it. Somebody without it is told the import does not exist, because
   * telling "not yours" from "no such import" would say where files are.
   */
  const visibleImport = (tenantId: string, importId: string, as: Principal) =>
    Effect.gen(function* () {
      const found = yield* dieQuery(withDb(importDetailOf(tenantId, importId)))
      if (found === null) return yield* new AdministrativeImportNotFound()
      if (!(yield* deps.holdsRecord(tenantId, found.batchId, as.userId))) {
        return yield* new AdministrativeImportNotFound()
      }
      return found
    })

  /**
   * An import whose people this reader all reaches, or a refusal.
   *
   * The rows and the original workbook are a list of names. A reader whose
   * reach covers part of the round may know the import happened - it is the
   * round's history - but may not read the rest of the list through it.
   */
  const reachableImport = (tenantId: string, importId: string, as: Principal) =>
    Effect.gen(function* () {
      const found = yield* visibleImport(tenantId, importId, as)
      const reaches = yield* dieQuery(
        withDb(importReachable({ tenantId, batchId: found.batchId, importId, userId: as.userId })),
      )
      if (!reaches) {
        return yield* new AccessDenied({
          reason: 'the import names people outside your recording reach',
        })
      }
      return found
    })

  const administrativeImportTemplate: AdministrativeImportMethods['administrativeImportTemplate'] =
    Effect.fn('Assessment.administrativeImportTemplate')(function* (tenantId, itemId, locale, as) {
      const ready = yield* administrativeQuestion(tenantId, itemId, as)
      const fields = recognitionFormFields(ready.plan) ?? []
      const bytes = yield* Effect.promise(() =>
        buildAdministrativeWorkbook({
          batchId: ready.item.batchId,
          itemId: ready.item.id,
          itemRevisionId: ready.revision.id,
          itemTitle: ready.item.title,
          locale,
          evidence: evidenceFieldsOf(
            ready.driver,
            ready.revision.formConfig,
            ready.context,
            ready.plan,
          ),
          recognition: fields.map((field) => ({ id: field.id, schema: field.schema })),
        }),
      )
      // Named after the question, what it is and when it was taken. A
      // folder of these is otherwise a folder of questions, and a template
      // goes stale the moment the question's form moves - the stamp is how
      // somebody tells this morning's download from last week's. Read in
      // the round's own clock, which is the one its dates are written in.
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, ready.item.batchId)))
      const stamp = new Intl.DateTimeFormat('en-CA', {
        timeZone: batch?.timezone ?? 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(new Date(yield* Clock.currentTimeMillis))
        .replace(/[^0-9]/g, '')
      return { bytes, filename: `${ready.item.title}_导入模板_${stamp}.xlsx` }
    })

  const prepareAdministrativeImportUpload: AdministrativeImportMethods['prepareAdministrativeImportUpload'] =
    Effect.fn('Assessment.prepareAdministrativeImportUpload')(
      function* (tenantId, batchId, input, as) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        if (!batch) return yield* new BatchNotFound()
        if (batch.status === 'archived') return yield* new BatchReadOnly()
        const ready = yield* administrativeQuestion(tenantId, input.itemId, as)
        if (ready.item.batchId !== batchId) return yield* new ItemNotFound()
        return yield* storage
          .prepareUpload({
            tenantId,
            ownerUserId: as.userId,
            filename: input.filename,
            declaredMime: input.declaredMime,
            size: BigInt(input.size),
          })
          .pipe(
            Effect.catchTags({
              STORAGE_UPLOAD_REFUSED: (refused) =>
                new EntryActionRefused({ action: 'import', reason: refused.reason }),
              STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
            }),
          )
      },
    )

  const completeAdministrativeImportUpload: AdministrativeImportMethods['completeAdministrativeImportUpload'] =
    Effect.fn('Assessment.completeAdministrativeImportUpload')(
      function* (tenantId, reservationId, as) {
        return yield* storage
          .completeUpload({ tenantId, ownerUserId: as.userId, reservationId })
          .pipe(
            Effect.map((meta) => ({
              id: meta.id,
              filename: meta.filename,
              declaredMime: meta.declaredMime,
              size: meta.size.toString(),
              status: meta.status,
            })),
            Effect.catchTags({
              STORAGE_RESERVATION_NOT_FOUND: () => new AttachmentUnavailable(),
              STORAGE_RESERVATION_INVALID: (refused) =>
                new EntryActionRefused({ action: 'import', reason: refused.reason }),
              STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
            }),
          )
      },
    )

  const previewAdministrativeImport: AdministrativeImportMethods['previewAdministrativeImport'] =
    Effect.fn('Assessment.previewAdministrativeImport')(function* (tenantId, batchId, input, as) {
      const runtime = yield* ScoringRuntimeCatalog
      return yield* previewOf(tenantId, batchId, input, as, runtime)
    })

  const commitAdministrativeImport: AdministrativeImportMethods['commitAdministrativeImport'] =
    Effect.fn('Assessment.commitAdministrativeImport')(function* (tenantId, batchId, input, as) {
      const runtime = yield* ScoringRuntimeCatalog
      // All outside any transaction: reading the file, judging it and
      // proving the arithmetic are the expensive parts, and none of them
      // may be done holding the batch lock.
      const judged = yield* previewOf(tenantId, batchId, input, as, runtime)
      if (judged.summary.errors > 0) {
        return yield* refusalOf(
          judged.rows.flatMap((row) =>
            row.issues
              .filter((one) => one.severity === 'error')
              .map((one) => ({ ...one, rowNo: row.rowNo })),
          ),
        )
      }
      if (judged.summary.rows === 0) {
        return yield* refusalOf([
          { rowNo: null, field: null, severity: 'error', reason: 'no-rows' },
        ])
      }
      // A file the server still has warnings about, that nobody confirmed,
      // is refused here rather than silently imported: the confirmation is
      // about what the SERVER read, not about what the browser drew.
      if (judged.summary.warnings > 0 && input.confirmWarnings !== true) {
        return yield* refusalOf(
          judged.rows.flatMap((row) =>
            row.issues
              .filter((one) => one.severity === 'warning')
              .map((one) => ({ ...one, rowNo: row.rowNo })),
          ),
        )
      }

      const meta = yield* storage
        .metadata({ tenantId, attachmentId: input.attachmentId })
        .pipe(Effect.catch(() => Effect.fail(new AttachmentUnavailable())))

      // Everything inside is deterministic writing plus the second look at
      // whatever could have moved while the file was being read.
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            // One upload, one import - answered with the import it already
            // became rather than refused. A lost response and a second press
            // is the ordinary way the same workbook arrives twice, and the
            // round must not end up carrying both sets of facts; binding the
            // file cannot say so, because binding an already-bound
            // attachment succeeds by design. Importing the same spreadsheet
            // again on purpose means uploading it again, which is a new
            // attachment and a new import.
            const already = yield* importOfAttachment({
              tenantId,
              attachmentId: input.attachmentId,
            })
            if (already !== null) return already
            // the question, again: a revision that moved while the reader
            // was filling in the file makes every determination in it
            // answer a question that no longer exists
            const ready = yield* administrativeQuestion(tenantId, input.itemId, as)
            if (ready.item.batchId !== batchId) return yield* new ItemNotFound()
            if (ready.revision.id !== input.expectedItemRevisionId) {
              return yield* new ItemRevisionConflict({
                itemId: ready.item.id,
                currentRevisionId: ready.item.currentRevisionId,
              })
            }
            // who the caller may still record on, how much room each of them
            // still has, and whether the phase still admits them: all read
            // again under the lock, because a scope can shrink, a quota can
            // fill and a phase can close while a file is open
            const numbers = [...new Set(judged.rows.map((row) => row.businessNo))]
            const found = yield* resolveImportParticipants({
              tenantId,
              batchId,
              actorId: as.userId,
              businessNos: numbers,
            })
            const byNumber = new Map(found.map((one) => [one.businessNo, one]))
            const held = yield* effectiveEntryCounts({
              tenantId,
              itemId: ready.item.id,
              participantIds: found.map((one) => one.participantId),
            })
            const gate = yield* deps
              .recordGate(as, batchId, ready.item.id)
              .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', Effect.die))
            const takenHere = new Map<string, number>()

            const written: {
              sourceRowNo: number
              participantId: string
              entryId: string
              businessNoSnapshot: string | null
              displayNameSnapshot: string | null
            }[] = []

            for (const row of judged.rows) {
              const person = byNumber.get(row.businessNo)
              const refuse = (field: string | null, reason: string) =>
                refusalOf([{ rowNo: row.rowNo, field, severity: 'error', reason }])
              // every refusal the first pass could have reached, asked
              // again; any of them now means nothing is written at all
              if (person === undefined) {
                return yield* refuse('businessNo', 'participant-not-found')
              }
              if (person.userId === as.userId) {
                return yield* refuse('businessNo', 'self-record-refused')
              }
              const admitted = gate(person.participantId)
              if (!admitted.allowed) return yield* refuse('businessNo', admitted.reason)
              if (ready.item.maxEntries !== null) {
                const already = held.get(person.participantId) ?? 0
                const here = takenHere.get(person.participantId) ?? 0
                if (already + here >= ready.item.maxEntries) {
                  return yield* refuse(null, 'max-entries-reached')
                }
                takenHere.set(person.participantId, here + 1)
              }
              if (row.basis.trim() === '') return yield* refuse('basis', 'basis-required')

              const { entryId } = yield* recordAdministrativeEntryTx({
                tenantId,
                batchId,
                itemId: ready.item.id,
                itemRevisionId: ready.revision.id,
                participantId: person.participantId,
                subjectUserId: person.userId,
                actorUserId: as.userId,
                payload: row.payloadPreview,
                // `{}` for a question that determines nothing, never
                // absent: an approved fact always carries a determination
                recognition: row.recognitionPreview,
                basis: row.basis,
                // the provenance of the fact and of its determination are
                // one thing: an import writes 'import' on both
                source: 'import',
                attachments: [],
              })
              written.push({
                sourceRowNo: row.rowNo,
                participantId: person.participantId,
                entryId,
                businessNoSnapshot: row.businessNo,
                displayNameSnapshot: row.displayNameFromFile || null,
              })
            }

            // the original file enters history in the same transaction the
            // facts do, so a committed import always has the workbook it
            // was read from
            yield* storage
              .bind({ tenantId, attachmentId: input.attachmentId, ownerUserId: as.userId })
              .pipe(Effect.catch(() => Effect.fail(new AttachmentUnavailable())))

            const importId = yield* insertImport({
              tenantId,
              batchId,
              itemId: ready.item.id,
              itemRevisionId: ready.revision.id,
              sourceAttachmentId: input.attachmentId,
              filenameSnapshot: meta.filename,
              sizeBytes: meta.size.toString(),
              // what the store itself verified the bytes to be, never a
              // value a browser sent: this is what later tells the original
              // from a substitute
              contentHashAlgorithm: meta.integrityAlgorithm,
              contentHash: meta.integrityValue,
              actorId: as.userId,
              defaultBasis: input.defaultBasis?.trim() || null,
              importedCount: written.length,
            })
            yield* insertImportRows(tenantId, importId, written)

            // One wake-up for the whole import, not two thousand. The
            // unread marks are already on each owner's row - those are
            // durable state and were written per entry - so what is left
            // to say is only "this round changed", once.
            yield* announce(tenantId, batchId, [
              { kind: 'entries-changed' },
              { kind: 'result-changed' },
            ])
            return { importId, importedCount: written.length }
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    })

  const listAdministrativeImports: AdministrativeImportMethods['listAdministrativeImports'] =
    Effect.fn('Assessment.listAdministrativeImports')(function* (tenantId, batchId, page, as) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      // the round's history, so the recording authority is the door and the
      // whole of it: every import of the round, whoever made it
      if (!(yield* deps.holdsRecord(tenantId, batchId, as.userId))) {
        return yield* new AccessDenied({ reason: 'cannot record on this batch' })
      }
      const rows = yield* dieQuery(
        withDb(
          importsOfBatchPage({
            tenantId,
            batchId,
            ...(page.after !== undefined ? { after: page.after } : {}),
            limit: page.limit,
          }),
        ),
      )
      if (rows.length === 0) return []
      const standing = yield* dieQuery(
        withDb(
          standingOfImports(
            tenantId,
            rows.map((row) => row.id),
          ),
        ),
      )
      // The original file's identity is part of the list of names, not part
      // of the fact that an import happened: a workbook called
      // 软件2301张三李四处分名单.xlsx says who is in it. So it is asked for
      // per row, behind the same reach the rows themselves are.
      const reaches = new Map<string, boolean>()
      for (const row of rows) {
        reaches.set(
          row.id,
          yield* dieQuery(
            withDb(
              importReachable({
                tenantId,
                batchId: row.batchId,
                importId: row.id,
                userId: as.userId,
              }),
            ),
          ),
        )
      }
      return rows.map((row): AdministrativeImportView => ({
        id: row.id,
        item: { id: row.itemId, title: row.itemTitle },
        source:
          reaches.get(row.id) === true
            ? { available: true, filename: row.filename, size: row.sizeBytes, integrity: null }
            : { available: false },
        actor: personOf(row.actorId, row.actorName),
        createdAt: new Date(row.createdAt).toISOString(),
        importedCount: row.importedCount,
        standing: standingOf(standing.get(row.id)),
        cursor: [row.cursorAt, row.id] as const,
      }))
    })

  const getAdministrativeImport: AdministrativeImportMethods['getAdministrativeImport'] = Effect.fn(
    'Assessment.getAdministrativeImport',
  )(function* (tenantId, importId, as) {
    const found = yield* visibleImport(tenantId, importId, as)
    // the detail opens for anyone who may know the import happened; the
    // original file's identity is the list of names, and waits for reach
    const reachesAll = yield* dieQuery(
      withDb(importReachable({ tenantId, batchId: found.batchId, importId, userId: as.userId })),
    )
    const [standing, events, candidates] = yield* Effect.all([
      dieQuery(withDb(standingOfImports(tenantId, [importId]))),
      dieQuery(withDb(eventsOfImport(tenantId, importId))),
      dieQuery(
        withDb(
          reversalCandidatesOf(tenantId, importId, { batchId: found.batchId, userId: as.userId }),
        ),
      ),
    ])
    // Offered only when pressing it could work: something still in effect,
    // a round that is not archived, every person it would touch within
    // this reader's reach and admitted by the phase. The reversal asks all
    // of it again; this only keeps a button off the screen that would
    // certainly be refused.
    const live = candidates.filter((one) => one.status !== 'voided')
    const batch = yield* dieQuery(withDb(oneBatch(tenantId, found.batchId)))
    const gate = yield* deps
      .recordGate(as, found.batchId, found.itemId)
      .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', Effect.die))
    const reverse =
      live.length > 0 &&
      batch !== null &&
      batch.status !== 'archived' &&
      live.every(
        (one) =>
          one.reached && one.participantUserId !== as.userId && gate(one.participantId).allowed,
      )
    return {
      id: found.id,
      batchId: found.batchId,
      item: { id: found.itemId, title: found.itemTitle },
      itemRevision: { id: found.itemRevisionId, revisionNo: found.itemRevisionNo },
      source: reachesAll
        ? {
            available: true as const,
            filename: found.filenameSnapshot,
            size: found.sizeBytes,
            integrity:
              found.contentHashAlgorithm === null || found.contentHash === null
                ? null
                : { algorithm: found.contentHashAlgorithm, value: found.contentHash },
          }
        : { available: false as const },
      actor: personOf(found.actorId, found.actorName),
      createdAt: new Date(found.createdAt).toISOString(),
      defaultBasis: found.defaultBasis,
      importedCount: found.importedCount,
      standing: standingOf(standing.get(importId)),
      reversals: events
        .filter((event) => event.kind === 'reversed')
        .map((event) => ({
          id: event.id,
          actor: personOf(event.actorId, event.actorName),
          reason: event.reason,
          affectedCount: event.affectedCount,
          createdAt: new Date(event.createdAt).toISOString(),
        })),
      capabilities: { reverse },
    }
  })

  const listAdministrativeImportRows: AdministrativeImportMethods['listAdministrativeImportRows'] =
    Effect.fn('Assessment.listAdministrativeImportRows')(function* (tenantId, importId, page, as) {
      yield* reachableImport(tenantId, importId, as)
      const rows = yield* dieQuery(
        withDb(
          importRowsPage({
            tenantId,
            importId,
            ...(page.afterRowNo !== undefined ? { afterRowNo: page.afterRowNo } : {}),
            limit: page.limit,
          }),
        ),
      )
      if (rows.length === 0) return []
      // what each fact currently stands determined as, read through the
      // question version it was judged under - the same reading the record
      // book gives, so a row here and its line there never disagree
      const determinations = yield* dieQuery(
        withDb(
          currentRecognitionsOfEntries(
            tenantId,
            rows.map((row) => row.entryId),
          ),
        ),
      )
      const byEntry = new Map(determinations.map((one) => [one.entryId, one]))
      const revisions = yield* dieQuery(
        withDb(revisionsByIdOf(tenantId, [...new Set(rows.map((row) => row.itemRevisionId))])),
      )
      const fieldsOfRevision = new Map<
        string,
        readonly { readonly id: string; readonly schema: unknown }[]
      >()
      for (const [id, revision] of revisions) {
        const plan = yield* Effect.option(readScoringPlan(revision))
        fieldsOfRevision.set(
          id,
          plan._tag === 'Some' ? (recognitionFormFields(plan.value) ?? []) : [],
        )
      }
      return rows.map((row): AdministrativeImportRowView => {
        const determined = byEntry.get(row.entryId)
        return {
          rowNo: row.rowNo,
          entryId: row.entryId,
          participant: {
            id: row.participantId,
            displayName: row.displayName,
            businessNo: row.businessNo,
          },
          businessNoSnapshot: row.businessNoSnapshot,
          displayNameSnapshot: row.displayNameSnapshot,
          status: row.status,
          recognition:
            determined === undefined
              ? null
              : {
                  id: determined.id,
                  itemRevisionId: row.itemRevisionId,
                  values: determined.values,
                  fields: fieldsOfRevision.get(row.itemRevisionId) ?? [],
                },
        }
      })
    })

  const openAdministrativeImportSource: AdministrativeImportMethods['openAdministrativeImportSource'] =
    Effect.fn('Assessment.openAdministrativeImportSource')(function* (tenantId, importId, as) {
      const found = yield* reachableImport(tenantId, importId, as)
      // the import has already answered who may read it; the store is only
      // asked whether the bytes are still there
      return yield* storage
        .open({ tenantId, attachmentId: found.sourceAttachmentId }, () => Effect.void)
        .pipe(
          Effect.catchTags({
            STORAGE_ATTACHMENT_NOT_FOUND: () => new AttachmentUnavailable(),
            STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
          }),
        )
    })

  const describeAdministrativeImportSource: AdministrativeImportMethods['describeAdministrativeImportSource'] =
    Effect.fn('Assessment.describeAdministrativeImportSource')(function* (tenantId, importId, as) {
      const opened = yield* openAdministrativeImportSource(tenantId, importId, as)
      const meta = {
        id: opened.meta.id,
        filename: opened.meta.filename,
        declaredMime: opened.meta.declaredMime,
        size: opened.meta.size.toString(),
        status: opened.meta.status,
      }
      if (opened.target.kind === 'redirect') {
        return {
          ...meta,
          delivery: {
            kind: 'redirect' as const,
            url: opened.target.url,
            expiresInSeconds: opened.target.expiresInSeconds,
          },
        }
      }
      // describing must not spend the stream: a disk opens a descriptor
      // eagerly, and an unread one is a leak
      ;(opened.target.body as { destroy?: () => void }).destroy?.()
      return { ...meta, delivery: { kind: 'content' as const } }
    })

  const reverseAdministrativeImport: AdministrativeImportMethods['reverseAdministrativeImport'] =
    Effect.fn('Assessment.reverseAdministrativeImport')(function* (tenantId, importId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* importOf(tenantId, importId)
            if (located === null) return yield* new AdministrativeImportNotFound()
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (!locked) return yield* new AdministrativeImportNotFound()
            // read again under the lock: the authority to record in this
            // round, held now by whoever is pressing - not by whoever made
            // the import
            yield* visibleImport(tenantId, importId, as)
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const reason = input.reason.trim()
            if (reason === '') {
              return yield* new EntryActionRefused({ action: 'abandon', reason: 'reason-required' })
            }

            const linked = yield* reversalCandidatesOf(tenantId, importId, {
              batchId: located.batchId,
              userId: as.userId,
            })
            const candidates = linked.filter((one) => one.status !== 'voided')
            // withdrawn one by one already, or withdrawn whole before: there
            // is nothing left for a reversal to say, and saying nothing is
            // not an event
            if (candidates.length === 0) return { affectedCount: 0 }

            // Every rule the single withdrawal asks, asked of every row
            // before any row moves: this person's reach over the person the
            // fact is about, the phase, and the fact being one an office
            // recorded. Any refusal is the whole file's.
            const gate = yield* deps
              .recordGate(as, located.batchId, located.itemId)
              .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', Effect.die))
            const refusals = candidates.flatMap((one) => {
              const refused = (reason: string) => [
                { rowNo: one.rowNo, field: null, severity: 'error' as const, reason },
              ]
              if (one.source !== 'record' && one.source !== 'import') {
                return refused('entry-not-abandonable')
              }
              if (!one.reached) return refused('participant-out-of-scope')
              if (one.participantUserId === as.userId) return refused('self-record-refused')
              const decision = gate(one.participantId)
              return decision.allowed ? [] : refused(decision.reason)
            })
            if (refusals.length > 0) return yield* refusalOf(refusals)

            let cancelledReview = false
            for (const one of candidates) {
              const withdrawn = yield* voidAdministrativeEntryTx({
                tenantId,
                entryId: one.entryId,
                status: one.status,
                currentReviewInstanceId: one.currentReviewInstanceId,
                actorUserId: as.userId,
                reason,
              })
              if (!withdrawn.voided) {
                return yield* refusalOf([
                  {
                    rowNo: one.rowNo,
                    field: null,
                    severity: 'error',
                    reason: 'entry-not-abandonable',
                  },
                ])
              }
              cancelledReview = cancelledReview || withdrawn.cancelledReview
            }
            // why these went together: each entry's own event already says
            // it was withdrawn, and this is the one line that says it was
            // this import being taken back
            yield* insertImportEvent({
              tenantId,
              importId,
              kind: 'reversed',
              actorId: as.userId,
              reason,
              affectedCount: candidates.length,
            })
            yield* announce(tenantId, located.batchId, [
              { kind: 'entries-changed' },
              { kind: 'result-changed' },
              // the queues too, when an appeal just left them
              ...(cancelledReview
                ? ([{ kind: 'review-inbox-changed' }, { kind: 'review-instance-changed' }] as const)
                : []),
            ])
            return { affectedCount: candidates.length }
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    })

  return {
    administrativeImportTemplate,
    prepareAdministrativeImportUpload,
    completeAdministrativeImportUpload,
    previewAdministrativeImport,
    commitAdministrativeImport,
    listAdministrativeImports,
    getAdministrativeImport,
    listAdministrativeImportRows,
    openAdministrativeImportSource,
    describeAdministrativeImportSource,
    reverseAdministrativeImport,
  }
}

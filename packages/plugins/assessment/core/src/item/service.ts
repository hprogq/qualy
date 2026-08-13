import { Effect, Result } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import type { EpochMillis } from '../phase/engine/types.ts'
import type { ItemTypeDriver } from '../plugin.ts'
import {
  BatchNotFound,
  BatchReadOnly,
  ItemConfigInvalid,
  ItemNotFound,
  ScoreGroupInvalid,
} from '../server/errors.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { validateItemConfig, type Catalogs, type ItemConfigInput } from './config.ts'
import {
  deleteGroups,
  groupsOf,
  insertGroup,
  insertItem,
  insertItemRevision,
  itemOf,
  itemsOf,
  liveEntryPayloads,
  nextRevisionNo,
  revisionOf,
  revisionsOf,
  setCurrentRevision,
  updateGroup,
  updateItemFields,
  type ItemRevisionRow,
  type ItemRow,
} from './db.ts'

// What a batch asks, managed: the score tree (one level of it), the items on
// it, and the immutable revisions their configuration moves through.
//
// The save algorithm is the whole point of the module. A configuration is
// checked against everything it cites - driver, scoring references, review
// policy - and then against every live entry that would have to be read
// under it; only then does it become the next revision. Nothing is ever
// updated in place: fixing a configuration is appending the next one.

export interface MaterialRange {
  readonly start: string
  readonly end: string
}

export interface ItemRevisionView {
  readonly id: string
  readonly revisionNo: number
  readonly entrySource: 'student' | 'administrative'
  readonly formConfig: unknown
  readonly scoringConfig: unknown
  readonly reviewPolicy: unknown
  readonly displayConfig: unknown
  readonly reason: string | null
  readonly createdAt: EpochMillis
}

export interface ItemView {
  readonly id: string
  readonly batchId: string
  readonly itemType: string
  readonly title: string
  readonly scoreGroupId: string
  readonly maxEntries: number | null
  readonly sortOrder: number
  readonly status: 'active' | 'voided'
  readonly currentRevision: ItemRevisionView | null
  readonly createdAt: EpochMillis
}

export interface ScoreGroupView {
  readonly id: string
  readonly name: string
  readonly cap: string | null
  readonly floor: string | null
  readonly sortOrder: number
  readonly itemCount: number
}

export interface CreateItemInput {
  readonly itemType: string
  readonly title: string
  readonly scoreGroupId: string
  readonly maxEntries: number | null
  readonly sortOrder?: number
  readonly config: ItemConfigInput
}

export interface UpdateItemInput {
  readonly title?: string
  readonly scoreGroupId?: string
  readonly maxEntries?: number | null
  readonly sortOrder?: number
  readonly config?: ItemConfigInput
  readonly reason?: string
}

export interface ScoreGroupSpec {
  readonly id?: string
  readonly name: string
  readonly cap: string | null
  readonly floor: string | null
  readonly sortOrder?: number
}

export type CreateItemError = BatchNotFound | BatchReadOnly | AccessDenied | ItemConfigInvalid
export type UpdateItemError =
  ItemNotFound | BatchNotFound | BatchReadOnly | AccessDenied | ItemConfigInvalid
export type ReplaceGroupsError = BatchNotFound | BatchReadOnly | AccessDenied | ScoreGroupInvalid

export interface ItemMethods {
  readonly listItems: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<
    { items: readonly ItemView[]; capabilities: { canManage: boolean } },
    BatchNotFound | AccessDenied
  >
  readonly createItem: (
    tenantId: string,
    batchId: string,
    input: CreateItemInput,
    as: Principal,
  ) => Effect.Effect<ItemView, CreateItemError>
  readonly getItem: (
    tenantId: string,
    itemId: string,
    as: Principal,
  ) => Effect.Effect<ItemView & { manageable: boolean }, ItemNotFound | AccessDenied>
  readonly updateItem: (
    tenantId: string,
    itemId: string,
    input: UpdateItemInput,
    as: Principal,
  ) => Effect.Effect<ItemView, UpdateItemError>
  readonly listScoreGroups: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<
    { groups: readonly ScoreGroupView[]; capabilities: { canManage: boolean } },
    BatchNotFound | AccessDenied
  >
  readonly replaceScoreGroups: (
    tenantId: string,
    batchId: string,
    specs: readonly ScoreGroupSpec[],
    as: Principal,
  ) => Effect.Effect<{ groups: readonly ScoreGroupView[] }, ReplaceGroupsError>
}

/** what the item methods borrow from the service that owns authorization */
export interface ItemDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  readonly requireBatchVisible: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<void, AccessDenied>
  readonly requireRosterReach: (
    as: Principal,
    tenantId: string,
    batchId: string,
  ) => Effect.Effect<void, AccessDenied>
  readonly recordConfigChange: (
    tenantId: string,
    batchId: string,
    status: string,
    diff: Record<string, unknown>,
    actorId: string | null,
    reason: string | null,
  ) => Effect.Effect<void, QueryFailed, Orm>
  readonly parseRange: (text: string) => MaterialRange
  readonly catalogs: Catalogs
}

export const makeItemMethods = (deps: ItemDeps): ItemMethods => {
  const { withDb, catalogs } = deps

  const toRevisionView = (row: ItemRevisionRow): ItemRevisionView => ({
    id: row.id,
    revisionNo: row.revisionNo,
    entrySource: row.entrySource,
    formConfig: row.formConfig,
    scoringConfig: row.scoringConfig,
    reviewPolicy: row.reviewPolicy,
    displayConfig: row.displayConfig,
    reason: row.reason,
    createdAt: row.createdAt,
  })

  const toView = (row: ItemRow, revision: ItemRevisionRow | null): ItemView => ({
    id: row.id,
    batchId: row.batchId,
    itemType: row.itemType,
    title: row.title,
    scoreGroupId: row.scoreGroupId,
    maxEntries: row.maxEntries,
    sortOrder: row.sortOrder,
    status: row.status,
    currentRevision: revision === null ? null : toRevisionView(revision),
    createdAt: row.createdAt,
  })

  /** whether this person could administer the batch, as a plain answer */
  const canManage = (as: Principal, tenantId: string, batchId: string) =>
    deps.requireRosterReach(as, tenantId, batchId).pipe(
      Effect.as(true),
      Effect.catchTag('ACCESS_DENIED', () => Effect.succeed(false)),
    )

  /**
   * The §6.3 gauntlet for one configuration, ending in the next revision.
   *
   * Runs inside the caller's transaction, after the batch row is locked. The
   * compatibility trial reads the current revision of every in-review or
   * approved entry and asks the new configuration's own driver to decode it:
   * a configuration that cannot read what it governs is refused with the
   * entries named, and the way forward is void-and-replace, not a save that
   * strands them.
   */
  const appendRevision = (input: {
    tenantId: string
    item: ItemRow
    materialRange: MaterialRange
    config: ItemConfigInput
    actorId: string
    reason: string | null
  }) =>
    Effect.gen(function* () {
      const issues = [...(yield* validateItemConfig(catalogs, input.item.itemType, input.config))]
      const driver = catalogs.itemTypes.get(input.item.itemType) as ItemTypeDriver | undefined
      if (issues.length === 0 && driver !== undefined) {
        const live = yield* liveEntryPayloads(input.tenantId, input.item.id)
        for (const entry of live) {
          const decoded = yield* Effect.result(
            driver.decodePayload(input.config.formConfig, entry.payload, {
              materialRange: input.materialRange,
            }),
          )
          if (Result.isFailure(decoded)) {
            issues.push({ path: `entries.${entry.entryId}`, reason: 'incompatible-entry' })
          }
        }
      }
      if (issues.length > 0) return yield* new ItemConfigInvalid({ issues })

      const revisionNo = yield* nextRevisionNo(input.tenantId, input.item.id)
      const revisionId = yield* insertItemRevision({
        tenantId: input.tenantId,
        itemId: input.item.id,
        revisionNo,
        entrySource: input.config.entrySource,
        formConfig: input.config.formConfig,
        scoringConfig: input.config.scoringConfig,
        reviewPolicy: input.config.reviewPolicy,
        displayConfig: input.config.displayConfig ?? {},
        createdBy: input.actorId,
        reason: input.reason,
      })
      yield* setCurrentRevision(input.tenantId, input.item.id, revisionId)
      return revisionId
    })

  const groupsView = (tenantId: string, batchId: string) =>
    groupsOf(tenantId, batchId).pipe(
      Effect.map((rows) =>
        rows.map((row): ScoreGroupView => ({
          id: row.id,
          name: row.name,
          cap: row.cap,
          floor: row.floor,
          sortOrder: row.sortOrder,
          itemCount: row.itemCount,
        })),
      ),
    )

  const listItems: ItemMethods['listItems'] = Effect.fn('Assessment.listItems')(
    function* (tenantId, batchId, as) {
      yield* deps.requireBatchVisible(tenantId, batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          const rows = yield* itemsOf(tenantId, batchId)
          const revisions = yield* revisionsOf(
            tenantId,
            rows.map((row) => row.id),
          )
          return {
            items: rows.map((row) => toView(row, revisions.get(row.id) ?? null)),
            capabilities: { canManage: yield* canManage(as, tenantId, batchId) },
          }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const createItem: ItemMethods['createItem'] = Effect.fn('Assessment.createItem')(
    function* (tenantId, batchId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* deps.requireRosterReach(as, tenantId, batchId)
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const batch = yield* oneBatch(tenantId, batchId)
            const groups = yield* groupsOf(tenantId, batchId)
            if (!groups.some((group) => group.id === input.scoreGroupId)) {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'scoreGroupId', reason: 'group-not-in-batch' }],
              })
            }
            const itemId = yield* insertItem({
              tenantId,
              batchId,
              itemType: input.itemType,
              title: input.title,
              scoreGroupId: input.scoreGroupId,
              maxEntries: input.maxEntries,
              sortOrder: input.sortOrder ?? 0,
            })
            const item = (yield* itemOf(tenantId, itemId))!
            yield* appendRevision({
              tenantId,
              item,
              materialRange: deps.parseRange(String(batch!.materialRange)),
              config: input.config,
              actorId: as.userId,
              reason: null,
            })
            yield* deps.recordConfigChange(
              tenantId,
              batchId,
              locked.status,
              { itemCreated: [item.title] },
              as.userId,
              null,
            )
            const written = (yield* itemOf(tenantId, itemId))!
            const revision =
              written.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, written.currentRevisionId)
            return toView(written, revision)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const getItem: ItemMethods['getItem'] = Effect.fn('Assessment.getItem')(
    function* (tenantId, itemId, as) {
      const found = yield* withDb(
        itemOf(tenantId, itemId).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
      if (found === null) return yield* new ItemNotFound()
      yield* deps.requireBatchVisible(tenantId, found.batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          const revision =
            found.currentRevisionId === null
              ? null
              : yield* revisionOf(tenantId, found.currentRevisionId)
          return {
            ...toView(found, revision),
            manageable: yield* canManage(as, tenantId, found.batchId),
          }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const updateItem: ItemMethods['updateItem'] = Effect.fn('Assessment.updateItem')(
    function* (tenantId, itemId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const item = yield* itemOf(tenantId, itemId)
            if (item === null) return yield* new ItemNotFound()
            const locked = yield* lockBatch(tenantId, item.batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* deps.requireRosterReach(as, tenantId, item.batchId)
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            // a voided question keeps its history; un-voiding it is its own
            // act, not a side effect of an edit
            if (item.status === 'voided') {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'item', reason: 'item-voided' }],
              })
            }
            if (input.scoreGroupId !== undefined) {
              const groups = yield* groupsOf(tenantId, item.batchId)
              if (!groups.some((group) => group.id === input.scoreGroupId)) {
                return yield* new ItemConfigInvalid({
                  issues: [{ path: 'scoreGroupId', reason: 'group-not-in-batch' }],
                })
              }
            }
            const fieldDiff: Record<string, unknown> = {}
            if (input.title !== undefined && input.title !== item.title) {
              fieldDiff['title'] = [item.title, input.title]
            }
            if (input.scoreGroupId !== undefined && input.scoreGroupId !== item.scoreGroupId) {
              fieldDiff['scoreGroupId'] = [item.scoreGroupId, input.scoreGroupId]
            }
            if (input.maxEntries !== undefined && input.maxEntries !== item.maxEntries) {
              fieldDiff['maxEntries'] = [item.maxEntries, input.maxEntries]
            }
            if (input.sortOrder !== undefined && input.sortOrder !== item.sortOrder) {
              fieldDiff['sortOrder'] = [item.sortOrder, input.sortOrder]
            }
            if (Object.keys(fieldDiff).length > 0) {
              yield* updateItemFields({
                tenantId,
                itemId,
                fields: {
                  ...(input.title !== undefined ? { title: input.title } : {}),
                  ...(input.scoreGroupId !== undefined ? { scoreGroupId: input.scoreGroupId } : {}),
                  ...(input.maxEntries !== undefined ? { maxEntries: input.maxEntries } : {}),
                  ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
                },
              })
            }
            if (input.config !== undefined) {
              const batch = yield* oneBatch(tenantId, item.batchId)
              yield* appendRevision({
                tenantId,
                item,
                materialRange: deps.parseRange(String(batch!.materialRange)),
                config: input.config,
                actorId: as.userId,
                reason: input.reason ?? null,
              })
              fieldDiff['config'] = 'revised'
            }
            yield* deps.recordConfigChange(
              tenantId,
              item.batchId,
              locked.status,
              fieldDiff,
              as.userId,
              input.reason ?? null,
            )
            const written = (yield* itemOf(tenantId, itemId))!
            const revision =
              written.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, written.currentRevisionId)
            return toView(written, revision)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const listScoreGroups: ItemMethods['listScoreGroups'] = Effect.fn('Assessment.listScoreGroups')(
    function* (tenantId, batchId, as) {
      yield* deps.requireBatchVisible(tenantId, batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          return {
            groups: yield* groupsView(tenantId, batchId),
            capabilities: { canManage: yield* canManage(as, tenantId, batchId) },
          }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const replaceScoreGroups: ItemMethods['replaceScoreGroups'] = Effect.fn(
    'Assessment.replaceScoreGroups',
  )(function* (tenantId, batchId, specs, as) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const locked = yield* lockBatch(tenantId, batchId)
          if (!locked) return yield* new BatchNotFound()
          yield* deps.requireRosterReach(as, tenantId, batchId)
          if (locked.status === 'archived') return yield* new BatchReadOnly()

          const existing = yield* groupsOf(tenantId, batchId)
          const existingById = new Map(existing.map((group) => [group.id, group]))
          const refusals: { reason: string; groupId: string | null; index?: number }[] = []
          for (const [index, spec] of specs.entries()) {
            if (spec.id !== undefined && !existingById.has(spec.id)) {
              refusals.push({ reason: 'group-not-found', groupId: spec.id, index })
            }
            // the database holds this line too; refusing here names the row
            if (spec.cap !== null && spec.floor !== null && Number(spec.floor) > Number(spec.cap)) {
              refusals.push({ reason: 'floor-above-cap', groupId: spec.id ?? null, index })
            }
          }
          const submitted = new Set(specs.flatMap((spec) => (spec.id ? [spec.id] : [])))
          const removed = existing.filter((group) => !submitted.has(group.id))
          for (const group of removed) {
            if (group.itemCount > 0) {
              refusals.push({ reason: 'group-has-items', groupId: group.id })
            }
          }
          if (refusals.length > 0) return yield* new ScoreGroupInvalid({ refusals })

          yield* deleteGroups(
            tenantId,
            batchId,
            removed.map((group) => group.id),
          )
          for (const [index, spec] of specs.entries()) {
            if (spec.id === undefined) {
              yield* insertGroup({
                tenantId,
                batchId,
                name: spec.name,
                cap: spec.cap,
                floor: spec.floor,
                sortOrder: spec.sortOrder ?? index,
              })
            } else {
              yield* updateGroup({
                tenantId,
                batchId,
                id: spec.id,
                name: spec.name,
                cap: spec.cap,
                floor: spec.floor,
                sortOrder: spec.sortOrder ?? index,
              })
            }
          }
          yield* deps.recordConfigChange(
            tenantId,
            batchId,
            locked.status,
            { scoreGroups: [existing.length, specs.length] },
            as.userId,
            null,
          )
          return { groups: yield* groupsView(tenantId, batchId) }
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
    )
  })

  return { listItems, createItem, getItem, updateItem, listScoreGroups, replaceScoreGroups }
}

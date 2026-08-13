import { Effect, Result } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import type { EpochMillis } from '../phase/engine/types.ts'
import type { ItemTypeDriver } from '../plugin.ts'
import {
  ItemActionRefused,
  BatchNotFound,
  BatchReadOnly,
  ItemConfigInvalid,
  ItemNotFound,
  ScoreGroupInvalid,
} from '../server/errors.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { scaledAmount } from '../scoring/builtins.ts'
import { validateItemConfig, type Catalogs, type ItemConfigInput } from './config.ts'
import {
  cancelReviewInstance,
  insertReviewEvent,
  openEntriesOfItem,
  setEntryState,
} from '../entry/db.ts'
import {
  deleteGroups,
  deleteItemRows,
  groupsOf,
  insertGroup,
  insertItem,
  insertItemRevision,
  itemHasEntries,
  itemOf,
  itemsOf,
  liveEntryPayloads,
  nextRevisionNo,
  revisionOf,
  revisionsOf,
  setCurrentRevision,
  setItemLifecycle,
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

export interface ReplaceScoreGroupsInput {
  readonly groups: readonly ScoreGroupSpec[]
  readonly reason?: string
}

export type CreateItemError = BatchNotFound | BatchReadOnly | AccessDenied | ItemConfigInvalid
export type ItemLifecycleError = ItemNotFound | BatchReadOnly | AccessDenied | ItemActionRefused
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
  readonly deleteItem: (
    tenantId: string,
    itemId: string,
    as: Principal,
  ) => Effect.Effect<void, ItemLifecycleError>
  readonly setItemStatus: (
    tenantId: string,
    itemId: string,
    input: { status: 'voided'; reason: string } | { status: 'active' },
    as: Principal,
  ) => Effect.Effect<ItemView, ItemLifecycleError>
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
    input: ReplaceScoreGroupsInput,
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

  // jsonb hands objects back with keys re-sorted, so equality has to be
  // order-blind: stringify with keys canonically sorted at every level
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
  }
  const sameJson = (left: unknown, right: unknown) =>
    canonical(left ?? null) === canonical(right ?? null)

  /** whether a submitted configuration differs from the stored current one */
  const configChanged = (current: ItemRevisionRow, config: ItemConfigInput) =>
    current.entrySource !== config.entrySource ||
    !sameJson(current.formConfig, config.formConfig) ||
    !sameJson(current.scoringConfig, config.scoringConfig) ||
    !sameJson(current.reviewPolicy, config.reviewPolicy) ||
    !sameJson(current.displayConfig, config.displayConfig ?? {})

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
    current: ItemRevisionRow | null
    materialRange: MaterialRange
    config: ItemConfigInput
    actorId: string
    reason: string | null
  }) =>
    Effect.gen(function* () {
      const issues = [...(yield* validateItemConfig(catalogs, input.item.itemType, input.config))]
      // once anything has been filed against the item, who may file is no
      // longer negotiable: the resource policy reads it from the current
      // revision, and flipping it would strand every existing entry on a
      // path that no longer exists. Void and replace is the way to change
      // what kind of question this is.
      if (
        input.current !== null &&
        input.config.entrySource !== input.current.entrySource &&
        (yield* itemHasEntries(input.tenantId, input.item.id))
      ) {
        issues.push({ path: 'entrySource', reason: 'entry-source-frozen' })
      }
      const driver = catalogs.itemTypes.get(input.item.itemType) as ItemTypeDriver | undefined
      if (driver?.configIssues !== undefined) {
        issues.push(
          ...driver
            .configIssues(input.config.formConfig, { materialRange: input.materialRange })
            .map((issue) => ({ path: issue.path, reason: issue.reason })),
        )
      }
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

      // a byte-identical configuration is not a new version of anything:
      // appending it would move current_revision_id and the audit counter to
      // say that nothing happened
      if (input.current !== null && !configChanged(input.current, input.config)) {
        return { revisionId: input.current.id, changed: false as const }
      }

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
      return { revisionId, changed: true as const }
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
            const appended = yield* appendRevision({
              tenantId,
              item,
              current: null,
              materialRange: deps.parseRange(String(batch!.materialRange)),
              config: input.config,
              actorId: as.userId,
              reason: null,
            })
            yield* deps.recordConfigChange(
              tenantId,
              batchId,
              locked.status,
              {
                itemCreated: {
                  itemId: item.id,
                  title: item.title,
                  revisionId: appended.revisionId,
                },
              },
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
            const current =
              item.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, item.currentRevisionId)

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

            // On a running round, changing what a question is worth needs a
            // sentence saying why (assessment-design §32.8): the scoring
            // references, and which group's caps the item answers to, are
            // scoring semantics. A title is not.
            const scoringChanged =
              input.config !== undefined &&
              current !== null &&
              !sameJson(current.scoringConfig, input.config.scoringConfig)
            const semanticChange = scoringChanged || fieldDiff['scoreGroupId'] !== undefined
            const reason = input.reason?.trim() ?? ''
            if (locked.status === 'active' && semanticChange && reason === '') {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'reason', reason: 'reason-required' }],
              })
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
              const appended = yield* appendRevision({
                tenantId,
                item,
                current,
                materialRange: deps.parseRange(String(batch!.materialRange)),
                config: input.config,
                actorId: as.userId,
                reason: input.reason ?? null,
              })
              if (appended.changed) {
                fieldDiff['config'] = {
                  oldRevisionId: current?.id ?? null,
                  newRevisionId: appended.revisionId,
                }
              }
            }
            // an update that changed nothing leaves no event and moves no
            // counter; recordConfigChange skips the empty diff
            yield* deps.recordConfigChange(
              tenantId,
              item.batchId,
              locked.status,
              Object.keys(fieldDiff).length > 0 ? { itemId, ...fieldDiff } : {},
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

  /** an amount as the engine's integer, or null; the schema already vetted it */
  const scaled = (value: string | null) => (value === null ? null : scaledAmount(value))

  const replaceScoreGroups: ItemMethods['replaceScoreGroups'] = Effect.fn(
    'Assessment.replaceScoreGroups',
  )(function* (tenantId, batchId, input, as) {
    const specs = input.groups
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
            // compared as the engine's own integers: a float comparison here
            // would be a second arithmetic beside the scoring one
            if (
              spec.cap !== null &&
              spec.floor !== null &&
              scaled(spec.floor)! > scaled(spec.cap)!
            ) {
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

          // the audit diff, computed before anything is written: which rows
          // appeared, which went, and field by field what changed on the rest
          const changed: Record<string, unknown>[] = []
          let limitsChanged = false
          for (const [index, spec] of specs.entries()) {
            if (spec.id === undefined) continue
            const before = existingById.get(spec.id)
            if (before === undefined) continue
            const delta: Record<string, unknown> = { groupId: spec.id }
            if (before.name !== spec.name) delta['name'] = [before.name, spec.name]
            if (scaled(before.cap) !== scaled(spec.cap)) {
              delta['cap'] = [before.cap, spec.cap]
              limitsChanged = true
            }
            if (scaled(before.floor) !== scaled(spec.floor)) {
              delta['floor'] = [before.floor, spec.floor]
              limitsChanged = true
            }
            const order = spec.sortOrder ?? index
            if (before.sortOrder !== order) delta['sortOrder'] = [before.sortOrder, order]
            if (Object.keys(delta).length > 1) changed.push(delta)
          }
          const added = specs.filter((spec) => spec.id === undefined).map((spec) => spec.name)
          const isNoOp = added.length === 0 && removed.length === 0 && changed.length === 0

          // a cap or floor on a running round is scoring semantics: moving
          // one without a sentence saying why is refused (§32.8)
          const reason = input.reason?.trim() ?? ''
          if (locked.status === 'active' && limitsChanged && reason === '') {
            refusals.push({ reason: 'reason-required', groupId: null })
          }
          if (refusals.length > 0) return yield* new ScoreGroupInvalid({ refusals })
          if (isNoOp) return { groups: yield* groupsView(tenantId, batchId) }

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
            {
              scoreGroups: {
                ...(added.length > 0 ? { added } : {}),
                ...(removed.length > 0
                  ? { removed: removed.map((group) => ({ groupId: group.id, name: group.name })) }
                  : {}),
                ...(changed.length > 0 ? { changed } : {}),
              },
            },
            as.userId,
            reason === '' ? null : reason,
          )
          return { groups: yield* groupsView(tenantId, batchId) }
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
    )
  })

  const refuse = (action: string, reason: string) => new ItemActionRefused({ action, reason })

  const deleteItem: ItemMethods['deleteItem'] = Effect.fn('Assessment.deleteItem')(
    function* (tenantId, itemId, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const item = yield* itemOf(tenantId, itemId)
            if (item === null) return yield* new ItemNotFound()
            yield* deps
              .requireBatchVisible(tenantId, item.batchId, as)
              .pipe(Effect.catchTag('ACCESS_DENIED', () => new ItemNotFound()))
            const locked = yield* lockBatch(tenantId, item.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            yield* deps.requireRosterReach(as, tenantId, item.batchId)
            // deletion is for questions nothing ever happened to: a draft
            // round, and not one entry. Anything more is a void, which keeps
            // the record.
            if (locked!.status !== 'draft') return yield* refuse('delete', 'batch-not-draft')
            if (yield* itemHasEntries(tenantId, itemId)) {
              return yield* refuse('delete', 'item-has-entries')
            }
            yield* deleteItemRows(tenantId, itemId)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const setItemStatus: ItemMethods['setItemStatus'] = Effect.fn('Assessment.setItemStatus')(
    function* (tenantId, itemId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const item = yield* itemOf(tenantId, itemId)
            if (item === null) return yield* new ItemNotFound()
            yield* deps
              .requireBatchVisible(tenantId, item.batchId, as)
              .pipe(Effect.catchTag('ACCESS_DENIED', () => new ItemNotFound()))
            const locked = yield* lockBatch(tenantId, item.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            yield* deps.requireRosterReach(as, tenantId, item.batchId)
            if (locked!.status === 'draft') {
              // a draft round has no facts to keep; the ceremony would
              // record nothing - delete instead
              return yield* refuse('void', 'batch-draft')
            }

            if (input.status === 'voided') {
              const reason = input.reason.trim()
              if (reason === '') return yield* refuse('void', 'reason-required')
              const moved = yield* setItemLifecycle({
                tenantId,
                itemId,
                to: 'voided',
                actorId: as.userId,
                reason,
              })
              if (!moved) return yield* refuse('void', 'item-not-active')
              // open work dies with the question; decided work stands
              for (const entry of yield* openEntriesOfItem(tenantId, itemId)) {
                if (entry.status === 'in_review' && entry.currentReviewInstanceId !== null) {
                  const cancelled = yield* cancelReviewInstance({
                    tenantId,
                    instanceId: entry.currentReviewInstanceId,
                    outcome: 'cancelled',
                  })
                  if (cancelled) {
                    yield* insertReviewEvent({
                      tenantId,
                      reviewInstanceId: entry.currentReviewInstanceId,
                      kind: 'cancelled-item-voided',
                      actorId: as.userId,
                    })
                  }
                }
                yield* setEntryState({
                  tenantId,
                  entryId: entry.id,
                  from: ['draft', 'in_review'],
                  to: 'voided',
                })
              }
              yield* deps.recordConfigChange(
                tenantId,
                item.batchId,
                locked!.status,
                { voidedItem: itemId },
                as.userId,
                reason,
              )
            } else {
              // restore reopens the question for new work and nothing else:
              // entries voided with it stay voided, cancelled rounds stay
              // cancelled - what happened, happened
              const moved = yield* setItemLifecycle({ tenantId, itemId, to: 'active' })
              if (!moved) return yield* refuse('restore', 'item-not-voided')
              yield* deps.recordConfigChange(
                tenantId,
                item.batchId,
                locked!.status,
                { restoredItem: itemId },
                as.userId,
                null,
              )
            }
            const written = (yield* itemOf(tenantId, itemId))!
            const revision =
              written.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, written.currentRevisionId)
            return toView(written, revision)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  return {
    listItems,
    createItem,
    getItem,
    updateItem,
    deleteItem,
    setItemStatus,
    listScoreGroups,
    replaceScoreGroups,
  }
}

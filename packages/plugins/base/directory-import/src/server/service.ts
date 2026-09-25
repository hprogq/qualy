import { Effect } from 'effect'
import { sql } from 'kysely'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import { DEFAULT_PAGE_SIZE } from '@qualy/api-kit'
import { pageNumber, pageSize, pageWindow } from '@qualy/api-kit/schema'
import type { Principal } from '@qualy/rbac-contract'
import { scopeCoverage } from '@qualy/rbac-contract'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import { Audit } from '@qualy/audit-contract/effect'
import { UserProvisioning } from '@qualy/auth-contract/provisioning'
import { OrgProvisioning } from '@qualy/org-contract/effect'
import type { OrgNodeRef } from '@qualy/org-contract'
import { Storage, type AttachmentMeta } from '@qualy/plugin-storage/server'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import {
  openWorkbook,
  readTable,
  readWorkbook,
  sheetsOf,
  SPREADSHEET_LIMITS,
  SpreadsheetUnreadable,
  type SheetTable,
} from '@qualy/spreadsheet'
import { ImportCommitted, ImportNodesCleaned, ImportReversed } from '../actions.ts'
import { db, lockTenant } from './db.ts'
import {
  importConstraints,
  UserImportInvalid,
  UserImportMappingInvalid,
  UserImportNotFound,
  UserImportPlanChanged,
  UserImportSourceUnavailable,
  UserImportSourceUsed,
} from './errors.ts'
import { resolveChain, type ImportMapping, type ResolvedChain } from './mapping.ts'
import { desiredTree, judgeRows, leafKeyOf, type ImportIssue, type JudgedRow } from './plan.ts'
import { readSourceBytes } from './read-source.ts'

// People in bulk: a spreadsheet in, a whole import out or nothing, and
// afterwards the history of what it did and the two ways to undo parts of
// it. The preview and the commit share one plan; the commit runs it again
// under the tenant lock and compares what it found with what the reader
// confirmed, so a tree or a roster that moved in between is a question put
// back to them rather than a difference written into the database.

const MANAGE = 'auth.user.manage'
const MANAGE_TREE = 'org.tree.manage'
const ISSUE_CAP = 100
const SAMPLE_ROWS = 5

export interface ImportRequest {
  readonly attachmentId: string
  readonly sheet: string
  readonly headerRow: number
  readonly userTypeId: string
  readonly mapping: ImportMapping
}

interface ResolvedNode {
  readonly key: string
  readonly path: string
  readonly depth: number
  readonly orgTypeId: string
  readonly name: string
  readonly parentKey: string | null
  /** the unit as it stands, when it does */
  readonly existing: OrgNodeRef | null
  readonly conflict: boolean
}

interface Plan {
  readonly meta: AttachmentMeta
  readonly chain: ResolvedChain
  readonly table: SheetTable
  readonly rows: readonly JudgedRow[]
  readonly nodes: readonly ResolvedNode[]
  readonly nodeByKey: ReadonlyMap<string, ResolvedNode>
  /** per complete row, what would happen to the person */
  readonly people: readonly {
    readonly row: JudgedRow
    readonly disposition: 'create' | 'existing'
    readonly existingId: string | null
    readonly leafKey: string | null
  }[]
  readonly issues: readonly ImportIssue[]
  readonly fingerprint: string
}

const PATH_SEPARATOR = ' / '

/** the reader's own words for where a unit is: names from the anchor down */
const pathOf = (anchorPath: string, names: readonly string[]) =>
  [anchorPath, ...names].join(PATH_SEPARATOR)

export const make = Effect.gen(function* () {
  const withDb = yield* withDatabase
  const rbac = yield* Rbac
  const audit = yield* Audit
  const storage = yield* Storage
  const org = yield* OrgProvisioning
  const users = yield* UserProvisioning

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

  /** the anchor is where authority is judged: every row stands under it */
  const requireReach = (as: Principal, code: string, nodeId: string) =>
    rbac.canAt(as, code, nodeId).pipe(
      Effect.flatMap((allowed) =>
        allowed
          ? Effect.void
          : Effect.fail(
              new AccessDenied({
                reason: `${code} is not held at the unit the rows stand under`,
              }),
            ),
      ),
    )

  /**
   * The door every file-reading step opens with: somebody who administers
   * users nowhere has no import to prepare, and a file they staged for
   * anything else is not this door's to read. Asked before a byte is read.
   */
  const requireManageSomewhere = Effect.fn('DirectoryImport.requireManageSomewhere')(function* (
    as: Principal,
  ) {
    const scope = yield* rbac.listAuthorizedScope(as, MANAGE)
    if (!scope.tenantWide && scope.anchors.length === 0) {
      return yield* new AccessDenied({ reason: 'auth.user.manage is not held anywhere' })
    }
  })

  /**
   * Which of the units a commit would write at lie outside the caller's
   * authority, each named once.
   *
   * A target is the key of a unit in the plan, or null for the anchor. One
   * that exists is reached as the write would reach it; one yet to be made
   * stands under the nearest unit that exists, and only a grant over that
   * unit's whole subtree reaches it.
   */
  const unreached = Effect.fn('DirectoryImport.unreached')(function* (
    tenantId: string,
    as: Principal,
    anchorId: string,
    nodeByKey: ReadonlyMap<string, ResolvedNode>,
    asks: readonly {
      readonly code: string
      readonly reason: string
      readonly targets: readonly { readonly key: string | null; readonly label: string }[]
    }[],
  ) {
    const found: ImportIssue[] = []
    for (const ask of asks) {
      if (ask.targets.length === 0) continue
      const placed = ask.targets.map((target) => {
        let key = target.key
        let below = false
        while (key !== null && nodeByKey.get(key)!.existing === null) {
          key = nodeByKey.get(key)!.parentKey
          below = true
        }
        const id = key === null ? anchorId : nodeByKey.get(key)!.existing!.id
        return { ...target, id, below }
      })
      const scope = yield* rbac.listAuthorizedScope(as, ask.code)
      const whole = {
        tenantWide: scope.tenantWide,
        anchors: scope.anchors.filter((anchor) => anchor.coverage === 'subtree'),
      }
      const at = yield* dieQuery(
        withDb(
          nodesReached(
            tenantId,
            scope,
            placed.filter((one) => !one.below).map((one) => one.id),
          ),
        ),
      )
      const under = yield* dieQuery(
        withDb(
          nodesReached(
            tenantId,
            whole,
            placed.filter((one) => one.below).map((one) => one.id),
          ),
        ),
      )
      const named = new Set<string>()
      for (const one of placed) {
        if ((one.below ? under : at).has(one.id) || named.has(one.label)) continue
        named.add(one.label)
        found.push({
          rowNo: null,
          field: null,
          severity: 'error',
          reason: ask.reason,
          detail: one.label,
        })
      }
    }
    return found
  })

  /** a unit and everything above it, root first, walked parent by parent */
  const ancestryOf = Effect.fn('DirectoryImport.ancestryOf')(function* (
    tenantId: string,
    node: OrgNodeRef,
  ) {
    const chain: OrgNodeRef[] = [node]
    let current = node
    // a tree is a few levels deep; a cycle is impossible by construction,
    // and the bound below is what says so if a row ever lies
    while (current.parentId !== null && chain.length < 64) {
      const parent = (yield* org.nodesById(tenantId, [current.parentId]))[0]
      if (parent === undefined) break
      chain.unshift(parent)
      current = parent
    }
    return chain
  })

  /** the words a unit is known by, top to bottom, for a path a reader can read */
  const namesOf = Effect.fn('DirectoryImport.namesOf')(function* (
    tenantId: string,
    node: OrgNodeRef,
  ) {
    return (yield* ancestryOf(tenantId, node)).map((one) => one.name)
  })

  const stagedFile = Effect.fn('DirectoryImport.stagedFile')(function* (
    tenantId: string,
    attachmentId: string,
    as: Principal,
  ) {
    const meta = yield* storage
      .metadata({ tenantId, attachmentId })
      .pipe(Effect.catch(() => Effect.fail(new UserImportSourceUnavailable())))
    // the file is the uploader's until it is bound: nobody else reads it,
    // and nothing else is committed from it. Bound is what a committed
    // import leaves behind, which is the one answer worth its own word.
    if (meta.ownerUserId !== as.userId) return yield* new UserImportSourceUnavailable()
    if (meta.status === 'bound') return yield* new UserImportSourceUsed()
    if (meta.status !== 'staged') return yield* new UserImportSourceUnavailable()
    return meta
  })

  const bytesOf = Effect.fn('DirectoryImport.bytesOf')(function* (
    tenantId: string,
    attachmentId: string,
    as: Principal,
  ) {
    const opened = yield* storage
      .open({ tenantId, attachmentId }, (meta) =>
        meta.ownerUserId === as.userId
          ? Effect.void
          : Effect.fail(new UserImportSourceUnavailable()),
      )
      .pipe(
        Effect.catchTags({
          STORAGE_ATTACHMENT_NOT_FOUND: () => new UserImportSourceUnavailable(),
          STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
        }),
      )
    return yield* readSourceBytes(opened).pipe(
      Effect.catch((error) =>
        Effect.fail(
          new UserImportInvalid({
            issues: [{ rowNo: null, field: null, severity: 'error', reason: error.reason }],
          }),
        ),
      ),
    )
  })

  /** a refusal from the engine, said as the one issue it is */
  const unreadable = (error: unknown) =>
    error instanceof SpreadsheetUnreadable
      ? new UserImportInvalid({
          issues: [
            {
              rowNo: error.rowNo,
              field: error.column,
              severity: 'error',
              reason: error.reason,
            },
          ],
        })
      : new UserImportInvalid({
          issues: [{ rowNo: null, field: null, severity: 'error', reason: 'unreadable' }],
        })

  /** one sheet of the staged file as a table, read under the process's one workbook permit */
  const tableOf = Effect.fn('DirectoryImport.tableOf')(function* (
    tenantId: string,
    attachmentId: string,
    as: Principal,
    sheet: string,
    headerRow: number,
  ) {
    return yield* readWorkbook({
      bytes: bytesOf(tenantId, attachmentId, as),
      read: async (bytes) => readTable(await openWorkbook(bytes), sheet, { headerRow }),
      refused: unreadable,
    })
  })

  const inspect = Effect.fn('DirectoryImport.inspect')(function* (
    tenantId: string,
    attachmentId: string,
    choice: { readonly sheet?: string; readonly headerRow?: number },
    as: Principal,
  ) {
    yield* requireManageSomewhere(as)
    yield* stagedFile(tenantId, attachmentId, as)
    return yield* readWorkbook({
      bytes: bytesOf(tenantId, attachmentId, as),
      read: async (bytes) => {
        const book = await openWorkbook(bytes)
        const sheets = sheetsOf(book)
        const sheet = choice.sheet ?? sheets[0]?.name ?? ''
        const table = readTable(book, sheet, { headerRow: choice.headerRow ?? 1 })
        return {
          sheets,
          table: {
            sheet: table.sheet,
            headerRow: table.headerRow,
            headers: table.headers,
            rowCount: table.rows.length,
            sample: table.rows.slice(0, SAMPLE_ROWS),
          },
        }
      },
      refused: unreadable,
    })
  })

  /**
   * The whole judgement, from the staged file to a fingerprint: what the
   * grammar makes of the mapping, what each row says, which units exist
   * and which would be made, who is already on the books.
   *
   * The lookups run on whatever connection the caller is on, so the commit
   * runs this inside its transaction and reads the tree it will write into.
   */
  const plan = Effect.fn('DirectoryImport.plan')(function* (
    tenantId: string,
    input: ImportRequest,
    as: Principal,
    prepared?: { readonly meta: AttachmentMeta; readonly table: SheetTable },
  ) {
    if (prepared === undefined) yield* requireManageSomewhere(as)
    const meta = prepared?.meta ?? (yield* stagedFile(tenantId, input.attachmentId, as))
    const table =
      prepared?.table ??
      (yield* tableOf(tenantId, input.attachmentId, as, input.sheet, input.headerRow))

    const [root, types, rules] = yield* Effect.all([
      org.rootNode(tenantId),
      org.types(tenantId),
      org.rules(tenantId),
    ])
    // the anchor and everything above it, root first, off its own path
    const anchorId = input.mapping.organization.anchorNodeId ?? root?.id ?? ''
    const anchorNode = (yield* org.nodesById(tenantId, [anchorId]))[0]
    const ancestry = anchorNode === undefined ? [] : yield* ancestryOf(tenantId, anchorNode)
    const resolved = resolveChain({
      root,
      types,
      rules,
      ancestry,
      mapping: input.mapping,
      headers: new Set(table.headers.map((header) => header.column)),
    })
    if (!resolved.ok) {
      return yield* new UserImportMappingInvalid({
        reason: resolved.problem.reason,
        subject: resolved.problem.subject,
      })
    }
    const chain = resolved.chain

    // who the rows will be, and whether they may stand there at all
    const type = yield* users.userType(tenantId, input.userTypeId)
    if (type === null)
      return yield* new UserImportMappingInvalid({
        reason: 'user-type-missing',
        subject: input.userTypeId,
      })
    if (!type.enabled)
      return yield* new UserImportMappingInvalid({ reason: 'user-type-disabled', subject: type.id })
    if (type.isSystem)
      return yield* new UserImportMappingInvalid({ reason: 'user-type-system', subject: type.id })
    const legal = yield* users.placementAllowedAtType(tenantId, type.id, chain.leafTypeId)
    if (legal !== true) {
      return yield* new UserImportMappingInvalid({ reason: 'placement', subject: chain.leafTypeId })
    }
    // authority over the anchor: every row stands under it
    yield* requireReach(as, MANAGE, chain.anchor.id)

    const rows = judgeRows(table.rows, input.mapping, chain)
    const issues: ImportIssue[] = rows.flatMap((row) => row.issues)
    const anchorPath = (yield* namesOf(tenantId, chain.anchor)).join(PATH_SEPARATOR)

    // the tree, level by level: a unit whose parent is yet to be made is
    // yet to be made itself, and one that exists under another type is a
    // conflict rather than something to reuse
    const desired = desiredTree(rows, chain)
    const nodeByKey = new Map<string, ResolvedNode>()
    for (const wanted of desired) {
      const parent = wanted.parentKey === null ? null : nodeByKey.get(wanted.parentKey)!
      const parentId = wanted.parentKey === null ? chain.anchor.id : parent!.existing?.id
      let existing: OrgNodeRef | null = null
      let conflict = parent?.conflict ?? false
      if (parentId !== undefined && !conflict) {
        existing = yield* org.childNamed(tenantId, parentId, wanted.name)
        if (existing !== null && existing.orgTypeId !== wanted.orgTypeId) {
          conflict = true
          existing = null
        }
      }
      const node: ResolvedNode = {
        key: wanted.key,
        path: pathOf(anchorPath, wanted.names),
        depth: wanted.depth,
        orgTypeId: wanted.orgTypeId,
        name: wanted.name,
        parentKey: wanted.parentKey,
        existing,
        conflict,
      }
      nodeByKey.set(wanted.key, node)
      if (conflict && !(parent?.conflict ?? false)) {
        issues.push({
          rowNo: null,
          field: null,
          severity: 'error',
          reason: 'node-type-conflict',
          detail: node.path,
        })
      }
    }
    const nodes = [...nodeByKey.values()]
    const creating = nodes.filter((node) => node.existing === null && !node.conflict)
    if (creating.length > 0) yield* requireReach(as, MANAGE_TREE, chain.anchor.id)

    // the people: on the books already, or not yet
    const complete = rows.filter((row) => row.issues.length === 0)
    const known = new Map(
      (yield* users.byBusinessNo(
        tenantId,
        complete.map((row) => row.businessNo),
      )).map((one) => [one.businessNo, one] as const),
    )
    // Somebody already on the books is described only to a caller who
    // administers them. To anybody else, saying which of the name, the type
    // or the unit differs from the row would confirm who holds a number the
    // caller cannot see, a spreadsheet of guesses at a time; the number
    // being taken is all the row needs to say.
    const scope = yield* rbac.listAuthorizedScope(as, MANAGE)
    const reached = scope.tenantWide
      ? null
      : yield* dieQuery(
          withDb(
            nodesReached(
              tenantId,
              scope,
              [...known.values()].flatMap((one) =>
                one.primaryOrgNodeId === null ? [] : [one.primaryOrgNodeId],
              ),
            ),
          ),
        )
    const administers = (nodeId: string | null) =>
      reached === null || (nodeId !== null && reached.has(nodeId))
    const people: {
      row: JudgedRow
      disposition: 'create' | 'existing'
      existingId: string | null
      leafKey: string | null
    }[] = []
    for (const row of complete) {
      const leafKey = leafKeyOf(row)
      const leaf = leafKey === null ? null : nodeByKey.get(leafKey)!
      if (leaf?.conflict) {
        issues.push({
          rowNo: row.rowNo,
          field: null,
          severity: 'error',
          reason: 'node-type-conflict',
          detail: leaf.path,
        })
        continue
      }
      const standingAt = leafKey === null ? chain.anchor.id : (leaf!.existing?.id ?? null)
      const found = known.get(row.businessNo)
      if (found === undefined) {
        people.push({ row, disposition: 'create', existingId: null, leafKey })
        continue
      }
      if (!administers(found.primaryOrgNodeId)) {
        issues.push({
          rowNo: row.rowNo,
          field: 'businessNo',
          severity: 'error',
          reason: 'business-no-taken',
        })
        continue
      }
      const differs: string[] = []
      if (found.displayName !== row.displayName) differs.push('displayName')
      if (found.userTypeId !== type.id) differs.push('userType')
      if (standingAt === null || found.primaryOrgNodeId !== standingAt) differs.push('organization')
      if (differs.length > 0) {
        issues.push({
          rowNo: row.rowNo,
          field: 'businessNo',
          severity: 'error',
          reason: 'user-conflict',
          detail: differs.join(','),
        })
        continue
      }
      people.push({ row, disposition: 'existing', existingId: found.id, leafKey })
    }

    // The commit asks each write for its own authority: a unit is created
    // under org.tree.manage at its parent, a person is placed under
    // auth.user.manage where they stand. Authority at the anchor alone says
    // nothing about the units below it when it covers the anchor only, so
    // every unit the commit would touch is asked here and one it could not is
    // named, rather than the whole import failing at the commit. A unit yet
    // to be made is reached only by a grant over the whole subtree of the
    // nearest unit that exists.
    const outOfReach = yield* unreached(tenantId, as, chain.anchor.id, nodeByKey, [
      {
        code: MANAGE_TREE,
        reason: 'unit-out-of-reach',
        // what a creation writes to is the parent
        targets: creating.map((node) => ({
          key: node.parentKey,
          label: node.path,
        })),
      },
      {
        code: MANAGE,
        reason: 'placement-out-of-reach',
        targets: [
          ...new Set(
            people.filter((one) => one.disposition === 'create').map((one) => one.leafKey),
          ),
        ].map((key) => ({
          key,
          label: key === null ? anchorPath : nodeByKey.get(key)!.path,
        })),
      },
    ])
    issues.push(...outOfReach)

    const fingerprint = hashCanonicalJson({
      attachmentId: input.attachmentId,
      contentHash: meta.integrityValue,
      sheet: input.sheet,
      headerRow: input.headerRow,
      userTypeId: input.userTypeId,
      chain: chain.levels.map((level) => [level.orgTypeId, level.node?.id ?? level.column ?? '']),
      anchor: chain.anchor.id,
      creating: creating.map((node) => node.key).sort(),
      reusing: nodes
        .filter((node) => node.existing !== null)
        .map((node) => [node.key, node.existing!.id])
        // the default order, which compares each pair as its text
        .sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)),
      create: people
        .filter((one) => one.disposition === 'create')
        .map((one) => one.row.businessNo)
        .sort(),
      existing: people
        .filter((one) => one.disposition === 'existing')
        .map((one) => one.row.businessNo)
        .sort(),
      errors: issues.length,
    })
    return {
      meta,
      chain,
      table,
      rows,
      nodes,
      nodeByKey,
      people,
      issues,
      fingerprint,
    } satisfies Plan
  })

  const previewOf = (found: Plan) => {
    const creating = found.nodes.filter((node) => node.existing === null && !node.conflict)
    return {
      chain: found.chain.levels.map((level) => ({
        orgTypeId: level.orgTypeId,
        orgTypeName: level.orgTypeName,
        source: level.source,
        detail: level.node?.name ?? level.column ?? '',
      })),
      nodes: {
        reused: found.nodes.filter((node) => node.existing !== null).length,
        created: creating.length,
        conflicts: found.nodes.filter((node) => node.conflict).length,
      },
      users: {
        create: found.people.filter((one) => one.disposition === 'create').length,
        existing: found.people.filter((one) => one.disposition === 'existing').length,
        warnings: found.issues.filter((issue) => issue.severity === 'warning').length,
        errors: found.issues.filter((issue) => issue.severity === 'error').length,
      },
      rowCount: found.rows.length,
      issues: found.issues.slice(0, ISSUE_CAP),
      createdNodes: creating.slice(0, ISSUE_CAP).map((node) => node.path),
      planFingerprint: found.fingerprint,
    }
  }

  const preview = Effect.fn('DirectoryImport.preview')(function* (
    tenantId: string,
    input: ImportRequest,
    as: Principal,
  ) {
    return previewOf(yield* plan(tenantId, input, as))
  })

  const commit = Effect.fn('DirectoryImport.commit')(function* (
    tenantId: string,
    input: ImportRequest & { readonly expectedPlanFingerprint: string },
    as: Principal,
  ) {
    // the file is read outside the lock: nothing about a workbook needs the
    // tenant serialized behind it
    yield* requireManageSomewhere(as)
    const meta = yield* stagedFile(tenantId, input.attachmentId, as)
    const table = yield* tableOf(tenantId, input.attachmentId, as, input.sheet, input.headerRow)
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId).pipe(Effect.orDie)
          const found = yield* plan(tenantId, input, as, { meta, table })
          if (found.issues.some((issue) => issue.severity === 'error')) {
            return yield* new UserImportInvalid({ issues: found.issues.slice(0, ISSUE_CAP) })
          }
          // what the reader confirmed has to be what is here now
          if (found.fingerprint !== input.expectedPlanFingerprint) {
            return yield* new UserImportPlanChanged()
          }

          // units first, parents before children, each under the authority
          // the single creation asks for
          const createdIds = new Map<string, OrgNodeRef>()
          const idOf = (node: ResolvedNode): string =>
            node.existing?.id ?? createdIds.get(node.key)!.id
          for (const node of found.nodes) {
            if (node.existing !== null) continue
            const parentId =
              node.parentKey === null
                ? found.chain.anchor.id
                : idOf(found.nodeByKey.get(node.parentKey)!)
            const made = yield* org
              .createChild(tenantId, { parentId, orgTypeId: node.orgTypeId, name: node.name }, as)
              .pipe(Effect.catchTag('OrgNodeRefused', () => new UserImportPlanChanged()))
            createdIds.set(node.key, made)
          }

          // then the people, in one judged batch
          const toCreate = found.people.filter((one) => one.disposition === 'create')
          const created = yield* users
            .createUsers(
              tenantId,
              toCreate.map((one) => ({
                displayName: one.row.displayName,
                businessNo: one.row.businessNo,
                userTypeId: input.userTypeId,
                primaryOrgNodeId:
                  one.leafKey === null
                    ? found.chain.anchor.id
                    : idOf(found.nodeByKey.get(one.leafKey)!),
              })),
              as,
            )
            .pipe(Effect.catchTag('UserProvisioningRefused', () => new UserImportPlanChanged()))
          const createdIdByIndex = new Map(created.map((one) => [one.index, one.id]))

          // the file enters history in the same transaction the people do
          yield* storage
            .bind({ tenantId, attachmentId: input.attachmentId, ownerUserId: as.userId })
            .pipe(Effect.catch(() => Effect.fail(new UserImportSourceUnavailable())))

          const importId = yield* insertImport({
            tenantId,
            sourceAttachmentId: input.attachmentId,
            filenameSnapshot: meta.filename,
            sizeBytes: meta.size.toString(),
            contentHashAlgorithm: meta.integrityAlgorithm,
            contentHash: meta.integrityValue,
            actorId: as.userId,
            sheetName: input.sheet,
            headerRow: input.headerRow,
            userTypeId: input.userTypeId,
            anchorNodeId: found.chain.anchor.id,
            mappingSnapshot: input.mapping,
            chainSnapshot: found.chain.levels.map((level) => ({
              orgTypeId: level.orgTypeId,
              source: level.source,
              detail: level.node?.id ?? level.column ?? '',
            })),
            sourceRowCount: found.rows.length,
            createdUserCount: created.length,
            existingUserCount: found.people.length - toCreate.length,
            createdNodeCount: createdIds.size,
            reusedNodeCount: found.nodes.length - createdIds.size,
          }).pipe(translateConstraints(importConstraints))
          yield* insertRows(
            tenantId,
            importId,
            found.people.map((one, at) => {
              const leaf = one.leafKey === null ? null : found.nodeByKey.get(one.leafKey)!
              const index = toCreate.indexOf(one)
              return {
                sourceRowNo: one.row.rowNo,
                userId:
                  one.disposition === 'create'
                    ? (createdIdByIndex.get(index) ?? null)
                    : one.existingId,
                businessNoSnapshot: one.row.businessNo,
                displayNameSnapshot: one.row.displayName,
                primaryOrgNodeIdSnapshot: leaf === null ? found.chain.anchor.id : idOf(leaf),
                primaryOrgPathSnapshot: leaf === null ? found.chain.anchor.name : leaf.path,
                disposition: one.disposition === 'create' ? 'created' : 'existing',
                at,
              }
            }),
          )
          yield* insertNodes(
            tenantId,
            importId,
            found.nodes.map((node) => ({
              orgNodeId: idOf(node),
              parentNodeIdSnapshot:
                node.parentKey === null
                  ? found.chain.anchor.id
                  : idOf(found.nodeByKey.get(node.parentKey)!),
              orgTypeIdSnapshot: node.orgTypeId,
              nameSnapshot: node.name,
              pathSnapshot: node.path,
              depthInImport: node.depth,
              disposition: node.existing === null ? 'created' : 'reused',
            })),
          )
          yield* audit.record(ImportCommitted, {
            tenantId,
            actor: { kind: 'user', userId: as.userId },
            target: { id: importId, label: meta.filename },
            organizationId: found.chain.anchor.id,
            details: {
              userTypeId: input.userTypeId,
              anchorNodeId: found.chain.anchor.id,
              createdUsers: created.length,
              existingUsers: found.people.length - toCreate.length,
              createdNodes: createdIds.size,
              reusedNodes: found.nodes.length - createdIds.size,
            },
          })
          return {
            importId,
            createdUsers: created.length,
            existingUsers: found.people.length - toCreate.length,
            createdNodes: createdIds.size,
            reusedNodes: found.nodes.length - createdIds.size,
          }
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
  })

  // --- history ---

  /** one import the reader may see: its anchor is inside their reach */
  const reachable = Effect.fn('DirectoryImport.reachable')(function* (
    tenantId: string,
    importId: string,
    as: Principal,
  ) {
    const row = yield* dieQuery(withDb(importOf(tenantId, importId)))
    if (row === null) return yield* new UserImportNotFound()
    if (!(yield* rbac.canAt(as, MANAGE, row.anchorNodeId))) return yield* new UserImportNotFound()
    return row
  })

  const summaryOf = Effect.fn('DirectoryImport.summaryOf')(function* (
    tenantId: string,
    row: ImportRow,
  ) {
    const standing = yield* dieQuery(withDb(standingOf(tenantId, row.id)))
    const anchor = (yield* org.nodesById(tenantId, [row.anchorNodeId]))[0]
    const anchorPath =
      anchor === undefined ? '' : (yield* namesOf(tenantId, anchor)).join(PATH_SEPARATOR)
    const types = new Map((yield* org.types(tenantId)).map((type) => [type.id, type.name]))
    const chain = (row.chainSnapshot as readonly { orgTypeId?: string }[]).map(
      (level) => types.get(level.orgTypeId ?? '') ?? '',
    )
    return {
      id: row.id,
      filename: row.filenameSnapshot,
      sizeBytes: String(row.sizeBytes),
      actorId: row.actorId,
      actorName: row.actorName,
      userTypeName: row.userTypeName,
      anchorPath,
      chain,
      sourceRowCount: row.sourceRowCount,
      createdUserCount: row.createdUserCount,
      existingUserCount: row.existingUserCount,
      createdNodeCount: row.createdNodeCount,
      reusedNodeCount: row.reusedNodeCount,
      createdAt: new Date(row.createdAt).toISOString(),
      standing,
    }
  })

  const list = Effect.fn('DirectoryImport.list')(function* (
    tenantId: string,
    page: { readonly page?: string; readonly limit?: string },
    as: Principal,
  ) {
    const scope = yield* rbac.listAuthorizedScope(as, MANAGE)
    const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
    const total = yield* dieQuery(withDb(importsCount({ tenantId, scope })))
    const window = pageWindow(pageNumber(page.page), limit, total)
    const found = yield* dieQuery(
      withDb(importsPage({ tenantId, scope, offset: window.offset, limit })),
    )
    const summaries = []
    for (const row of found) summaries.push(yield* summaryOf(tenantId, row))
    return { items: summaries, total, page: window.page, pageSize: limit }
  })

  const detail = Effect.fn('DirectoryImport.detail')(function* (
    tenantId: string,
    importId: string,
    as: Principal,
  ) {
    const row = yield* reachable(tenantId, importId, as)
    const [summary, events, nodes] = yield* Effect.all([
      summaryOf(tenantId, row),
      dieQuery(withDb(eventsOf(tenantId, importId))),
      dieQuery(withDb(nodesOf(tenantId, importId))),
    ])
    return {
      import: summary,
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind as 'reversed' | 'nodes-cleaned',
        actorId: event.actorId,
        actorName: event.actorName,
        reason: event.reason,
        affectedUserCount: event.affectedUserCount,
        deletedNodeCount: event.deletedNodeCount,
        retainedNodeCount: event.retainedNodeCount,
        createdAt: new Date(event.createdAt).toISOString(),
      })),
      nodes: nodes.map((node) => ({
        id: node.id,
        orgNodeId: node.orgNodeId,
        path: node.pathSnapshot,
        depth: node.depthInImport,
        disposition: node.disposition as 'created' | 'reused',
        present: node.presentId !== null,
      })),
    }
  })

  const rows = Effect.fn('DirectoryImport.rows')(function* (
    tenantId: string,
    importId: string,
    page: { readonly page?: string; readonly limit?: string },
    as: Principal,
  ) {
    yield* reachable(tenantId, importId, as)
    // Seeing that an import happened is the anchor's; reading who is in it
    // is each row's own. A reader whose authority stops at the anchor
    // itself reaches none of the people it placed in the units below, and
    // reads only the rows placed where their authority reaches.
    const scope = yield* rbac.listAuthorizedScope(as, MANAGE)
    const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
    const total = yield* dieQuery(withDb(rowsCount({ tenantId, importId, scope })))
    const window = pageWindow(pageNumber(page.page), limit, total)
    const items = yield* dieQuery(
      withDb(rowsPage({ tenantId, importId, scope, offset: window.offset, limit })),
    )
    return {
      total,
      page: window.page,
      pageSize: limit,
      items: items.map((row) => ({
        sourceRowNo: row.sourceRowNo,
        userId: row.userId,
        businessNo: row.businessNoSnapshot,
        displayName: row.displayNameSnapshot,
        orgPath: row.primaryOrgPathSnapshot,
        disposition: row.disposition as 'created' | 'existing',
        // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- keeps the literals from widening to string
        standing: (row.userId === null || row.presentId === null
          ? 'missing'
          : row.deletedAt !== null
            ? 'deleted'
            : row.enabled
              ? 'active'
              : 'disabled') as 'active' | 'disabled' | 'deleted' | 'missing',
      })),
    }
  })

  const reversalPreview = Effect.fn('DirectoryImport.reversalPreview')(function* (
    tenantId: string,
    importId: string,
    as: Principal,
  ) {
    yield* reachable(tenantId, importId, as)
    return yield* dieQuery(withDb(reversalStanding(tenantId, importId)))
  })

  const reverse = Effect.fn('DirectoryImport.reverse')(function* (
    tenantId: string,
    importId: string,
    input: { readonly reason: string },
    as: Principal,
  ) {
    yield* reachable(tenantId, importId, as)
    const living = yield* dieQuery(withDb(livingCreatedUserIds(tenantId, importId)))
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const outcome = yield* users.retireUsers(tenantId, living, as)
          yield* insertEvent({
            tenantId,
            importId,
            kind: 'reversed',
            actorId: as.userId,
            reason: input.reason.trim() || null,
            affectedUserCount: outcome.retired,
            deletedNodeCount: 0,
            retainedNodeCount: 0,
          })
          yield* audit.record(ImportReversed, {
            tenantId,
            actor: { kind: 'user', userId: as.userId },
            target: { id: importId },
            details: { retired: outcome.retired, skipped: outcome.skipped },
          })
          return outcome
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
  })

  const cleanNodes = Effect.fn('DirectoryImport.cleanNodes')(function* (
    tenantId: string,
    importId: string,
    as: Principal,
  ) {
    yield* reachable(tenantId, importId, as)
    // deepest first, each in its own transaction: a unit whose children
    // went first can go itself, and one that stays is named with why
    const created = (yield* dieQuery(withDb(nodesOf(tenantId, importId))))
      .filter((node) => node.disposition === 'created' && node.orgNodeId !== null)
      .sort((a, b) => b.depthInImport - a.depthInImport)
    let deleted = 0
    const retained: {
      orgNodeId: string
      path: string
      reason: 'has-children' | 'in-use' | 'missing'
    }[] = []
    for (const node of created) {
      if (node.presentId === null) continue
      const outcome = yield* org.deleteUnused(tenantId, node.orgNodeId!, as)
      if (outcome === 'deleted') deleted += 1
      else retained.push({ orgNodeId: node.orgNodeId!, path: node.pathSnapshot, reason: outcome })
    }
    yield* withDb(
      transaction(
        Effect.gen(function* () {
          yield* insertEvent({
            tenantId,
            importId,
            kind: 'nodes-cleaned',
            actorId: as.userId,
            reason: null,
            affectedUserCount: 0,
            deletedNodeCount: deleted,
            retainedNodeCount: retained.length,
          })
          yield* audit.record(ImportNodesCleaned, {
            tenantId,
            actor: { kind: 'user', userId: as.userId },
            target: { id: importId },
            details: { deleted, retained: retained.length },
          })
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    return { deleted, retained }
  })

  const options = Effect.fn('DirectoryImport.options')(function* (tenantId: string, as: Principal) {
    // the screen is behind manage somewhere; the grammar is not a secret
    // from somebody who may create people
    yield* requireManageSomewhere(as)
    const [types, rules, root, userTypes] = yield* Effect.all([
      org.types(tenantId),
      org.rules(tenantId),
      org.rootNode(tenantId),
      dieQuery(withDb(assignableUserTypes(tenantId))),
    ])
    return {
      userTypes,
      orgTypes: types,
      rules,
      root: root === null ? null : { id: root.id, name: root.name, orgTypeId: root.orgTypeId },
    }
  })

  const prepareUpload = Effect.fn('DirectoryImport.prepareUpload')(function* (
    tenantId: string,
    input: { readonly filename: string; readonly declaredMime: string; readonly size: string },
    as: Principal,
  ) {
    yield* requireManageSomewhere(as)
    return yield* storage
      .prepareUpload({
        tenantId,
        ownerUserId: as.userId,
        filename: input.filename,
        declaredMime: input.declaredMime,
        size: BigInt(input.size),
        // no bigger than the reader will open: a larger file would be
        // stored, counted against the uploader's quota, and never read
        maxFileBytes: BigInt(SPREADSHEET_LIMITS.maxFileBytes),
      })
      .pipe(
        Effect.catchTags({
          STORAGE_UPLOAD_REFUSED: (refused) =>
            refused.reason === 'file-too-large'
              ? new UserImportInvalid({
                  issues: [
                    { rowNo: null, field: null, severity: 'error', reason: 'file-too-large' },
                  ],
                })
              : new AccessDenied({ reason: refused.reason }),
          STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
        }),
      )
  })

  const completeUpload = Effect.fn('DirectoryImport.completeUpload')(function* (
    tenantId: string,
    reservationId: string,
    as: Principal,
  ) {
    return yield* storage.completeUpload({ tenantId, ownerUserId: as.userId, reservationId }).pipe(
      Effect.map((meta) => ({ id: meta.id, filename: meta.filename, size: meta.size.toString() })),
      Effect.catchTags({
        STORAGE_RESERVATION_NOT_FOUND: () => new UserImportSourceUnavailable(),
        STORAGE_RESERVATION_INVALID: () => new UserImportSourceUnavailable(),
        STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
      }),
    )
  })

  return {
    options,
    prepareUpload,
    completeUpload,
    inspect,
    preview,
    commit,
    list,
    detail,
    rows,
    reversalPreview,
    reverse,
    cleanNodes,
  }
})

export type DirectoryImportShape = Effect.Success<typeof make>

// --- queries ---

type ImportRow =
  Effect.Success<ReturnType<typeof importOf>> extends infer R ? NonNullable<R> : never

const importColumns = (k: Parameters<Parameters<typeof db.query>[0]>[0]) =>
  k
    .selectFrom('DirectoryImport as i')
    .leftJoin('User as a', (join) =>
      join.onRef('a.tenantId', '=', 'i.tenantId').onRef('a.id', '=', 'i.actorId'),
    )
    .leftJoin('UserType as t', (join) =>
      join.onRef('t.tenantId', '=', 'i.tenantId').onRef('t.id', '=', 'i.userTypeId'),
    )
    .select([
      'i.id',
      'i.filenameSnapshot',
      'i.sizeBytes',
      'i.actorId',
      'i.userTypeId',
      'i.anchorNodeId',
      'i.chainSnapshot',
      'i.sourceRowCount',
      'i.createdUserCount',
      'i.existingUserCount',
      'i.createdNodeCount',
      'i.reusedNodeCount',
      'a.displayName as actorName',
      't.name as userTypeName',
    ])
    .select(['i.createdAt'])
    .select([sql<string>`i.created_at::text`.as('cursorAt')])

const importOf = (tenantId: string, importId: string) =>
  db
    .query((k) =>
      importColumns(k)
        .where('i.tenantId', '=', tenantId)
        .where('i.id', '=', importId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row ?? null))

const importsPage = (input: {
  tenantId: string
  scope: Parameters<typeof scopeCoverage>[0]
  offset: number
  limit: number
}) =>
  db.query((k) => {
    const query = importColumns(k)
      .innerJoin('OrgNode as n', (join) =>
        join.onRef('n.tenantId', '=', 'i.tenantId').onRef('n.id', '=', 'i.anchorNodeId'),
      )
      .where('i.tenantId', '=', input.tenantId)
      .where((eb) =>
        scopeCoverage(input.scope, {
          tenantId: eb.ref('n.tenantId'),
          id: eb.ref('n.id'),
          path: eb.ref('n.path'),
        }),
      )
      .orderBy('i.createdAt', 'desc')
      .orderBy('i.id', 'desc')
      .limit(input.limit)
      .offset(input.offset)
    return query.execute()
  })

/** how many imports this reader can reach, for the page numbers */
const importsCount = (input: { tenantId: string; scope: Parameters<typeof scopeCoverage>[0] }) =>
  db.query((k) =>
    k
      .selectFrom('DirectoryImport as i')
      .innerJoin('OrgNode as n', (join) =>
        join.onRef('n.tenantId', '=', 'i.tenantId').onRef('n.id', '=', 'i.anchorNodeId'),
      )
      .where('i.tenantId', '=', input.tenantId)
      .where((eb) =>
        scopeCoverage(input.scope, {
          tenantId: eb.ref('n.tenantId'),
          id: eb.ref('n.id'),
          path: eb.ref('n.path'),
        }),
      )
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
  )

/** which of these units the scope reaches, by the one predicate every read uses */
const nodesReached = (
  tenantId: string,
  scope: Parameters<typeof scopeCoverage>[0],
  nodeIds: readonly string[],
) =>
  nodeIds.length === 0
    ? Effect.succeed(new Set<string>())
    : db.query((k) =>
        k
          .selectFrom('OrgNode as n')
          .select('n.id')
          .where('n.tenantId', '=', tenantId)
          .where('n.id', 'in', [...new Set(nodeIds)])
          .where((eb) =>
            scopeCoverage(scope, {
              tenantId: eb.ref('n.tenantId'),
              id: eb.ref('n.id'),
              path: eb.ref('n.path'),
            }),
          )
          .execute()
          .then((rows) => new Set(rows.map((row) => row.id))),
      )

const standingOf = (tenantId: string, importId: string) =>
  db.query((k) =>
    k
      .selectFrom('DirectoryImportRow as r')
      .leftJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.userId'),
      )
      .where('r.tenantId', '=', tenantId)
      .where('r.importId', '=', importId)
      .where('r.disposition', '=', 'created')
      .select((eb) => [
        eb.fn.count<number>('r.id').filterWhere('u.deletedAt', 'is', null).as('living'),
        eb.fn.count<number>('r.id').filterWhere('u.deletedAt', 'is not', null).as('deleted'),
      ])
      .executeTakeFirstOrThrow()
      .then((row) => ({ living: Number(row.living), deleted: Number(row.deleted) })),
  )

const eventsOf = (tenantId: string, importId: string) =>
  db.query((k) =>
    k
      .selectFrom('DirectoryImportEvent as e')
      .leftJoin('User as a', (join) =>
        join.onRef('a.tenantId', '=', 'e.tenantId').onRef('a.id', '=', 'e.actorId'),
      )
      .select([
        'e.id',
        'e.kind',
        'e.actorId',
        'e.reason',
        'e.affectedUserCount',
        'e.deletedNodeCount',
        'e.retainedNodeCount',
        'a.displayName as actorName',
      ])
      .select(['e.createdAt'])
      .where('e.tenantId', '=', tenantId)
      .where('e.importId', '=', importId)
      .orderBy('e.createdAt', 'desc')
      .execute(),
  )

const nodesOf = (tenantId: string, importId: string) =>
  db.query((k) =>
    k
      .selectFrom('DirectoryImportNode as n')
      .leftJoin('OrgNode as o', (join) =>
        join.onRef('o.tenantId', '=', 'n.tenantId').onRef('o.id', '=', 'n.orgNodeId'),
      )
      .select([
        'n.id',
        'n.orgNodeId',
        'n.pathSnapshot',
        'n.depthInImport',
        'n.disposition',
        'o.id as presentId',
      ])
      .where('n.tenantId', '=', tenantId)
      .where('n.importId', '=', importId)
      .orderBy('n.depthInImport', 'asc')
      .orderBy('n.pathSnapshot', 'asc')
      .execute(),
  )

/** the rows of an import placed where the reader's authority reaches */
const visibleRows = (
  k: Parameters<Parameters<typeof db.query>[0]>[0],
  input: { tenantId: string; importId: string; scope: Parameters<typeof scopeCoverage>[0] },
) =>
  k
    .selectFrom('DirectoryImportRow as r')
    // where the row placed the person; a unit since purged is reached by
    // nobody below the tenant, the same as any other node that is not there
    .leftJoin('OrgNode as n', (join) =>
      join.onRef('n.tenantId', '=', 'r.tenantId').onRef('n.id', '=', 'r.primaryOrgNodeIdSnapshot'),
    )
    .where('r.tenantId', '=', input.tenantId)
    .where('r.importId', '=', input.importId)
    .where((eb) =>
      scopeCoverage(input.scope, {
        tenantId: eb.ref('n.tenantId'),
        id: eb.ref('n.id'),
        path: eb.ref('n.path'),
      }),
    )

const rowsPage = (input: {
  tenantId: string
  importId: string
  scope: Parameters<typeof scopeCoverage>[0]
  offset: number
  limit: number
}) =>
  db.query((k) => {
    const query = visibleRows(k, input)
      .leftJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.userId'),
      )
      .select([
        'r.sourceRowNo',
        'r.userId',
        'r.businessNoSnapshot',
        'r.displayNameSnapshot',
        'r.primaryOrgPathSnapshot',
        'r.disposition',
        'u.id as presentId',
        'u.enabled',
        'u.deletedAt',
      ])
      .orderBy('r.sourceRowNo', 'asc')
      .limit(input.limit)
      .offset(input.offset)
    return query.execute()
  })

const rowsCount = (input: {
  tenantId: string
  importId: string
  scope: Parameters<typeof scopeCoverage>[0]
}) =>
  db.query((k) =>
    visibleRows(k, input)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
  )

const livingCreatedUserIds = (tenantId: string, importId: string) =>
  db.query((k) =>
    k
      .selectFrom('DirectoryImportRow as r')
      .innerJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.userId'),
      )
      .select('u.id')
      .where('r.tenantId', '=', tenantId)
      .where('r.importId', '=', importId)
      .where('r.disposition', '=', 'created')
      .where('u.deletedAt', 'is', null)
      .orderBy('r.sourceRowNo', 'asc')
      .execute()
      .then((rows) => rows.map((row) => row.id)),
  )

const reversalStanding = (tenantId: string, importId: string) =>
  Effect.gen(function* () {
    const counted = yield* db.query((k) =>
      k
        .selectFrom('DirectoryImportRow as r')
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.userId'),
        )
        .where('r.tenantId', '=', tenantId)
        .where('r.importId', '=', importId)
        .where('r.disposition', '=', 'created')
        .select((eb) => [
          eb.fn.count<number>('r.id').filterWhere('u.deletedAt', 'is', null).as('toRetire'),
          eb.fn
            .count<number>('r.id')
            .filterWhere((where) =>
              where.or([where('u.id', 'is', null), where('u.deletedAt', 'is not', null)]),
            )
            .as('alreadyGone'),
        ])
        .executeTakeFirstOrThrow(),
    )
    const withBindings = yield* db.query((k) =>
      k
        .selectFrom('DirectoryImportRow as r')
        .innerJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.userId'),
        )
        .innerJoin('UserAuthBinding as b', (join) =>
          join.onRef('b.tenantId', '=', 'r.tenantId').onRef('b.userId', '=', 'r.userId'),
        )
        .where('r.tenantId', '=', tenantId)
        .where('r.importId', '=', importId)
        .where('r.disposition', '=', 'created')
        .where('u.deletedAt', 'is', null)
        .where('b.revokedAt', 'is', null)
        .select((eb) => eb.fn.count<number>('r.id').distinct().as('n'))
        .executeTakeFirstOrThrow(),
    )
    const withGrants = yield* db.query((k) =>
      k
        .selectFrom('DirectoryImportRow as r')
        .innerJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.userId'),
        )
        .innerJoin('RoleGrant as g', (join) =>
          join.onRef('g.tenantId', '=', 'r.tenantId').onRef('g.userId', '=', 'r.userId'),
        )
        .where('r.tenantId', '=', tenantId)
        .where('r.importId', '=', importId)
        .where('r.disposition', '=', 'created')
        .where('u.deletedAt', 'is', null)
        .where('g.revokedAt', 'is', null)
        .select((eb) => eb.fn.count<number>('r.id').distinct().as('n'))
        .executeTakeFirstOrThrow(),
    )
    return {
      toRetire: Number(counted.toRetire),
      alreadyGone: Number(counted.alreadyGone),
      withBindings: Number(withBindings.n),
      withGrants: Number(withGrants.n),
    }
  })

const assignableUserTypes = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserType')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .where('enabled', '=', true)
      .where('isSystem', '=', false)
      .orderBy('sortOrder', 'asc')
      .orderBy('name', 'asc')
      .execute(),
  )

const jsonb = (value: unknown) => sql<Record<string, unknown>>`${JSON.stringify(value)}::jsonb`

const insertImport = (input: {
  tenantId: string
  sourceAttachmentId: string
  filenameSnapshot: string
  sizeBytes: string
  contentHashAlgorithm: string | null
  contentHash: string | null
  actorId: string
  sheetName: string
  headerRow: number
  userTypeId: string
  anchorNodeId: string
  mappingSnapshot: unknown
  chainSnapshot: unknown
  sourceRowCount: number
  createdUserCount: number
  existingUserCount: number
  createdNodeCount: number
  reusedNodeCount: number
}) =>
  db.query((k) =>
    k
      .insertInto('DirectoryImport')
      .values({
        tenantId: input.tenantId,
        sourceAttachmentId: input.sourceAttachmentId,
        filenameSnapshot: input.filenameSnapshot,
        sizeBytes: sql<string>`${input.sizeBytes}::bigint` as never,
        contentHashAlgorithm: input.contentHashAlgorithm,
        contentHash: input.contentHash,
        actorId: input.actorId,
        sheetName: input.sheetName,
        headerRow: input.headerRow,
        userTypeId: input.userTypeId,
        anchorNodeId: input.anchorNodeId,
        mappingSnapshot: jsonb(input.mappingSnapshot),
        chainSnapshot: jsonb(input.chainSnapshot) as never,
        sourceRowCount: input.sourceRowCount,
        createdUserCount: input.createdUserCount,
        existingUserCount: input.existingUserCount,
        createdNodeCount: input.createdNodeCount,
        reusedNodeCount: input.reusedNodeCount,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id),
  )

const insertRows = (
  tenantId: string,
  importId: string,
  rows: readonly {
    sourceRowNo: number
    userId: string | null
    businessNoSnapshot: string
    displayNameSnapshot: string
    primaryOrgNodeIdSnapshot: string
    primaryOrgPathSnapshot: string
    disposition: string
    at: number
  }[],
) =>
  rows.length === 0
    ? Effect.void
    : db.query((k) =>
        k
          .insertInto('DirectoryImportRow')
          .values(
            rows.map((row) => ({
              tenantId,
              importId,
              sourceRowNo: row.sourceRowNo,
              userId: row.userId,
              businessNoSnapshot: row.businessNoSnapshot,
              displayNameSnapshot: row.displayNameSnapshot,
              primaryOrgNodeIdSnapshot: row.primaryOrgNodeIdSnapshot,
              primaryOrgPathSnapshot: row.primaryOrgPathSnapshot,
              disposition: row.disposition,
            })),
          )
          .execute(),
      )

const insertNodes = (
  tenantId: string,
  importId: string,
  nodes: readonly {
    orgNodeId: string
    parentNodeIdSnapshot: string
    orgTypeIdSnapshot: string
    nameSnapshot: string
    pathSnapshot: string
    depthInImport: number
    disposition: string
  }[],
) =>
  nodes.length === 0
    ? Effect.void
    : db.query((k) =>
        k
          .insertInto('DirectoryImportNode')
          .values(nodes.map((node) => ({ tenantId, importId, ...node })))
          .execute(),
      )

const insertEvent = (input: {
  tenantId: string
  importId: string
  kind: string
  actorId: string
  reason: string | null
  affectedUserCount: number
  deletedNodeCount: number
  retainedNodeCount: number
}) => db.query((k) => k.insertInto('DirectoryImportEvent').values(input).execute())

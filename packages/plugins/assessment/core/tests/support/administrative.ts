import ExcelJS from 'exceljs'
import { sql } from 'kysely'
import { Effect } from 'effect'
import { runSql } from '@qualy/plugin-database/testkit'
import { Storage } from '@qualy/plugin-storage/server'
import { Assessment } from '../../src/server/index.ts'
import { DATA_SHEET } from '../../src/administrative-import/workbook.ts'
import { backend, one, type Seeded } from './round.ts'

// What every suite about administrative imports starts from: a question to
// import into, students a workbook can name, and the workbook itself, filled
// in and sent back through the import door the way a person would.

/**
 * One row as the template lays it out.
 *
 * A row is written the way a person reads the sheet: the business number,
 * the name, then the basis - which the template always puts last - with
 * anything in between being the question's own columns, left blank unless
 * given after the basis.
 */
export const laidOut = (sheet: ExcelJS.Worksheet, row: readonly string[]): string[] => {
  const width = sheet.getRow(1).cellCount
  const [businessNo = '', name = '', basis = '', ...between] = row
  const cells = Array.from({ length: width }, () => '')
  cells[0] = businessNo
  cells[1] = name
  between.forEach((value, at) => {
    cells[2 + at] = value
  })
  cells[width - 1] = basis
  return cells
}

/** an administrative question, published and ready */
export const recordItem = (
  f: Seeded,
  batchId: string,
  over?: {
    maxEntries?: number | null
    formConfig?: Record<string, unknown>
    scoringConfig?: Record<string, unknown>
  },
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const admin = f.principal(f.admin)
    const groups = yield* assessment.listScoreGroups(f.t, batchId, admin)
    const stage = (id: string) => ({
      id,
      selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
      quorum: { type: 'any' },
    })
    const item = yield* assessment.createItem(
      f.t,
      batchId,
      {
        itemType: 'evidence',
        title: '违纪扣分',
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: over?.maxEntries ?? null,
        config: {
          entryChannels: ['administrative'],
          formConfig: over?.formConfig ?? {},
          scoringConfig: over?.scoringConfig ?? {
            calculator: { ref: 'fixed@1', config: { value: '-1.00' } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          reviewPolicy: {
            normal: { stages: [stage('s1')] },
            escalation: { stages: [stage('appeal')] },
          },
        },
      },
      admin,
    )
    yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
    return item
  })

/** give the seeded students numbers a workbook can name them by */
export const numbered = (f: Seeded) =>
  Effect.gen(function* () {
    yield* runSql(sql`update users set business_no = '2023001' where id = ${f.s1}`)
    yield* runSql(sql`update users set business_no = '2023002' where id = ${f.s2}`)
    // college B: outside the recorder's reach
    yield* runSql(sql`update users set business_no = '2023003' where id = ${f.s3}`)
    yield* runSql(sql`update users set business_no = '9999999' where id = ${f.recorder}`)
  })

/**
 * The template for a question, filled in and sent back through the import
 * door - exactly the file a person would produce.
 */
export const workbook = (
  f: Seeded,
  itemId: string,
  who: string,
  rows: readonly (readonly string[])[],
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const storage = yield* Storage
    const template = yield* assessment.administrativeImportTemplate(
      f.t,
      itemId,
      'zh-CN',
      f.principal(who),
    )
    const book = new ExcelJS.Workbook()
    yield* Effect.promise(() => book.xlsx.load(template.bytes as unknown as ArrayBuffer))
    const sheet = book.getWorksheet(DATA_SHEET)!
    for (const row of rows) sheet.addRow(laidOut(sheet, row))
    const bytes = Buffer.from(yield* Effect.promise(() => book.xlsx.writeBuffer()))
    const ticket = yield* storage.prepareUpload({
      tenantId: f.t,
      ownerUserId: who,
      filename: 'import.xlsx',
      declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: BigInt(bytes.byteLength),
    })
    backend.put(`attachments/${f.t}/${ticket.attachmentId}`, bytes)
    const meta = yield* storage.completeUpload({
      tenantId: f.t,
      ownerUserId: who,
      reservationId: ticket.reservationId,
    })
    return meta.id
  })

/** how many rows each import table holds, for asserting nothing was written */
export const counts = (f: Seeded) =>
  Effect.gen(function* () {
    const imports = one<{ n: number }>(
      yield* runSql(
        sql`select count(*)::int as n from administrative_entry_imports where tenant_id = ${f.t}`,
      ),
    ).n
    const entries = one<{ n: number }>(
      yield* runSql(
        sql`select count(*)::int as n from entries where tenant_id = ${f.t} and source = 'import'`,
      ),
    ).n
    return { imports, entries }
  })

/** the version a question currently stands at, as a workbook would carry it */
export const currentRevisionOf = (itemId: string) =>
  Effect.map(
    runSql(sql`select current_revision_id as id from assessment_items where id = ${itemId}`),
    (result) => one<{ id: string }>(result).id,
  )

/** a workbook filled in, uploaded and committed by this person, in one step */
export const imported = (
  f: Seeded,
  batchId: string,
  itemId: string,
  who: string,
  rows: readonly (readonly string[])[],
  over?: { defaultBasis?: string },
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const attachmentId = yield* workbook(f, itemId, who, rows)
    const done = yield* assessment.commitAdministrativeImport(
      f.t,
      batchId,
      {
        attachmentId,
        itemId,
        expectedItemRevisionId: yield* currentRevisionOf(itemId),
        ...(over?.defaultBasis !== undefined ? { defaultBasis: over.defaultBasis } : {}),
        confirmWarnings: true,
      },
      f.principal(who),
    )
    return { ...done, attachmentId }
  })

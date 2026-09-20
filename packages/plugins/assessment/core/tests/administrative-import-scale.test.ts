import ExcelJS from 'exceljs'
import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Storage } from '@qualy/plugin-storage/server'
import { Assessment } from '../src/server/index.ts'
import { DATA_SHEET } from '../src/administrative-import/workbook.ts'
import { laidOut } from './support/administrative.ts'
import { backend, ok, one, run, runningBatch, seed } from './support/round.ts'

// A workbook the size the import is actually used at, written for real.
//
// No timing assertion: a wall-clock bound is a property of the machine, not
// of the code. What this holds is that a file this size still goes in as one
// transaction and comes out whole - the place where a per-row read, a bind
// parameter ceiling or a statement that grows with the file shows up first.
// The measured cost lives in STATUS.md.

const ROWS = 1000

describe.runIf(postgresAvailable)('an administrative import at scale', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-administrative-import-scale')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('writes a thousand-row workbook whole, in one transaction', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-scale')
          const assessment = yield* Assessment
          const storage = yield* Storage
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
            select ${f.t}, 'Student ' || n, ${f.studentType}, ${f.classA}, 'S' || lpad(n::text, 6, '0')
              from generate_series(1, ${ROWS}) as n`)
          const g = yield* runningBatch(f)
          const admin = f.principal(f.admin)
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const stage = (id: string) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          })
          const item = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '优秀学生干部',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 1,
              config: {
                entryChannels: ['administrative'],
                formConfig: {},
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '2.00' } },
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
          const template = yield* assessment.administrativeImportTemplate(
            f.t,
            item.id,
            'zh-CN',
            f.principal(f.recorder),
          )
          const book = new ExcelJS.Workbook()
          yield* Effect.promise(() => book.xlsx.load(template.bytes as unknown as ArrayBuffer))
          const sheet = book.getWorksheet(DATA_SHEET)!
          for (let n = 1; n <= ROWS; n++) {
            sheet.addRow(
              laidOut(sheet, [
                `S${String(n).padStart(6, '0')}`,
                `Student ${n}`,
                `校发〔2026〕${n} 号`,
              ]),
            )
          }
          const bytes = Buffer.from(yield* Effect.promise(() => book.xlsx.writeBuffer()))
          const ticket = yield* storage.prepareUpload({
            tenantId: f.t,
            ownerUserId: f.recorder,
            filename: 'scale.xlsx',
            declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: BigInt(bytes.byteLength),
          })
          backend.put(`attachments/${f.t}/${ticket.attachmentId}`, bytes)
          yield* storage.completeUpload({
            tenantId: f.t,
            ownerUserId: f.recorder,
            reservationId: ticket.reservationId,
          })
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const input = {
            attachmentId: ticket.attachmentId,
            itemId: item.id,
            expectedItemRevisionId: revision,
          }
          const preview = yield* assessment.previewAdministrativeImport(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const done = yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const written = one<{ n: number }>(
            yield* runSql(
              sql`select count(*)::int as n from entries where tenant_id = ${f.t} and source = 'import'`,
            ),
          ).n
          return { summary: preview.summary, done, written }
        }),
      ),
    )
    expect(found.summary).toEqual({ rows: ROWS, valid: ROWS, warnings: 0, errors: 0 })
    expect(found.done.importedCount).toBe(ROWS)
    expect(found.written).toBe(ROWS)
  }, 600_000)
})

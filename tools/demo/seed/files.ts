import fs from 'node:fs'
import path from 'node:path'
import { Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { Storage } from '@qualy/plugin-storage/server/service'
import { DEMO_STORAGE_ROOT } from '../runtime.ts'

// Files, the way a browser would have uploaded them: the product reserves the
// upload, the bytes land where the local backend keeps objects, and the
// product completes it - reading the bytes back and recording their digest
// itself, so nothing here is taken on trust.
//
// Proof images are hard links to the committed renders: fourteen thousand
// claims cite a few dozen pictures, and each needs its own object, but not
// its own copy of the bytes.

const ASSETS = path.resolve('tools/demo/assets')

const objectPath = (tenantId: string, attachmentId: string) =>
  path.resolve(DEMO_STORAGE_ROOT, 'attachments', tenantId, attachmentId)

const place = (from: string, tenantId: string, attachmentId: string) => {
  const target = objectPath(tenantId, attachmentId)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.linkSync(from, target)
}

const sizes = new Map<string, number>()
const assetFile = (asset: string) => {
  const file = path.join(ASSETS, `${asset}.jpg`)
  if (!sizes.has(asset)) sizes.set(asset, fs.statSync(file).size)
  return { file, size: sizes.get(asset)! }
}

/** one proof image uploaded for a question, by whoever is filing it */
export const stageProof = (
  tenantId: string,
  batchId: string,
  itemId: string,
  asset: string,
  filename: string,
  as: Principal,
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const { file, size } = assetFile(asset)
    const ticket = yield* assessment.prepareAttachmentUpload(
      tenantId,
      { batchId, itemId, filename, declaredMime: 'image/jpeg', size: BigInt(size) },
      as,
    )
    place(file, tenantId, ticket.attachmentId)
    const meta = yield* assessment.completeAttachmentUpload(tenantId, ticket.reservationId, as)
    return meta.id
  })

/** a workbook an importer uploads, through the plain storage door */
export const stageWorkbook = (tenantId: string, bytes: Buffer, filename: string, as: Principal) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const ticket = yield* storage.prepareUpload({
      tenantId,
      ownerUserId: as.userId,
      filename,
      declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: BigInt(bytes.byteLength),
    })
    const target = objectPath(tenantId, ticket.attachmentId)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
    const meta = yield* storage.completeUpload({
      tenantId,
      ownerUserId: as.userId,
      reservationId: ticket.reservationId,
    })
    return meta.id
  })

/** the proof pictures of each kind */
export const PROOF_ASSETS = {
  campus: ['campus-1', 'campus-2', 'campus-3'],
  competition: ['competition-1', 'competition-2', 'competition-3'],
  certificate: ['certificate-1', 'certificate-2', 'certificate-3'],
  language: ['certificate-1', 'certificate-2'],
  practice: ['practice-1', 'practice-2', 'practice-3'],
  research: ['research-1', 'research-2'],
  blood: ['blood-1'],
  honour: ['honour-1'],
  article: ['article-1'],
  sport: ['sport-1'],
} as const

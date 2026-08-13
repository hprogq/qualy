import { upload, type UploadProgress } from '@qualy/plugin-storage/client'

// One file, all the way in: ask for a ticket, spend it wherever the grant
// points, and tell the server the bytes arrived. The page holds nothing but
// the attachment id and the name to show for it.

export interface UploadedFile {
  readonly attachmentId: string
  readonly filename: string
  readonly size: string
}

export interface UploadDoors {
  readonly prepare: (input: {
    batchId: string
    itemId: string
    filename: string
    declaredMime: string
    size: string
  }) => Promise<{
    reservationId: string
    attachmentId: string
    grant: { driver: string; payload: unknown }
    expiresAt: string
  }>
  readonly complete: (
    reservationId: string,
  ) => Promise<{ id: string; filename: string; size: string }>
}

export const uploadFile = async (
  doors: UploadDoors,
  where: { batchId: string; itemId: string },
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadedFile> => {
  const ticket = await doors.prepare({
    batchId: where.batchId,
    itemId: where.itemId,
    filename: file.name,
    declaredMime: file.type || 'application/octet-stream',
    size: String(file.size),
  })
  await upload(
    {
      reservationId: ticket.reservationId,
      attachmentId: ticket.attachmentId,
      grant: ticket.grant,
      expiresAt: Date.parse(ticket.expiresAt),
    },
    file,
    { onProgress },
  )
  const meta = await doors.complete(ticket.reservationId)
  return { attachmentId: meta.id, filename: meta.filename, size: meta.size }
}

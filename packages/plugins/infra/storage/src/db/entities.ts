import { defineEntity } from '@mikro-orm/core'

// The two tables storage owns: a short-lived permission to upload one object,
// and the object itself once the backend has confirmed it exists.
//
// No foreign keys to tenants or users. This plugin does not know what a tenant
// is beyond an id it carries through, and pointing at another plugin's tables
// would make storage depend on whoever owns them - which is the wrong way
// round for a piece of infrastructure that business plugins are meant to sit
// on top of.

const p = defineEntity.properties

/**
 * Permission to write exactly one object, and the quota it has already spent.
 *
 * Issued before the browser uploads anything, which is the point: an account
 * that asks for a thousand keys and uploads nothing has still spent a
 * thousand keys' worth of somebody's allowance. The attachment's id and its
 * final key are decided here, so the object is immutable from the first byte
 * written rather than after a later move.
 */
export const UploadReservation = defineEntity({
  name: 'UploadReservation',
  tableName: 'storage_upload_reservations',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: p.uuid(),
    ownerUserId: p.uuid(),
    /** the attachment this ticket will become, decided now so the key is */
    attachmentId: p.uuid(),
    backend: p.string().length(31),
    storageKey: p.string().length(255),
    filename: p.string().length(255),
    declaredMime: p.string().length(127),
    /** what it may weigh, and what it costs the owner's allowance meanwhile */
    reservedBytes: p.bigint(),
    status: p.string().length(31).default('issued'),
    /** when the upload credential stops working */
    grantExpiresAt: p.datetime(),
    /**
     * When the abandoned-upload sweeper may delete the object.
     *
     * Later than the credential expires, on purpose: a slow upload that
     * started while the credential was valid may still be arriving, and a
     * sweeper that ran at the same instant would delete an object that was
     * about to land.
     */
    cleanupAfter: p.datetime(),
    createdAt: p.datetime().defaultRaw('now()'),
    completedAt: p.datetime().nullable(),
    expiredAt: p.datetime().nullable(),
    failedAt: p.datetime().nullable(),
    /** a lease, not a state: one worker at a time, and it can be taken over */
    cleanupClaimedAt: p.datetime().nullable(),
  },
  checks: [
    {
      name: 'chk_storage_upload_reservations_status',
      expression: `status IN ('issued', 'completed', 'expired', 'failed')`,
    },
    { name: 'chk_storage_upload_reservations_reserved_bytes', expression: 'reserved_bytes > 0' },
    {
      name: 'chk_storage_upload_reservations_cleanup_after',
      expression: 'cleanup_after >= grant_expires_at',
    },
  ],
  indexes: [
    {
      name: 'uq_storage_upload_reservations_attachment',
      expression:
        'create unique index uq_storage_upload_reservations_attachment on storage_upload_reservations (attachment_id)',
    },
    {
      name: 'uq_storage_upload_reservations_object',
      expression:
        'create unique index uq_storage_upload_reservations_object on storage_upload_reservations (backend, storage_key)',
    },
    {
      name: 'idx_storage_upload_reservations_owner',
      expression:
        'create index idx_storage_upload_reservations_owner on storage_upload_reservations (tenant_id, owner_user_id, created_at desc)',
    },
    {
      name: 'idx_storage_upload_reservations_sweep',
      expression:
        'create index idx_storage_upload_reservations_sweep on storage_upload_reservations (status, cleanup_after)',
    },
  ],
})

/**
 * An object the backend has confirmed exists.
 *
 * Created by completeUpload and never by the browser's word: size and
 * integrity come from asking the backend about the object, because the only
 * thing the uploader can tell us is that it is worth looking.
 */
export const Attachment = defineEntity({
  name: 'Attachment',
  tableName: 'storage_attachments',
  properties: {
    id: p.uuid().primary(),
    tenantId: p.uuid(),
    ownerUserId: p.uuid(),
    backend: p.string().length(31),
    filename: p.string().length(255),
    declaredMime: p.string().length(127),
    size: p.bigint(),
    /** how the fingerprint was taken, because backends differ */
    integrityAlgorithm: p.string().length(31),
    /** not unique: it identifies the bytes, not the attachment */
    integrityValue: p.string().length(127),
    etag: p.string().length(127).nullable(),
    storageKey: p.string().length(255),
    status: p.string().length(31).default('staged'),
    boundAt: p.datetime().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
    cleanupClaimedAt: p.datetime().nullable(),
  },
  checks: [
    {
      name: 'chk_storage_attachments_status',
      expression: `status IN ('staged', 'bound', 'retired')`,
    },
    { name: 'chk_storage_attachments_size', expression: 'size >= 0' },
    // bound and retired are both past the point of no return, and a row that
    // reached either without recording when would lose that fact
    {
      name: 'chk_storage_attachments_bound_at',
      expression: `(status = 'staged') = (bound_at IS NULL)`,
    },
  ],
  indexes: [
    {
      name: 'uq_storage_attachments_tenant_id_id',
      expression:
        'create unique index uq_storage_attachments_tenant_id_id on storage_attachments (tenant_id, id)',
    },
    {
      name: 'uq_storage_attachments_object',
      expression:
        'create unique index uq_storage_attachments_object on storage_attachments (backend, storage_key)',
    },
    {
      name: 'idx_storage_attachments_owner',
      expression:
        'create index idx_storage_attachments_owner on storage_attachments (tenant_id, owner_user_id, status)',
    },
    {
      name: 'idx_storage_attachments_sweep',
      expression:
        'create index idx_storage_attachments_sweep on storage_attachments (status, created_at)',
    },
  ],
})

export const entities = [UploadReservation, Attachment] as const

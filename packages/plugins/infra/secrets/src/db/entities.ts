import { defineEntity } from '@mikro-orm/core'

// The one table this plugin owns: a value somebody asked to keep secret,
// encrypted under the deployment's master key.
//
// No foreign keys to tenants or to whatever owns the value. Secrets does not
// know what a tenant or a login entrance is beyond the ids it is handed, the
// same way storage does not; the owner deletes its secrets when it goes.

const p = defineEntity.properties

/**
 * One secret value of one owner.
 *
 * The owner is `(tenant, kind, id)` and the value is named by `key` within it.
 * All four are also the ciphertext's additional authenticated data, so a row
 * copied onto another owner or another key does not decrypt.
 */
export const Secret = defineEntity({
  name: 'Secret',
  tableName: 'secrets',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: p.uuid(),
    ownerKind: p.string().length(63),
    ownerId: p.uuid(),
    key: p.string().length(127),
    ciphertext: p.blob(),
    nonce: p.blob(),
    authTag: p.blob(),
    /** which master key sealed it; there is one so far */
    keyVersion: p.smallint().default(1),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'uq_secrets_owner_key',
      expression:
        'create unique index uq_secrets_owner_key on secrets (tenant_id, owner_kind, owner_id, key)',
    },
  ],
  checks: [
    {
      name: 'chk_secrets_nonce_length',
      expression: 'octet_length(nonce) = 12',
    },
    {
      name: 'chk_secrets_auth_tag_length',
      expression: 'octet_length(auth_tag) = 16',
    },
  ],
})

export const entities = [Secret] as const

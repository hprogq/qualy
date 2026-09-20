import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// One table: what a tenant chose for a setting the code defines.
//
// The row holds a JSON value and a version, and nothing about what the value
// means - the declaring plugin's definition says that, and stores nothing
// here. A row exists only once a tenant has written the setting; "back to
// the default" is an empty object under a higher version, never a delete,
// so the version a screen carries can only ever move forward.

const p = defineEntity.properties

export const TenantSettingValue = defineEntity({
  name: 'TenantSettingValue',
  tableName: 'tenant_setting_values',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: () =>
      p
        .manyToOne(Tenant)
        .joinColumns('tenant_id')
        .referencedColumnNames('id')
        .foreignKeyName('tenant_setting_values_tenant_id_tenants_id_fkey')
        .deleteRule('cascade'),
    settingId: p.string().length(191),
    value: p.json<Record<string, unknown>>(),
    version: p.integer().default(1),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_tenant_setting_values_setting_id_format',
      expression: `setting_id ~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$'`,
    },
    {
      name: 'chk_tenant_setting_values_version_positive',
      expression: 'version >= 1',
    },
  ],
  indexes: [
    {
      name: 'uq_tenant_setting_values_tenant_setting',
      expression:
        'create unique index uq_tenant_setting_values_tenant_setting on tenant_setting_values (tenant_id, setting_id)',
    },
  ],
})

export const entities = [TenantSettingValue] as const

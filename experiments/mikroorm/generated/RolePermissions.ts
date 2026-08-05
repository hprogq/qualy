import { type Opt, PrimaryKeyProp, type Ref, defineEntity, p } from '@mikro-orm/core';
import { Permissions } from './Permissions.js';
import { Roles } from './Roles.js';
import { Tenants } from './Tenants.js';

export class RolePermissions {
  [PrimaryKeyProp]?: ['tenant', 'role', 'permission'];
  tenant!: Ref<Tenants>;
  tenantId!: string;
  role!: Ref<Roles>;
  roleId!: string;
  permission!: Ref<Permissions>;
  permissionId!: string;
  createdAt!: Date & Opt;
}

export const RolePermissionsSchema = defineEntity({
  class: RolePermissions,
  properties: {
    tenant: () => p.manyToOne(Tenants).primary().ref().updateRule('no action'),
    tenantId: p.uuid().persist(false),
    role: () => p.manyToOne(Roles).primary().ref().fieldNames('tenant_id','role_id').referencedColumnNames('tenant_id','id').updateRule('no action').index('idx_role_permissions_tenant_role'),
    roleId: p.uuid().persist(false),
    permission: () => p.manyToOne(Permissions).primary().ref().updateRule('no action'),
    permissionId: p.uuid().persist(false),
    createdAt: p.datetime().defaultRaw(`now()`),
  },
});

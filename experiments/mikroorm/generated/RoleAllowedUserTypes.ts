import { type Opt, PrimaryKeyProp, type Ref, defineEntity, p } from '@mikro-orm/core';
import { Roles } from './Roles.js';
import { Tenants } from './Tenants.js';
import { UserTypes } from './UserTypes.js';

export class RoleAllowedUserTypes {
  [PrimaryKeyProp]?: ['tenant', 'role', 'userType'];
  tenant!: Ref<Tenants>;
  tenantId!: string;
  role!: Ref<Roles>;
  roleId!: string;
  userType!: Ref<UserTypes>;
  userTypeId!: string;
  createdAt!: Date & Opt;
}

export const RoleAllowedUserTypesSchema = defineEntity({
  class: RoleAllowedUserTypes,
  properties: {
    tenant: () => p.manyToOne(Tenants).primary().ref().updateRule('no action'),
    tenantId: p.uuid().persist(false),
    role: () => p.manyToOne(Roles).primary().ref().fieldNames('tenant_id','role_id').referencedColumnNames('tenant_id','id').updateRule('no action'),
    roleId: p.uuid().persist(false),
    userType: () => p.manyToOne(UserTypes).primary().ref().fieldNames('tenant_id','user_type_id').referencedColumnNames('tenant_id','id').updateRule('no action'),
    userTypeId: p.uuid().persist(false),
    createdAt: p.datetime().defaultRaw(`now()`),
  },
});

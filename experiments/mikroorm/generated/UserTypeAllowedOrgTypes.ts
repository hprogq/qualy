import { type Opt, PrimaryKeyProp, type Ref, defineEntity, p } from '@mikro-orm/core';
import { OrgTypes } from './OrgTypes.js';
import { Tenants } from './Tenants.js';
import { UserTypes } from './UserTypes.js';

export class UserTypeAllowedOrgTypes {
  [PrimaryKeyProp]?: ['tenant', 'userType', 'orgType'];
  tenant!: Ref<Tenants>;
  tenantId!: string;
  userType!: Ref<UserTypes>;
  userTypeId!: string;
  orgType!: Ref<OrgTypes>;
  orgTypeId!: string;
  createdAt!: Date & Opt;
}

export const UserTypeAllowedOrgTypesSchema = defineEntity({
  class: UserTypeAllowedOrgTypes,
  properties: {
    tenant: () => p.manyToOne(Tenants).primary().ref().updateRule('no action'),
    tenantId: p.uuid().persist(false),
    userType: () => p.manyToOne(UserTypes).primary().ref().fieldNames('tenant_id','user_type_id').referencedColumnNames('tenant_id','id').updateRule('no action').index('idx_user_type_allowed_org_types_tenant_type'),
    userTypeId: p.uuid().persist(false),
    orgType: () => p.manyToOne(OrgTypes).primary().ref().fieldNames('tenant_id','org_type_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('restrict'),
    orgTypeId: p.uuid().persist(false),
    createdAt: p.datetime().defaultRaw(`now()`),
  },
});

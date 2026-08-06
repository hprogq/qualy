import { type Opt, PrimaryKeyProp, type Ref, defineEntity, p } from '@mikro-orm/core';
import { OrgTypes } from './OrgTypes.js';
import { Roles } from './Roles.js';
import { Tenants } from './Tenants.js';

export class RoleAllowedOrgTypes {
  [PrimaryKeyProp]?: ['tenant', 'role', 'orgType'];
  tenant!: Ref<Tenants>;
  tenantId!: string;
  role!: Ref<Roles>;
  roleId!: string;
  orgType!: Ref<OrgTypes>;
  orgTypeId!: string;
  createdAt!: Date & Opt;
}

export const RoleAllowedOrgTypesSchema = defineEntity({
  class: RoleAllowedOrgTypes,
  properties: {
    tenant: () => p.manyToOne(Tenants).primary().ref().updateRule('no action'),
    tenantId: p.uuid().persist(false),
    role: () => p.manyToOne(Roles).primary().ref().fieldNames('tenant_id','role_id').referencedColumnNames('tenant_id','id').updateRule('no action'),
    roleId: p.uuid().persist(false),
    orgType: () => p.manyToOne(OrgTypes).primary().ref().fieldNames('tenant_id','org_type_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('restrict'),
    orgTypeId: p.uuid().persist(false),
    createdAt: p.datetime().defaultRaw(`now()`),
  },
});

import { Collection, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { OrgNodes } from './OrgNodes.js';
import { OrgTypeRules } from './OrgTypeRules.js';
import { RoleAllowedOrgTypes } from './RoleAllowedOrgTypes.js';
import { Tenants } from './Tenants.js';
import { UserTypeAllowedOrgTypes } from './UserTypeAllowedOrgTypes.js';

export class OrgTypes {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  code!: string;
  name!: string;
  sortOrder: number & Opt = 0;
  createdAt!: Date & Opt;
  updatedAt!: Date & Opt;
  orgNodesCollection = new Collection<OrgNodes>(this);
  orgTypeRulesCollection = new Collection<OrgTypeRules>(this);
  orgTypeRulesCollection1 = new Collection<OrgTypeRules>(this);
  roleAllowedOrgTypesCollection = new Collection<RoleAllowedOrgTypes>(this);
  userTypeAllowedOrgTypesCollection = new Collection<UserTypeAllowedOrgTypes>(this);
}

export const OrgTypesSchema = defineEntity({
  class: OrgTypes,
  uniques: [
    { name: 'uq_org_types_tenant_code', properties: ['tenantId', 'code'] },
    { name: 'uq_org_types_tenant_id_id', properties: ['tenantId', 'id'] },
    { name: 'uq_org_types_tenant_name', properties: ['tenantId', 'name'] },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.manyToOne(Tenants).ref().updateRule('no action').deleteRule('cascade'),
    tenantId: p.uuid().persist(false),
    code: p.string().length(63),
    name: p.string().length(100),
    sortOrder: p.smallint(),
    createdAt: p.datetime().defaultRaw(`now()`),
    updatedAt: p.datetime().defaultRaw(`now()`),
    orgNodesCollection: () => p.oneToMany(OrgNodes).mappedBy('orgType'),
    orgTypeRulesCollection: () => p.oneToMany(OrgTypeRules).mappedBy('parentType'),
    orgTypeRulesCollection1: () => p.oneToMany(OrgTypeRules).mappedBy('childType'),
    roleAllowedOrgTypesCollection: () => p.oneToMany(RoleAllowedOrgTypes).mappedBy('orgType'),
    userTypeAllowedOrgTypesCollection: () => p.oneToMany(UserTypeAllowedOrgTypes).mappedBy('orgType'),
  },
});

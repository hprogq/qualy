import { type Opt, PrimaryKeyProp, type Ref, defineEntity, p } from '@mikro-orm/core';
import { OrgTypes } from './OrgTypes.js';
import { Tenants } from './Tenants.js';

export class OrgTypeRules {
  [PrimaryKeyProp]?: ['tenant', 'parentType', 'childType'];
  tenant!: Ref<Tenants>;
  tenantId!: string;
  parentType!: Ref<OrgTypes>;
  parentTypeId!: string;
  childType!: Ref<OrgTypes>;
  childTypeId!: string;
  createdAt!: Date & Opt;
}

export const OrgTypeRulesSchema = defineEntity({
  class: OrgTypeRules,
  properties: {
    tenant: () => p.manyToOne(Tenants).primary().ref().updateRule('no action'),
    tenantId: p.uuid().persist(false),
    parentType: () => p.manyToOne(OrgTypes).primary().ref().fieldNames('tenant_id','parent_type_id').referencedColumnNames('tenant_id','id').updateRule('no action'),
    parentTypeId: p.uuid().persist(false),
    childType: () => p.manyToOne(OrgTypes).primary().ref().fieldNames('tenant_id','child_type_id').referencedColumnNames('tenant_id','id').updateRule('no action').index('idx_org_type_rules_tenant_child'),
    childTypeId: p.uuid().persist(false),
    createdAt: p.datetime().defaultRaw(`now()`),
  },
});

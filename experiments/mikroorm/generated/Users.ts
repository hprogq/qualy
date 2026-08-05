import { Collection, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { OrgNodes } from './OrgNodes.js';
import { RoleGrants } from './RoleGrants.js';
import { Sessions } from './Sessions.js';
import { Tenants } from './Tenants.js';
import { UserIdentities } from './UserIdentities.js';
import { UserTypes } from './UserTypes.js';

export class Users {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  businessNo?: string;
  displayName!: string;
  userType!: Ref<UserTypes>;
  userTypeId!: string;
  primaryOrgNode!: Ref<OrgNodes>;
  primaryOrgNodeId!: string;
  enabled: boolean & Opt = true;
  createdAt!: Date & Opt;
  updatedAt!: Date & Opt;
  roleGrantsCollection = new Collection<RoleGrants>(this);
  sessionsCollection = new Collection<Sessions>(this);
  userIdentitiesCollection = new Collection<UserIdentities>(this);
}

export const UsersSchema = defineEntity({
  class: Users,
  indexes: [
    {
      name: 'idx_users_tenant_org_node_name',
      properties: ['primaryOrgNodeId', 'tenantId', 'displayName'],
    },
  ],
  uniques: [
    {
      name: 'uq_users_tenant_business_no',
      where: 'business_no IS NOT NULL',
      properties: ['tenantId', 'businessNo'],
    },
    { name: 'uq_users_tenant_id_id', properties: ['tenantId', 'id'] },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.manyToOne(Tenants).ref().updateRule('no action').deleteRule('cascade'),
    tenantId: p.uuid().persist(false),
    businessNo: p.string().length(64).nullable(),
    displayName: p.string().length(100),
    userType: () => p.manyToOne(UserTypes).ref().fieldNames('tenant_id','user_type_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('restrict').index('idx_users_tenant_user_type'),
    userTypeId: p.uuid().persist(false),
    primaryOrgNode: () => p.manyToOne(OrgNodes).ref().fieldNames('tenant_id','primary_org_node_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('restrict'),
    primaryOrgNodeId: p.uuid().persist(false),
    enabled: p.boolean(),
    createdAt: p.datetime().defaultRaw(`now()`),
    updatedAt: p.datetime().defaultRaw(`now()`),
    roleGrantsCollection: () => p.oneToMany(RoleGrants).mappedBy('user'),
    sessionsCollection: () => p.oneToMany(Sessions).mappedBy('user'),
    userIdentitiesCollection: () => p.oneToMany(UserIdentities).mappedBy('user'),
  },
});

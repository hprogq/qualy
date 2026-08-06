import { Collection, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { OrgTypes } from './OrgTypes.js';
import { RoleGrants } from './RoleGrants.js';
import { Tenants } from './Tenants.js';
import { Users } from './Users.js';

export class OrgNodes {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  parent?: Ref<OrgNodes>;
  parentId?: string;
  orgType!: Ref<OrgTypes>;
  orgTypeId!: string;
  code?: string;
  name!: string;
  path!: unknown;
  depth: number & Opt = 0;
  sortOrder: number & Opt = 0;
  createdAt!: Date & Opt;
  updatedAt!: Date & Opt;
  orgNodesCollection = new Collection<OrgNodes>(this);
  roleGrantsCollection = new Collection<RoleGrants>(this);
  usersCollection = new Collection<Users>(this);
}

export const OrgNodesSchema = defineEntity({
  class: OrgNodes,
  indexes: [
    {
      name: 'idx_org_nodes_parent_sort',
      properties: ['parentId', 'tenantId', 'sortOrder', 'name'],
    },
    { name: 'idx_org_nodes_path_gist', properties: ['path'], type: 'gist' },
  ],
  uniques: [
    {
      name: 'uq_org_nodes_tenant_code',
      where: 'code IS NOT NULL',
      properties: ['tenantId', 'code'],
    },
    { name: 'uq_org_nodes_tenant_id_id', properties: ['tenantId', 'id'] },
    {
      name: 'uq_org_nodes_tenant_parent_name',
      where: 'parent_id IS NOT NULL',
      properties: ['parentId', 'tenantId', 'name'],
    },
    { name: 'uq_org_nodes_tenant_path', properties: ['tenantId', 'path'] },
    {
      name: 'uq_org_nodes_tenant_root_name',
      where: 'parent_id IS NULL',
      properties: ['tenantId', 'name'],
    },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.oneToOne(Tenants).ref().updateRule('no action').deleteRule('cascade').unique('uq_org_nodes_tenant_single_root'),
    tenantId: p.uuid().persist(false).unique('uq_org_nodes_tenant_single_root'),
    parent: () => p.manyToOne(OrgNodes).ref().fieldNames('tenant_id','parent_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('restrict').nullable(),
    parentId: p.uuid().nullable().persist(false),
    orgType: () => p.manyToOne(OrgTypes).ref().fieldNames('tenant_id','org_type_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('restrict').index('idx_org_nodes_tenant_type'),
    orgTypeId: p.uuid().persist(false),
    code: p.string().length(63).nullable(),
    name: p.string(),
    path: p.unknown().columnType('ltree').index('idx_org_nodes_path_gist'),
    depth: p.smallint(),
    sortOrder: p.smallint(),
    createdAt: p.datetime().defaultRaw(`now()`),
    updatedAt: p.datetime().defaultRaw(`now()`),
    orgNodesCollection: () => p.oneToMany(OrgNodes).mappedBy('parent'),
    roleGrantsCollection: () => p.oneToMany(RoleGrants).mappedBy('orgNode'),
    usersCollection: () => p.oneToMany(Users).mappedBy('primaryOrgNode'),
  },
});

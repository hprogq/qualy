import { type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { OrgNodes } from './OrgNodes.js';
import { Roles } from './Roles.js';
import { Tenants } from './Tenants.js';
import { Users } from './Users.js';

export class RoleGrants {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  user!: Ref<Users>;
  userId!: string;
  role!: Ref<Roles>;
  roleId!: string;
  orgNode?: Ref<OrgNodes>;
  orgNodeId?: string;
  coverage?: TRoleGrantsCoverage;
  createdAt!: Date & Opt;
}

export const RoleGrantsCoverage = {
  SELF: 'self',
  SUBTREE: 'subtree',
} as const;

export type TRoleGrantsCoverage = (typeof RoleGrantsCoverage)[keyof typeof RoleGrantsCoverage];

export const RoleGrantsSchema = defineEntity({
  class: RoleGrants,
  uniques: [
    {
      name: 'uq_role_grants_anchored',
      where: 'org_node_id IS NOT NULL',
      properties: ['orgNodeId', 'roleId', 'userId', 'tenantId', 'coverage'],
    },
    {
      name: 'uq_role_grants_tenant_wide',
      where: 'org_node_id IS NULL',
      properties: ['roleId', 'userId', 'tenantId'],
    },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.manyToOne(Tenants).ref().updateRule('no action').deleteRule('cascade'),
    tenantId: p.uuid().persist(false),
    user: () => p.manyToOne(Users).ref().fieldNames('tenant_id','user_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('cascade').index('idx_role_grants_tenant_user'),
    userId: p.uuid().persist(false),
    role: () => p.manyToOne(Roles).ref().fieldNames('tenant_id','role_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('cascade').index('idx_role_grants_tenant_role'),
    roleId: p.uuid().persist(false),
    orgNode: () => p.manyToOne(OrgNodes).ref().fieldNames('tenant_id','org_node_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('restrict').nullable().index('idx_role_grants_tenant_node'),
    orgNodeId: p.uuid().nullable().persist(false),
    coverage: p.enum(() => RoleGrantsCoverage).nullable(),
    createdAt: p.datetime().defaultRaw(`now()`),
  },
});

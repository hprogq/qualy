import { Collection, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { RoleAllowedOrgTypes } from './RoleAllowedOrgTypes.js';
import { RoleAllowedUserTypes } from './RoleAllowedUserTypes.js';
import { RoleGrants } from './RoleGrants.js';
import { RolePermissions } from './RolePermissions.js';
import { Tenants } from './Tenants.js';

export class Roles {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  code!: string;
  name!: string;
  description?: string;
  kind!: TRolesKind;
  assignable: boolean & Opt = true;
  createdAt!: Date & Opt;
  updatedAt!: Date & Opt;
  status: TRolesStatus & Opt = RolesStatus.DRAFT;
  permissionMode: TRolesPermissionMode & Opt = RolesPermissionMode.EXPLICIT;
  systemKey?: string;
  version: number & Opt = 1;
  roleAllowedOrgTypesCollection = new Collection<RoleAllowedOrgTypes>(this);
  roleAllowedUserTypesCollection = new Collection<RoleAllowedUserTypes>(this);
  roleGrantsCollection = new Collection<RoleGrants>(this);
  rolePermissionsCollection = new Collection<RolePermissions>(this);
}

export const RolesKind = {
  TENANT: 'tenant',
  ORG: 'org',
} as const;

export type TRolesKind = (typeof RolesKind)[keyof typeof RolesKind];

export const RolesStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;

export type TRolesStatus = (typeof RolesStatus)[keyof typeof RolesStatus];

export const RolesPermissionMode = {
  EXPLICIT: 'explicit',
  'ALL-ACTIVE': 'all-active',
} as const;

export type TRolesPermissionMode = (typeof RolesPermissionMode)[keyof typeof RolesPermissionMode];

export const RolesSchema = defineEntity({
  class: Roles,
  uniques: [
    { name: 'uq_roles_tenant_code', properties: ['tenantId', 'code'] },
    { name: 'uq_roles_tenant_id_id', properties: ['tenantId', 'id'] },
    { name: 'uq_roles_tenant_name', properties: ['tenantId', 'name'] },
    {
      name: 'uq_roles_tenant_system_key',
      where: 'system_key IS NOT NULL',
      properties: ['tenantId', 'systemKey'],
    },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.manyToOne(Tenants).ref().updateRule('no action').deleteRule('cascade'),
    tenantId: p.uuid().persist(false),
    code: p.string().length(63),
    name: p.string().length(100),
    description: p.string().length(500).nullable(),
    kind: p.enum(() => RolesKind),
    assignable: p.boolean(),
    createdAt: p.datetime().defaultRaw(`now()`),
    updatedAt: p.datetime().defaultRaw(`now()`),
    status: p.enum(() => RolesStatus),
    permissionMode: p.enum(() => RolesPermissionMode),
    systemKey: p.string().length(63).nullable(),
    version: p.integer(),
    roleAllowedOrgTypesCollection: () => p.oneToMany(RoleAllowedOrgTypes).mappedBy('role'),
    roleAllowedUserTypesCollection: () => p.oneToMany(RoleAllowedUserTypes).mappedBy('role'),
    roleGrantsCollection: () => p.oneToMany(RoleGrants).mappedBy('role'),
    rolePermissionsCollection: () => p.oneToMany(RolePermissions).mappedBy('role'),
  },
});

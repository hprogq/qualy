import { Collection, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { RoleAllowedUserTypes } from './RoleAllowedUserTypes.js';
import { Tenants } from './Tenants.js';
import { UserTypeAllowedOrgTypes } from './UserTypeAllowedOrgTypes.js';
import { Users } from './Users.js';

export class UserTypes {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  code!: string;
  name!: string;
  description?: string;
  allowLocalLogin: boolean & Opt = false;
  allowSsoLogin: boolean & Opt = false;
  enabled: boolean & Opt = true;
  isSystem: boolean & Opt = false;
  sortOrder: number & Opt = 0;
  createdAt!: Date & Opt;
  updatedAt!: Date & Opt;
  version: number & Opt = 1;
  placementMode!: TUserTypesPlacementMode;
  roleAllowedUserTypesCollection = new Collection<RoleAllowedUserTypes>(this);
  userTypeAllowedOrgTypesCollection = new Collection<UserTypeAllowedOrgTypes>(this);
  usersCollection = new Collection<Users>(this);
}

export const UserTypesPlacementMode = {
  UNRESTRICTED: 'unrestricted',
  'ALLOW-LIST': 'allow-list',
} as const;

export type TUserTypesPlacementMode = (typeof UserTypesPlacementMode)[keyof typeof UserTypesPlacementMode];

export const UserTypesSchema = defineEntity({
  class: UserTypes,
  uniques: [
    { name: 'uq_user_types_tenant_code', properties: ['tenantId', 'code'] },
    { name: 'uq_user_types_tenant_id_id', properties: ['tenantId', 'id'] },
    { name: 'uq_user_types_tenant_name', properties: ['tenantId', 'name'] },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.manyToOne(Tenants).ref().updateRule('no action').deleteRule('cascade'),
    tenantId: p.uuid().persist(false),
    code: p.string().length(63),
    name: p.string().length(100),
    description: p.string().length(500).nullable(),
    allowLocalLogin: p.boolean(),
    allowSsoLogin: p.boolean(),
    enabled: p.boolean(),
    isSystem: p.boolean(),
    sortOrder: p.smallint(),
    createdAt: p.datetime().defaultRaw(`now()`),
    updatedAt: p.datetime().defaultRaw(`now()`),
    version: p.integer(),
    placementMode: p.enum(() => UserTypesPlacementMode),
    roleAllowedUserTypesCollection: () => p.oneToMany(RoleAllowedUserTypes).mappedBy('userType'),
    userTypeAllowedOrgTypesCollection: () => p.oneToMany(UserTypeAllowedOrgTypes).mappedBy('userType'),
    usersCollection: () => p.oneToMany(Users).mappedBy('userType'),
  },
});

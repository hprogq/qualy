import { Collection, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { AuthProviders } from './AuthProviders.js';
import { OrgNodes } from './OrgNodes.js';
import { OrgTypeRules } from './OrgTypeRules.js';
import { OrgTypes } from './OrgTypes.js';
import { RoleAllowedOrgTypes } from './RoleAllowedOrgTypes.js';
import { RoleAllowedUserTypes } from './RoleAllowedUserTypes.js';
import { RoleGrants } from './RoleGrants.js';
import { RolePermissions } from './RolePermissions.js';
import { Roles } from './Roles.js';
import { Sessions } from './Sessions.js';
import { UserIdentities } from './UserIdentities.js';
import { UserTypeAllowedOrgTypes } from './UserTypeAllowedOrgTypes.js';
import { UserTypes } from './UserTypes.js';
import { Users } from './Users.js';

export class Tenants {
  id!: string & Opt;
  slug!: string;
  name!: string;
  logoUrl?: string;
  createdAt!: Date & Opt;
  updatedAt!: Date & Opt;
  enabled: boolean & Opt = true;
  expiresAt?: Date;
  authProvidersCollection = new Collection<AuthProviders>(this);
  orgNodes?: Ref<OrgNodes>;
  orgTypeRulesCollection = new Collection<OrgTypeRules>(this);
  orgTypesCollection = new Collection<OrgTypes>(this);
  roleAllowedOrgTypesCollection = new Collection<RoleAllowedOrgTypes>(this);
  roleAllowedUserTypesCollection = new Collection<RoleAllowedUserTypes>(this);
  roleGrantsCollection = new Collection<RoleGrants>(this);
  rolePermissionsCollection = new Collection<RolePermissions>(this);
  rolesCollection = new Collection<Roles>(this);
  sessionsCollection = new Collection<Sessions>(this);
  userIdentitiesCollection = new Collection<UserIdentities>(this);
  userTypeAllowedOrgTypesCollection = new Collection<UserTypeAllowedOrgTypes>(this);
  userTypesCollection = new Collection<UserTypes>(this);
  usersCollection = new Collection<Users>(this);
}

export const TenantsSchema = defineEntity({
  class: Tenants,
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    slug: p.string().length(63).unique('tenants_slug_key'),
    name: p.string(),
    logoUrl: p.string().length(2048).nullable(),
    createdAt: p.datetime().defaultRaw(`now()`),
    updatedAt: p.datetime().defaultRaw(`now()`),
    enabled: p.boolean(),
    expiresAt: p.datetime().nullable(),
    authProvidersCollection: () => p.oneToMany(AuthProviders).mappedBy('tenant'),
    orgNodes: () => p.oneToOne(OrgNodes).ref().mappedBy('tenant'),
    orgTypeRulesCollection: () => p.oneToMany(OrgTypeRules).mappedBy('tenant'),
    orgTypesCollection: () => p.oneToMany(OrgTypes).mappedBy('tenant'),
    roleAllowedOrgTypesCollection: () => p.oneToMany(RoleAllowedOrgTypes).mappedBy('tenant'),
    roleAllowedUserTypesCollection: () => p.oneToMany(RoleAllowedUserTypes).mappedBy('tenant'),
    roleGrantsCollection: () => p.oneToMany(RoleGrants).mappedBy('tenant'),
    rolePermissionsCollection: () => p.oneToMany(RolePermissions).mappedBy('tenant'),
    rolesCollection: () => p.oneToMany(Roles).mappedBy('tenant'),
    sessionsCollection: () => p.oneToMany(Sessions).mappedBy('tenant'),
    userIdentitiesCollection: () => p.oneToMany(UserIdentities).mappedBy('tenant'),
    userTypeAllowedOrgTypesCollection: () => p.oneToMany(UserTypeAllowedOrgTypes).mappedBy('tenant'),
    userTypesCollection: () => p.oneToMany(UserTypes).mappedBy('tenant'),
    usersCollection: () => p.oneToMany(Users).mappedBy('tenant'),
  },
});

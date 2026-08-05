import { Collection, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { Tenants } from './Tenants.js';
import { UserIdentities } from './UserIdentities.js';

export class AuthProviders {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  code!: string;
  type!: string;
  name!: string;
  config: any & Opt = '{}';
  isSystem: boolean & Opt = false;
  enabled: boolean & Opt = true;
  createdAt!: Date & Opt;
  updatedAt!: Date & Opt;
  sortOrder: number & Opt = 0;
  userIdentitiesCollection = new Collection<UserIdentities>(this);
}

export const AuthProvidersSchema = defineEntity({
  class: AuthProviders,
  uniques: [
    { name: 'uq_auth_providers_tenant_code', properties: ['tenantId', 'code'] },
    { name: 'uq_auth_providers_tenant_id_id', properties: ['tenantId', 'id'] },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.manyToOne(Tenants).ref().updateRule('no action').deleteRule('cascade'),
    tenantId: p.uuid().persist(false),
    code: p.string().length(63),
    type: p.string().length(32),
    name: p.string().length(100),
    config: p.json(),
    isSystem: p.boolean(),
    enabled: p.boolean(),
    createdAt: p.datetime().defaultRaw(`now()`),
    updatedAt: p.datetime().defaultRaw(`now()`),
    sortOrder: p.smallint(),
    userIdentitiesCollection: () => p.oneToMany(UserIdentities).mappedBy('authProvider'),
  },
});

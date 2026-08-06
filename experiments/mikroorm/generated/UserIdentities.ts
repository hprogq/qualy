import { type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { AuthProviders } from './AuthProviders.js';
import { Tenants } from './Tenants.js';
import { Users } from './Users.js';

export class UserIdentities {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  user!: Ref<Users>;
  userId!: string;
  authProvider!: Ref<AuthProviders>;
  authProviderId!: string;
  identifier!: string;
  credentialHash?: string;
  boundAt!: Date & Opt;
  lastUsedAt?: Date;
}

export const UserIdentitiesSchema = defineEntity({
  class: UserIdentities,
  uniques: [
    {
      name: 'uq_user_identities_login',
      properties: ['authProviderId', 'tenantId', 'identifier'],
    },
    { name: 'uq_user_identities_tenant_id_id', properties: ['tenantId', 'id'] },
    {
      name: 'uq_user_identities_user_provider',
      properties: ['authProviderId', 'userId', 'tenantId'],
    },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.manyToOne(Tenants).ref().updateRule('no action').deleteRule('cascade'),
    tenantId: p.uuid().persist(false),
    user: () => p.manyToOne(Users).ref().fieldNames('tenant_id','user_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('cascade'),
    userId: p.uuid().persist(false),
    authProvider: () => p.manyToOne(AuthProviders).ref().fieldNames('tenant_id','auth_provider_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('restrict'),
    authProviderId: p.uuid().persist(false),
    identifier: p.string(),
    credentialHash: p.text().nullable(),
    boundAt: p.datetime().defaultRaw(`now()`),
    lastUsedAt: p.datetime().nullable(),
  },
});

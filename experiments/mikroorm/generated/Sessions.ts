import { type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { Tenants } from './Tenants.js';
import { Users } from './Users.js';

export class Sessions {
  id!: string & Opt;
  tenant!: Ref<Tenants>;
  tenantId!: string;
  user!: Ref<Users>;
  userId!: string;
  tokenHash!: string;
  expiresAt!: Date;
  lastUsedAt?: Date;
  loginIp?: unknown;
  userAgent?: string;
  createdAt!: Date & Opt;
}

export const SessionsSchema = defineEntity({
  class: Sessions,
  indexes: [
    {
      name: 'idx_sessions_tenant_user_expires',
      properties: ['userId', 'tenantId', 'expiresAt'],
    },
  ],
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    tenant: () => p.manyToOne(Tenants).ref().updateRule('no action').deleteRule('cascade'),
    tenantId: p.uuid().persist(false),
    user: () => p.manyToOne(Users).ref().fieldNames('tenant_id','user_id').referencedColumnNames('tenant_id','id').updateRule('no action').deleteRule('cascade'),
    userId: p.uuid().persist(false),
    tokenHash: p.character().length(64).unique('sessions_token_hash_key'),
    expiresAt: p.datetime(),
    lastUsedAt: p.datetime().nullable(),
    loginIp: p.unknown().columnType('inet').nullable(),
    userAgent: p.text().nullable(),
    createdAt: p.datetime().defaultRaw(`now()`),
  },
});

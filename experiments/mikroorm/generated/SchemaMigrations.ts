import { defineEntity, p } from '@mikro-orm/core';

export class SchemaMigrations {
  id!: number;
  hash!: string;
  createdAt?: bigint;
  name?: string;
  appliedAt?: Date;
}

export const SchemaMigrationsSchema = defineEntity({
  class: SchemaMigrations,
  schema: 'cordis_meta',
  properties: {
    id: p.integer().primary(),
    hash: p.text(),
    createdAt: p.bigint().nullable(),
    name: p.text().nullable(),
    appliedAt: p.datetime().nullable().defaultRaw(`now()`),
  },
});

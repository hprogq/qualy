import { Collection, type Opt, defineEntity, p } from '@mikro-orm/core';
import { RolePermissions } from './RolePermissions.js';

export class Permissions {
  id!: string & Opt;
  code!: string;
  plugin!: string;
  name!: string;
  description?: string;
  groupKey?: string;
  createdAt!: Date & Opt;
  updatedAt!: Date & Opt;
  targetKind!: TPermissionsTargetKind;
  rolePermissionsCollection = new Collection<RolePermissions>(this);
}

export const PermissionsTargetKind = {
  TENANT: 'tenant',
  'ORG-NODE': 'org-node',
} as const;

export type TPermissionsTargetKind = (typeof PermissionsTargetKind)[keyof typeof PermissionsTargetKind];

export const PermissionsSchema = defineEntity({
  class: Permissions,
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    code: p.string().length(127).unique('uq_permissions_code'),
    plugin: p.string().length(127),
    name: p.string().length(100),
    description: p.string().length(500).nullable(),
    groupKey: p.string().length(63).nullable(),
    createdAt: p.datetime().defaultRaw(`now()`),
    updatedAt: p.datetime().defaultRaw(`now()`),
    targetKind: p.enum(() => PermissionsTargetKind),
    rolePermissionsCollection: () => p.oneToMany(RolePermissions).mappedBy('permission'),
  },
});

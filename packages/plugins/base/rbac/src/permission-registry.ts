import { sql } from 'drizzle-orm'
import type { Context } from 'cordis'
import type { PermissionDefinition } from '@qualy/rbac-contract'

const PERMISSION_CODE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

interface ActiveDefinition extends PermissionDefinition {
  plugin: string
  registration: symbol
}

// the active in-memory permission catalog plus its database mirror. Stable
// semantics are scope, both grant channels, defaultTenantAdmin AND the
// owning plugin: any drift against the stored row disables the definition
// (fail closed) and surfaces through whenSynced() — changed meaning or
// changed ownership requires a new code or an explicit migration.
export class PermissionRegistry {
  private active = new Map<string, ActiveDefinition>()
  // tail keeps the serial queue alive across failures; latest preserves the
  // most recent task's rejection for whenSynced()
  private syncBox: { tail: Promise<void>; latest: Promise<void> } = {
    tail: Promise.resolve(),
    latest: Promise.resolve(),
  }

  constructor(private ctx: Context) {}

  has(code: string): boolean {
    return this.active.has(code)
  }

  get(code: string): ActiveDefinition | undefined {
    return this.active.get(code)
  }

  validate(definitions: readonly PermissionDefinition[]) {
    const seen = new Set<string>()
    for (const def of definitions) {
      if (!PERMISSION_CODE.test(def.code)) {
        throw new Error(`permission code "${def.code}" must be dotted lower-case`)
      }
      if (def.grantToUserType && def.scope !== 'tenant') {
        throw new Error(`permission ${def.code}: only tenant scope may grant to user types`)
      }
      if (def.defaultTenantAdmin && !def.grantToRole) {
        throw new Error(`permission ${def.code}: defaultTenantAdmin requires grantToRole`)
      }
      if (seen.has(def.code)) {
        throw new Error(`permission catalog declares ${def.code} twice`)
      }
      seen.add(def.code)
    }
  }

  activate(plugin: string, definitions: readonly PermissionDefinition[]): symbol {
    for (const def of definitions) {
      const existing = this.active.get(def.code)
      if (existing) {
        throw new Error(
          `permission code conflict: ${def.code} (already active via ${existing.plugin})`,
        )
      }
    }
    const registration = Symbol(plugin)
    for (const def of definitions) this.active.set(def.code, { ...def, plugin, registration })
    this.queueSync(plugin, definitions, registration)
    return registration
  }

  deactivate(registration: symbol) {
    for (const [code, def] of this.active) {
      if (def.registration === registration) this.active.delete(code)
    }
  }

  whenSynced(): Promise<void> {
    return this.syncBox.latest
  }

  private queueSync(
    plugin: string,
    definitions: readonly PermissionDefinition[],
    registration: symbol,
  ) {
    const box = this.syncBox
    const task = box.tail.then(() => this.sync(plugin, definitions, registration))
    box.latest = task
    box.tail = task.catch((error) => this.ctx.logger.error(error))
  }

  private async sync(
    plugin: string,
    definitions: readonly PermissionDefinition[],
    registration: symbol,
  ) {
    const db = this.ctx.db.drizzle
    const rejected: string[] = []
    for (const def of definitions) {
      const existing = (
        await db.execute<{
          plugin: string
          scope: string
          grant_to_user_type: boolean
          grant_to_role: boolean
          default_tenant_admin: boolean
        }>(sql`select plugin, scope, grant_to_user_type, grant_to_role, default_tenant_admin
               from permissions where code = ${def.code}`)
      ).rows[0]
      if (!existing) {
        await db.execute(sql`
          insert into permissions (code, plugin, name, description, group_key, scope,
            grant_to_user_type, grant_to_role, default_tenant_admin)
          values (${def.code}, ${plugin}, ${def.name},
            ${def.description ?? null}, ${def.groupKey ?? null}, ${def.scope},
            ${def.grantToUserType}, ${def.grantToRole}, ${def.defaultTenantAdmin})
          on conflict (code) do nothing`)
      } else if (
        existing.plugin !== plugin ||
        existing.scope !== def.scope ||
        existing.grant_to_user_type !== def.grantToUserType ||
        existing.grant_to_role !== def.grantToRole ||
        existing.default_tenant_admin !== def.defaultTenantAdmin
      ) {
        this.ctx.logger.error(
          'permission %s definition conflicts with its database row, disabling it ' +
            '(changed semantics or ownership need a new code)',
          def.code,
        )
        // only remove what this very registration added: a reload may have
        // re-registered the code while an old sync task was still queued
        if (this.active.get(def.code)?.registration === registration) {
          this.active.delete(def.code)
        }
        rejected.push(def.code)
        continue
      } else {
        await db.execute(sql`
          update permissions set name = ${def.name}, description = ${def.description ?? null},
            group_key = ${def.groupKey ?? null}, updated_at = now()
          where code = ${def.code}`)
      }
      if (def.defaultTenantAdmin) {
        // every tenant's system tenant-admin role picks the code up idempotently
        await db.execute(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select r.tenant_id, r.id, p.id
          from roles r, permissions p
          where r.code = 'tenant-admin' and r.is_system and p.code = ${def.code}
          on conflict do nothing`)
      }
    }
    if (rejected.length > 0) {
      throw new Error(`permission definitions rejected: ${rejected.join(', ')}`)
    }
  }
}

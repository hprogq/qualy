import { sql } from 'drizzle-orm'
import type { Context } from 'cordis'
import type { ActivePermission, PermissionDefinition, PermissionTarget } from '@qualy/rbac-contract'

const PERMISSION_CODE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

interface Registration {
  plugin: string
  definitions: readonly PermissionDefinition[]
  status: 'pending' | 'active' | 'rejected'
  // settled sync task; failures land in `error`, the task itself never rejects
  task: Promise<void>
  error?: Error
}

interface RegisteredPermission extends ActivePermission {
  registration: symbol
}

// The active catalog and its database mirror.
//
// A registration starts pending and its codes become visible to
// authorization only after the stored row is inserted-or-verified: there is
// no window where an unverified definition authorizes anything, and two
// instances racing on the same code converge on the stored row (insert,
// then unconditionally re-read). Drift disables the affected code — fail
// closed, per code, to keep the blast radius small — and surfaces through
// whenSynced(). Changed meaning or changed ownership needs a new code or an
// explicit migration.
//
// Being in this map is the only thing that makes a capability real. There is
// no enabled column an administrator could switch off: a permission whose
// plugin is not loaded simply is not here, and a code that is not here
// authorizes nothing and is never offered as something to grant.
export class PermissionRegistry {
  private active = new Map<string, RegisteredPermission>()
  private registrations = new Map<symbol, Registration>()
  // serial database queue in a stable box (traceable-proxy discipline)
  private queue: { tail: Promise<void> } = { tail: Promise.resolve() }

  constructor(private ctx: Context) {}

  has(code: string): boolean {
    return this.active.has(code)
  }

  get(code: string): RegisteredPermission | undefined {
    return this.active.get(code)
  }

  list(filter?: { target?: PermissionTarget; plugin?: string }): ActivePermission[] {
    return [...this.active.values()]
      .filter((entry) => !filter?.target || entry.target === filter.target)
      .filter((entry) => !filter?.plugin || entry.plugin === filter.plugin)
      .sort((a, b) => a.code.localeCompare(b.code))
  }

  validate(definitions: readonly PermissionDefinition[]) {
    const seen = new Set<string>()
    for (const def of definitions) {
      if (!PERMISSION_CODE.test(def.code)) {
        throw new Error(`permission code "${def.code}" must be dotted lower-case`)
      }
      if (def.target !== 'tenant' && def.target !== 'org-node') {
        throw new Error(`permission ${def.code}: target must be 'tenant' or 'org-node'`)
      }
      if (seen.has(def.code)) throw new Error(`permission catalog declares ${def.code} twice`)
      seen.add(def.code)
    }
  }

  activate(plugin: string, definitions: readonly PermissionDefinition[]): symbol {
    for (const def of definitions) {
      for (const existing of this.registrations.values()) {
        if (existing.definitions.some((other) => other.code === def.code)) {
          throw new Error(
            `permission code conflict: ${def.code} (already registered via ${existing.plugin})`,
          )
        }
      }
    }
    const registration = Symbol(plugin)
    const entry: Registration = { plugin, definitions, status: 'pending', task: Promise.resolve() }
    this.registrations.set(registration, entry)
    const task = this.queue.tail.then(async () => {
      try {
        await this.sync(registration)
      } catch (error) {
        // unexpected failure (connection loss, bugs): the registration keeps
        // no active codes and the error stays observable until disposal
        this.ctx.logger.error(error)
        const current = this.registrations.get(registration)
        if (current) {
          current.status = 'rejected'
          current.error = error as Error
        }
      }
    })
    this.queue.tail = task
    entry.task = task
    return registration
  }

  deactivate(registration: symbol) {
    this.registrations.delete(registration)
    for (const [code, def] of this.active) {
      if (def.registration === registration) this.active.delete(code)
    }
  }

  // resolves once every currently registered catalog has settled and none of
  // the still-registered ones failed; a failure is not masked by later
  // successful registrations and clears only when its plugin is disposed
  async whenSynced(): Promise<void> {
    await Promise.allSettled([...this.registrations.values()].map((entry) => entry.task))
    const failed = [...this.registrations.values()].filter((entry) => entry.error)
    if (failed.length > 0) {
      throw new Error(failed.map((entry) => entry.error!.message).join('; '))
    }
  }

  private async sync(registration: symbol) {
    const entry = this.registrations.get(registration)
    if (!entry) return // disposed before the queue reached it
    const db = this.ctx.db.drizzle
    const rejected: string[] = []
    for (const def of entry.definitions) {
      await db.execute(sql`
        insert into permissions (code, plugin, name, description, group_key, target_kind)
        values (${def.code}, ${entry.plugin}, ${def.name},
          ${def.description ?? null}, ${def.groupKey ?? null}, ${def.target})
        on conflict (code) do nothing`)
      // unconditional re-read: whether this instance inserted the row or
      // lost the race to another one, the stored row is the single truth
      const row = (
        await db.execute<{ plugin: string; target_kind: string }>(
          sql`select plugin, target_kind from permissions where code = ${def.code}`,
        )
      ).rows[0]
      // ownership and calling convention are the stable semantics; a change
      // in either needs a new code, because live grants already assume them
      if (!row || row.plugin !== entry.plugin || row.target_kind !== def.target) {
        this.ctx.logger.error(
          'permission %s definition conflicts with its database row, disabling it ' +
            '(changed semantics or ownership need a new code)',
          def.code,
        )
        rejected.push(def.code)
        continue
      }
      // display text follows the plugin freely: it decides nothing
      await db.execute(sql`
        update permissions set name = ${def.name}, description = ${def.description ?? null},
          group_key = ${def.groupKey ?? null}, updated_at = now()
        where code = ${def.code}`)
      // activation only after full verification, and only while the
      // registration is still alive (a reload may have disposed it mid-sync)
      if (this.registrations.get(registration) === entry) {
        this.active.set(def.code, { ...def, plugin: entry.plugin, registration })
      }
    }
    if (this.registrations.get(registration) !== entry) return
    if (rejected.length > 0) {
      entry.status = 'rejected'
      entry.error = new Error(`permission definitions rejected: ${rejected.join(', ')}`)
    } else {
      entry.status = 'active'
    }
  }
}

import { Effect } from 'effect'
import type { Pool } from 'pg'

// Placing a seeding run in the past.
//
// The services write their own timestamps from the database clock, and none
// of them takes an "as of" - rightly, since nothing in the product should be
// able to write history. So the seeder runs every step now and records, per
// step, the real window it ran in and the moment in the story it stands for.
// Afterwards every recorded timestamp in a known column is moved from its
// window to its moment, keeping its offset inside the window so the order of
// what one step wrote survives.
//
// Only the columns listed below are moved, each named on purpose. Anything a
// run writes into a column that is not listed is found by the check that
// follows the rewrite and stops the seeder: a new column is sorted before it
// is trusted, never swept along or left behind by accident.

/** columns whose value is the moment a step happened, moved with the step */
export const MOVED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  tenants: ['created_at', 'updated_at'],
  auth_providers: ['created_at', 'updated_at'],
  user_auth_bindings: ['bound_at'],
  permissions: ['created_at', 'updated_at'],
  org_types: ['created_at', 'updated_at'],
  org_type_rules: ['created_at'],
  org_nodes: ['created_at', 'updated_at'],
  user_types: ['created_at', 'updated_at'],
  user_type_allowed_org_types: ['created_at'],
  users: ['created_at', 'updated_at'],
  roles: ['created_at', 'updated_at'],
  role_permissions: ['created_at'],
  role_allowed_user_types: ['created_at'],
  role_allowed_org_types: ['created_at'],
  role_grants: ['created_at'],
  audit_events: ['occurred_at'],
  assessment_batches: ['created_at', 'updated_at'],
  batch_management_anchors: ['created_at'],
  batch_access_sources: ['accepted_at'],
  batch_access_source_permissions: ['created_at'],
  batch_lifecycle_events: ['created_at', 'occurred_at'],
  batch_participants: ['created_at', 'included_at', 'updated_at'],
  batch_participant_events: ['occurred_at'],
  roster_imports: ['occurred_at'],
  batch_phases: ['created_at', 'updated_at', 'actual_entry_at'],
  phase_events: ['created_at', 'actual_at', 'processed_at'],
  score_groups: ['created_at', 'updated_at'],
  assessment_items: ['created_at', 'updated_at'],
  assessment_item_revisions: ['created_at'],
  entries: ['created_at', 'updated_at'],
  entry_revisions: ['created_at'],
  entry_recognitions: ['created_at'],
  review_instances: ['created_at', 'completed_at'],
  review_events: ['created_at'],
}

/**
 * Columns a step writes relative to its own "now" rather than at it: a
 * planned entry an hour ahead, say. They move by the same distance as the row
 * they sit on, which the named companion column says - so they stay the same
 * distance from it after the move.
 */
export const COMPANION_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  batch_phases: { planned_entry_at: 'updated_at' },
  phase_events: { planned_at: 'created_at' },
}

interface Window {
  readonly startedAt: Date
  readonly endedAt: Date
  readonly at: Date
}

export class Timeline {
  readonly windows: Window[] = []
  started = new Date(0)
  readonly #pool: Pool

  /**
   * Windows are read off the database's own clock: the services stamp rows
   * with its now(), and a container's clock can sit milliseconds away from
   * this process's - enough to leave a row just outside its step.
   */
  constructor(pool: Pool) {
    this.#pool = pool
  }

  async begin(): Promise<void> {
    this.started = await this.#clock()
  }

  #clock = async (): Promise<Date> =>
    (await this.#pool.query<{ now: Date }>('select clock_timestamp() as now')).rows[0]!.now

  /** the same, for work done outside the service graph */
  async record<A>(at: Date, work: () => Promise<A>): Promise<A> {
    return Effect.runPromise(this.step(at, Effect.promise(work)))
  }

  /** runs a step, recording that it stands for `at` */
  step<A, E, R>(at: Date, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    const windows = this.windows
    const clock = this.#clock
    return Effect.gen(function* () {
      const startedAt = yield* Effect.promise(clock)
      const result = yield* effect
      const endedAt = yield* Effect.promise(clock)
      windows.push({ startedAt, endedAt, at })
      return result
    })
  }
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/**
 * Moves every recorded timestamp to the moment its step stands for, in one
 * transaction, then checks that nothing written during the run was left
 * where it was. Returns how many values moved.
 */
export const rewrite = async (pool: Pool, timeline: Timeline): Promise<number> => {
  const client = await pool.connect()
  let moved = 0
  try {
    await client.query('begin')
    await client.query(
      `create temporary table demo_windows (started_at timestamptz, ended_at timestamptz, at timestamptz) on commit drop`,
    )
    for (const window of timeline.windows) {
      await client.query(`insert into demo_windows values ($1, $2, $3)`, [
        window.startedAt,
        window.endedAt,
        window.at,
      ])
    }
    // companions first, while the column they follow still holds real time
    for (const [table, companions] of Object.entries(COMPANION_COLUMNS)) {
      for (const [column, follows] of Object.entries(companions)) {
        const result = await client.query(
          `update ${quote(table)} t
              set ${quote(column)} = t.${quote(column)} + (w.at - w.started_at)
             from demo_windows w
            where t.${quote(follows)} between w.started_at and w.ended_at
              and t.${quote(column)} is not null`,
        )
        moved += result.rowCount ?? 0
      }
    }
    for (const [table, columns] of Object.entries(MOVED_COLUMNS)) {
      for (const column of columns) {
        const result = await client.query(
          `update ${quote(table)} t
              set ${quote(column)} = w.at + (t.${quote(column)} - w.started_at)
             from demo_windows w
            where t.${quote(column)} between w.started_at and w.ended_at`,
        )
        moved += result.rowCount ?? 0
      }
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  await requireNothingLeftBehind(pool, timeline)
  return moved
}

/**
 * Every timestamp column in the schema, asked whether it still holds a value
 * from the run. One that does is either a column this file does not list or
 * a write that happened outside every recorded step - both are refused.
 */
const requireNothingLeftBehind = async (pool: Pool, timeline: Timeline) => {
  const columns = await pool.query<{ table_name: string; column_name: string }>(`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public' and data_type = 'timestamp with time zone'`)
  const left: string[] = []
  for (const { table_name, column_name } of columns.rows) {
    const found = await pool.query<{ n: string }>(
      `select count(*)::text as n from ${quote(table_name)}
        where ${quote(column_name)} between $1 and clock_timestamp()`,
      [timeline.started],
    )
    if (found.rows[0]!.n !== '0') left.push(`${table_name}.${column_name} (${found.rows[0]!.n})`)
  }
  if (left.length > 0) {
    throw new Error(
      `these columns still hold times from the seeding run: ${left.join(', ')}. List each in tools/demo/timeline.ts, or make the step that wrote it a recorded one`,
    )
  }
}

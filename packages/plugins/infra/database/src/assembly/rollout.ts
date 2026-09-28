// Whether a migration may run while the release before it still serves.
//
// An upgrade runs two colors against one database (docs/deployment.md §3.1):
// the new release's migrations have applied while the old release still
// answers requests, and a rollback runs the old release on the schema the
// new one left. A migration that only adds - a table, a nullable column, an
// index - leaves the old release working. One that changes what the old
// release reads or writes does not, and the old release has to be stopped
// before it runs.
//
// That is a different question from whether a migration loses data
// (drop-guard.ts). `SET NOT NULL`, a changed column type, a renamed column
// or a new constraint lose nothing and still break the release before them;
// a column dropped a release after its last reader stopped reading it breaks
// nobody. So every migration answers this one on its own line, generation
// writes its best guess, a person may change it, and CI refuses a new
// migration that says nothing (tools/quality/check-migrations-immutable.ts).
//
// No imports on purpose: CI and the deploy tooling read this as well as
// generation.

export type Rollout = 'expand' | 'maintenance'

const marker = /^--\s*rollout:\s*(expand|maintenance)\s*$/m

/** the line a migration declares itself with */
export const rolloutLine = (rollout: Rollout): string => `-- rollout: ${rollout}`

/** what a migration declares, or undefined when it declares nothing */
export const rolloutOf = (sql: string): Rollout | undefined =>
  marker.exec(sql)?.[1] as Rollout | undefined

const withoutComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

/**
 * The statements, roughly: split on semicolons. A function body with
 * semicolons of its own falls apart into pieces nothing below recognises,
 * which classifies it as maintenance - the safe direction.
 */
const statementsOf = (sql: string) =>
  withoutComments(sql)
    .split(';')
    .map((statement) => statement.trim().replace(/\s+/g, ' '))
    .filter((statement) => statement !== '')

/** a table name as the statement spells it, without quotes or schema */
const tableName = (spelled: string) => spelled.replace(/"/g, '').split('.').at(-1)!.toLowerCase()

const NAME = '("?[\\w$]+"?(?:\\."?[\\w$]+"?)?)'
const CREATE_TABLE = new RegExp(`^create table (?:if not exists )?${NAME}`, 'i')
const CREATE_INDEX = new RegExp(
  `^create (unique )?index (?:concurrently )?(?:if not exists )?(?:"?[\\w$]+"? )?on (?:only )?${NAME}`,
  'i',
)
const ALTER_TABLE = new RegExp(`^alter table (?:only )?(?:if exists )?${NAME} (.*)$`, 'i')

/** statements that add and leave everything already there as it was */
const ADDS_ONLY = [
  /^create sequence\b/i,
  /^create extension if not exists\b/i,
  /^create schema\b/i,
  /^comment on\b/i,
]

/**
 * A column added so that a writer who has never heard of it still writes:
 * nullable, or filled by a default. Constraints are not additions.
 */
const addsWritableColumn = (action: string) => {
  const trimmed = action.trim()
  if (!/^add (column )?(?!constraint\b)/i.test(trimmed)) return false
  return !/\bnot null\b/i.test(trimmed) || /\bdefault\b/i.test(trimmed)
}

/**
 * Generation's guess at a migration's rollout, from its SQL.
 *
 * Expand only when every statement is one of: a new table, and anything done
 * to a table this same migration creates (nothing before it knows the
 * table); a plain index, or a unique one on a new table; a new sequence,
 * schema or extension; a comment; a column added nullable or with a default.
 * Everything else - a changed type, a new constraint on an existing table,
 * a rename, a drop, data changes, functions and triggers - is maintenance
 * until a person who has checked it says otherwise.
 */
export const classifyRollout = (sql: string): Rollout => {
  const statements = statementsOf(sql)
  const created = new Set(
    statements.flatMap((statement) => {
      const match = CREATE_TABLE.exec(statement)
      return match ? [tableName(match[1]!)] : []
    }),
  )
  const expands = (statement: string) => {
    if (CREATE_TABLE.test(statement)) return true
    if (ADDS_ONLY.some((pattern) => pattern.test(statement))) return true
    const index = CREATE_INDEX.exec(statement)
    if (index) return index[1] === undefined || created.has(tableName(index[2]!))
    const alter = ALTER_TABLE.exec(statement)
    if (!alter) return false
    if (created.has(tableName(alter[1]!))) return true
    // several actions in one statement, split on commas outside parentheses
    return alter[2]!.split(/,(?![^(]*\))/).every(addsWritableColumn)
  }
  return statements.length > 0 && statements.every(expands) ? 'expand' : 'maintenance'
}

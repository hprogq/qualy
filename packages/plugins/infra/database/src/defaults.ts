// The answers a machine with nothing configured is assumed to want, and the
// names of the variables that override them.
//
// One definition each, in a module with no dependencies, because both are read
// from two sides that must agree: the CLI resolves the lineage folder while
// generating and the process resolves it while applying, and both connect to a
// database when nothing said which. Two copies drifting apart means `qualy
// deploy` writing one lineage while the application applies another, or the
// two reaching different databases - neither of which anything would notice.

/**
 * Where the product's lineage lives, relative to the product root (the
 * manifest's directory). Not configurable: one product has one committed
 * history.
 */
export const MIGRATIONS_FOLDER = 'db/migrations'

/**
 * What a migration file is called: a 14-digit UTC instant, then an optional
 * lowercase name in dashes. The instant is the order; the name is for people.
 * `qualy database check` holds the lineage to it, and the CI gate on committed
 * migrations holds every added file to it.
 */
export const MIGRATION_FILE = /^(\d{14})(?:_[a-z0-9]+(?:-[a-z0-9]+)*)?\.sql$/

/**
 * How long the application's own sessions wait on the database before the
 * wait is a failure, in milliseconds.
 *
 * Without them a lock queue or a database that stopped answering held every
 * request, and the readiness probe, for as long as it lasted. The pool's
 * connection timeout covers both getting a pooled connection and opening a
 * new one; the other three are PostgreSQL's own session settings, sent when a
 * session opens. A `statement_timeout`, `lock_timeout` or
 * `idle_in_transaction_session_timeout` parameter on DATABASE_URL overrides
 * the one here, 0 turning it off. The migrator opens sessions of its own and
 * keeps its own limits.
 */
export interface DatabaseTimeouts {
  readonly connectMs: number
  readonly statementMs: number
  readonly lockMs: number
  readonly idleInTransactionMs: number
}

export const DATABASE_TIMEOUTS: DatabaseTimeouts = {
  connectMs: 5_000,
  statementMs: 30_000,
  lockMs: 10_000,
  idleInTransactionMs: 60_000,
}

/** the database a development machine is assumed to have */
export const LOCAL_FALLBACK = 'postgres://qualy:qualy@localhost:5432/qualy'

/**
 * The server generation builds its two scratch databases on, when it is not
 * the one DATABASE_URL names. Development and CI only: a production
 * deployment applies the committed lineage and never generates.
 */
export const GENERATION_URL_VARIABLE = 'QUALY_GENERATION_DATABASE_URL'

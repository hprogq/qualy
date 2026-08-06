// The two answers a machine with nothing configured is assumed to want.
//
// One definition each, in a module with no dependencies, because both are read
// from two sides that must agree: the CLI resolves the lineage folder while
// generating and the process resolves it while applying, and both connect to a
// database when nothing said which. Two copies drifting apart means `qualy
// deploy` writing one lineage while the application applies another, or the
// two reaching different databases - neither of which anything would notice.

/** where the lineage lives when the manifest does not say, relative to it */
export const MIGRATIONS_FOLDER = 'db/migrations'

/** the database a development machine is assumed to have */
export const LOCAL_FALLBACK = 'postgres://qualy:qualy@localhost:5432/qualy'

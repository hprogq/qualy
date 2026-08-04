// The trusted caller, as a value production code cannot obtain.
//
// Authorization used to be skippable by omission: the actor parameter was
// optional and the in-lock checks opened with an early return when it was
// absent, so a caller that forgot the argument was treated as trusted. No
// production call site forgot, but the type system allowed it and sixty-six
// tests depended on it, which meant authorization was skippable for test
// convenience. A caller that forgets and a caller that is trusted must not
// look the same.
//
// The actor is now required, and the only way to be trusted is to pass this,
// whose sole construction site is the testkit. Production code cannot import
// a testkit (scripts/tests/test-layers.test.ts), so an HTTP handler cannot
// reach it however the call is written.
//
// The predicate is exported here rather than from the testkit because checking
// is not constructing: services must be able to ask, without anyone being able
// to answer falsely.

const SYSTEM_ACTOR = Symbol.for('qualy.rbac.system-actor')

/** a caller that is trusted by construction rather than by authorization */
export interface SystemActor {
  readonly [SYSTEM_ACTOR]: true
}

/**
 * Recognises the trusted caller across package instances.
 *
 * A global symbol rather than instanceof, for the same reason the domain error
 * brands are: a second copy of this package must not produce a value that
 * fails to be recognised.
 */
export const isSystemActor = (actor: unknown): actor is SystemActor =>
  typeof actor === 'object' && actor !== null && SYSTEM_ACTOR in actor

/** the one construction site, re-exported only from the testkit */
export const makeSystemActor = (): SystemActor => ({ [SYSTEM_ACTOR]: true })

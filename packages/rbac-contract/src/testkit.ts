import { makeSystemActor, type SystemActor } from './system-actor.ts'

// The trusted caller, available only here.
//
// A test that exercises domain logic without building an authorization graph
// passes this instead of omitting an argument, so "trusted" is something a
// call says rather than something it fails to say. Production code cannot
// import a testkit, which is what keeps this out of reach of a request.

export const systemActor: SystemActor = makeSystemActor()

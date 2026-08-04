import { NodeRuntime } from '@effect/platform-node'
import { Layer } from 'effect'
import { application } from './runtime.ts'

// The Effect entry point, running alongside the cordis one until the switch.
//
// `runMain` installs the signal handlers, interrupts the root fiber, runs
// every finalizer and decides the exit code, so graceful shutdown is not
// something this file implements. `Layer.launch` builds the application and
// then waits: the process stays up because the server is running, not because
// something is holding it open.
NodeRuntime.runMain(Layer.launch(application))

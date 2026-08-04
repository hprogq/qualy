import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { NodeRuntime } from '@effect/platform-node'
import { Layer } from 'effect'
import { verifyAssembly } from '../verify-assembly.ts'
import { application } from './runtime.ts'

// Start validates and starts; it never repairs. The generated modules this
// process imports are derived from the manifest and the lock, so an instance
// whose layers, routes or permission catalog do not match the reviewed lock is
// running an assembly nobody approved. Production refuses; development warns,
// because editing the manifest and restarting is the whole loop there.
const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const configPath = process.env.QUALY_CONFIG
  ? path.resolve(process.env.QUALY_CONFIG)
  : path.join(appRoot, 'qualy.yml')
await verifyAssembly(configPath, (message) => console.warn(message))

// The Effect entry point, running alongside the cordis one until the switch.
//
// `runMain` installs the signal handlers, interrupts the root fiber, runs
// every finalizer and decides the exit code, so graceful shutdown is not
// something this file implements. `Layer.launch` builds the application and
// then waits: the process stays up because the server is running, not because
// something is holding it open.
NodeRuntime.runMain(Layer.launch(application))

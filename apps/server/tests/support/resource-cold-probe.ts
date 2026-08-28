import net from 'node:net'
import { resolveLogging } from '../../src/logging.ts'
import { manifestPath } from '../../src/manifest.ts'
import { verifyAssembly } from '../../src/verify-assembly.ts'

// Everything this process does on its way up, stopping one line short.
//
// The line is `Layer.launch`. Above it the work is pure - read the manifest,
// check it against the lock, import every active plugin's descriptor, compose
// the layers - and below it the process takes the port, the pool, the
// scheduler and whatever else the assembly owns. A development supervisor
// stages a candidate through the band above and only lets it cross once the
// process it is replacing has gone, so "the band above touches nothing" is a
// property the supervisor rests on rather than a nicety.
//
// This probe runs that band with the outside world unreachable and with every
// outbound connection and every listen recorded, then prints what it saw and
// returns. It deliberately does not call `process.exit`: a probe that ends on
// its own has left nothing running, which is the other half of the claim.

const connects: string[] = []
const listens: string[] = []

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function patched(this: net.Socket, ...args: never[]) {
  connects.push(JSON.stringify(args[0] ?? null))
  return connect.apply(this, args as never)
}

const listen = net.Server.prototype.listen
net.Server.prototype.listen = function patched(this: net.Server, ...args: never[]) {
  listens.push(JSON.stringify(args[0] ?? null))
  return listen.apply(this, args as never)
}

const report = (extra: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify({ connects, listens, ...extra })}\n`)
}

try {
  const resolution = await verifyAssembly(manifestPath(), () => {})
  const { makeApplication } = await import('../../src/runtime.ts')
  await makeApplication(resolution, resolveLogging(undefined, {}, 'development'))
  report({ composed: true })
} catch (error) {
  report({ composed: false, error: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
}

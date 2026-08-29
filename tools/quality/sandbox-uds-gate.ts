/**
 * The provider capability gate for the sandbox container form: a REAL
 * bidirectional AF_UNIX PING/PONG through a bind-mounted directory, because
 * a socket inode appearing on the other side proves nothing (measured:
 * OrbStack and Docker Desktop's AVF+VirtioFS both sync the node and refuse
 * the connection; Docker VMM carries it). Any container provider or
 * file-sharing implementation must pass this before `pnpm sandbox:up` is
 * worth talking about. No fallbacks live here on purpose: a failing gate
 * stops the container form, it never degrades to TCP.
 */

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const IMAGE = 'node:24-alpine'
// under the HOME share on purpose: the macos tmpdir (/var/folders) rides a
// different share channel where the container->host direction was measured
// to hang, while the home share carries both - and the real sockets live
// under the repository anyway
const probeDir = fs.mkdtempSync(path.join(os.homedir(), '.qualy-uds-gate-'))
// mkdtemp yields 0700; the provider's connect-forwarding was measured to
// hang against it, while 0755 (any hand-made directory) carries fine
fs.chmodSync(probeDir, 0o755)
const sockDir = path.join(probeDir, 'sock')
fs.mkdirSync(sockDir)

const SERVER = `
import net from 'node:net'
import fs from 'node:fs'
const sock = process.argv[2]
try { fs.unlinkSync(sock) } catch {}
net.createServer((c) => c.on('data', (d) => c.write(d.toString() === 'PING' ? 'PONG' : 'NO')))
  .listen(sock, () => console.log('listening'))
`
fs.writeFileSync(path.join(probeDir, 'server.mjs'), SERVER)
fs.writeFileSync(
  path.join(probeDir, 'client.mjs'),
  `
import net from 'node:net'
const timer = setTimeout(() => { console.error('timeout'); process.exit(1) }, 5000)
const c = net.connect(process.argv[2], () => c.write('PING'))
c.on('data', (d) => { clearTimeout(timer); process.exit(d.toString() === 'PONG' ? 0 : 1) })
c.on('error', (e) => { console.error(String(e)); process.exit(1) })
`,
)

const docker = (args: readonly string[], options: { detach?: boolean } = {}) => {
  if (options.detach) return spawn('docker', args, { stdio: 'ignore', detached: false })
  return execFileSync('docker', args, { encoding: 'utf8' })
}

const hostRoundtrip = (sock: string): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000)
    const connection = net.connect(sock, () => connection.write('PING'))
    connection.on('data', (data) => {
      clearTimeout(timer)
      connection.end()
      resolve(data.toString() === 'PONG')
    })
    connection.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })

const waitFor = async (file: string): Promise<void> => {
  const deadline = Date.now() + 15_000
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error('gate socket never appeared')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const name = `qualy-uds-gate-${process.pid}`
let failed = false
try {
  // direction 1: container listens, host connects
  docker(['rm', '-f', name])
} catch {
  // absent is fine
}
try {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '-v',
    `${sockDir}:/sock`,
    '-v',
    `${path.join(probeDir, 'server.mjs')}:/srv/server.mjs:ro`,
    IMAGE,
    'node',
    '/srv/server.mjs',
    '/sock/gate.sock',
  ])
  await waitFor(path.join(sockDir, 'gate.sock'))
  const inbound = await hostRoundtrip(path.join(sockDir, 'gate.sock'))
  console.log(`container-listen -> host-connect: ${inbound ? 'PASS' : 'FAIL'}`)
  if (!inbound) failed = true

  // the direction-1 container must release the mount first: a second
  // container sharing the directory while the first still holds it was
  // measured to hang the host-listen direction
  docker(['rm', '-f', name])

  // direction 2: host listens, container connects - in a FRESH directory:
  // the share established for direction 1 caches its view, and a host
  // socket created after that share exists was measured to hang
  const sockDir2 = path.join(probeDir, 'sock2')
  fs.mkdirSync(sockDir2)
  const hostSock = path.join(sockDir2, 'host.sock')
  const server = net.createServer((c) => c.on('data', (d) => c.write('PONG')))
  await new Promise<void>((resolve) => server.listen(hostSock, resolve))
  try {
    // async on purpose: the ping server lives in THIS process, and a
    // synchronous docker call would freeze the event loop under it -
    // measured as a self-inflicted five-second hang before anyone answered
    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${sockDir2}:/sock`,
          '-v',
          `${path.join(probeDir, 'client.mjs')}:/srv/client.mjs:ro`,
          IMAGE,
          'node',
          '/srv/client.mjs',
          '/sock/host.sock',
        ],
        { stdio: ['ignore', 'inherit', 'inherit'] },
      )
      child.on('exit', (exitCode) => resolve(exitCode ?? 1))
    })
    console.log(`host-listen -> container-connect: ${code === 0 ? 'PASS' : 'FAIL'}`)
    if (code !== 0) failed = true
  } finally {
    server.close()
  }
} finally {
  try {
    docker(['rm', '-f', name])
  } catch {
    // already gone
  }
  fs.rmSync(probeDir, { recursive: true, force: true })
}

if (failed) {
  console.error('\nThis container provider cannot carry AF_UNIX connections across a bind mount.')
  console.error(
    'On Docker Desktop for Mac, switch Settings -> General -> Virtual Machine Manager to Docker VMM.',
  )
  console.error('The sandbox container form refuses to run without this; there is no TCP fallback.')
  process.exit(1)
}
console.log('\nprovider capability gate: PASS')

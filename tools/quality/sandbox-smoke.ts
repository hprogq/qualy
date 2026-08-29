/**
 * The container security smoke of the isolation spec (§50), run against the
 * LIVE compose sandbox: non-root, no capabilities, read-only root, no
 * network, no docker socket, no repository, no host secrets, and neither
 * container able to see the other's socket. Run `pnpm sandbox:up` first.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const services = ['sandbox-runtime', 'sandbox-authoring'] as const

const containerOf = (service: string): string => {
  const out = execFileSync('docker', ['compose', '--profile', 'sandbox', 'ps', '-q', service], {
    encoding: 'utf8',
  }).trim()
  if (out === '') throw new Error(`${service} is not running; \`pnpm sandbox:up\` first`)
  return out.split('\n')[0]!
}

const execIn = (container: string, command: string): { code: number; out: string } => {
  try {
    const out = execFileSync('docker', ['exec', container, 'sh', '-c', command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out: out.trim() }
  } catch (failure) {
    const wrapped = failure as { status?: number; stdout?: string; stderr?: string }
    return {
      code: wrapped.status ?? 1,
      out: `${wrapped.stdout ?? ''}${wrapped.stderr ?? ''}`.trim(),
    }
  }
}

let failed = false
const check = (service: string, name: string, holds: boolean, detail: string): void => {
  console.log(`${holds ? 'PASS' : 'FAIL'}  ${service}: ${name}${holds ? '' : ` — ${detail}`}`)
  if (!holds) failed = true
}

const sentinel = path.join(os.homedir(), '.qualy-sandbox-smoke-sentinel')
fs.writeFileSync(sentinel, 'host-only')

try {
  for (const service of services) {
    const container = containerOf(service)

    const uid = execIn(container, 'id -u')
    check(service, 'runs as non-root', uid.code === 0 && uid.out !== '0', `uid=${uid.out}`)

    const caps = execIn(container, 'grep CapEff /proc/self/status')
    check(service, 'holds no capabilities', caps.out.includes('0000000000000000'), caps.out)

    const rootWrite = execIn(container, 'touch /probe-root 2>&1')
    check(service, 'root filesystem is read-only', rootWrite.code !== 0, rootWrite.out)

    // reachability, not interface listing: the kernel ships down-and-dead
    // tunnel stubs (gre0, tunl0...) even under network_mode none
    const network = execIn(
      container,
      `node -e "const s=require('node:net').connect(53,'8.8.8.8');` +
        `s.on('error',(e)=>{console.log(e.code);process.exit(0)});` +
        `s.on('connect',()=>{console.log('CONNECTED');process.exit(1)});` +
        `setTimeout(()=>{console.log('TIMEOUT');process.exit(1)},3000)"`,
    )
    check(
      service,
      'cannot reach the network',
      network.code === 0 && network.out !== 'CONNECTED',
      network.out,
    )

    for (const [name, at] of [
      ['docker socket', '/var/run/docker.sock'],
      ['repository root', '/repo'],
      ['host env file', '/build/.env'],
      ['host home', `/host${os.homedir()}`],
      ['host sentinel', sentinel],
      ['ssh directory', `${os.homedir()}/.ssh`],
    ] as const) {
      const probe = execIn(container, `test -e '${at}'`)
      check(service, `cannot see ${name}`, probe.code !== 0, `${at} is visible`)
    }

    const other = service === 'sandbox-runtime' ? 'authoring' : 'runtime'
    const cross = execIn(container, `test -e /run/qualy-sandbox/${other}`)
    check(service, `cannot see the ${other} socket directory`, cross.code !== 0, 'visible')

    const own = service === 'sandbox-runtime' ? 'runtime/runtime.sock' : 'authoring/authoring.sock'
    const owns = execIn(container, `test -S /run/qualy-sandbox/${own}`)
    check(service, 'serves its own socket', owns.code === 0, `${own} missing`)
  }
} finally {
  fs.rmSync(sentinel, { force: true })
}

if (failed) {
  console.error('\nsandbox security smoke: FAIL')
  process.exit(1)
}
console.log('\nsandbox security smoke: PASS')

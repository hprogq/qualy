import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The addresses a deployment's parts see each other at, stated in several
// files that have to agree.
//
// An edge proxy on the host connects to the loopback-bound published port,
// and the container sees that connection come from its compose network's
// gateway. If .env.example trusts anything else, the server believes no
// forwarded header and every visitor shares the gateway's address in the
// sign-in rate limits. Nothing fails loudly when these drift apart, so this
// file is where they are compared.

const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const composeGateway = () => {
  const gateway = /gateway: \$\{QUALY_NETWORK_GATEWAY:-([\d.]+)\}/.exec(read('deploy/compose.yaml'))
  if (gateway === null) throw new Error('deploy/compose.yaml fixes no network gateway')
  return gateway[1]!
}

describe('the deployment topology', () => {
  it('trusts the compose network gateway as the proxy by default', () => {
    const trusted = /^QUALY_TRUSTED_PROXIES=(.*)$/m.exec(read('deploy/.env.example'))?.[1]
    expect(trusted).toBe(composeGateway())
  })

  it('points the reverse proxy examples at the gateway, not loopback', () => {
    const gateway = composeGateway()
    for (const file of ['ops/reverse-proxy/Caddyfile', 'ops/reverse-proxy/nginx.conf']) {
      const text = read(file)
      expect(text, file).toContain(gateway)
      expect(text, file).not.toMatch(/e\.g\. 127\.0\.0\.1/)
    }
  })

  it('is a compose project apart from the development one', () => {
    // docker-compose.yml names no project, so it takes the checkout's
    // directory name, and it has services and volumes of the same names
    const project = /^name: (\S+)$/m.exec(read('deploy/compose.yaml'))?.[1]
    expect(project).toBeDefined()
    expect(project).not.toBe(path.basename(ROOT))
    expect(project).not.toBe('qualy')
  })

  it('publishes the development containers on loopback only', () => {
    const published = [...read('docker-compose.yml').matchAll(/^\s+- '([^']*:\d+)'$/gm)].map(
      (match) => match[1]!,
    )
    expect(published.length).toBeGreaterThan(0)
    expect(published.filter((port) => !port.startsWith('127.0.0.1:'))).toEqual([])
  })
})

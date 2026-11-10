import fs from 'node:fs'
import path from 'node:path'

// A release store of a test's own, in the shape the installer writes
// (packages/build/web/src/release-store.ts): one installed release, current,
// its public files, the assets it names in the shared directory,
// and beside them an asset of an earlier release that nothing current names.
// Written by hand here rather than through the installer, so the serving
// half is tested against the layout it reads and not against the installer.

export const TEST_HASH = 'sha256:test'
export const TEST_CONTRACT = 'sha256:test-surfaces'

export interface TestRelease {
  readonly releaseId?: string
  readonly hash?: string
  /** the surfaces this release's bundle can render, as the installer fingerprints them */
  readonly browserContract?: string
  /** hashed assets, by name under assets/ */
  readonly assets?: Readonly<Record<string, string>>
  /** leave the release without its metadata: a store the host must refuse */
  readonly metadata?: boolean
}

export const installTestRelease = (root: string, options: TestRelease = {}): void => {
  const releaseId = options.releaseId ?? 'test-release'
  const releaseRoot = path.join(root, 'releases', releaseId)
  fs.mkdirSync(releaseRoot, { recursive: true })
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(releaseRoot, 'favicon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  )
  const assets = options.assets ?? { 'index-current.js': 'export const release = "current"\n' }
  for (const [name, content] of Object.entries(assets)) {
    fs.writeFileSync(path.join(root, 'assets', name), content)
  }
  // an earlier release's asset: nothing current names it, the store still holds it
  fs.writeFileSync(path.join(root, 'assets', 'page-old.js'), 'export const release = "old"\n')
  if (options.metadata !== false) {
    fs.writeFileSync(
      path.join(releaseRoot, '.qualy-release.json'),
      JSON.stringify({
        schema: 1,
        releaseId,
        mode: 'production',
        clientProtocol: 1,
        resolutionHash: options.hash ?? TEST_HASH,
        browserContractHash: options.browserContract ?? TEST_CONTRACT,
        installedAt: '2026-09-14T09:00:00.000Z',
        assets: Object.keys(assets).map((name) => `assets/${name}`),
      }),
    )
  }
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ schema: 1, releaseId }))
}

/**
 * A server's half of a build, placed where staging places one: a stand-in
 * that draws a small document naming the request it was handed, the nonce
 * and the api it was given, for the release it says it draws.
 */
export const placeTestServer = (
  root: string,
  releaseId = 'test-release',
  /** a fixed document in place of the one naming the request */
  document?: string,
): void => {
  fs.mkdirSync(path.join(root, 'rsc'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  fs.writeFileSync(
    path.join(root, '.qualy-server-build.json'),
    JSON.stringify({ schema: 1, releaseId }),
  )
  if (document !== undefined) {
    fs.writeFileSync(
      path.join(root, 'rsc', 'index.js'),
      `export default async () =>
  new Response(${JSON.stringify(document)}, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
  })
`,
    )
    return
  }
  fs.writeFileSync(
    path.join(root, 'rsc', 'index.js'),
    `export default async (request, context) => {
  if (new URL(request.url).pathname.startsWith('/telemetry-slow/')) {
    context.onRoute?.('/telemetry-slow/:id', 'document')
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'))
        setTimeout(() => { try { controller.enqueue(new TextEncoder().encode('second')); controller.close() } catch {} }, 1000)
      }
    }), { headers: { 'content-type': 'text/html' } })
  }
  if (new URL(request.url).pathname.startsWith('/telemetry/')) context.onRoute?.('/telemetry/:id', new URL(request.url).pathname.endsWith('.rsc') ? 'rsc' : 'document')
  return new Response(
    '<!doctype html><title>drawn</title><p data-path="' + new URL(request.url).pathname +
      '" data-nonce="' + context.nonce + '" data-api="' + context.apiOrigin + '">${releaseId}</p>',
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } },
  )
}
`,
  )
}

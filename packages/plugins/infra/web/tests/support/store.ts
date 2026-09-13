import fs from 'node:fs'
import path from 'node:path'

// A release store of a test's own, in the shape the installer writes
// (packages/build/web/src/release-store.ts): one installed release, current,
// its shell and public files, the assets it names in the shared directory,
// and beside them an asset of an earlier release that nothing current names.
// Written by hand here rather than through the installer, so the serving
// half is tested against the layout it reads and not against the installer.

export const TEST_HASH = 'sha256:test'

export interface TestRelease {
  readonly releaseId?: string
  readonly hash?: string
  /** the shell's bytes; a plain page unless the test is about its content */
  readonly shell?: string
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
    path.join(releaseRoot, 'index.html'),
    options.shell ?? '<!doctype html><title>shell</title>',
  )
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
        installedAt: '2026-09-14T09:00:00.000Z',
        assets: Object.keys(assets).map((name) => `assets/${name}`),
      }),
    )
  }
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ schema: 1, releaseId }))
}

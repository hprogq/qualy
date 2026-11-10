import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssemblyPlugin } from '@qualy/assembly-contract'
import { readCurrentWebRelease, storeAt } from '@qualy/web-build/release-store'
import provider from '../src/assembly/index.ts'
import { RELEASE_STORE_VARIABLE } from '../src/config.ts'
import { installTestRelease } from './support/store.ts'

// The deploy step as `qualy deploy` runs it: the release the image carries at
// this plugin's asset root goes into the deployment's own store, which is
// where the server then serves from (effect-web.test.ts has the start's side).

const dirs: string[] = []
const temp = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const work = (
  options: {
    readonly assetRoot: string
    readonly state?: AssemblyPlugin['state']
  },
  args: readonly string[] = [],
) => {
  const manifestDir = temp('qualy-product-')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return {
    manifestPath: path.join(manifestDir, 'qualy.yml'),
    plugins: new Map([
      [
        '@qualy/plugin-web',
        { id: '@qualy/plugin-web', version: '0.0.0', state: options.state ?? 'active' },
      ],
    ]),
    contributions: new Map<string, never>(),
    descriptors: new Map(),
    resolvePackageDir: () => manifestDir,
    state: {},
    // the manifest block, as the product would write it: relative to the manifest
    providerConfig: { assetRoot: path.relative(manifestDir, options.assetRoot) },
    args,
  }
}
const deploy = (options: {
  readonly assetRoot: string
  readonly state?: AssemblyPlugin['state']
}) => provider.deploy!(work(options))

/** an image's store: the one release it was built with */
const image = (releaseId?: string) => {
  const root = temp('qualy-image-')
  installTestRelease(root, releaseId === undefined ? {} : { releaseId })
  return root
}

describe('the web release deploy step', () => {
  it("installs the image's release into the deployment's store, and again as a no-op", async () => {
    const deployment = temp('qualy-deployment-')
    vi.stubEnv(RELEASE_STORE_VARIABLE, deployment)
    const carried = image()
    await deploy({ assetRoot: carried })
    expect(readCurrentWebRelease(storeAt(deployment))?.releaseId).toBe('test-release')
    expect(fs.existsSync(path.join(deployment, 'assets', 'index-current.js'))).toBe(true)
    // the job run twice for one image changes nothing
    await deploy({ assetRoot: carried })
    expect(readCurrentWebRelease(storeAt(deployment))?.releaseId).toBe('test-release')
  })

  it('keeps the release before when the next image is deployed', async () => {
    const deployment = temp('qualy-deployment-')
    vi.stubEnv(RELEASE_STORE_VARIABLE, deployment)
    await deploy({ assetRoot: image('earlier-release') })
    await deploy({ assetRoot: image() })
    expect(readCurrentWebRelease(storeAt(deployment))?.releaseId).toBe('test-release')
    for (const id of ['earlier-release', 'test-release']) {
      expect(fs.existsSync(path.join(deployment, 'releases', id, 'favicon.svg'))).toBe(true)
    }
  })

  it('defers collection during repeated promotions and collects only for the verified serving release', async () => {
    const deployment = temp('qualy-deployment-')
    vi.stubEnv(RELEASE_STORE_VARIABLE, deployment)
    vi.stubEnv('QUALY_WEB_RELEASE_RETAIN_COUNT', '0')
    vi.stubEnv('QUALY_WEB_RELEASE_RETAIN_HOURS', '0')
    const first = temp('qualy-image-')
    installTestRelease(first, { releaseId: 'old', assets: { 'old.js': 'old content' } })
    await deploy({ assetRoot: first })
    const metadata = path.join(deployment, 'releases/old/.qualy-release.json')
    const old = JSON.parse(fs.readFileSync(metadata, 'utf8'))
    old.installedAt = '2000-01-01T00:00:00.000Z'
    fs.writeFileSync(metadata, JSON.stringify(old))
    for (const id of ['candidate-one', 'candidate-two']) await deploy({ assetRoot: image(id) })
    expect(fs.readFileSync(path.join(deployment, 'assets/old.js'), 'utf8')).toBe('old content')
    expect(fs.existsSync(path.join(deployment, 'releases/old/favicon.svg'))).toBe(true)
    await expect(provider.commands!.collect!(work({ assetRoot: first }, ['old']))).rejects.toThrow(
      /does not match/,
    )
    expect(fs.existsSync(path.join(deployment, 'assets/old.js'))).toBe(true)
    await provider.commands!.collect!(work({ assetRoot: first }, ['candidate-two']))
    expect(fs.existsSync(path.join(deployment, 'assets/old.js'))).toBe(false)
    expect(readCurrentWebRelease(storeAt(deployment))?.releaseId).toBe('candidate-two')
  })

  it('does nothing where the deployment keeps no store of its own, or serves no web', async () => {
    const carried = image()
    vi.stubEnv(RELEASE_STORE_VARIABLE, '')
    await deploy({ assetRoot: carried })
    const deployment = temp('qualy-deployment-')
    vi.stubEnv(RELEASE_STORE_VARIABLE, deployment)
    await deploy({ assetRoot: carried, state: 'disabled' })
    expect(fs.readdirSync(deployment)).toEqual([])
  })

  it('refuses a store named by a relative path, and an image with no release', async () => {
    vi.stubEnv(RELEASE_STORE_VARIABLE, 'web-releases')
    await expect(deploy({ assetRoot: image() })).rejects.toThrow(/absolute/)
    vi.stubEnv(RELEASE_STORE_VARIABLE, temp('qualy-deployment-'))
    await expect(deploy({ assetRoot: temp('qualy-image-') })).rejects.toThrow(
      /no web release is installed/,
    )
  })
})

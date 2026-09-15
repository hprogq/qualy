import { describe, expect, it } from 'vitest'
import { ConfigProvider, Effect, Layer } from 'effect'
import { TencentRumConfig, config } from '../src/server/config.ts'
import { rumVersionForRelease } from '../src/version.ts'
import { explainRefusal } from '../src/cli/preflight.ts'

// Which project this deployment reports to, and under what name the reports
// arrive.
//
// None of it is secret - the browser sends the reporting id with every report -
// but all of it is one deployment's fact, which is why it is read here and
// served rather than built into a bundle that several deployments share.

const configured = (declared: Record<string, unknown>, env: Record<string, string> = {}) =>
  Effect.runPromise(
    Effect.flatMap(TencentRumConfig, Effect.succeed).pipe(
      Effect.provide(
        config(declared, { manifestDir: '/somewhere' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    ),
  )

describe('the reporting project', () => {
  it('comes from the manifest when the manifest names it', async () => {
    expect((await configured({ id: 'Dv3JDFEPn8GxJ24amb' })).id).toBe('Dv3JDFEPn8GxJ24amb')
  })

  it('comes from the environment in preference, which is how one build serves two deployments', async () => {
    const settings = await configured(
      { id: 'from-manifest' },
      { QUALY_RUM_TENCENT_ID: 'from-environment' },
    )
    expect(settings.id).toBe('from-environment')
  })

  it('refuses to start when nothing names it', async () => {
    // an operator who installed this plugin meant to report; coming up quietly
    // reporting nowhere is the failure nobody notices until they go looking
    await expect(configured({})).rejects.toThrow()
  })

  it('reports production at full rate unless told otherwise', async () => {
    const settings = await configured({ id: 'x' })
    expect(settings.environment).toBe('production')
    expect(settings.sampleRate).toBe(1)
  })

  it('takes an environment name the vendor knows, and refuses one it does not', async () => {
    expect((await configured({ id: 'x', environment: 'pre' })).environment).toBe('pre')
    await expect(configured({ id: 'x', environment: 'staging' })).rejects.toThrow()
  })

  it('refuses a sample rate outside the range rather than clamping it', async () => {
    // clamping up reports everything from a deployment that asked for a tenth;
    // clamping down drops failures. Both are answers to a typo nobody sees.
    expect((await configured({ id: 'x', sampleRate: 0.25 })).sampleRate).toBe(0.25)
    await expect(configured({ id: 'x', sampleRate: 0 })).rejects.toThrow()
    await expect(configured({ id: 'x', sampleRate: 1.5 })).rejects.toThrow()
    await expect(configured({ id: 'x', sampleRate: -1 })).rejects.toThrow()
  })

  it('refuses a manifest key it does not know', async () => {
    // a key that looks applied and is not is what the channel exists to stop
    await expect(configured({ id: 'x', projectId: 159421 })).rejects.toThrow()
  })
})

describe('the version a report is filed under', () => {
  it('is the release id itself, which is what every real one fits in', () => {
    // a minted production id is 24 characters, so the fallback below is
    // reached only by a deployment that names its releases itself
    expect(rumVersionForRelease('r_hT3kQ9vXbN2mPzR7wL4sYd')).toBe('r_hT3kQ9vXbN2mPzR7wL4sYd')
    expect(rumVersionForRelease('dev-633d6de6')).toBe('dev-633d6de6')
  })

  it('is a digest once the id is longer than the platform accepts', () => {
    const long = `release-${'x'.repeat(80)}`
    const mapped = rumVersionForRelease(long)
    expect(mapped).toMatch(/^q-[0-9a-f]{16}$/)
    expect(mapped.length).toBeLessThanOrEqual(60)
  })

  it('gives ids that share a prefix different versions', () => {
    // the reason this is a digest and not a truncation: two releases mapped
    // onto one version share one set of source maps, and every stack trace
    // from the second is then restored against the first
    const base = 'release-'.padEnd(58, 'a')
    expect(rumVersionForRelease(`${base}-one`)).not.toBe(rumVersionForRelease(`${base}-two`))
  })

  it('answers the same thing every time, in every runtime', () => {
    const long = `release-${'y'.repeat(90)}`
    expect(rumVersionForRelease(long)).toBe(rumVersionForRelease(long))
    // pinned, because the browser and the source map uploader have to agree
    // across processes and across machines
    expect(rumVersionForRelease('a'.repeat(61))).toBe('q-f9bf3487d17c93f0')
  })
})

// Whether a deployment would be allowed to report, asked before it is one.
//
// The platform decides per origin, and a browser it refuses gets a 403 - at
// which point the sdk destroys its own instance and the page reports nothing
// for the rest of its life, with no error anybody could see. So the order is
// "origin on the list, then deploy", and the preflight is what makes that
// checkable rather than remembered.
//
// The reading is asserted here and the request is not: the request was run
// against the real endpoint once, which is how the header turned out not to
// be the bare code the notes recorded.

describe('what the platform said when it refused', () => {
  it('names the two causes worth telling apart', () => {
    // an id that does not exist and an origin that is not allowed are
    // different problems with different fixes, and the code is the only thing
    // that separates them
    expect(
      explainRefusal('type:business, code:41, msg:project(probe-id) is not exist'),
    ).toContain('no project has that reporting id')
    expect(
      explainRefusal('type:business, code:111, msg:id(x) in origin(y) is not allowed'),
    ).toContain('that origin is not on the project allow list')
  })

  it('keeps the platform own words either way', () => {
    // what this product calls it is a translation; what the platform called
    // it is the evidence
    expect(explainRefusal('type:business, code:41, msg:project(probe-id) is not exist')).toContain(
      'msg:project(probe-id) is not exist',
    )
  })

  it('reads out a refusal it has no translation for rather than a number', () => {
    const said = explainRefusal('type:business, code:999, msg:something new')
    expect(said).toBe('the platform refused: type:business, code:999, msg:something new')
    // and one that is not shaped like the others at all
    expect(explainRefusal('rate limited')).toBe('the platform refused: rate limited')
  })
})

import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { ShellPolicy, shellPolicyLayer } from '@qualy/api-kit/shell-policy'
import { RumProviders } from '@qualy/plugin-rum/server'
import plugin from '../src/index.ts'
import {
  TENCENT_RUM_ID_MISSING,
  TencentRumConfig,
  type TencentRumConfiguration,
} from '../src/server/config.ts'
import { TENCENT_RUM_HOST } from '../src/settings.ts'

// What the provider does with the reporting switch. Off, it stays idle: no
// settings served, no host in the shell's policy, no id asked for - so a
// laptop and a CI job run the release that carries this plugin. On, it
// reports or refuses to start; it never comes up reporting nowhere.

const registration = plugin.features.find((feature) => feature._tag === 'Layer')!
  .layer as Layer.Layer<never, never, RumProviders | TencentRumConfig | ShellPolicy>

const named: TencentRumConfiguration = {
  settings: { id: 'Dv3JDFEPn8GxJ24amb', environment: 'production', sampleRate: 1 },
}

const started = async (configuration: TencentRumConfiguration, reporting: boolean) => {
  const registered: string[] = []
  const exit = await Effect.runPromiseExit(
    Effect.flatMap(ShellPolicy, (policy) => policy.entries).pipe(
      Effect.provide(
        registration.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              shellPolicyLayer,
              Layer.succeed(TencentRumConfig, TencentRumConfig.of(configuration)),
              Layer.succeed(
                RumProviders,
                RumProviders.of({
                  reporting,
                  register: (entry) =>
                    Effect.sync(() => {
                      registered.push(entry.code)
                    }),
                  selected: Effect.succeed(null),
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  )
  return { exit, registered }
}

describe('the tencent provider and the reporting switch', () => {
  it('stays idle while reporting is off, with or without an id', async () => {
    for (const configuration of [named, { refusal: TENCENT_RUM_ID_MISSING }]) {
      const { exit, registered } = await started(configuration, false)
      expect(Exit.isSuccess(exit) && exit.value).toEqual([])
      expect(registered).toEqual([])
    }
  })

  it('reports, and opens the policy to its host, while reporting is on', async () => {
    const { exit, registered } = await started(named, true)
    expect(registered).toEqual(['tencent'])
    expect(Exit.isSuccess(exit) && exit.value).toEqual([
      { owner: '@qualy/plugin-rum-tencent', 'connect-src': [TENCENT_RUM_HOST] },
    ])
  })

  it('refuses to start with reporting on and no id, naming the variable', async () => {
    const { exit, registered } = await started({ refusal: TENCENT_RUM_ID_MISSING }, true)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain('QUALY_RUM_TENCENT_ID')
    expect(registered).toEqual([])
  })
})

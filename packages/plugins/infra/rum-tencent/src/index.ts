import { Effect, Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { ShellPolicy } from '@qualy/api-kit/shell-policy'
import { Rum } from '@qualy/plugin-rum/plugin'
import { RumProviders } from '@qualy/plugin-rum/server'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Cli } from '@qualy/plugin-kit/cli'
import { config, TencentRumConfig } from './server/config.ts'
import { TENCENT_RUM_HOST, TENCENT_RUM_PROVIDER } from './settings.ts'

// Reporting browser failures to a Tencent Cloud RUM project.
//
// Installing this plugin is a deployment decision and nothing more: no
// business plugin depends on it, no screen mentions it, and the vocabulary the
// runtime reports through does not change when this is swapped for another
// provider. The two lines that would swap it are in the manifest.
//
// Everything vendor-shaped lives in this package: the sdk, its hooks, the host
// its reports go to, the mapping from a release to a version. The capability
// next door must never learn any of it.

const registration: Layer.Layer<never, never, RumProviders | TencentRumConfig | ShellPolicy> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const settings = yield* TencentRumConfig
      const registry = yield* RumProviders
      yield* registry.register({
        code: TENCENT_RUM_PROVIDER,
        // verbatim to the browser; the capability does not read it, and
        // nothing that a browser may not see belongs in it
        publicConfig: { ...settings },
      })
      // the browser talks to the reporting host directly, so the shell's
      // policy has to allow it - and only while this plugin is selected, which
      // is what makes "reporting off" mean no endpoint in the policy either
      const policy = yield* ShellPolicy
      yield* policy.register({
        owner: '@qualy/plugin-rum-tencent',
        'connect-src': [TENCENT_RUM_HOST],
      })
      yield* Effect.logDebug(
        `browser reporting to tencent rum project ${settings.id} (${settings.environment}, sampling ${String(settings.sampleRate)})`,
      )
    }),
  )

const plugin = Plugin.define(
  '@qualy/plugin-rum-tencent',
  { dependsOn: ['@qualy/plugin-rum'], config },
  Rum.provider({ code: TENCENT_RUM_PROVIDER }),
  // the browser half announces itself; the sdk arrives only if it is used
  Ui.browser('./client/register.ts'),
  // Filing this build's source maps, run by a release pipeline and never by
  // the serving process. The namespace is this provider's because the
  // capability has no commands of its own and only one provider may be
  // enabled at a time; a different provider would claim it in its turn, with
  // its own platform's upload flow behind the same words.
  Cli.command({
    namespace: 'rum',
    name: 'sourcemaps',
    summary: "file this build's source maps with the reporting platform",
    context: 'assembly',
    load: () => import('./cli/sourcemaps.ts'),
  }),
  Plugin.layer(registration),
)

export default plugin

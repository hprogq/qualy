import { Context, Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import { isCaptchaProviderCode } from './contract.ts'

// This capability's face in the descriptor model: what a plugin writes to say
// "I am where challenges come from".
//
// At most one, decided in the assembly. A browser that is asked for one
// provider's challenge while another's proof is expected fails every time,
// and two providers sharing a deployment would mean a proof's worth depended
// on which of them happened to issue it. None is allowed: a deployment with
// no provider still starts, says so, and lets challenged requests through.

export interface CaptchaProviderDeclaration {
  /** the word a challenge names its provider by, and the browser half answers to */
  readonly code: string
}

/** every challenge provider this assembly's plugins declare */
export const CaptchaProviderDeclarations = ExtensionPoint.make<CaptchaProviderDeclaration>(
  '@qualy/plugin-captcha/providers',
  { phase: 'prepare' },
)

/** what the assembly says exists, before anything has been built */
export class DeclaredCaptchaProvider extends Context.Service<
  DeclaredCaptchaProvider,
  (CaptchaProviderDeclaration & { readonly pluginId: string }) | null
>()('@qualy/plugin-captcha/DeclaredCaptchaProvider') {}

export const Captcha = {
  /** declares that this plugin issues and verifies challenges */
  provider: (declaration: CaptchaProviderDeclaration): PluginFeature => {
    if (!isCaptchaProviderCode(declaration.code)) {
      throw new Error(
        `"${declaration.code}" is not a captcha provider code: lowercase words joined by hyphens`,
      )
    }
    return Plugin.contribute(CaptchaProviderDeclarations, declaration)
  },

  /**
   * The owner's interpretation: none, or exactly one.
   *
   * A second provider is refused here, by name, while the assembly is being
   * described - not resolved by load order. Moving from one provider to
   * another is two lines in the manifest, and the refusal is what makes the
   * first of them mandatory.
   */
  owner: Plugin.provideExtension(CaptchaProviderDeclarations, {
    compile: (contributions) => {
      if (contributions.length > 1) {
        const named = contributions.map((contribution) => contribution.pluginId).join(', ')
        throw new Error(
          `challenges take one provider and this assembly declares ${String(contributions.length)}: ${named}. ` +
            'Disable all but one in the manifest.',
        )
      }
      const only = contributions[0]
      return Layer.succeed(
        DeclaredCaptchaProvider,
        only === undefined ? null : { ...only.value, pluginId: only.pluginId },
      )
    },
  }),
}

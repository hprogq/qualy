import { Context, Data, Layer } from 'effect'
import type { Effect } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'

// This capability's face: what a plugin writes to say "I can deliver mail",
// and what a plugin holds to send some.
//
// Sending is one call with the message already written - subject, text and,
// when there is one, the html alternative. What a message says, and in which
// language, is the sender's business: this capability does not know what a
// password reset is and never will. Where the message goes out is a
// deployment's choice among the backends installed, declared here as data
// and registered by the backend's own layer, and checked at the barrier.

export interface MailBackendDeclaration {
  /** what the deployment names to choose this backend */
  readonly code: string
}

/** every mail backend this assembly's plugins declare, in plugin order */
export const MailBackendDeclarations = ExtensionPoint.make<MailBackendDeclaration>(
  '@qualy/plugin-mail/backends',
  { phase: 'prepare' },
)

/** what the assembly says exists, before anything has been built */
export class DeclaredMailBackends extends Context.Service<
  DeclaredMailBackends,
  readonly (MailBackendDeclaration & { readonly pluginId: string })[]
>()('@qualy/plugin-mail/DeclaredMailBackends') {}

/** one message, as the sender writes it */
export interface MailMessage {
  /** one recipient; a message to several people is several messages */
  readonly to: string
  readonly subject: string
  readonly text: string
  /** the same message as html, for clients that show it */
  readonly html?: string
  readonly replyTo?: string
}

/**
 * The message did not go out.
 *
 * `rejected`: the server refused it - the address, the sender, the content.
 * `unavailable`: the server could not be reached or did not answer in time.
 * Neither is retried here; the sender decides what not sending means.
 */
export class MailUnavailable extends Data.TaggedError('MailUnavailable')<{
  readonly reason: 'rejected' | 'unavailable'
}> {}

export class Mailer extends Context.Service<
  Mailer,
  {
    /** sends through the deployment's default backend, from its address */
    readonly send: (message: MailMessage) => Effect.Effect<void, MailUnavailable>
  }
>()('@qualy/plugin-mail/Mailer') {}

export const Mail = {
  /** declares that this plugin provides a way to deliver mail */
  backend: (declaration: MailBackendDeclaration): PluginFeature =>
    Plugin.contribute(MailBackendDeclarations, declaration),

  /**
   * The owner's interpretation: the declared set as a value every layer may
   * read. Two plugins claiming one code is refused rather than decided by
   * which one built last.
   */
  provider: Plugin.provideExtension(MailBackendDeclarations, {
    compile: (contributions) => {
      const declared = contributions.map((contribution) => ({
        ...contribution.value,
        pluginId: contribution.pluginId,
      }))
      const seen = new Map<string, string>()
      for (const declaration of declared) {
        const owner = seen.get(declaration.code)
        if (owner !== undefined) {
          throw new Error(
            `two plugins provide the mail backend "${declaration.code}": ${owner} and ${declaration.pluginId}`,
          )
        }
        seen.set(declaration.code, declaration.pluginId)
      }
      return Layer.succeed(DeclaredMailBackends, declared)
    },
  }),
}

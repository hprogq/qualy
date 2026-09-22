import { Layer } from 'effect'
import type { Assembled } from '@qualy/api-kit/assembled'
import type { DeclaredMailBackends, Mailer } from '../plugin.ts'
import type { MailConfig } from './config.ts'
import { barrierLayer, MailBackends, registryLayer } from './registry.ts'
import { serviceLayer as mailerLayer } from './service.ts'

// What core mail publishes: the sender every plugin holds, and the registry a
// backend plugin registers into. The backend contract is here for backends;
// nothing else is anybody's business.

export { config, MailConfig, DEVELOPMENT_FROM, MAIL_FROM_MISSING, senderValid } from './config.ts'
export { MailBackends } from './registry.ts'
export { MailBackendFailed, type MailBackend, type OutgoingMail } from './backend.ts'

/** the registry first, then the sender over it, and the barrier check at assembly */
export const serviceLayer: Layer.Layer<
  Mailer | MailBackends,
  never,
  MailConfig | DeclaredMailBackends | Assembled
> = Layer.mergeAll(mailerLayer, barrierLayer).pipe(Layer.provideMerge(registryLayer))

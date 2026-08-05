import { Context } from 'effect'

// What the host tells this plugin about its own deployment.
//
// Its own module because both the session middleware and the sign-in service
// need it, and the middleware must not import the service to get it.

/** what the host tells this plugin about its own deployment */
export class AuthConfig extends Context.Service<
  AuthConfig,
  {
    /** the tenant an anonymous visitor is offered a way into */
    readonly defaultTenantSlug: string
    readonly sessionTtlSeconds: number
    readonly secureCookies: boolean
  }
>()('@qualy/plugin-auth/AuthConfig') {}

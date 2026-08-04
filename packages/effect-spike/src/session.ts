import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
} from 'effect/unstable/httpapi'

// The gap M1b left open: can HttpApi carry this project's session, which is an
// HttpOnly cookie holding an opaque token, and hand the resolved principal to
// a handler without every handler re-deriving it?
//
// This is not the auth migration. It is the smallest thing that answers the
// question, so the answer is known before auth is rewritten around it.

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  'Unauthorized',
  {},
  { httpApiStatus: 401 },
) {}

/** who the request is, derived once by the middleware */
export class Principal extends Context.Service<
  Principal,
  { readonly userId: string }
>()('@qualy/effect-spike/Principal') {}

export const sessionCookie = HttpApiSecurity.apiKey({ in: 'cookie', key: 'qualy_session' })

/**
 * Reads the cookie and resolves it to a principal, or fails the request.
 *
 * `provides` is what makes this worth having: handlers under this middleware
 * receive `Principal` in their context, so nothing downstream parses a cookie
 * or repeats the lookup.
 */
export class Authenticate extends HttpApiMiddleware.Service<Authenticate, {
  provides: Principal
}>()('@qualy/effect-spike/Authenticate', {
  security: { session: sessionCookie },
  error: Unauthorized,
}) {}

/** the only token this spike accepts, standing in for a session table */
const validToken = 'session-token-for-ada'

export const authenticateLayer = Layer.succeed(
  Authenticate,
  Authenticate.of({
    // the handler wraps the rest of the request rather than returning a value:
    // it decides whether to continue at all, and provides the principal into
    // whatever runs next
    session: Effect.fn('Authenticate.session')(function* (httpEffect, { credential }) {
      if (Redacted.value(credential) !== validToken) return yield* new Unauthorized()
      return yield* Effect.provideService(httpEffect, Principal, Principal.of({ userId: 'ada' }))
    }),
  }),
)

export const sessionApi = HttpApi.make('session').add(
  HttpApiGroup.make('session')
    .add(
      HttpApiEndpoint.post('login', '/session', {
        payload: Schema.Struct({ identifier: Schema.String }),
        success: Schema.Struct({ userId: Schema.String }),
        error: Unauthorized,
      }),
    )
    .add(
      HttpApiEndpoint.get('me', '/session/me', {
        success: Schema.Struct({ userId: Schema.String }),
      }).middleware(Authenticate),
    ),
)

const handlerGroup = HttpApiBuilder.group(sessionApi, 'session', (handlers) =>
  handlers
    .handle('login', ({ payload }) =>
      Effect.gen(function* () {
        if (payload.identifier !== 'ada') return yield* new Unauthorized()
        // the cookie is set as a side effect of the response, not by the
        // handler returning a header: HttpOnly and Secure are the defaults
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, validToken, { path: '/' })
        return { userId: 'ada' }
      }),
    )
    // the principal is in context because the middleware put it there; this
    // handler neither reads a cookie nor repeats the lookup
    .handle('me', () =>
      Effect.gen(function* () {
        const principal = yield* Principal
        return { userId: principal.userId }
      }),
    ),
)

/**
 * The group with its middleware supplied.
 *
 * The middleware layer is provided by the group that uses it rather than
 * beside it, so a group cannot be wired without the thing that authenticates
 * it.
 */
export const sessionHandlers = handlerGroup.pipe(Layer.provide(authenticateLayer))

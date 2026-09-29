import { Effect, Option } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { deviceOfCookieHeader, type SignInDevice } from '@qualy/auth-contract/device'

// Which device a sign-in is on, and the one place that answers it.
//
// A form's sign-in reads the page's choice off its own request. A redirect's
// is read when the flow leaves and kept in the flow's row; when the flow is
// taken up on the way back, the row's answer is recorded against that
// request, and the session is made from it - the returning request's cookies
// and address are the other server's to shape, and nothing on them is
// believed about this.

/** a flow's recorded device, against the request that took the flow up */
const fromFlows = new WeakMap<object, SignInDevice>()

const currentRequest = Effect.map(
  Effect.serviceOption(HttpServerRequest.HttpServerRequest),
  Option.getOrUndefined,
)

/** what the request starting a sign-in says of the device it is on */
export const deviceAtStart: Effect.Effect<SignInDevice> = Effect.map(currentRequest, (request) =>
  deviceOfCookieHeader(request?.headers.cookie),
)

/** records the device a flow taken up on this request was started on */
export const recordFlowDevice = (device: SignInDevice): Effect.Effect<void> =>
  Effect.flatMap(currentRequest, (request) =>
    Effect.sync(() => {
      if (request !== undefined) fromFlows.set(request.source, device)
    }),
  )

/** the device a session is being made for: the flow's, where one came back, else the request's own */
export const signInDevice: Effect.Effect<SignInDevice> = Effect.map(currentRequest, (request) =>
  request === undefined
    ? 'personal'
    : (fromFlows.get(request.source) ?? deviceOfCookieHeader(request.headers.cookie)),
)

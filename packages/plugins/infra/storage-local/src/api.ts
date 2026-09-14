import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

// The disk's upload door.
//
// An api endpoint like any other, even though its body is a file rather than
// json: the handler is raw, so the bytes stream straight to disk without
// anything decoding them, while the path, the method and the parameter stay
// in the contract where every other route's are.
//
// It was a bare router registration once, which meant the url was written
// twice - here, and again where a grant tells the browser to send the bytes -
// with nothing but proximity keeping the two equal.
//
// The reservation id IS the credential: unguessable, single purpose,
// expiring, the same trust shape as a cloud store's signed url. So no session
// middleware, and core storage checks the ticket when the bytes arrive and
// again at complete. The id stays a plain string rather than a uuid, because
// what an unknown ticket deserves is the door's own "no such reservation",
// not a decoder's complaint about its shape.

export const storageLocalApiGroup = HttpApiGroup.make('storageLocal').add(
  HttpApiEndpoint.put('uploadObject', '/storage/local/uploads/:reservationId', {
    params: Schema.Struct({ reservationId: Schema.String }),
  }),
)

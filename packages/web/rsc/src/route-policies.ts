import type { unstable_RSCPayload as RSCPayload } from 'react-router'
import { pageRevalidation } from '@qualy/web-runtime/revalidation'

/**
 * React Router 8.5.0 copies shouldRevalidate into matched routes but omits it
 * from getManifestRoute's discovery patches. Applying that catalog otherwise
 * erases the policy on a route already being displayed. Keep the existing
 * policy at the public payload boundary, without patching router internals.
 */
export function withRoutePolicies(payload: RSCPayload): RSCPayload {
  if ((payload.type !== 'render' && payload.type !== 'manifest') || payload.patches === undefined)
    return payload
  return {
    ...payload,
    patches: payload.patches.then((patches) =>
      patches.map((patch) =>
        patch.id === 'qualy:document' || /^(?:page|layout):/.test(patch.id)
          ? { ...patch, shouldRevalidate: patch.shouldRevalidate ?? pageRevalidation }
          : patch,
      ),
    ),
  }
}

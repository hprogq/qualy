import { isPluginDescriptor, type PluginDescriptor } from '@qualy/plugin-kit'
import { surfaceLabel } from '@qualy/ui-contract'
import { browserContractHashOf } from '@qualy/ui-contract/browser-contract'
import { uiSurfacesOf } from '@qualy/plugin-ui-registry/plugin'
import { loginSurfacesOf } from '@qualy/auth-contract/plugin'
import type { Resolution } from '@qualy/assembly'

// What an assembly's browser half is allowed to address, as one value.
//
// Two callers, and the point is that they are the same walk. The browser
// build writes this into a release's own metadata; a starting host computes
// it from the descriptors it loaded and refuses to serve a release whose
// value differs - which catches the deployment that updated the server and
// reused the store's existing release, a case the assembly hash cannot see
// because a lock records no page id, slot key or login type.
//
// It lives beside the collector rather than in the host because each kind of
// surface comes from the capability that owns it, and the composition root
// may not name a capability: `apps/server` gets one function and learns
// nothing about what a page is. It imports no vite, so a server pays a
// module for it and not a toolchain.

/** every browser surface one descriptor declares, from each owner's own walk */
export const browserSurfacesOf = (descriptor: PluginDescriptor): string[] =>
  [...uiSurfacesOf(descriptor), ...loginSurfacesOf(descriptor)].map((entry) =>
    surfaceLabel(entry.surface),
  )

/**
 * The contract of the ACTIVE selection, which is what a build carries.
 *
 * A disabled plugin contributes no surface to either side, and a detached one
 * is kept for its tables and has no browser half at all.
 */
export const browserContractOf = (resolution: Resolution): string =>
  browserContractHashOf(
    resolution.runtimePlugins
      .map((id) => resolution.descriptors.get(id))
      .filter((descriptor) => isPluginDescriptor(descriptor))
      .flatMap(browserSurfacesOf),
  )

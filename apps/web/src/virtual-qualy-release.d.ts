// The identity of the release this bundle is, served as a virtual module by
// the qualyRelease Vite plugin (packages/build/web/src/release-vite.ts): one
// production build or one development Vite session. The composition root
// imports it and hands it on; no reusable package imports a virtual module.
declare module 'virtual:qualy/release' {
  import type { WebReleaseIdentity } from '@qualy/release-contract'

  export const webRelease: WebReleaseIdentity
}

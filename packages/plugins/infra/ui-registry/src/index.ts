import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Ui } from './plugin.ts'
import { appApiGroup } from './api.ts'
import { appApiHandlers, layer as serviceLayer } from './server/index.ts'

// The registry-and-manifest plugin, as a description: it owns the surface
// extension point, provides the registry service, and serves the manifest
// group. Peers import the registry and authorizer through their own subpaths
// rather than through this file.

const plugin = Plugin.define(
  '@qualy/plugin-ui-registry',
  Ui.provider,
  Plugin.layer(serviceLayer),
  Api.group(appApiGroup, appApiHandlers),
)

export default plugin

// the handler layer stays a named export beside the descriptor: tests build
// the single group from it, and a value export costs nothing
export { appApiHandlers as apiHandlers } from './server/index.ts'

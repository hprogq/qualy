import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { config, routes } from './server/index.ts'

// The web shell, as a description: one raw-routes contribution - the browser
// shell is a wildcard handler, not an api endpoint - and the config channel
// the manifest block arrives through.

const plugin = Plugin.define('@qualy/plugin-web', { config }, Api.routes(routes))

export default plugin

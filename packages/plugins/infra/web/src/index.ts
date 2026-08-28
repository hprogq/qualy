import { Plugin } from '@qualy/plugin-kit'
import { Dev } from '@qualy/plugin-kit/dev'
import { Api } from '@qualy/api-kit/plugin'
import { config, routes } from './server/index.ts'

// The web shell, as a description: one raw-routes contribution - the browser
// shell is a wildcard handler, not an api endpoint - the config channel the
// manifest block arrives through, and the development server this plugin
// wants running beside the backend while somebody is working on the ui.
//
// The dev service is the browser's entry point in development, and it is
// declared rather than started here: nothing in the serving runtime reads it.

const plugin = Plugin.define(
  '@qualy/plugin-web',
  { config },
  Api.routes(routes),
  Dev.service({ id: 'web', module: './dev' }),
)

export default plugin

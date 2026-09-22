import { Plugin } from '@qualy/plugin-kit'
import { Mail } from './plugin.ts'
import { config, serviceLayer } from './server/index.ts'

// Mail as a description: the channel backends declare themselves through, and
// the sender every other plugin holds. Which relay, which credentials, which
// port - none of it is here; a backend plugin knows its own.

const plugin = Plugin.define(
  '@qualy/plugin-mail',
  { config },
  Mail.provider,
  Plugin.layer(serviceLayer),
)

export default plugin

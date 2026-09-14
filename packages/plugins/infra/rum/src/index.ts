import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Rum } from './plugin.ts'
import { rumApiGroup } from './api.ts'
import { rumApiHandlers, barrierLayer, registryLayer } from './server/index.ts'

// Browser reporting as a capability, with no idea where reports go.
//
// It owns the vocabulary - an exception, a diagnostic, the page a viewer is
// on - the browser api the rest of the product calls, the endpoint that tells
// a page whether this deployment reports at all, and the rule that at most one
// provider may answer. Which platform stores any of it is a provider plugin's
// business and must not become this one's: the moment a reporting id or a
// vendor host appears in this package, swapping platforms stops being a
// manifest change.
//
// Nothing depends on this plugin the way business plugins depend on storage,
// because reporting has no business callers - the runtime calls it, at the
// two seams where a browser failure is already known about.

const plugin = Plugin.define(
  '@qualy/plugin-rum',
  Rum.owner,
  Plugin.layer(registryLayer),
  Plugin.layer(barrierLayer),
  Api.group(rumApiGroup, rumApiHandlers),
)

export default plugin

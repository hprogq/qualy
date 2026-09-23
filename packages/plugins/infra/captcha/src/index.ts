import { Plugin } from '@qualy/plugin-kit'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Captcha } from './plugin.ts'
import { barrierLayer, registryLayer, serviceLayer } from './server/index.ts'

// Challenges as a capability, with no idea who asks for them or who issues
// them.
//
// It owns the policy - when a request with a challenge may go on, what a
// proof is bound to, what happens when there is nobody to ask - the rule
// that at most one provider answers, and the browser host a caller renders a
// challenge in. Which requests are risky is the caller's business; how a
// challenge is made and checked is a provider plugin's. Neither is ever
// named here, so a new caller or a new provider changes nothing in this
// package.

const plugin = Plugin.define(
  '@qualy/plugin-captcha',
  { dependsOn: ['@qualy/plugin-secrets', '@qualy/plugin-ui-registry'] },
  Captcha.owner,
  Ui.i18n('./client/i18n'),
  Plugin.layer(registryLayer),
  Plugin.layer(serviceLayer),
  Plugin.layer(barrierLayer),
)

export default plugin

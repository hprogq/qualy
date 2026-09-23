import { Plugin } from '@qualy/plugin-kit'
import { Browser } from '@qualy/plugin-kit/browser'
import { Db } from '@qualy/plugin-database/plugin'
import { Captcha } from '@qualy/plugin-captcha/plugin'
import { entities } from './db/entities.ts'
import { ALTCHA_PROVIDER, registrationLayer } from './server/index.ts'

// ALTCHA as the deployment's challenge provider: a proof of work computed in
// the visitor's own browser and checked here, with no third party in the
// loop - which is what makes it the provider a deployment in mainland China
// can use. Installing it is a manifest decision: no caller names it, and
// the capability next door never learns what a proof of work is.

const plugin = Plugin.define(
  '@qualy/plugin-captcha-altcha',
  {
    dependsOn: ['@qualy/plugin-captcha', '@qualy/plugin-database', '@qualy/plugin-secrets'],
  },
  Captcha.provider({ code: ALTCHA_PROVIDER }),
  Db.entities(entities),
  // the browser half announces itself; the widget arrives only with a challenge
  Browser.module('./client/register'),
  Plugin.layer(registrationLayer),
)

export default plugin

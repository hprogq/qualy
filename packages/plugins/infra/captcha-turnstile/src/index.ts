import { Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Browser } from '@qualy/plugin-kit/browser'
import { Captcha } from '@qualy/plugin-captcha/plugin'
import {
  config,
  fetchTransportLayer,
  registrationLayer,
  TURNSTILE_PROVIDER,
} from './server/index.ts'

// Cloudflare Turnstile as the deployment's challenge provider - for a
// deployment Cloudflare serves, which mainland China is not; ALTCHA is the
// default there. Off unless a deployment turns it on, and never on beside
// another provider: the capability refuses two.

const plugin = Plugin.define(
  '@qualy/plugin-captcha-turnstile',
  { dependsOn: ['@qualy/plugin-captcha'], config },
  Captcha.provider({ code: TURNSTILE_PROVIDER }),
  // the browser half announces itself; Cloudflare's script arrives only with a challenge
  Browser.module('./client/register'),
  Plugin.layer(registrationLayer.pipe(Layer.provide(fetchTransportLayer))),
)

export default plugin

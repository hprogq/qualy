import { Layer } from 'effect'
import {
  ExtensionPoint,
  Plugin,
  type PluginDescriptor,
  type PluginFeature,
} from '@qualy/plugin-kit'
import { LoginDrivers, registerLoginDriver, type LoginDriver } from './login.ts'

// The sign-in capability's face in the descriptor model. A driver's
// presentation is pure data and its proof lives in an api handler, so
// declaring one is a prepare-phase contribution; auth, which owns the
// registry, interprets the set.

/** every login driver this assembly's plugins declare, in plugin order */
export const LoginDriverDeclarations = ExtensionPoint.make<LoginDriver>(
  '@qualy/auth-contract/login-drivers',
  { phase: 'prepare' },
)

export const Login = {
  /** declares how this plugin's sign-in method is presented and typed */
  driver: (driver: LoginDriver): PluginFeature =>
    Plugin.contribute(LoginDriverDeclarations, driver),
}

/**
 * The legacy bridge, until the descriptor assembler takes over the host
 * (docs/plugin-descriptor-plan.md, batch 5): the runtime registration this
 * declaration used to be, derived from the descriptor so the two shapes
 * cannot drift. Precisely typed, because the generated composition's types
 * are load-bearing until cutover.
 */
export const legacyDriverLayer = (
  plugin: PluginDescriptor,
): Layer.Layer<never, never, LoginDrivers> =>
  Layer.mergeAll(
    Layer.empty,
    ...Plugin.contributionsOf(plugin, LoginDriverDeclarations).map(registerLoginDriver),
  )

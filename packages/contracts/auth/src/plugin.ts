import { Layer } from 'effect'
import {
  ExtensionPoint,
  Plugin,
  type PluginDescriptor,
  type PluginFeature,
} from '@qualy/plugin-kit'
import type { BrowserSurface, ClientComponentRef } from '@qualy/ui-contract'
import { loginDriversLayer, registerLoginDriver, type LoginDriver } from './login.ts'

// The sign-in capability's face in the descriptor model. A driver's
// presentation is pure data and its proof lives in an api handler, so
// declaring one is a prepare-phase contribution; auth, which owns the
// registry, interprets the set.

/** every login driver this assembly's plugins declare, in plugin order */
export const LoginDriverDeclarations = ExtensionPoint.make<LoginDriver>(
  '@qualy/auth-contract/login-drivers',
  { phase: 'prepare' },
)

/**
 * The browser surface a driver presents, when it presents one.
 *
 * The same walk the ui capability publishes for its three kinds, for the one
 * this capability owns - so the build and the host agree about the fourth
 * without either of them reading the other's declarations. A redirect driver
 * has no component and therefore no browser surface.
 */
export const loginSurfacesOf = (
  descriptor: PluginDescriptor,
): { surface: BrowserSurface; component: ClientComponentRef }[] =>
  Plugin.contributionsOf(descriptor, LoginDriverDeclarations).flatMap((driver) =>
    driver.presentation.mode === 'component'
      ? [
          {
            surface: { kind: 'login' as const, id: driver.type },
            component: driver.presentation.component,
          },
        ]
      : [],
  )

export const Login = {
  /** declares how this plugin's sign-in method is presented and typed */
  driver: (driver: LoginDriver): PluginFeature =>
    Plugin.contribute(LoginDriverDeclarations, driver),

  /**
   * The owner's interpretation: the registry, already populated before any
   * service layer builds - so auth reads a finished set instead of providing
   * a channel its drivers reach back through.
   */
  provider: Plugin.provideExtension(LoginDriverDeclarations, {
    compile: (drivers) =>
      Layer.mergeAll(
        Layer.empty,
        ...drivers.map((driver) => registerLoginDriver(driver.value, driver.pluginId)),
      ).pipe(Layer.provideMerge(loginDriversLayer)),
  }),
}

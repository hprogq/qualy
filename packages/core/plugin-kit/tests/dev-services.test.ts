import { describe, expect, it } from 'vitest'
import { Plugin, type PluginDescriptor } from '../src/index.ts'
import { Dev, collectDevServices } from '../src/dev.ts'

// What an assembly asks for beside it, and what it is refused.
//
// The keys here become process identities in a supervisor, so two of them
// meaning the same thing is not a naming preference: it is two processes the
// supervisor cannot tell apart. And the module is a package export subpath
// rather than a file, so a declaration that reaches into somebody's src/ is
// refused where it is written rather than resolving on one machine.

const context = {
  manifestDir: '/somewhere',
  resolveModuleUrl: (specifier: string) => `file:///resolved/${specifier}`,
}

const source = (descriptor: PluginDescriptor) => ({
  descriptor,
  packageRoot: `/packages/${descriptor.id}`,
  config: { some: 'block' },
})

describe('the development services an assembly declares', () => {
  it('collects them with the key a supervisor addresses them by', () => {
    const web = Plugin.define('@qualy/plugin-web', Dev.service({ id: 'web', module: './dev' }))
    const [only, ...rest] = collectDevServices([source(web)], context)
    expect(rest).toEqual([])
    expect(only).toMatchObject({
      key: '@qualy/plugin-web:web',
      pluginId: '@qualy/plugin-web',
      id: 'web',
      moduleUrl: 'file:///resolved/@qualy/plugin-web/dev',
      manifestDir: '/somewhere',
      pluginRoot: '/packages/@qualy/plugin-web',
    })
    // the plugin's own block travels, uninterpreted
    expect(only!.config).toEqual({ some: 'block' })
  })

  it('says nothing for a plugin that declares none', () => {
    const quiet = Plugin.define('@qualy/plugin-quiet')
    expect(collectDevServices([source(quiet)], context)).toEqual([])
  })

  it('refuses two services of one name in one plugin', () => {
    const twice = Plugin.define(
      '@qualy/plugin-twice',
      Dev.service({ id: 'web', module: './dev' }),
      Dev.service({ id: 'web', module: './other' }),
    )
    expect(() => collectDevServices([source(twice)], context)).toThrow(
      /declares dev service web twice/,
    )
  })

  it('refuses a module that reaches into the package instead of naming an export', () => {
    const reaching = Plugin.define(
      '@qualy/plugin-reaching',
      Dev.service({ id: 'web', module: 'src/dev/index.ts' as './dev' }),
    )
    expect(() => collectDevServices([source(reaching)], context)).toThrow(
      /not a package export subpath/,
    )
  })

  it('says which declaration failed when the module does not resolve', () => {
    const missing = Plugin.define(
      '@qualy/plugin-missing',
      Dev.service({ id: 'web', module: './nowhere' }),
    )
    expect(() =>
      collectDevServices([source(missing)], {
        ...context,
        resolveModuleUrl: () => {
          throw new Error('cannot find it')
        },
      }),
    ).toThrow(/@qualy\/plugin-missing declares dev service web at @qualy\/plugin-missing\/nowhere/)
  })
})

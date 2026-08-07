import { Context, Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { ExtensionPoint, Plugin, type Contributed } from '@qualy/plugin-kit'
import { assemble } from '@qualy/plugin-kit/assemble'

// The kernel's own guarantees, asserted on synthetic descriptors: keyed
// services order by their declared tags, broken declarations are refused with
// the plugins named, and a provider is told who contributed what.

class ServiceA extends Context.Service<ServiceA, { readonly a: string }>()('kernel-test/A') {}
class ServiceB extends Context.Service<ServiceB, { readonly b: string }>()('kernel-test/B') {}

describe('service topology', () => {
  it('builds a service above the one it requires, whatever the list order says', async () => {
    // A requires B but is listed first; the fold in list order would hand A
    // an empty world and fail its build
    const needy = Plugin.define(
      '@fake/needy',
      Plugin.service(ServiceA, {
        requires: [ServiceB],
        layer: Layer.effect(
          ServiceA,
          Effect.map(ServiceB, ({ b }) => ServiceA.of({ a: `a-over-${b}` })),
        ),
      }),
    )
    const base = Plugin.define(
      '@fake/base',
      Plugin.service(ServiceB, {
        requires: [],
        layer: Layer.succeed(ServiceB, ServiceB.of({ b: 'b' })),
      }),
    )
    const { services } = assemble([needy, base])
    const built = await Effect.runPromise(
      Effect.provide(ServiceA, services as Layer.Layer<ServiceA>),
    )
    expect(built.a).toBe('a-over-b')
  })

  it('refuses two plugins providing one service key', () => {
    const provide = (id: string) =>
      Plugin.define(
        id,
        Plugin.service(ServiceA, {
          requires: [],
          layer: Layer.succeed(ServiceA, ServiceA.of({ a: id })),
        }),
      )
    expect(() => assemble([provide('@fake/one'), provide('@fake/two')])).toThrow(
      /service kernel-test\/A is provided by both @fake\/one and @fake\/two/,
    )
  })

  it('refuses a requirement no selected plugin provides as a service', () => {
    const needy = Plugin.define(
      '@fake/needy',
      Plugin.service(ServiceA, {
        requires: [ServiceB],
        layer: Layer.effect(
          ServiceA,
          Effect.map(ServiceB, () => ServiceA.of({ a: 'a' })),
        ),
      }),
    )
    expect(() => assemble([needy])).toThrow(
      /@fake\/needy requires service kernel-test\/B, which no selected plugin provides/,
    )
  })

  it('refuses a cycle and names the path', () => {
    const a = Plugin.define(
      '@fake/a',
      Plugin.service(ServiceA, {
        requires: [ServiceB],
        layer: Layer.effect(
          ServiceA,
          Effect.map(ServiceB, () => ServiceA.of({ a: 'a' })),
        ),
      }),
    )
    const b = Plugin.define(
      '@fake/b',
      Plugin.service(ServiceB, {
        requires: [ServiceA],
        layer: Layer.effect(
          ServiceB,
          Effect.map(ServiceA, () => ServiceB.of({ b: 'b' })),
        ),
      }),
    )
    expect(() => assemble([a, b])).toThrow(
      /service dependency cycle: kernel-test\/A -> kernel-test\/B -> kernel-test\/A/,
    )
  })
})

describe('extension point identity', () => {
  it('refuses one id declared with two shapes', () => {
    // matched by string id across package instances, so a second definition
    // with a different phase would cross-connect two channels sharing a name
    const asPrepare = ExtensionPoint.make<string>('kernel-test/point', { phase: 'prepare' })
    const asAfter = ExtensionPoint.make<string>('kernel-test/point', { phase: 'afterServices' })
    const contributor = Plugin.define('@fake/contributor', Plugin.contribute(asPrepare, 'x'))
    const provider = Plugin.define(
      '@fake/provider',
      Plugin.provideExtension(asAfter, { compile: () => Layer.empty }),
    )
    expect(() => assemble([contributor, provider])).toThrow(
      /extension point kernel-test\/point is declared with a different shape by @fake\/contributor and @fake\/provider: phase prepare vs afterServices/,
    )
  })
})

describe('contributor identity', () => {
  it('hands the provider each contribution with the plugin that made it', () => {
    const point = ExtensionPoint.make<string>('kernel-test/identified', { phase: 'prepare' })
    let seen: readonly Contributed<string>[] = []
    const provider = Plugin.define(
      '@fake/owner',
      Plugin.provideExtension(point, {
        compile: (contributions) => {
          seen = contributions
          return Layer.empty
        },
      }),
    )
    const contributor = Plugin.define('@fake/speaker', Plugin.contribute(point, 'hello'))
    assemble([provider, contributor])
    expect(seen).toEqual([{ pluginId: '@fake/speaker', value: 'hello' }])
  })
})

import { Context, Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { ExtensionPoint, Plugin, type Contributed, type PrepareLayer } from '@qualy/plugin-kit'
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

describe('a contribution whose behaviour needs a running service', () => {
  // afterServices layers can consume running services: the provider compiles
  // ABOVE the service graph, so a final consumer's requirement - an http
  // handler's, here a gateway's - is discharged there, with the real service,
  // while the contributed value stays a plain description. (The seam for
  // service-backed drivers themselves is the runtime phase, proven in its own
  // suite below; this channel is where the graph's last consumers close.)
  class Library extends Context.Service<Library, { readonly lookup: (id: string) => string }>()(
    'kernel-test/Library',
  ) {}

  interface RuntimeDriver {
    readonly ref: string
    readonly evaluate: (config: unknown) => Effect.Effect<string, never, Library>
  }

  it('closes the requirement in the phase built above the services', async () => {
    const point = ExtensionPoint.make<RuntimeDriver>('kernel-test/runtime-drivers', {
      phase: 'afterServices',
    })
    class Catalog extends Context.Service<
      Catalog,
      { readonly evaluate: (ref: string, config: unknown) => Effect.Effect<string> }
    >()('kernel-test/RuntimeCatalog') {}

    const owner = Plugin.define(
      '@fake/catalog-owner',
      Plugin.provideExtension(point, {
        compile: (contributions) =>
          Layer.effect(
            Catalog,
            Effect.map(Library, (library) => {
              const byRef = new Map(contributions.map((one) => [one.value.ref, one.value]))
              return Catalog.of({
                evaluate: (ref, config) =>
                  byRef.get(ref)?.evaluate(config).pipe(Effect.provideService(Library, library)) ??
                  Effect.succeed('missing'),
              })
            }),
          ),
      }),
    )
    const provider = Plugin.define(
      '@fake/library',
      Plugin.service(Library, {
        requires: [],
        layer: Layer.succeed(Library, Library.of({ lookup: (id) => `row:${id}` })),
      }),
    )
    const contributor = Plugin.define(
      '@fake/driver',
      Plugin.contribute(point, {
        ref: 'needs-a-service@1',
        evaluate: (config) => Effect.map(Library, (library) => library.lookup(String(config))),
      } satisfies RuntimeDriver),
    )

    const { services, above } = assemble([owner, provider, contributor])
    const answer = await Effect.runPromise(
      Effect.flatMap(Catalog, (catalog) => catalog.evaluate('needs-a-service@1', 'v7')).pipe(
        Effect.provide(
          (above as Layer.Layer<Catalog, never, never>).pipe(
            Layer.provide(services as Layer.Layer<Library>),
          ),
        ),
      ),
    )
    expect(answer).toBe('row:v7')
  })
})

describe('the runtime phase', () => {
  // The seam for a driver backed by a live service: its registration stays a
  // plain contributed value, the provider compiles to a layer whose BUILD
  // acquires the services it needs, and both the boot barrier and the request
  // path consume the catalog that layer outputs. `compile` itself is
  // synchronous and never touches a service; no module global, no late
  // binding, and one build serves every consumer.
  class RuntimeCatalog extends Context.Service<
    RuntimeCatalog,
    { readonly answer: (question: string) => string }
  >()('kernel-test/PhaseRuntimeCatalog') {}
  class Gateway extends Context.Service<Gateway, { readonly ask: (question: string) => string }>()(
    'kernel-test/Gateway',
  ) {}

  const catalogPoint = ExtensionPoint.make<string>('kernel-test/phase-runtime', {
    phase: 'runtime',
  })
  const gatewayPoint = ExtensionPoint.make<never>('kernel-test/phase-gateway', {
    phase: 'afterServices',
  })

  const libraryPlugin = Plugin.define(
    '@fake/library',
    Plugin.service(ServiceA, {
      requires: [],
      layer: Layer.succeed(ServiceA, ServiceA.of({ a: 'shelf' })),
    }),
  )
  const catalogOwner = (onBuild?: () => void) =>
    Plugin.define(
      '@fake/catalog-owner',
      Plugin.provideExtension(catalogPoint, {
        compile: (contributions) =>
          Layer.effect(
            RuntimeCatalog,
            Effect.map(ServiceA, ({ a }) => {
              onBuild?.()
              const known = new Set(contributions.map((one) => one.value))
              return RuntimeCatalog.of({
                answer: (question) => (known.has(question) ? `${a}:${question}` : 'unknown'),
              })
            }),
          ),
      }),
    )
  const gatewayOwner = Plugin.define(
    '@fake/gateway-owner',
    Plugin.provideExtension(gatewayPoint, {
      compile: () =>
        Layer.effect(
          Gateway,
          Effect.map(RuntimeCatalog, (catalog) => Gateway.of({ ask: catalog.answer })),
        ),
    }),
  )
  const contributor = Plugin.define('@fake/driver', Plugin.contribute(catalogPoint, 'v7'))

  const graphOf = (assembled: ReturnType<typeof assemble>) =>
    (assembled.runtime as Layer.Layer<RuntimeCatalog, never, ServiceA>).pipe(
      Layer.provide(assembled.services as Layer.Layer<ServiceA>),
      Layer.provide(assembled.prepared as Layer.Layer<never>),
    )

  it('builds the runtime over the services and hands it to the phase above', async () => {
    const assembled = assemble([libraryPlugin, catalogOwner(), gatewayOwner, contributor])
    const answer = await Effect.runPromise(
      Effect.map(Gateway, (gateway) => gateway.ask('v7')).pipe(
        Effect.provide(
          (assembled.above as Layer.Layer<Gateway, never, RuntimeCatalog>).pipe(
            Layer.provide(graphOf(assembled)),
          ),
        ),
      ),
    )
    expect(answer).toBe('shelf:v7')
  })

  it('fails the build, naming the service, when a runtime binding lacks it', async () => {
    // no ServiceA provider selected: the requirement lives inside the
    // provider's layer, so the refusal is the build's, not assemble()'s
    const assembled = assemble([catalogOwner(), gatewayOwner, contributor])
    const outcome = await Effect.runPromiseExit(
      Effect.map(RuntimeCatalog, () => undefined).pipe(Effect.provide(graphOf(assembled))),
    )
    expect(outcome._tag).toBe('Failure')
    expect(String(outcome)).toMatch(/kernel-test\/A/)
  })

  it('builds one runtime for the boot barrier and the request path alike', async () => {
    let builds = 0
    const assembled = assemble([
      libraryPlugin,
      catalogOwner(() => {
        builds += 1
      }),
      gatewayOwner,
      contributor,
    ])
    // one runtimeGraph reference, consumed twice the way the host does it:
    // the barrier is provided (and therefore built) below the request path
    const runtimeGraph = graphOf(assembled)
    const barrier = Layer.effectDiscard(Effect.map(RuntimeCatalog, () => undefined)).pipe(
      Layer.provide(runtimeGraph),
    )
    const answer = await Effect.runPromise(
      Effect.map(Gateway, (gateway) => gateway.ask('v7')).pipe(
        Effect.provide(
          (assembled.above as Layer.Layer<Gateway, never, RuntimeCatalog>).pipe(
            Layer.provide(runtimeGraph),
            Layer.provide(barrier),
          ),
        ),
      ),
    )
    expect(answer).toBe('shelf:v7')
    expect(builds).toBe(1)
  })

  it('still refuses a prepare layer that quietly needs a service', async () => {
    // the type gate (PrepareLayer requires nothing) is bypassed on purpose:
    // this asserts the runtime backstop behind it
    const sneaky = Plugin.define(
      '@fake/sneaky',
      Plugin.provideExtension(
        ExtensionPoint.make<never>('kernel-test/sneaky-prepare', { phase: 'prepare' }),
        {
          compile: () =>
            Layer.effectDiscard(Effect.map(ServiceA, () => undefined)) as unknown as PrepareLayer,
        },
      ),
    )
    const { prepared } = assemble([sneaky])
    const outcome = await Effect.runPromiseExit(
      Effect.void.pipe(Effect.provide(prepared as Layer.Layer<never>)),
    )
    expect(outcome._tag).toBe('Failure')
    expect(String(outcome)).toMatch(/kernel-test\/A/)
  })
})

# Effect Pattern: services and layers

## Version

- effect: `4.0.0-beta.103`
- Last verified: 2026-08-05

## Upstream evidence

- `repos/effect/LLMS.md:120-159`(class 形态的 service 与它的 `static readonly layer`)、`:255-261`(ManagedRuntime)
- `repos/effect/ai-docs/src/01_effect/03_services/01_service.ts:13-45`、`10_reference.ts:8-10`、
  `20_layer-composition.ts:32,55,64`、`20_layer-unwrap.ts:57-70`
- `repos/effect/ai-docs/src/01_effect/05_resources/10_acquire-release.ts:22-44`、`20_layer-side-effects.ts:11-27`
- `repos/effect/ai-docs/src/01_effect/06_running/20_layer-launch.ts:23-27`
- `repos/effect/packages/effect/src/Context.ts:203-245`(`Service` 三个重载)、`:100-130`(实例 API)、`:1334-1341`(`Reference`)
- `repos/effect/packages/effect/src/Layer.ts:54`(类型参数顺序)、`:1012-1031`(`effect`)、`:1104`(`effectDiscard`)、
  `:1172`(`unwrap`)、`:1244-1250`(`mergeAll`)、`:1430-1460`(`provide`)、`:1548-1583`(`provideMerge`)、`:2205`(`launch`)
- `repos/effect/migration/services.md:1-5, 172-199, 225-235`、`migration/layer-memoization.md:8-11, 59-98`、
  `migration/scope.md:3-8`、`migration/v3-to-v4.md:10961-10965`

已实读复核:`Layer.ts` 里**没有** `export const scoped`;`Effect.ts` 里**没有** `export const Service`;
`Context.ts:203` 的 `Service` 是三重载,类型参数在前、id 在后。

## Qualy decision

**定义 service**

只有一种形态:`Context.Service`。v3 的 `Context.Tag` / `Context.GenericTag` / `Effect.Tag` /
`Effect.Service` 全部并进它。类型参数在前、id 字符串在后(与 v3 相反)。id 用「包名 + 子路径 + 名字」。

```ts
export class Database extends Context.Service<
  Database,
  {
    query(sql: string): Effect.Effect<ReadonlyArray<unknown>, DatabaseError>
  }
>()('@qualy/plugin-database/Database') {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function* () {
      // ...
      return Database.of({ query })
    }),
  )
}
```

取服务用 `yield* Database`,**不要**用 `Database.use(...)`——上游明确说 `use` 把依赖藏在调用点,
容易泄漏 requirement。

**Layer**

- `Layer<ROut, E = never, RIn = never>`:成功、错误、依赖。
- **`Layer.scoped` 不存在**,并进了 `Layer.effect`——它自动 supply 并 `Exclude<R, Scope>`。资源用
  `Effect.acquireRelease` 写在 `Layer.effect` 的 body 里,finalizer 随 layer scope 关闭而运行,
  Scope 不会泄进 layer 类型。
- **`make` 选项不会自动生成 layer**,`.Default` 与 `dependencies` 都没了。自己写
  `Layer.effect(this, this.make).pipe(Layer.provide(Dep.layer))`。
- 命名约定是 `layer`(以及 `layerTest` / `layerNoDeps` / `layerConfig`),**不是** v3 的 `Default` / `Live`。
- 组合:`mergeAll`(变参、至少一个)、`provide`(隐藏被提供的服务)、`provideMerge`(继续暴露)、
  `unwrap`(按 Config/Effect 在构建期选 layer)、`effectDiscard`(只做副作用、不提供服务,
  后台任务用 `Effect.forkScoped`,随 layer scope 中断)。
- 应用入口:`Layer.launch(ApplicationLive)` 把整棵 layer 变成永不返回的 Effect。

**本项目的额外规定**(不是上游的):

- **整个应用一个 Effect runtime、一个根 Scope**。数据库池、HTTP server、调度器、后台消费者全挂根 Scope。
  **不允许每个插件各自建 `ManagedRuntime`**——那会重新产生多个不协调的生命周期域,正是这次迁移要消灭的东西。
- **静态事实不做成 service**:route、permission、page 属于 assembly descriptor。Effect resource 留给
  数据库池、HTTP server、缓存、调度器、worker、外部客户端。
- **禁止把 Cordis 的每个 Service 机械翻译成一个 `Context.Service`。**

**memoization 有个 v4 变化要注意**:layer 现在**跨** `Effect.provide` 调用共享 memo,不再是每次调用一份。
需要隔离用 `Layer.fresh` 或 `Effect.provide(layer, { local: true })`。上游同时警告这只是安全网,
**不是**「先组合再 provide」的替代品。

## Canonical example

```ts
// 一个持有连接池的基础设施 service
export class Database extends Context.Service<Database, DatabaseShape>()(
  '@qualy/plugin-database/Database',
) {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function* () {
      const config = yield* DatabaseConfig
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => new Pool({ connectionString: config.url })),
        (pool) => Effect.promise(() => pool.end()),
      )
      return Database.of(makeDatabase(pool))
    }),
  ).pipe(Layer.provide(DatabaseConfig.layer))
}
```

## Forbidden

- `Layer.scoped(...)` —— 不存在,用 `Layer.effect`
- `Effect.Service` / `Context.Tag` / `Context.GenericTag` —— 只有 `Context.Service`
- 指望 `make` 或 `dependencies` 自动生成 layer
- `Service.Default` / `Service.Live` 命名 —— 用 `layer`
- 插件各自 `ManagedRuntime.make(...)`
- 把 route / permission / page 做成 `Context.Service`
- 用全局 service locator 绕过 Layer 图去解跨插件环

## Verification

M2 落地时补:根 Scope 唯一性、SIGTERM 后连接零泄漏。
M7 门禁:仓库零 `cordis` import。

## Open questions

- 跨插件环(org ↔ rbac)最终怎么拆:抽 port、coordinator、还是整簇一次迁。见 effect-migration.md「硬骨头 1」
- 运行时依赖声明落在插件 descriptor 还是 package.json。见「硬骨头 2」
- `Context.Service` 的 `fiberCached` 选项:签名里标了 `@internal`,没有文档,暂不使用

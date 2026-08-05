# Effect Pattern: core style

## Version

- effect: `4.0.0-beta.103`
- @effect/sql-pg: `4.0.0-beta.103`
- drizzle-orm: `1.0.0-rc.4`
- Last verified: 2026-08-05

## Upstream evidence

- `repos/effect/LLMS.md:16-18`(gen + fn 的风格规定)、`:32-34` 与 `:73-75`(错误必须 `return yield*`)、
  `:53-57`(返回 Effect 的函数必须用 `Effect.fn`)、`:77-82`(不要对 `Effect.fn` 结果用 `.pipe`)、
  `:99-103` 与 `:304-312`(校验一律 Schema,禁止手写类型守卫)、`:226`(入口用 `runMain`)
- `repos/effect/ai-docs/src/01_effect/01_basics/02_effect-fn.ts:4-8, 28-33`
- `repos/effect/packages/effect/src/Effect.ts:13519`(`export const fn`)、`:10863`(`type Traced`)、
  `:9267`(`fn.Return`)、`:2598` 与 `:2634`(`catch_ as catch`)、`:9071`/`:8891`/`:8709`(run\* 要求 `R = never`)
- `repos/effect/packages/platform-node/src/NodeRuntime.ts:39`(`runMain`)
- `repos/effect/migration/error-handling.md:9-19`、`migration/generators.md:23-32`、
  `migration/forking.md:8-15`、`migration/yieldable.md:35-40`、`migration/runtime.md:15-17`、
  `migration/fiberref.md:3-5`、`migration/v3-to-v4.md:9640`

已实读复核(不是转述):`Layer.scoped` 在 `Layer.ts` 里**不存在**;`Effect.ts` 里**没有** `Service`;
`catchAll` 在 `Effect.ts` 里**零出现**,`catch` 是 `catch_ as catch` 导出。

## Qualy decision

**写法**

- 用 `Effect.gen` 与 **具名** `Effect.fn("name")`,再用组合子补充行为。名字买到两样东西:每次调用外面
  包一个同名 tracing span,以及压两个具名栈帧。不给名字就没有 span。
- **任何返回 Effect 的函数一律 `Effect.fn`**,不要写「返回 `Effect.gen(...)` 的普通函数」。
- 额外行为作为 `Effect.fn` 的**尾随参数**传入,**不要**对它的结果用 `.pipe`——尾随参数是按调用应用的,
  能拿到调用参数。
- 生成器体内抛错必须 `return yield* new SomeError(...)`,**带 `return`**,否则 TypeScript 不知道
  后面不再执行。
- 标注生成器返回类型用 `Effect.fn.Return<A, E, R>`(它是 Generator 类型,不是 Effect 类型)。
- 校验与领域建模一律 `Schema`,不手写谓词解析,不自己写 `isRecord`/`isString` 这类守卫(用 `Predicate`)。

**Effect.run\* 的边界**

类型层面已经强制:`runSync`/`runPromise`/`runFork` 都要求 `R = never`。本项目在此之上再加一条纪律
(**这是 Qualy 的规定,不是上游的**——上游没有这条禁令,只有类型约束):

生产源码里 `Effect.run*` 只允许出现在应用入口、CLI 边界、前端统一 API runtime、测试边界。
service / repo / handler 内部不得自行运行 Effect。

进程入口用 `NodeRuntime.runMain`:它装 SIGINT/SIGTERM、中断根 fiber、管理退出码、报告未处理错误。
(注意 v4 已经不再**需要** runMain 来保活,保活进了核心 fiber runtime;用它是为了信号与退出码。)

从非 Effect 代码调进来(框架 handler、回调)用**一个**由应用 Layer 构建的 `ManagedRuntime`,
不是每处 `runPromise`。

## Canonical example

```ts
import { Effect } from 'effect'

export class TenantNotFound extends Schema.TaggedErrorClass<TenantNotFound>()('TenantNotFound', {
  tenantId: Schema.String,
}) {}

export const loadTenant = Effect.fn('loadTenant')(function* (tenantId: string) {
  const db = yield* Database
  const row = yield* db.findTenant(tenantId)
  // 带 return,否则 TS 认为后面还会执行
  if (!row) return yield* new TenantNotFound({ tenantId })
  return row
})
```

## Forbidden

- `const f = (x) => Effect.gen(function* () {...})` —— 返回 Effect 的函数必须是 `Effect.fn`
- `Effect.fn("x")(body).pipe(...)` —— 额外行为走尾随参数
- `yield* new SomeError(...)` 不带 `return`
- `Effect.catchAll`(v4 叫 `Effect.catch`)、`Effect.either`(叫 `Effect.result`)、
  `Effect.fork`(叫 `forkChild`)、`Effect.forkDaemon`(叫 `forkDetach`)
- `yield* fiber` / `yield* ref` / `yield* deferred` —— v4 里它们不是 Effect,要 `Fiber.join` /
  `Ref.get` / `Deferred.await`
- `FiberRef` —— 已移除,fiber 局部状态用 `Context.Reference`
- `Runtime<R>` / `Effect.runtime<R>()` —— 用 `Effect.context<R>()` + `Effect.runForkWith`
- service/repo/handler 内部出现任何 `Effect.run*`

## Verification

M7 门禁:生产源码零 `Effect.run*`(入口/CLI/前端 runtime/测试除外)。
其余条目暂由 review 与 typecheck 承担,出现第二次踩坑再加门禁。

## Open questions

- `Effect.fn` 能否在同一次调用里同时接 `{ self }` 与前置名字字符串(`fn.Traced` 两个重载都存在,
  但没找到同时用的例子)
- `Data.TaggedError` 与 `Schema.TaggedErrorClass` 的分工:`migration/v3-to-v4.md` 两边都提到,
  本项目默认用后者(它能进 Schema/HttpApi),但边界待 errors.md 裁决

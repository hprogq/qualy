# Effect 迁移

后端从 Cordis + oRPC 迁到 Effect 作为唯一运行时。本文件是这次迁移的主计划与进度台账;
架构裁决在 [ADR 0001](adr/0001-no-online-plugin-install.md) /
[0002](adr/0002-effect-as-the-backend-runtime.md) / [0003](adr/0003-httpapi-replaces-orpc.md);
Agent 检索纪律在 [agents/effect-source-policy.md](agents/effect-source-policy.md)。

原始讨论存档:`docs/effect-refactor-chat.txt`。本文件与它冲突时以本文件为准(下面「与存档讨论的
偏离」一节列出所有偏离及理由)。

## 分支与基线

- 基线 tag:`p1-capability-boundary`(commit `5edcd26`,装配阶段 1 + 1.5 收官)
- 迁移分支:`refactor/effect-platform`
- 主线 `main` 冻结业务开发,只接受必要缺陷修复,修完 cherry-pick 到迁移分支
- 需要对照旧实现时用 `git worktree add ../qualy-cordis p1-capability-boundary`,
  **不要**把现仓库复制进 `legacy/`

## 版本栈(全部实查,2026-08-05)

| 包 | 版本 | 事实 |
| --- | --- | --- |
| `effect` | `4.0.0-beta.103` | 导出 `./unstable/httpapi`、`/http`、`/rpc`、`/sql`、`/schema` |
| `@effect/sql-pg` | `4.0.0-beta.103` | peer `effect ^4.0.0-beta.103`,**必须完全同版本** |
| `@effect/vitest` | `4.0.0-beta.103` | 同上 |
| `drizzle-orm` | `1.0.0-rc.4`(已安装) | 已带 `effect-postgres`,peer `effect >= 4.0.0-beta.83` |

**这是 v4 beta,不是 v3。** 要用的模块住在 `effect/unstable/**`,beta 允许破坏它们。
选择不是自由的:drizzle 的 Effect 通路要求 v4,所以「用稳定的 v3」不是一个选项。

风险敞口比现状大——现在是 oRPC beta + drizzle rc + cordis rc,迁移后**整个后端运行时**都在 beta 上。
这是 ADR 0002 必须有 spike 放行条件的原因。

## 里程碑

| # | 名称 | 状态 |
| --- | --- | --- |
| M0 | 冻结与决策:tag、分支、三份 ADR、阶段 2 重写、版本锁定 | **完成** |
| M0.5 | vendored 上游源码 + Agent 检索纪律 + 对齐门禁 | **完成** |
| M1 | 技术验证 spike(数据库 + 事务回滚 + 关闭) | 待办 |
| M2 | Effect 应用外壳(config/logger/database/readiness/根 Scope/优雅关闭) | 待办 |
| M3 | HttpApi 基础 + 类型化 client + TanStack Query 适配,先迁 ping | 待办 |
| M4 | 最难的业务集群:auth/IAM + rbac + org | 待办 |
| M5 | 其余插件,按依赖簇而不是按目录 | 待办 |
| M6 | 前端切换到 HttpApiClient | 待办 |
| M7 | 原子切换 + 删除 Cordis/oRPC | 待办 |

**顺序不能改的地方**:M4 是决定性的。不要先把简单 CRUD 迁完、最后才发现 org ↔ rbac 的环拆不开。

## M1 spike 的放行条件

写在 ADR 0002。补充两条工程约束:

- spike 代码放 `packages/plugins/infra/database/` 之外的临时位置,验证完**删除实验代码,保留测试**
- spike 不得改动现有 Cordis 运行时的任何文件

### 已实读 drizzle effect-postgres(rc.4)得到的事实

第一轮实读 `repos/drizzle-orm` 与 `repos/effect/packages/sql/pg`,以下**已有源码/测试证据**,
M1 只需在本项目的真实 schema 上复验,不必再从零摸索:

- **没有 `drizzle()` 工厂**(beta.13 移除)。入口是 `make` / `makeWithDefaults`
  (`src/effect-postgres/driver.ts:48-84`)。`makeWithDefaults` 已经预置 `DefaultServices`
  (no-op cache + no-op logger),剩下的唯一依赖是 `PgClient`。
- **要的是 `@effect/sql-pg` 的 `PgClient` 服务,不是裸 `pg.Pool`,也不是通用 `SqlClient`**
  (`driver.ts:1,52`)。`PgClient.layer(config)` 会自己建池;要沿用已有的池就用
  `PgClient.fromPool`(`repos/effect/packages/sql/pg/src/PgClient.ts:274-286`)。
- **查询本身就是 Effect**(`effect-core/query-effect.ts:17-27` 把 `Effectable.Prototype` 接上去),
  错误类型恒为 `EffectDrizzleQueryError`,requirement 恒为 `never`。
- **事务提交/回滚只看 `Exit.isSuccess`**(`repos/effect/packages/effect/src/unstable/sql/SqlClient.ts:262-281`):
  typed fail、defect、interruption 一律回滚。回滚已有集成测试证明
  (`repos/drizzle-orm/integration-tests/tests/pg/effect-common.ts:1309-1333`)。
- `tx.rollback()` **返回一个错误值**(要 `yield*`),对调用方表现为 typed failure
  `EffectTransactionRollbackError`,**不是** defect。
- **嵌套事务是 savepoint**(`effect_sql_<depth>`),但**成功退出时不 RELEASE**,savepoint 会在外层
  事务生命周期内累积(`SqlClient.ts:270`)。
- 事务连接放在 **fiber context**,不在 `tx` 对象上——事务体内用外层 `db` 句柄发的查询也走事务连接。

### 这些事实会推翻现有 CLAUDE.md 的三条纪律

| 现在的纪律 | effect-postgres 下的事实 | 证据 |
| --- | --- | --- |
| 「需要 db.query 关系 API 用 `ctx.db.withRelations(defineRelations(...))`」 | **没有 `withRelations`**。relations 是 `make({ relations })` 的**构造期参数** | `src/effect-postgres/driver.ts:61-66` |
| 「timestamptz 经 drizzle 回来是字符串而非 Date,断言要断值不断 JS 类型」 | effect-postgres 的 `effectPgCodecs` 把它变回**真 JS `Date`** | `src/effect-postgres/codecs.ts:89-95` + 集成测试 |
| 「SQLSTATE 在 `error.cause` 上,`pgCode` 因此走 cause 链」 | `EffectDrizzleQueryError.cause` 是 **Effect `Cause`** 包着 `SqlError`,不是驱动错误;而且 `@effect/sql-pg` 已经预分类:23505 → `UniqueViolation` 带 `constraint`,**其余 23xxx → `ConstraintError` 会丢掉约束名**,要拿约束名必须再挖 `reason.cause` | `PgClient.ts:909-948`、`effect-core/errors.ts:11-28` |

第三条影响最大:`createConstraintTranslator`(约束名 → 领域错误)是本项目授权与不变量的一条主干,
M1 必须验证在 effect-postgres 下还能按约束名翻译。

### M1 还必须自己验的(上游没有证据)

- `snakeCase.table` 定义的 schema 跑 effect-postgres——**上游全部集成测试用的是普通 `pgTable`**,
  兼容性目前只是「共用同一条 `PgTable`/`PgDialect` 通路」的推断
- PG18、UUIDv7、ltree、pgvector 与现有 baseline SQL
- interruption 触发回滚(代码可证,但 `repos/` 里没有对应测试)
- 数百 endpoint 规模下的 typecheck 性能

## 已知的硬骨头

### 1. 跨插件环必须真的拆开

Cordis 靠运行时延迟激活容忍环,静态 Layer 图不能。当前 `@qualy/plugin-org` 需要 db/server/ui/rbac/auth,
`@qualy/plugin-rbac` 又承载跨域管理员不变量并向 org 贡献。装配阶段 1 明确写过「只有能力图,没有
运行时图」,理由之一就是 workspace 包之间允许成环、org ↔ rbac 已经是。**这条裁决在 ADR 0002 下必须重开。**

拆法(按优先级):抽小 port 包,而不是互相持有对方完整 service;跨域不变量放 application coordinator;
实在拆不开就把 auth/rbac/org 当成一个依赖簇一次迁完。**禁止**用全局 service locator 绕过 Layer 图。

### 2. 运行时依赖声明在哪

装配现在只认 `qualy.contributions.database`,运行时依赖不声明。静态 Layer 需要知道。
两条路:插件导出单一 descriptor(assembly、codegen、runtime 读同一份),或者把 JSON 可读的
metadata 放进 package.json 再加编译期一致性测试。**resolver 必须能在不执行插件代码的情况下工作**,
这一条会决定选哪个。

### 3. 静态事实不要变成 Effect service

route、permission、page 属于 assembly descriptor,不是 Effect resource。
Effect resource 留给数据库池、HTTP server、缓存、调度器、worker、外部客户端。
**禁止把 Cordis 的每个 Service 机械翻译成一个 `Context.Service`。**

## 测试迁移策略

现有测试资产价值很高,**不要先重写测试再重写生产代码**。

保留复用(与后端框架无关的黑盒):HTTP URL/状态码/响应体、数据库约束、登录行为、权限结果、
浏览器页面、表单提交、readiness、迁移 clean-room。迁移期间同一批测试可以分别指向 Cordis server
与 Effect server,让旧系统充当 executable specification。

需要重写(白盒):Cordis fiber 状态、`ctx.effect` disposer、`ctx.inject` pending、动态 contribution
注销、oRPC middleware 内部。对应换成 Effect Scope finalizer、Layer 构建失败、interruption、
HttpApi test client、typed failure、生成的静态装配。

## M7 切换前的门禁

现有全部门禁,加上:空库迁移重放、seed/provision、无刷新登录、`Effect.fail` 写后回滚、
数据库连接零泄漏、SIGTERM 优雅关闭、首个 readiness 必为 pending、lock 漂移拒启、migration 落后拒启、
OpenAPI 语义审查、前端 chunk/tree-shaking 审查,以及三条零容忍:
**仓库零 `cordis` import、零 `@orpc` import、生产源码零 `Effect.run*`**(入口/CLI/前端 runtime/测试除外)。

## 存档讨论里已经过时的 API

`docs/effect-refactor-chat.txt` 写在 v3 的记忆上,里面的示例有相当一部分在 v4 beta.103 上不成立。
第一轮实读上游(见 `repos/effect/migration/`)确认了这些:

| 存档/v3 写法 | v4 beta.103 实际 | 证据 |
| --- | --- | --- |
| `Layer.scoped(Tag, acquireRelease(...))` | **`Layer.scoped` 不存在**,并进 `Layer.effect`(它自动 supply 并 Exclude Scope) | `migration/v3-to-v4.md:10961`、`packages/effect/src/Layer.ts:1012` |
| `Effect.Service` / `Context.Tag` / `Context.GenericTag` | 四种形态全并成 **`Context.Service`**,且类型参数在前、id 字符串在后 | `migration/services.md:225`、`Context.ts:203` |
| `.Default` / `dependencies` 自动生成 layer | 都没了,自己写 `Layer.effect(this, this.make)` 再 `Layer.provide` | `migration/services.md:172` |
| `@effect/platform/HttpApi*` | platform/rpc/cluster 并进 `effect`,住在 **`effect/unstable/*`** | `MIGRATION.md:14-50` |
| `Effect.catchAll` | **`Effect.catch`**(catchTag/catchTags/catchIf 不变) | `migration/error-handling.md:9` |
| `Effect.either` | **`Effect.result`**(v4 用 Result 不用 Either) | `migration/v3-to-v4.md:9640` |
| `Effect.fork` / `forkDaemon` | **`forkChild`** / **`forkDetach`** | `migration/forking.md:8` |
| `Runtime<R>` + `Effect.runtime<R>()` | 没了,改 `Effect.context<R>()` + `Effect.runForkWith` | `migration/runtime.md:15` |
| `FiberRef` | 移除,fiber 局部状态用 `Context.Reference` | `migration/fiberref.md:3` |
| `Schema.TaggedError` | **`Schema.TaggedErrorClass`** | `migration/schema.md` |
| `Schema.Date`(解 ISO 字符串) | **语义变了**:现在等于 `DateFromSelf`,要 ISO 字符串得用 `Schema.DateFromString`。**升级后仍然编译,但行为不同** | `migration/schema.md:91-114` |
| `yield* fiber` / `yield* ref` | Fiber/Ref/Deferred 不再是 Effect 子类型,必须 `Fiber.join` / `Ref.get` / `Deferred.await` | `migration/yieldable.md:35` |

**结论:存档讨论用来定方向,不用来抄 API。** 每写一段 Effect 代码都要回 `repos/` 核对。

## 与存档讨论的偏离

| 存档建议 | 实际做法 | 理由 |
| --- | --- | --- |
| 从 `d69da1e`(阶段 1)开分支 | 从 `5edcd26`(阶段 1.5)开 | 1.5 的 capability boundary 正是静态装配要保留的东西,退回去等于白丢 |
| `git subtree --squash` 引入上游 | 浅克隆 tag 后落盘,`scripts/vendor-sync.ts` 管同步 | 唯一支持的升级方式是「换版本→整树替换→单独 commit」,重新克隆正好表达这个;subtree 还会把上游历史带进本仓库,这里没有用处 |
| 未提及 vendored 树自带 agent 配置 | `NOT_VENDORED` 剥掉 `.claude`/`.cursor`/`.agents`/`AGENTS.md` | drizzle-orm 的 `.claude/skills` 落地当场就自我声明了一次;那是写给别的仓库的指令 |
| `scripts/check-vendor-alignment.ts` | `scripts/tests/vendor.test.ts` | 本仓库的架构不变量一律是测试,不是单独脚本 |
| M0.5 一次生成 9 份 pattern | 按里程碑逐份生成,每份必须带 `repos/` 证据路径 | 没有实际迁移代码时批量生成规则,产出的是理论正确但不合身的东西 |

## 决定了但还没做的

- `runtime.gen.ts` 的确切形状(M2 定,替换 `cordis.gen.yml`)
- 运行时依赖声明落在 descriptor 还是 package.json(见「硬骨头 2」)
- `@qualy/api` / `@qualy/api-client` 包边界(M3 定)
- Zod → Effect Schema 的迁移顺序与共存期(M3 定)

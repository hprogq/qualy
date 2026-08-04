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
| `effect` | `4.0.0-beta.103` | 导出 `./unstable/httpapi`、`/http`、`/rpc`、`/sql`。**`Schema` 是顶层模块**(`effect` 根导出),`unstable/schema` 里只有 `Model` 与 `VariantSchema` |
| `@effect/sql-pg` | `4.0.0-beta.103` | peer `effect ^4.0.0-beta.103`,**必须完全同版本** |
| `@effect/vitest` | `4.0.0-beta.103` | 同上 |
| `drizzle-orm` | `1.0.0-rc.4`(已安装) | 已带 `effect-postgres`,peer `effect >= 4.0.0-beta.83` |

**这是 v4 beta,不是 v3。** HttpApi / SQL / RPC 住在 `effect/unstable/**`,beta 允许破坏它们(Schema 不在其中,它是顶层稳定模块)。
选择不是自由的:drizzle 的 Effect 通路要求 v4,所以「用稳定的 v3」不是一个选项。

风险敞口比现状大——现在是 oRPC beta + drizzle rc + cordis rc,迁移后**整个后端运行时**都在 beta 上。
这是 ADR 0002 必须有 spike 放行条件的原因。

## 里程碑

| # | 名称 | 状态 |
| --- | --- | --- |
| M0 | 冻结与决策:tag、分支、三份 ADR、阶段 2 重写、版本锁定 | **完成** |
| M0.5 | vendored 上游源码 + Agent 检索纪律 + 对齐门禁 | **完成** |
| M1a | 技术验证 spike:**数据库**(真实 schema + 事务 + 关闭) | **完成** |
| M1b | 技术验证 spike:**HttpApi**(endpoint + client + Scalar + Query 适配) | **完成** |
| M2 | Effect 应用外壳(config/database/readiness/根 Scope/优雅关闭/runtime.gen.ts) | **完成** |
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
  事务生命周期内累积(`SqlClient.ts:272`)。
- 事务连接放在 **fiber context**,不在 `tx` 对象上——事务体内用外层 `db` 句柄发的查询也走事务连接。

### 这些事实会推翻现有 CLAUDE.md 的三条纪律

| 现在的纪律 | effect-postgres 下的事实 | 证据 |
| --- | --- | --- |
| 「需要 db.query 关系 API 用 `ctx.db.withRelations(defineRelations(...))`」 | **没有 `withRelations`**。relations 是 `make({ relations })` 的**构造期参数** | `src/effect-postgres/driver.ts:61-66` |
| 「timestamptz 经 drizzle 回来是字符串而非 Date,断言要断值不断 JS 类型」 | effect-postgres 的 `effectPgCodecs` 把它变回**真 JS `Date`** | `src/effect-postgres/codecs.ts:87-93` + 集成测试 |
| 「SQLSTATE 在 `error.cause` 上,`pgCode` 因此走 cause 链」 | `EffectDrizzleQueryError.cause` 是 **Effect `Cause`** 包着 `SqlError`,不是驱动错误;而且 `@effect/sql-pg` 已经预分类:23505 → `UniqueViolation` 带 `constraint`,**其余 23xxx → `ConstraintError` 会丢掉约束名**,要拿约束名必须再挖 `reason.cause` | `PgClient.ts:909-948`、`effect-core/errors.ts:11-28` |

第三条影响最大:`createConstraintTranslator`(约束名 → 领域错误)是本项目授权与不变量的一条主干,
M1 必须验证在 effect-postgres 下还能按约束名翻译。

### M1a 实测结果(2026-08-05,`packages/effect-spike/tests/database.test.ts`,8 例全过)

跑在**真实 schema 与真实 lineage** 上(scratch 库经 database 插件的生产路径跑完 15 条迁移),
不是自造的测试表:

| 问题 | 结果 |
| --- | --- |
| `snakeCase.table` 兼容 effect-postgres | **可以**。上游集成测试全用普通 `pgTable`,这条此前只是推断,现已实测 |
| PG18 `uuidv7()` 列默认值 | **可以**,读回是标准 UUID |
| ltree 列 | **可以**(`::text` 投影读回) |
| 事务内 typed failure 回滚 | **回滚**。并断言了写入在失败前**确实执行过**(事务内先 select 到 1 行),否则这条断言在「insert 根本没跑」时也会通过 |
| 成功即提交 | 是 |
| interruption 回滚 | **回滚**。上游无对应测试,这条是自己验的 |
| 嵌套事务 | 是 savepoint,内层失败只回滚内层,外层照常提交 |
| 未识别 SQL 错误(42P01) | 停在普通 `SqlError`,`reason._tag` **不是** `UniqueViolation`/`ConstraintError`,不会被误当成业务冲突 |
| 约束名是否还拿得到 | **拿得到**,但在四层之下(见下) |
| Scope 关闭是否真的关池 | **是**。断言了连接数在使用期**升高**、关闭后**回到基线**,只断后半句的话对一个从未连接的 layer 也会通过 |
| timestamptz | **回来是 `Date` 不是字符串**——与现有纪律相反,已确认 |

**约束名的实际路径**(重写 `createConstraintTranslator` 要走的就是这条):

```
EffectDrizzleQueryError { query, params }
  .cause                      -> Effect Cause,不是驱动错误
    .reasons[0].error         -> SqlError
      .reason._tag            -> 'UniqueViolation'(@effect/sql-pg 预分类)
      .reason.cause           -> 原始 pg 错误:{ code: '23505', constraint: 'tenants_slug_key' }
```

注意 23505 之外的 23xxx 会落到 `ConstraintError`,而它**故意丢掉约束名**,只能再挖 `reason.cause`。

pgvector 不在验收范围内:全仓 schema 没有任何 vector 列,lineage 里只有 `CREATE EXTENSION ltree`。
镜像带 pgvector 不等于本项目在用。

### M1b 实测结果(2026-08-05,`packages/effect-spike/tests/{httpapi,runtime,query}.test.ts`,11 例全过)

| 问题 | 结果 |
| --- | --- |
| path param / query / header / JSON body | **都可以**。注意:全部字段可选的 `Schema.Struct` 仍是**必填对象**,客户端要传 `query: {}, headers: {}` |
| 业务错误的状态码 | **是 schema 注解** `{ httpApiStatus: 404 }`,写在错误类上一次。**没有**运行期 boundary 去查表 |
| 客户端能否推导公开错误类型 | **能,而且是窄的**。端点声明 `TenantNotFound` 时,把 `SlugTaken` 赋给它的失败通道**不编译**(用 `@ts-expect-error` 双向验过:去掉就报 unused directive) |
| 两个错误能否按 `_tag` 分辨 | 能,客户端把错误体解码回声明的那个类 |
| OpenAPI / Scalar | 同一份定义产出 `/openapi.json` 与 `/docs`,真实 server 上都是 200 |
| cookie session | **跑通了**,见下面「cookie 会话与 middleware」一节 |
| 一个 Scope 同时关 server 与池 | **是**。真 Node server + 真池,`Scope.close` 之后端口不可达且连接回到基线 |
| TanStack Query 保留 `E` | **保留**。适配层把 `E` 带进 `TError`,赋给别的错误类型不编译 |
| 取消 → interruption | **是**。`runPromise` 原生收 `AbortSignal`;拆掉这座桥,取消测试立刻失败(实测) |
| typecheck 规模 | **线性,不爆炸**。全仓根程序:3 endpoint 2.6s、200 endpoint 3.9s、500 endpoint 5.4s(约 6ms/endpoint)。本项目当前 55 条路径 |

**一个类型系统当场抓到的东西**:`system/count` 端点没声明错误,于是读数据库的 handler
**不编译**——`EffectDrizzleQueryError` 不可赋给 `never`。必须显式决定这个失败去哪:
它是基础设施而不是业务结果,所以 `Effect.orDie` 变成 defect 与 500。同一个失败在 oRPC 下是一个
未声明的 throw,类型里没有任何痕迹。

### cookie 会话与 middleware(2026-08-05 补验,`packages/effect-spike/tests/session.test.ts`,4 例)

M1b 当时只声明没跑通,现在跑通了,**真 server 而不是内存 client**(要测的是 `Set-Cookie` 与浏览器
自己的 cookie 处理,内存传输测不到):

- `POST /session` 用 `HttpApiBuilder.securitySetCookie` 下发 cookie,实测带 `HttpOnly` 与 `Secure`,
  **token 不出现在响应体里**
- `GET /session/me` 挂 `.middleware(Authenticate)`,middleware 解出 cookie 后
  `Effect.provideService(httpEffect, Principal, ...)`,**handler 既不读 cookie 也不重复查一次**
- 无 cookie → 401 且响应体是 `{_tag: 'Unauthorized'}`;伪造 cookie → 401
- OpenAPI 里 `securitySchemes.session = {type: apiKey, in: cookie, name: qualy_session}`,
  且只挂在需要它的 endpoint 上(不需要的那个是 `security: []`,不是没有这个键)

**形状上要记住的一条**:middleware 的 handler **包住下游 effect**(`(httpEffect, { credential })`),
不是返回一个值——它决定要不要继续,并把 principal 提供进接下来运行的东西。而且 **middleware layer
由用它的 group 提供**(`group.pipe(Layer.provide(authLayer))`),不是并列提供,否则 group 可以在
没有认证的情况下被接上。

### M1 未覆盖(留给后续里程碑)

- 会话失效(登出 / 过期清 cookie),随 auth 迁移一起做
- 浏览器里跑 `@effect/vitest`(上游没有 browser mode 的证据),M6 前要确认

## M2 实测结果(2026-08-05,`packages/app/tests/effect-shell.test.ts`)

跑起来了:`pnpm dev:effect` 与 `pnpm dev` **并存**,前者服务 `/health/live`、`/health/ready`、
`/openapi.json`、`/docs`,后者不受影响(实跑,零 `[E]`)。

| 属性 | 结果 |
| --- | --- |
| 端口是否等依赖建完才绑 | **是**。layer 建成之前 `/health/live` 连不上(不是 503,是拒绝连接) |
| 一次 close 是否同时释放 server 与池 | **是**,端口不可达且连接回到基线 |
| 数据库落后于 lineage | **拒绝装配**。`migrations: 'off'` + 空台账 → layer 构建失败为 `MigrationsBehind`,**server layer 根本没建**,端口不存在 |
| SIGTERM | 进程退出、端口释放、无残留 listener(实测) |
| `runtime.gen.ts` | 从 lock 生成,静态 import 各插件 `layer` 再 `Layer.mergeAll` |

### 「首个 readiness 必为 pending」这条验收要改写

assembly-design 阶段 2 写的是「首个 readiness 必为 pending」。那是 cordis 的形状:server 早早绑端口,
装配还在继续,所以需要一个门去挡。静态 Layer 图里**这个窗口不存在**——绑端口的 layer 在它依赖的
layer 之后才建,所以编排器看到的是「拒绝连接 → 可用实例」,而不是「503 → 200」。

新的等价验收是:**依赖没建好之前端口不存在**(已实测)。readiness 端点保留,但它回答的是
「现在还连得上数据库吗」,而不是「装配完了吗」。

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

- ~~`runtime.gen.ts` 的确切形状~~ M2 已定:静态 import + `Layer.mergeAll`,插件用
  `qualy.runtime.entry` 声明入口
- **manifest config 怎么进 layer**:M2 里 `DatabaseConfig` 由宿主提供、读环境变量,`qualy.yml` 的
  `migrationsFolder` 暂时没接进去。等 M5 有第二个带 config 的插件再定,现在定就是照着一个样本设计
- 运行时依赖声明落在 descriptor 还是 package.json(见「硬骨头 2」)
- `@qualy/api` / `@qualy/api-client` 包边界(M3 定)
- Zod → Effect Schema 的迁移顺序与共存期(M3 定)

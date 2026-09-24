# Qualy 项目亮点(简历素材)

> 本文从仓库现有代码、docs/ 与 STATUS.md 整理而来,用于简历与面试准备。
> 每条都尽量给出**机制、动机、数字与出处**,方便面试时展开。标注「设计未实现」的内容不要写成已交付。

---

## 0. 一句话定位与简历短句

**一句话**:Qualy 是一个面向高校「综合素质测评」的**插件化**全栈系统。后端以 Effect v4 作为唯一运行时,插件以不可变描述器声明服务、扩展点与能力,经 lock 文件冻结装配;前端按「授权投影后的 manifest」动态组合页面;配套 OpenTelemetry 全链路可观测性、前端 RUM、审计、发布版本协商、开发态进程监督,以及几十条把架构约束写成测试的仓库级门禁。

**可直接放简历的要点(按需挑 4-6 条)**:

- 设计并实现**编译期 + 启动期双重校验的插件装配系统**:插件以 `Plugin.define` 不可变描述器声明依赖、服务、扩展点(prepare / runtime / afterServices / external 四相)与能力;装配器拓扑排序并对重复提供、缺失提供、成环点名硬失败;`qualy.yml` + `qualy.lock.json`(manifestHash / resolutionHash)冻结装配,生产环境漂移拒绝启动。
- 主导后端运行时从 Cordis + oRPC **整体迁移到 Effect v4**(3 份 ADR、分阶段 spike 验证事务回滚/中断/保存点、HttpApi 类型检查伸缩性实测 500 端点 5.4s),同一份 HttpApi 契约同时产出服务端实现、OpenAPI、前端强类型客户端与测试客户端。
- 基于 Effect 原生 OTLP 模块(不引第二套 OTel SDK)实现 **traces / metrics / logs 三信号**:路由模板级 span 命名、数据库边界 span(不含 SQL 文本)、带基数防护的业务指标、日志与 trace_id/span_id/request_id 关联;经 OpenTelemetry Collector 双写本地 LGTM 与腾讯云 APM / CLS 并完成真实凭据验收。
- 实现**前后端同一装配的发布一致性协议**:Web 产物 release store(共享 assets、多版本共存与保留策略)、`resolutionHash` + `browserContractHash` 双哈希在服务端比对,旧标签页按装配差异精确返回 409,纯代码发布不打断在线用户。
- 设计 **Kubernetes 风格的防提权 RBAC**:角色 kind / 授权 coverage / 权限 target 三概念分立,任命关系为写入时校验无环的 DAG,自授不得扩权;授权判定与写入同事务(租户行锁 + 锁内复核),读取经 ltree 子树谓词下推 SQL 求交。
- 实现综测核心领域:版本化填报与题目配置、双链路审核引擎(普通链 / 升级链、评议组 quorum、同轮独立性、缺员阻塞与自愈巡检)、`bigint` 定点确定性计分器、Excel 行政认定导入(服务端重解析、全量预演、事务内复验原子提交)、PostgreSQL LISTEN/NOTIFY + SSE 实时失效通知。
- 以**测试即架构门禁**守住约束:插件隔离独立编译、开放世界第三方 scope 插件、仅含 dist 的已发布插件、冻结路由表与 OpenAPI 深比较、全局错误码唯一、i18n catalog 完整性、浏览器依赖图禁 Node 模块、生产 smoke(真启动 + SIGTERM 退出 0);node 套件 1781 项、浏览器(Chromium)418 项、WebKit 冒烟 14 项全部通过。
- 向上游 **MikroORM 提交并合入 6 个缺陷修复**(Kysely Generated 列、分区索引/检查约束/索引列序/索引访问方法的 introspection 丢失等),仓库最终零 patch。

---

## 1. 技术栈总览

| 层       | 选型                                                                        | 备注                                               |
| -------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| 运行时   | Node 24 LTS,**原生 strip-types 直接跑 TS,无加载器**                         | 冷启到端口 2.0s → 1.3s                             |
| 后端     | **Effect v4**(HttpApi、Layer、Scope、Fiber、Schema)                         | 唯一运行时,Cordis 与 oRPC 已完全离场               |
| 数据     | PostgreSQL 18(ltree、daterange、uuidv7)、MikroORM 7 定义实体、Kysely 写查询 | 迁移为纯 SQL,可 `psql -f` 执行                     |
| 前端     | React 19、React Router、TanStack Query、Vite、Mantine + StyleX、Lingui ICU  | 插件化页面组合                                     |
| 类型     | TypeScript 7 原生 tsc + `@effect/tsgo`(Effect 诊断进 tsc)                   | floating Effect、layer 需求泄漏在 typecheck 即失败 |
| 测试     | Vitest(node)、Vitest Browser Mode(Playwright Chromium / WebKit)             | 每轮建删约 150 个临时数据库                        |
| 可观测性 | Effect OTLP、OpenTelemetry Collector、Grafana LGTM、腾讯云 APM / CLS / RUM  |                                                    |
| 工程     | pnpm workspaces + catalog、GitHub Actions、AGPL-3.0-only                    | 约 40+ workspace 包,19 个插件                      |

---

## 2. 架构亮点:插件化与装配系统

### 2.1 为什么「插件拓扑按进程固定」(ADR 0001)

- 早期基于 Cordis 的动态插件运行时支持热插拔、服务动态出现消失。
- 裁决:**安装一个业务插件 = 同时改数据库、后端代码、权限、路由、前端资源和所有副本**,这是一次发布而不是热插拔。
- 因此进程启动后插件集合、服务图、路由、权限目录、UI 全部冻结;增删启停插件产生新装配,滚动重启;启动 all-or-nothing。
- 这一裁决让 Cordis 的独特价值消失,为迁移到 Effect 铺路(ADR 0002)。

### 2.2 描述器模型(`@qualy/plugin-kit`)

- 插件 = `src/index.ts` default export 一个 `Plugin.define(id, {dependsOn?, config?}, ...features)` **不可变纯值**,import 无副作用;描述器 id 必须等于包名,resolve 期校验。
- **三概念分立**:
  - **Service**:`Plugin.service(Tag, { requires, layer })`,`requires` 既是运行时拓扑,又是 layer 需求的**编译期上界**(需要更多就是插件内部的类型错误)。
  - **ExtensionPoint**:一个 owner、多个贡献者,分四相:
    - `prepare`:构建任何 layer 之前编译成纯值(实体、权限目录、页面、API 契约),compile 由重载强制零 requirement;
    - `runtime`:在完整服务图之上、最终消费者之下,产出 service-backed 绑定目录;
    - `afterServices`:在一切之上闭合(API handlers、raw routes);
    - `external`:由别的宿主解释(CLI 命令、i18n 模块、开发服务)。
  - **Feature**:参与装配的单位。
- **刻意删掉 boot 相**:装配器不编译的相会静默吞掉贡献;启动后的一次性工作改为在插件自己的 layer 里向 `Assembled` 屏障注册。
- **内核零能力知识**:`Db.entities`、`Ui.page/layout/slot/i18n`、`Access.permissions`、`Login.driver`、`Api.group/routes`、`Cli.command`、`Browser.module`、`Dev.service` 全部归各自能力包;新能力 = 新插件。
- 类型账:插件侧零 cast,类型擦除只集中在装配器与宿主 narrow。

### 2.3 装配流程与校验

`qualy.yml` + lock → 按依赖序动态 import 描述器 → prepare → 按 `requires` 拓扑构建服务 → runtime → afterServices → **Assembled 屏障** → 绑定端口。

- 重复提供、缺失提供、成环一律**点名硬拒**;同一 ExtensionPoint 以不同相位重用也拒绝。
- 插件 layer 经 `Layer.fromBuild` 包装,构建期与其 fork 的后台 fiber 自动带 `source: <插件id>` 日志注解。
- 发现 `Layer.mergeAll` 不会把成员互相接线,改为拓扑分层 + `provideMerge`。

### 2.4 能力(Capability)与 lock 文件

- 能力以 `Plugin.capability(key, () => import('./assembly/...'))` **惰性声明**:CLI 做事时才 import,服务端启动永不付费。
- 固定生命周期 `resolve / plan / generate / deploy / <capability> <command>`,**插件不得自造阶段**。
- 一键一主:两个 provider 认领同一 key 硬失败;贡献了无人提供的能力也硬失败。capability state 每次 resolve 重新派生。
- `qualy.lock.json`(`lockfileVersion: 2`)记录 `manifestHash`、`resolutionHash`、每插件 `{version, state, contributions}`、能力 provider 与 state;**禁止写入 secret、连接串、外部资源 id**(provider 的 `resolve()` 拿不到配置)。当前 lock:19 个插件、16 个运行时插件、2 个能力(database、permissions)、59 个实体、30 个权限码。
- **漂移检测**:生产环境清单与 lock 不一致拒绝启动,开发环境告警;`--frozen-lockfile` 零写入;lock 版本更旧且无保留插件时告警重写,否则硬失败。

### 2.5 插件状态与「停用不删数据」

- `active` / `disabled`(在清单里)、`detached`(不在清单里,但某能力经 `retainsPlugin` 声明要保留,lock 记 `retainedBy`)。
- schema 聚合读保留集,浏览器聚合读 active 集;**停用与移除都不删数据**。当前 `@qualy/plugin-ping` 就处于 detached、由 database 保留。
- `qualy plugin add/enable/disable/remove`:在 YAML document 层编辑以**保住注释**,改清单、重写 lock 与派生模块作为一个文件集,任一步被拒整体回滚。

### 2.6 CLI 设计

- 名词优先两级:`qualy <lifecycle>` + `qualy <namespace> <command>`,命名空间一次一个 owner、支持别名(`db` → `database`)、实现惰性加载。
- 三档上下文:`assembly` / `capability` / `runtime`。runtime 档按服务端同一装配构建服务,**不起 HTTP、不跑 boot hook、迁移强制 off**,命令交出的 Effect 程序在 scoped runtime 上执行后 dispose。

### 2.7 开放世界:插件判据不看 npm scope

- 「什么算插件」= default export 是自称本包名的描述器,与发布在 `@qualy/` 还是 `@acme/` 无关。
- `open-world.test.ts`:一个外部 scope 的第三方插件(含描述器、页面、i18n、浏览器模块)不改宿主即可 resolve、收集、构建。
- `dist-only-plugin.test.ts`:只有 `package.json` + `dist/` 的已发布插件同样可用。模块引用是**包的 export 子路径**而不是文件路径,构建工具因此不再知道 `src`/`dist`/`.tsx`/`.js`。

### 2.8 零 codegen

- 仓库唯一生成物是 `db/migrations/` 的 SQL。已删除 `runtime.gen.ts`、`api-handlers.gen.ts`、`entities.gen`、`routes.gen`、`api.gen.ts`、`cordis.gen.yml`、前端 `plugins.gen`。
- 浏览器聚合是 Vite 期 virtual module `virtual:qualy/plugins`,从 resolution 现算,物化到 gitignored 的 `apps/web/.qualy/`。

---

## 3. 迁移工程:Cordis + oRPC → Effect v4

出处:`docs/adr/0001-0003`、`docs/effect-migration.md`、`docs/reports/effect-migration-progress.md`。

### 3.1 动机

- **ADR 0002**:`Effect<A, E, R>` 把依赖与错误放进类型,Cordis `inject` 只是运行时声明;两套并存意味着两套拓扑、生命周期、服务图。
- **ADR 0003**:oRPC 退化为一层额外适配(运行时 `apiErrorBoundary` 把 DomainError 翻成 ORPCError)。HttpApi 一份定义产出服务端、OpenAPI、Scalar 文档、强类型客户端与测试客户端。拒绝 Effect RPC:冻结的 REST 路径要比内部重构活得久,且面向企业集成。

### 3.2 分阶段、先 spike 后迁移

- 基线打 tag、冻结版本、vendored 上游源码。
- **数据库 spike(8 项测试)**:在真实 schema 与 15 条真实迁移上验证 typed failure 回滚、fiber 中断回滚、savepoint、UUIDv7、ltree、timestamptz、约束名提取、关闭 Scope 真正关闭连接池。
- **HttpApi spike(11 项测试)**:窄化的客户端错误类型、OpenAPI/Scalar、TanStack Query 保留错误类型并支持取消;**类型检查伸缩性实测**:3 端点 2.6s、200 端点 3.9s、500 端点 5.4s(约每端点 6ms),当时项目 55 条路径。
- 应用壳 → HttpApi 基座 → auth/RBAC/org → 其余插件按**依赖簇**而非目录迁移 → 原子切换删除 Cordis 与 oRPC。
- 硬门禁:零 `cordis` import、零 `@orpc` import、生产源码允许边界之外零 `Effect.run*`。

### 3.3 迁移中的发现

- **事务是环境而不是参数**:peer service 经 fiber context 自动加入调用方事务,删除了 `RbacDbHandle` 参数;前提是「每进程一个 PgClient」,由门禁守住。
- 所谓 org ↔ rbac 循环依赖在服务层并不存在,唯一真实的反转是 UiAuthorizer,改为必需服务(若用 `Context.Reference` 默认值会**静默 fail-closed**)。
- 授权方法上 14 处 `actor?` 可选是 fail-open 形状,改为只有 testkit 能构造的受信 principal 值。
- 外部审计发现 4 个 P0 全部修复;逐方法审计再确认 12 个缺陷,其中一个是安全级(**被停用租户的会话仍然有效**)。
- 路由组的运行时 key 只含标识,类型却携带 API id:每个插件针对本地单组 API 实现,第三方聚合统一服务,**无循环包依赖**;原全局 `@qualy/api` 与 `@qualy/api-client` 包被删除。

---

## 4. 数据层

出处:`packages/plugins/infra/database/`、`docs/notes/mikro-orm.md`、`docs/notes/data-layer-retrospective.md`、`docs/upstream/`。

### 4.1 ORM 定义 + Kysely 查询

- MikroORM 7 `defineEntity` 定义表,查询一律 Kysely(`kyselyOf(em)`)。**Query Builder 是默认路径**,`sql<T>` 只以最小片段内嵌 PostgreSQL 特有表达(advisory lock、ltree、row-value keyset、`IS DISTINCT FROM`、uuid[]/jsonb 转换)。
- 迁移时约 5,300 行业务查询从 Drizzle 迁到 MikroORM + Kysely,auth / org / rbac 因事务共享连接必须同批切换(经探针证明)。
- 主键统一 **UUIDv7 且由数据库侧 `uuidv7()` 生成**,裸 psql 与 ETL 写入同样拿到 ID;时间戳一律 `timestamptz`。

### 4.2 「两个真实数据库对比」生成迁移

- 建两个临时库:一个应用已提交的迁移历史,一个由实体 + 复合外键 + baseline 片段构建;**迁移 = 两个真实存在的数据库的差**。
- 动机:租户作用域的复合外键无法在实体元数据中表达,对比元数据会永远建议删除它们。
- 从不读开发者自己的库,输出只依赖仓库;迁移文件原子写入(临时文件 → fsync → rename);**应用进程禁止生成迁移**,已应用迁移只 fix-forward。
- **drop-guard**:DROP TABLE / COLUMN / SCHEMA CASCADE 需 `ALLOW_DESTRUCTIVE=1` 或文件内 `-- destructive: approved`,在写文件前拦截;CI 做全历史扫描,并检查 `qualy generate` 为 no-op 且工作区干净。

### 4.3 插件自带 baseline 片段

- 插件声明 `Db.entities(entities, { baselineDir })`,目录内 `NNNN_*.sql` 承载结构对比看不到的东西(扩展、函数、种子行),可指定 `-- phase: pre-structure`。
- 编进中央迁移时打 `-- qualy-baseline: <插件> <路径> <sha>` 标记,**已编译片段改动即硬失败**,重跑 no-op,停用插件仍贡献;片段必须幂等。
- 触发事件:干净环境测试对每种插件组合都报 `type "ltree" does not exist`,因为 `CREATE EXTENSION` 只存在于宿主历史里。
- `qualy database adopt`:历史被压缩或早于账本的库,逐对象比对、不一致拒绝、一致只写账本。

### 4.4 「复杂度必须由已发生的问题证明」

- 一整套数据治理机制(三份 lock、advisory lock、checksum 拒绝、对象注册表)被**回滚并归档到 tag**,改为触发表:每个机制对应一个真实事故或需求。
- 目前仅两个触发器真实发生:baseline 片段,以及**连接池 checkout 账本**(由 CI teardown 挂起触发):用 `AsyncLocalStorage` 给池连接打上来源 fiber 与 span,关闭时从 `pg_stat_activity` 报告谁没还连接。

### 4.5 上游贡献

- `docs/upstream/` 共 10 份缺陷报告草稿,其中 8 份针对 MikroORM。
- **6 个已被 MikroORM 合入**(7.1.11 合入 4 个:Kysely `Generated` 列忽略 `defaultRaw`、实体生成器丢检查约束、丢分区索引、丢索引列序;7.1.13 合入 2 个:检查约束 cast 剥离导致括号不平衡、丢索引访问方法)。
- 结果:**MikroORM 零 patch**;`introspection.test.ts` 与 `kysely-types.test.ts` 断言的是行为而不是补丁,上游回归会按名失败。
- 还有一个未合入问题(COMMIT 被拒时池连接永不归还)用 `settle` 规避并由 `pool-release.test.ts` 守住;另发现并最小复现了 pnpm 12 的回归。

---

## 5. API 契约与错误体系

- **契约与实现分家**:每个插件 `src/api.ts` 导出 `HttpApiGroup`(`./api` 叶子子路径),服务端 `Api.group(group, handlers)` 实现,浏览器 `Api.local(...groups)` 生成强类型客户端,组件经 `useApi` / `useApiQuery` 消费,错误类型为 `ApiResult<typeof xApi, 'group', 'endpoint'>`。
- **包体积防护**:`Api.local` 必须从 `@qualy/api-kit/local` 取,否则 `HttpApiScalar` 内嵌的 3.1MB 参考 UI 会被拖进前端包,由 browser-graph 门禁守住。
- **单一错误 wire shape**:`/api/*` 所有 JSON 错误都是 `Schema.TaggedError` 编码的 `{ _tag, ...公开字段 }`,路由不存在(`API_ROUTE_NOT_FOUND`)、来源拒绝、协议不兼容都用同一形状,不引入第二套 Problem Details;禁止在错误数据里放角色码、约束名、SQL 明细。
- **错误码全局唯一**,归属由 `error-codes.test.ts` 冻结并与各插件前端错误翻译交叉校验;数据库约束冲突经 `createConstraintTranslator` 翻成领域错误(409 而不是 500)。
- 踩坑记录:middleware 的 `error` 用 `Schema.Union` 会把所有声明错误静默变成 500,改用数组修复。
- **REST 路径规范**:首段为产品域(auth / iam / org / app / assessment),禁止实现名与场景名;状态与关系用幂等子资源(`PUT .../status`、`/placement`、`/permissions`、`/grantable-roles`),**禁止动作段**;method/path 字面量只允许出现在 `HttpApiEndpoint` 声明里,需要地址时用 `HttpApiClient.urlBuilder` 现算。
- **全量路由冻结**:`frozen-routes.ts` 列出所有 `METHOD /path`,与运行时同一聚合现算的 OpenAPI **全量深比较**;曾借此发现匿名 schema 名随 group 顺序漂移。
- **列表一律 keyset 分页**,禁止裸 `limit N` 静默截断;响应带 `capabilities` 或逐行 `manageable`,前端据此不渲染用不了的控件。

---

## 6. 前端平台

### 6.1 manifest 驱动、按用户授权投影的路由

- 页面在描述器里单点声明:`Ui.page({ id, path, component: Ui.react('./client/X'), layout, visibility, navigation })`,`visibility` 必须显式(`PUBLIC` / `AUTHENTICATED` / `permissionOf(code)`),没有隐式默认。
- `GET /app/manifest` 是**按 principal 的授权投影**:不可见页面一律不下发,内部声明永不出服务端;缺 authorizer 时权限页 fail closed。
- 浏览器**按 surface 寻址而非按实现寻址**:manifest 只发 page id / layout contract / slot key / login type,registry 是同键四张表(pages / layouts / slots / login)。
- 跨插件导航一律按 id(`PageLink page="auth/login"`、`usePageNavigate`、`usePageHref`),禁止裸内部路径(`client-paths.test.ts` 守)。
- UI 组合模型:Page 引用 Layout Contract 而非实现,布局插件提供实现,松耦合组件走 Slot;业务插件不得依赖布局实现插件,反之亦然。

### 6.2 构建期聚合(`@qualy/web-build`)

- Vite 插件从 **active** 装配现算插件聚合,dev / build / 浏览器测试共用同一选择;**停用插件的代码永远不进浏览器**:构建产物 113 → 111 个 JS 资源(去掉腾讯 RUM 与 COS SDK),停用公式插件则 Monaco 整个消失(100 个)。
- 聚合时拒绝重复 surface、catalog 命名空间、message id 与错误码。
- 产出私有 surface → chunk 映射,**chunk 哨兵**断言每个 surface 渲染器独立成 chunk,`--expect-absent` 断言某 surface 被摇掉;替换了会泄露源文件名、同名文件互相冒充的 basename 匹配方案。

### 6.3 事故复盘:冷缓存双 React

- 现象:整套浏览器测试**只在冷缓存时**报 "Invalid hook call"。
- 根因一:生成模块用绝对文件路径,在 Vite 里是 root 相对 URL,依赖扫描器与 dev server 都不跟进。
- 根因二:浏览器测试 root 在仓库根,pnpm 隔离下 React 从未声明它的 package.json 解析,每个插件包各加载一份 React。
- 修复:生成模块一律相对路径 + 静态 import 的「scan 孪生文件」,内容变化才写并注册为 `optimizeDeps.entries`;测试 root 改为拥有 React 的 `apps/web`;`dedupe`;CI 单独一个**永远冷缓存**的 browser job。

### 6.4 浏览器插件生命周期

- `Browser.module('./client/boot')` 默认导出 `BrowserPlugin`:`setup(ctx)` 同步、廉价、**返回 disposer**;`start(ctx)` 做昂贵的事且**宿主从不 await**。
- 组合根按装配顺序先全部 setup 再全部 start,teardown 逆序;单个插件失败隔离且只告警一次;ctx 只有 `release`,刻意「不是第二个 DI 容器」。
- 替换了顶层副作用注册(没有时机、无法撤销、HMR 下重复注册)。

### 6.5 i18n:后端传语义,前端定语言

- 服务端只传 `UiText`:`message(id, en)` 可译或 `literal(value)` 业务数据,**禁传已选定语言的字符串**(权限名、权限分组也是 UiText)。
- message id 为 `<plugin>/<段>/<段>`,插件独占命名空间;catalog 是纯 TS 模块(raw ICU,运行时编译)。
- `catalogs.test.ts` 从描述器发现 catalog,校验全语言完整、无孤儿键、命名空间不越界、ICU 可编译;组件内禁止裸中文。
- 错误翻译 `defineErrorTranslations`,按 `_tag` 判断而不是 `instanceof`(模块重复加载下依然成立),后端英文 message 只是协议兜底。
- 界面文案原则写成规范:文案只服务「读者下一步做什么」,禁止在界面解释实现机制。

### 6.6 UI 平台

- Mantine + StyleX:约 55 个无 barrel 的子路径组件(table、sheet、tree-select、date-range-picker、dropzone、toast 等),StyleX tokens / breakpoints / layout;组件库零文案。

---

## 7. 身份、授权与多租户

出处:`packages/plugins/base/{auth,auth-local,org,rbac}`、`packages/contracts/rbac`、CLAUDE.md 访问模型章节。

### 7.1 概念模型

- **三概念禁止合并**:`permission.target`(tenant | org-node,领域事实,决定用 `require` 还是 `requireAt`)、`role.kind`(tenant | org,授权要不要锚节点)、`grant.coverage`(self | subtree,授权那一刻才知道)。
- **用户类型只约束身份与站位,角色只承载职责与权限**;站位是显式策略 `placement_mode`(`unrestricted` | `allow-list`),**禁止把空集合读成不限制**。
- 「能进门户」不建模为权限,用 `AUTHENTICATED` 可见性。
- 跨插件不变量单源:站位合法性 auth 与 org 都能破坏,判定只有一份 `placementLegal`,写入校验、org 改类型前询问、全量扫描共用;不变量在**自身写入之后**读终态校验,失败整体回滚。

### 7.2 防提权(参照 Kubernetes RBAC)

- 定义角色、新增任命边只能使用自己持有的权限(`iam.role.escalate` 为受审计的逃生口)。
- 对**他人**授予不比较权限集合,完全由 `role_grant_rules` 任命图承载(能任命审核员 ≠ 须亲自具备审核员的全部业务能力)。
- **任命图写入时自洽**:拒自环与成环(DAG)、只可任命同 kind 角色、granter 自身必须携带对应 grant-manage(杜绝靠持有人另一角色补足的潜伏边)。
- **自授不得扩权且无逃生口**:目标角色权威 ⊆ 自身现有权威且 coverage 不更宽,还比较出向任命边(否则人事岗之间互升会被判为无变化)。
- 修改活跃角色权限即修改职位本身,立即作用于全部持有人;上级失权不级联撤销下级(任命是独立组织事实)。
- canonical tenant-admin(唯一 `all-active`)是唯一豁免 eligibility 与任命规则的角色;**最后管理员保护**锁定管理员角色行、计算幸存者,缺角色时 fail closed。
- 角色 draft → active → disabled,激活时检查完整性,集合替换带 `version` 乐观并发。

### 7.3 授权一致性三条

1. **读过滤下推**:`scopeCoverage(scope, nodeRef)` 返回 Kysely `RawBuilder<boolean>`,全租户为 `true`、无锚点为 `false`,否则按 ltree `node.path <@ anchor.path` 生成 `exists` 子查询;接收类型化列引用(join 改名即编译失败),锚点 id 以 `uuid[]` **绑定参数**而非拼接。请求范围 ∩ 授权范围,返回部分子树是正确答案,且保持 keyset 分页正确。
2. **结构性写入**:第一条语句 `select 1 from tenants where id = $1 for update`,锁内**用调用方连接**复跑授权,禁止持锁另开池连接(防连接池耗尽死锁)。
3. **解释与判定同源**:诊断接口(`POST /iam/access-evaluations`、有效权限查询)复用同一 SQL 片段。

- 契约包里单份实现的来由:曾经两份拷贝不一致,把 self 授权读成了 subtree。
- 租户纪律:tenantId 只来自配置、session 或服务端查出的关联对象,普通 input 禁止自由填写。
- 权限目录由描述器声明、在 Assembled 屏障镜像入库;库中行与声明的插件或 target 不一致则阻止启动,带外改动只会收窄授权。

### 7.4 会话与登录

- Cookie + 不透明 32 字节 CSPRNG token,库中只存 sha256;**不用 JWT、不用 localStorage**(登出/停用即时生效、HttpOnly 防 XSS 窃取)。
- 生产 cookie 名 `__Host-qualy_session`(Secure、Path=/,阻止兄弟子域种 cookie),HttpOnly、SameSite=Lax、TTL 7 天。修过一个 bug:`maxAge` 传裸数字被当毫秒,所有 cookie 约 10 分钟就失效。
- 会话是声明 `provides` 的 Effect HttpApi middleware:端点**无法忘记认证**,没有 middleware 就读不到 principal。
- 一条查询同时校验 session、用户、用户类型、租户均启用且租户未过期。
- 登录驱动插件化:协议族 = 驱动插件(`Login.driver`),实例 = `auth_providers` 行,每租户可多实例;登录方式受众(`audienceMode`)决定哪些用户类型可用。
- 本地密码驱动:**Argon2id(64 MiB, t=3, p=4)**,开发机实测 hash 36ms / verify 31ms,最短 12 位;未知用户对固定 dummy hash 校验以**抹平时序**,所有失败统一 `INVALID_CREDENTIALS`;回跳地址经 URL 解析强制同源(挡住反斜杠绕过)。
- `sign_in_events` 独立于审计:不存攻击者输入的标识,账户级拒绝记录精确原因而 wire 响应保持统一;会话写入、身份最近使用时间、登录事件同一事务。

---

## 8. 综测业务领域

出处:`docs/assessment-design.md`、`docs/administrative.md`、`packages/plugins/assessment/{core,evidence,formula}`。

> **已实现**:批次、阶段、名单、题目与版本、填报、审核引擎、申诉(作为新审核轮)、实时暂计分、行政认定与 Excel 导入、实时推送、公式插件。
> **设计未实现**(不要写成已交付):初步/最终公示快照、排名与并列裁决、归档打印、ScoreRun。

### 8.1 领域模型要点

- **批次**:一次测评一套规则;`material_range` 用 PostgreSQL `daterange`(左闭右开,避开 23:59:59 与时区问题);`config_revision` 检测过期计分;状态只存 draft / active / archived,「未开始」由派生得出;归档后只能追加新阶段重开且必须写原因(数据库 check 约束),历史不改写。
- **管理边界在创建时冻结**(`batch_management_anchors`),修补了「一个学院管理员接管另一学院空草稿」的漏洞。
- **阶段**只存进入时间,下一阶段开始即本阶段结束,**间隙与重叠在模型上无法表达**;排期必须是连续前缀;补录阶段可限定题目与参评人。
- **截止由时钟决定而非调度器运行时刻**:`effectivePhaseIndex` 精确到秒,调度器只记录时钟已经决定的事;调度器把定时器对准下一个边界而不是轮询。
- **题目配置不可变**:`assessment_item_revisions` 承载表单、计分、审核、展示配置,填报记录所用版本并始终按该版本解码;字段与审核阶段有永久 id,配置变更按身份映射而非数组下标。
- 分组是单根树,上下限由内向外 `final = clamp(own + children, floor, cap)`。

### 8.2 两条不可妥协的业务原则

- **不替学生填报**:只有学生能改自己的材料;审核员发现问题只能驳回并附建议稿,学生只读查看、**没有「一键套用」按钮**(否则作者身份存疑)。两种例外严格分开:
  - **代录**:原子的「创建并提交」,subject 是学生、actor 是工作人员,走完整审核链,不存在代录草稿;
  - **行政认定**:机构陈述事实(纪律处分、官方名单),无需审核但必须写依据,**应用层与数据库 check(`actor_id <> subject_id`)双重禁止给自己认定**,救济途径是申诉。
- **审核决定不定价**:审核只判断真伪,分值永远来自配置;后续允许 approve 携带受冻结 schema 约束的「认定(Recognition)」,但金额仍由冻结的计算器或公式算出,计分器类型上要求计入项必须带已求值金额与 `recognitionId`。

### 8.3 填报

- 状态 `draft | in_review | approved | rejected | needs_revision | voided`,来源 `self | proxy | record | import | system` 由服务端决定,客户端从不发送 source / actor / subject。
- `entry_revisions` 追加式;撤回仅限审核正式开始前(递归查询被取代的轮次判断);放弃对已通过填报也生效但审核历史保留。
- 每个动作的可用性以 available / blocked / hidden 下发,与写路径**同一个检查**。
- 写入携带 `expectedItemRevisionId`:题目在此期间变了则在解码 payload 前返回 409,界面**保留学生已输入内容**并提供「查看最新要求」。
- 附件 staged → bound → retired 不可变,下载强制 `Content-Disposition: attachment` + `nosniff`;审核员可要求补充材料,轮次进入 `awaiting_supplement`,不改原版本。

### 8.4 审核引擎(有边界的工作流)

- 每题两条链:**普通链**(一次驳回即驳回)与**升级链**(中间步骤可直接通过,中间驳回只是向上传递意见,只有最后一步能终审驳回)。
- 阶段选择器:`roleAt`(在参评人冻结的组织谱系上找最近的某类型节点,匹配锚定在该节点的角色)、`nearestRole`(向上找最近的辅导员类角色)。
- 链在开启审核时解析并**快照到轮次**,每次开新轮而不复用。
- **拉取式收件箱**:不分配任务,实时 join 阶段角色与节点和用户授权,班长交接即时生效、无需迁移任务。
- **缺员三分**:该层级对此学生不存在 → 跳过;岗位空缺 → `blocked` 并记录原因(`no-assignee` / `no-independent-reviewer` / `panel-seat-unfilled`);审核人是学生本人或修订作者 → 排除。**审批权永不静默上交**。
- 评议组 `quorum: all` 到达时冻结席位,投票在结论前保密,投票人事后失去角色投票仍有效;同轮已判断者不得判断后续升级步骤。
- **自愈巡检**:每分钟一次后台 loop,是发现审核人变动的唯一机制,双向修复 active ↔ blocked,用条件更新(`WHERE state='blocked'`)与人工操作并发安全;**不在 rbac 写路径挂钩子**。
- 申诉 = 新审核轮(`origin='appeal'`,走升级链),必须针对当前结论,事务内加批次锁后复核;部分唯一索引保证每个填报只有一个开放轮次。
- 配置保存做**影响分析**:首次 PATCH 可能返回 409 + 影响报告 + `impactToken`,管理员按情况选择继续、退回修改或重路由在途审核(新轮 `origin='reroute'` + `supersedesInstanceId`,禁止原地改快照链)。旧存储格式经适配器读取不改写。

### 8.5 `mayReview`:一个 SQL 谓词统一四处判定

提交时到达检查、收件箱、审核决定、巡检共用同一 SQL 片段,杜绝「提交找到了审核人但收件箱里看不到」。它要求:角色属于阶段角色且**精确锚定**在阶段节点(学院级授权不下探到班级)、授权在有效期内未撤销、角色启用、用户启用、批次接纳了该授权的审核权限且角色仍携带、无批次级拒绝、资源作用域为通用或本批次、审核人不是 subject 也不是修订作者;再与同轮独立性、评议席位谓词组合。

### 8.6 批次内授权三层

- 权威(RBAC 或在名单上) → **阶段闸门**(只收窄,无活跃阶段时拒绝受闸动作) → 资源策略,拒绝带结构化原因(`not-participant`、`phase-closed`、`item-out-of-scope` 等)。
- **参评人动作不是 RBAC 权限**:创建/编辑/提交/撤回/放弃/申诉来自「在名单上」,模块加载期断言它们永不进入权限目录,并以迁移清理残留授权。
- 工作人员来自普通 RBAC 授权,可经资源作用域限定到单个批次;批次保留**访问基线**(接纳时的权限上限 + 按人拒绝):租户级撤销立即生效,**扩权需要显式预览并接受同步**。
- 有效权限 = (授权当前携带 ∩ 批次接纳) − 批次拒绝 ∪ 参评人动作,再 ∩ 当前阶段开放,再过资源守卫。
- 多轮安全加固均附带对抗性回归测试:跨学院接管、越权重新纳入名单、名单写入的 TOCTOU 窗口(用 `unnest(user_id, node_id)` 成对 join 防止检查后被移动的人被插入)、资源作用域授权绕过 eligibility。

### 8.7 确定性计分器

- 单一纯函数 `calcParticipant`:无时钟、无查询、**无浮点**,内部排序保证同样事实产出**逐字节相同**的明细。
- 金额为 `bigint` 定点(×10⁴),逐行「远离零」舍入后再求和(83.245 → 83.25,-0.125 → -0.13),打印出的行永远加得出打印的小计。
- 组树深度优先递归并检测环,孤儿分组作为根而不是消失;每行有确定性 `lineId` 与出处(填报、修订、认定、计算器)。
- 被驳回的填报以零值 `excluded-evidence` 行出现,让学生有一行可以申诉。
- 内置计算器 `fixed@1`、`sum@1`、`max@1`(只取最高职务)、`top-n-sum@1`,一律 `id@version` 版本化;聚合器必须对每个填报恰好返回一个决定(双射),否则抛错。
- 失败边界按发生位置区分:结算认定时的拒绝展示给用户,读账时出现同样拒绝视为 bug;结算证明在事务外探测(尝试 → ProbeNeeded → 回滚 → 证明 → 重写)。
- **自定义公式插件**:管理员编写、编译为不可变版本,在确定性 QuickJS 沙箱中运行(无 `Date` / `Math.random`、内存与时间限制、结果冻结产物 sha256、失败不静默记零),经 unix socket 隔离;设计上不向 LLM 发送真实学生数据。

### 8.8 行政认定 Excel 导入

- 纯解析器不懂领域(exceljs),限制 10MB、2000 行、128 列、单元格 4000 字符、8 个 sheet,**拒绝公式单元格**。
- 模板含隐藏 `_qualy` sheet 记录模板版本、批次、题目、题目版本与列映射;重复选项标签做成可逆的 `label [value]`。
- **预演**:服务端重新解析已存储文件(**从不信任浏览器解析的 JSON**),不写任何东西,收集全部错误而不是遇错即停;参评人一条 SQL 批量解析(无 N+1),调用者范围外的人一律显示「未找到」(**不泄露存在性**);计分证明在事务外批量进行,相同认定哈希去重、并发 4;警告需 `confirmWarnings: true`。
- **提交**:重开文件 → 重解析 → 重校验 → 证明计分 → 事务 → 锁批次 → 复核所有易竞争条件 → 全部写入或全不写;源文件在同一事务绑定到存储;实时事件合并为一次通知。
- 导入计数派生不存储;批量撤销原子化,且只作用于导入行记录的那些填报,而不是「学生当前的填报」。

### 8.9 实时推送

- 事务内 `pg_notify`,**只在提交后到达**;每进程一个 LISTEN 连接,经进程内 PubSub 扇出到 SSE。
- 事件只带 kind,**不带业务数据与 id**,浏览器只做查询失效;不引入 Redis。
- 未读标记用两个单调计数器(attention revision / seen revision)而不是时间戳;活动流用 `(at, source, id)` keyset。

### 8.10 各角色界面

- **学生**:我的填报(逐题状态点、未读红点、填报闸门在请求前禁用按钮)、我的结果(逐行暂计分明细)。
- **审核员**:收件箱(实时队列计数)、三栏审核工作台(流程 / 填报 / 依据),移动端变为横向翻页 + 未查看栏软提醒 + 2×2 决定网格;「任务已被他人处理」横幅不丢输入、5 秒撤销。
- **认定员**:行政认定记录与导入历史、手工认定、导入向导、单条与批量撤销。
- **管理员**:阶段计划、名单、参评结果、批次人员与访问同步、批次设置、单表试卷树 + 全页题目编辑器(带参评人预览)。
- **公式作者**:公式库、公式编辑器(Monaco)、模板。

### 8.11 记录的三格分工

- **审计**(安全、管理、配置)、**领域历史**(实体自己的演进,带 actor)、**遥测**(诊断),每个 mutation 明确落在哪一格,「三格都不需要」也是合法答案,**不写三遍**。
- 领域历史表:`phase_events`、`batch_participant_events`、`batch_lifecycle_events`、`review_events`、`review_votes`、填报事件、导入事件等;不做 event sourcing。

---

## 9. 可观测性

### 9.1 OpenTelemetry(`packages/core/telemetry`)

- 直接用 Effect 自带的 `effect/unstable/observability` OTLP 模块(Tracer / Metrics / Logger / Exporter),**不引 `@opentelemetry/*`**,避免第二套 SDK 与 Node 24 的 ESM loader hook。
- **默认零开销**:没有 `OTEL_EXPORTER_OTLP_ENDPOINT` 或 `OTEL_SDK_DISABLED` 时不建 HTTP 客户端、不替换 tracer。
- 默认 `http/protobuf`,支持 `http/json`;`grpc` 在启动时拒绝而不是静默丢弃。在与 OTel 规范冲突处跟随规范(未设置 exporter 即 otlp、指标 60s 导出)。
- **尽力而为导出**:批量、3 次重试、硬失败后自禁用 60s、关闭时限时 flush,业务代码从不 await 导出。**刻意与审计相反**:审计记录失败则整个事务失败。
- Resource:`service.name`、`service.namespace`、`deployment.environment.name`、`service.instance.id`、`process.runtime.*`,优先级明确。
- Layer 顺序:telemetry 包住应用、处于 logger 之内,关闭时应用先关(排空过程本身被追踪)→ telemetry flush → logger 最后;telemetry / logger 自身失败有第二个报告器兜底(修复前 grpc 配置会**零输出退出 1**)。

### 9.2 Tracing

- 每个请求一个 server span,继承 W3C `traceparent`(兼容 b3)。
- **路由模板级 span 命名**:span 在路由前就被命名为 `http.server GET` 且 `Tracer.Span` 无 rename 方法;在响应后读取 `http.route` 属性改名为 `GET /iam/users/:userId`,**原始 URL 永不成为 span 名**;以 pinning test 守住升级。
- 审计约 300 个 `Effect.fn` / `withSpan` 名称,统一 `Service.operation` 规范,禁止动态拼名,纯函数用 `Effect.fnUntraced`。
- **数据库边界 span**(所有查询唯一出口 `orm.ts`):`db.query`(client kind)、仅在真实 BEGIN 时有 `db.transaction`,加入已有事务不加 span;**构造上不可能带 SQL 文本、参数与行**(这一层只看到不透明 thunk);拒绝 pg 自动插桩并记录重新评估条件;真实 Postgres 上的 `tracing.test.ts` 守住 span 与事务传播互不破坏。
- **浏览器侧刻意关闭 trace 传播**:浏览器不导出 span,否则每个请求在后端产生孤儿父 span(Tempo 中 "root span not yet received")。
- **校验客户端传入的 trace id**(`^[0-9a-f]{32}$`):曾有 36 字符的 `x-b3-traceid` 撑爆 `varchar(32)`,把一次成功登录回滚成 500。

### 9.3 Metrics

- **HTTP RED**:单一直方图 `http.server.request.duration`,OTel semconv 桶与标签,method 归一(未知为 `_OTHER`),route 只来自路由模板,5xx 带 `error.type`;审计中修复 `url.scheme` 恒为 `http` 的错误。
- **运行时**(每 15s):CPU 时间、内存、堆使用、事件循环延迟均值/最大值、事件循环利用率(命名刻意避开语义不一致的 semconv 名)。
- **数据库**:`db.client.operation.duration`,失败只带 SQLSTATE 不带 message;连接池 idle / used / pending 经 MikroORM `onPoolCreated` 采集;采样器用墙钟 Node 定时器(Effect sleep 会与 TestClock 死锁)。
- **基数防护**:`boundedCounter` / `boundedDurationHistogram` 预先声明全部标签键值,其余在运行时收敛为 `other`,测试喂入 UUID、`DROP TABLE`、原始 URL 验证。业务指标:登录结果、填报提交、审核决定、调度运行时长/失败、存储操作时长/失败。

### 9.4 采集管线与云上验收(`ops/observability/`)

- 本地:OpenTelemetry Collector + grafana/otel-lgtm(Tempo、Prometheus、Loki、Grafana),docker compose profile 一键起。
- 预发/生产:Collector 双写本地栈与**腾讯云 APM**(traces,OTLP gRPC/TLS),指标 APM → TMP,日志经原生 OTLP/HTTP protobuf 进 **CLS**。
- **凭据从不进入应用进程**,只在 gitignored 的 `collector.env`;门禁要求配置里的密钥值必须是 `${env:...}` 引用、镜像版本必须钉死。
- 发现真实兼容性问题:CLS 忽略 `Content-Encoding: gzip`,对压缩 protobuf 返回 400(curl 探针:identity 200、gzip 400),修复为 `compression: none`。
- 验收:真实凭据下完整导出周期,云端 exporter 零错误/重试/丢弃,APM 与 CLS 可按 TraceId/SpanId 互跳。

### 9.5 日志

- `qualy.yml` 的 `application.logging` 是提交的默认值且**不进 manifestHash**(调级别不触发漂移),环境变量最高优先,支持按来源设置最低级别,未知键拒绝。
- pretty 格式 `HH:MM:SS.mmm LEVEL [source] message`,来源按首次出现顺序分配稳定颜色(红色留给错误),插件名缩写;json 格式顶层 `request_id` / `trace_id` / `span_id`(对齐 CLS 键索引),从**正在说话的 fiber** 读取,子 span 内的日志带子 span id,从不伪造。
- **自研访问日志**:5xx=Error、429=Warn、其他 4xx=Info、成功按配置(dev Debug / prod Info)、客户端断开(499 / 中断)=Debug、SSE 流结束=Debug(时长是连接寿命不是延迟);模式 `off | api | all`,默认排除健康探针。
- `X-Qualy-Request-Id`:每请求 `randomUUID()`,进 header 不进 body;`RequestContext` 还承载按受信代理策略(CIDR BlockList、`X-Forwarded-For` 自右向左、伪造项置空)解析的 clientIp、userAgent、traceId、publicHost、sessionId。
- 关闭可诊断:每个 layer 的 finalizer 记录开始/结束毫秒,超时点名仍在释放的 layer;连接池不关时每 5s 报告谁持有 checkout(fiber/span)并附一次 `pg_stat_activity` 快照。

### 9.6 前端 RUM

- **平台端口与厂商实现分离**:`@qualy/browser-observability`(零厂商代码)提供 `captureException` / `captureDiagnostic` / `setObservedPage`,**永不抛错、没有用户等待的操作 await 它们**。
- 应用启动前安装的 window error / unhandledrejection 早期队列(上限 20);provider 就绪前的报告排队并**在失败发生时快照页面上下文**;按对象身份 `WeakSet` 去重(实测 React 19 不会重抛边界已捕获的错误)。修复过「首屏错误在 provider 未就绪时被标记为已上报而丢失」。
- **URL 脱敏**:UUID、4 位以上数字串、转义段、16 字符以上段替换为 `:id`,丢弃 query 与 hash;API 地址按声明的路由契约解析,**无契约认领则丢弃**(fail closed)。
- `@qualy/plugin-rum` 是能力(provider 注册表,最多一个启用,两个则装配点名拒绝);`@qualy/plugin-rum-tencent` 是厂商实现(Aegis),**换厂商是 `qualy.yml` 一行改动**;仅启用时向壳 CSP 注册上报域名的 `connect-src`。
- 腾讯 SDK(128KB)仅在开启上报时动态 import,**24KB 启动预算门禁**抓到过一次被静态 import 的回归。
- **隐私**:不发用户 id、不采页面浏览、不采请求/响应体与请求头,只读回 `X-Qualy-Request-Id` 一个响应头用于**前端报告与后端日志关联**;针对本地伪造上报主机测试,开箱时一个哨兵值上线了 17 次,三个 hook 清除。
- 错误边界 `PluginComponentBoundary` 覆盖 page / layout / slot / login 渲染器,报告按 surface 打标(`page:assessment/review`);删除了能绕过边界的逃生口。
- **Sourcemap 上传 CLI**(`qualy rum sourcemaps`):只在发布流水线运行,版本取自构建元数据,按文件名 + md5 可续传(列表 API 最多返回 10 条),STS 凭据 3600s(默认值是未文档化的 10s),并发 8 并回读校验;sourcemap 永不进入 release store。

### 9.7 审计(`@qualy/plugin-audit`)

- 审计是**强制能力**:声明了审计动作而装配里没有审计插件,启动失败。
- 写入在调用方事务连接上一条 INSERT,与业务操作一起提交或回滚;任何拒绝都是缺陷而不是可处理错误。
- 校验顺序:动作已注册且版本匹配 → 按动作 schema 编码(白名单)→ 二次守卫(键名匹配 password / secret / token / cookie / authorization 等即拒,字符串 ≤ 4096、details ≤ 32KiB)。
- requestId / traceId / sessionId / clientIp / userAgent **从 RequestContext 读取,调用方无法传入或伪造**。
- 表只允许 INSERT / SELECT;keyset `(tenant_id, occurred_at, id)`;修复精度 bug:`now()` 存微秒而 JS `Date` 只有毫秒,分页边界丢行,游标改用 `occurred_at::text`。
- 覆盖 auth / org / rbac / assessment 共 29 个审计动作,角色权限变更记录增删 diff。

---

## 10. 运行、交付与开发体验

### 10.1 启动、健康与优雅关闭

- 启动:验证 lock → 组合 layer(纯组合 10-13ms)→ `Layer.launch` → Assembled 屏障 → 绑定端口;**资源冷边界**有测试证明(错误 `DATABASE_URL` 下组合阶段 `{"connects":[],"listens":[]}`)。
- 端口先绑定、路由未就绪时返回 `503 Retry-After: 1, X-Qualy-State: starting`,早到请求不再挂起。
- `/health/live`(不查依赖,永远快速 200)与 `/health/ready`(插件注册 readiness probe,数据库注册 `select 1`),在 `/api` 与 OpenAPI 之外,**失败原因只进日志不进响应体**(有门禁在 `check` 字段被加回时变红)。
- 关闭:`Layer.launch` 与关闭信号 `raceFirst`(用 `race` 时启动失败会静默挂起,SIGTERM 退出又看起来像正常关闭);HTTP 排空每 250ms 关闭空闲连接、2s 后强制关闭;`QUALY_SHUTDOWN_TIMEOUT`(默认 30s)超时点名;间隔 ≥1s 的第二个信号立即退出(1s 内视为同一次按键经进程组扇出);SIGTERM 到 "shutdown complete" 实测 9ms。
- 生产环境迁移默认 off(归 `qualy deploy`),库落后于迁移时拒绝启动并给出运维建议。

### 10.2 开发态进程监督(`docs/runtime-redesign.md`)

- 问题:Vite 原本运行在后端 Effect scope 里,每次后端重启杀掉 HMR、React 状态与查询缓存。
- 长驻 Dev Host + **分阶段候选进程**(不是 `node --watch`),IPC 协议 `prepare → PREPARED → commit → ACCEPT → acquire`:
  - 候选进程在 ACCEPT 前**资源冷**(不占端口、不连库、不跑调度、不迁移);
  - 旧后端持续服务直到候选 PREPARED,PREPARE 失败保留旧世界(last-known-good);
  - 交接等待旧子进程完全退出而不只是端口释放;commit 后钉住不回滚,commit 前更新的保存会替换候选(latest wins);STARTING 状态从不硬杀;IPC 断开即租约失效,host 死子进程自动退出。
- Web 作为独立进程:`Dev.service({id:'web'})` 声明,Vite 独立运行在 :5173,只反代 `/api` 与 `/health` 且保留 Host 头,后端不在时返回 `503 X-Qualy-State: unavailable`;浏览器读查询退避重试,mutation 永不重试。有测试断言**两次后端切换后 Vite PID 不变**。
- 按目录约定分类变更:`src/client` → HMR、`src/server` → 仅重启后端、`src/dev` → 仅重启该服务、其他 → 完整会话;未知路径按最贵处理;后端上报拓扑变化时升级为完整会话。
- 修过的真实问题:chokidar 4 去掉 glob 支持导致 `**/node_modules/**` 失效耗尽进程(`spawn EBADF`);在 watcher `ready` 前宣布 watching,初始扫描期间的保存静默丢失(CI 抓到);`.env` 可能是密钥管理器提供的命名管道,watch 会永久阻塞,改为会话开始时读一次快照。
- 性能:去掉 tsx 加载器改为 Node 原生 strip-types 后,读清单 ~500ms → ~320ms、装配验证 ~600ms → ~355ms,**冷启到端口 ~2.0s → ~1.3s,后端单次重载约 1.1s**。

### 10.3 Web 发布版本协议(`docs/web-release.md`)

- 三个身份:`resolutionHash`(哪个插件装配)、`releaseId`(`r_` + 22 位 base64url 随机值,无时钟无顺序,只比较相等)、`clientProtocol`(小整数兼容窗口);私有构建修订号不进 bundle。
- **release store**:`current.json` + 共享 `assets/` + `releases/<id>/`;安装顺序 assets → shell(原子 rename)→ 指针;同名资源字节不同硬失败;同 release 重装幂等。
- **保留策略**:最近 N 个(默认 5)+ 最近 H 小时(默认 72),current 永不删,任一 release 元数据读不出则整体不回收。
- 生产进程启动时 pin 一个 release,**`resolutionHash` 与 `browserContractHash` 两个都比**,任一不一致拒绝启动:前后端是同一装配的两次构建,不存在「只更新 server 复用旧 web」的合法部署。
- `browserContractHash` 存在的理由:工作区插件版本恒为 0.0.0,page / layout / slot / login 的增删改不会移动 `resolutionHash`;它由描述器现算(排序后的 surface 键做 sha256),构建侧与宿主侧两支 walk 由测试钉住等值。
- **旧标签页协商**:每个 `/api` 请求带 `X-Qualy-Web-Release` 与 `X-Qualy-Client-Protocol`;协议出窗口 → 409 `protocol`;不同 release 则查该 release 自己的元数据:两个 hash 都相同 → **放行(纯代码发布不打断旧 tab)**,任一不同 → 409 `assembly`,查不到 → 409 `release`(且「查不到」不缓存,滚动部署中可能稍后安装);**浏览器永远看不到任何 hash**。
- 浏览器 `ReleaseCoordinator`:标签页可见时(最多每 5 分钟)、bfcache 恢复、`online`、`vite:preloadError`、其他标签页 `BroadcastChannel` 消息时探测;状态 current / update-available(toast)/ reload-required(全屏),**从不自动刷新**;启动看门狗 20s。
- 缓存:`/assets/*` `max-age=31536000, immutable`,缺失返回 404 而不是壳;壳 `no-cache`;brotli 预压缩。

### 10.4 安全响应头与 CSP

- 壳安全头:`X-Frame-Options: DENY`、COOP、nosniff、Referrer-Policy、CORP same-origin。
- **CSP 由插件贡献组装**、在启动屏障冻结一次,内联脚本以 sha256 放行;`QUALY_CSP_MODE` 从 report 切换到 enforce;`POST /csp-reports` 64KiB 上限、一分钟去重、从不记录 `script-sample`。
- CI 三道 CSP 检查:构建产物无字符串求值代码、公开产物不泄露不该有的内容、Chromium 在**强制 CSP** 下打开启动依赖图。
- **CSRF 防护基于 Fetch Metadata**:非安全方法要求 `Sec-Fetch-Site` 为 `same-origin` 或 `none`,**`same-site` 也拒绝**(恰好是 SameSite=Lax 挡不住的兄弟子域场景);无 Fetch Metadata 时校验 `Origin`;都没有(curl、CLI)放行;拒绝 403 `REQUEST_ORIGIN_REFUSED`;公式 WebSocket 握手复用同一检查。评估并否决了签名请求、CSRF token 与 CORS。
- 反向代理参考配置(Caddy、nginx):HSTS、`X-Forwarded-*`、SSE 关闭缓冲。

### 10.5 存储

- `@qualy/plugin-storage` 能力 + 本地 / 腾讯云 COS 两个后端插件;上传走预留(reservation),本地 PUT 由预留而非会话授权;清理任务与存储指标。

---

## 11. 工程质量体系

### 11.1 类型门禁

- `pnpm typecheck` = 根 solution + web 侧工程 + **glob 发现**的插件 client / tests 工程逐一 `tsc --noEmit` + 组件引用检查器(页面组件必须零必需 props),必须零错误。
- tsconfig 分层:浏览器侧不带 Node 类型、加 DOM lib,防 Node 全局类型泄进浏览器代码;测试目录必须在某个 tsconfig 的 include 里(曾整轮类型漂移无人发现)。
- **Effect 语言服务进 tsc**:TS 7 原生 tsc 经 `@effect/tsgo` patch,floating Effect、layer 需求泄漏、scope 违规在 typecheck 即失败;`effect-diagnostics.test.ts` 编译故意写错的 fixture,**诊断没出现就失败**,防止门禁悄悄失效。
- `Effect.run*` 只允许出现在应用入口、CLI 边界、前端统一 API runtime 与测试边界。

### 11.2 仓库级架构门禁(`tools/tests/`)

| 门禁                                  | 守什么                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `plugin-isolation`                    | 每个插件服务端代码**独立编译**(每插件一个 tsconfig 探针,增量、并发);跨插件 import 边具名列出且**只许变短**;apps/web 不得声明插件   |
| `open-world`                          | 外部 scope 第三方插件不改宿主即可 resolve / 收集 / 构建                                                                            |
| `dist-only-plugin`                    | 仅含 `package.json` + `dist/` 的已发布插件可用                                                                                     |
| `effect-api-parity` + `frozen-routes` | 全量路由冻结,与运行时 OpenAPI 深比较                                                                                               |
| `api-paths`                           | 生产源码不得写出 `/api` 前缀字面量                                                                                                 |
| `client-paths`                        | 客户端禁止硬编码内部路由                                                                                                           |
| `error-codes`                         | 错误码全局唯一、归属冻结、与前端翻译交叉校验                                                                                       |
| `catalogs`                            | i18n 全语言完整、无孤儿、命名空间不越界、ICU 可编译                                                                                |
| `browser-contract`                    | 构建侧与宿主侧 surface 集合及 browserContractHash 等值                                                                             |
| `browser-graph`                       | 真实 Vite 打包浏览器依赖图,出现 pg、`node:*`、Buffer 等即失败(起因:`api.ts` → 错误类 → db → pg 四跳后页面 "Buffer is not defined") |
| `test-layers`                         | 只有 database 基础设施可持有 pg 驱动、连接串与建删库;业务插件不得声明 `pg`(此前 6 个套件各自复制了 bootstrap)                      |
| `package-exports`                     | 所有 workspace `exports` 指向存在的文件                                                                                            |
| `observability`                       | 采集配置密钥必须为环境变量引用、镜像钉版本                                                                                         |
| `vendor`                              | vendored 上游源码 lock 与 catalog 一致、不进任何工具链、无人 import                                                                |

### 11.3 测试分层

- **node 套件**:服务、契约、授权与真实 HTTP;`createTestContext()` 按生产路径注册数据库插件并 `migrations: 'apply'`,临时库全生命周期托管,正常路径永不 force,失败清理把所有错误聚合为 AggregateError;**每轮建删约 150 个数据库**,CI 用关闭 fsync / synchronous_commit / full_page_writes 的 Postgres 加速。
- **迁移数据步骤有升级测试**:建旧库形态 → 跑迁移 → 断言(空库重放证明不了 UPDATE / DELETE 分支)。
- **浏览器测试**:Vitest Browser Mode + Playwright Chromium,与生产同一套 StyleX 与插件聚合;harness 是独立包 `@qualy/testkit/browser`(不 import 任何插件);**浏览器测试跟着被测包走**。
- **三层纪律**:定位用 role + name / label(顺带验证可访问性);**业务断言不绑界面文案**,用 `data-testid` + 承载事实的 `data-*`(如 `data-entry-standing`、`data-count`);只有专门的本地化测试断言原文(ICU 复数、插值、切 locale)。
- testkit 只经显式 `/testkit` 子路径暴露,生产源码不得 import;不为白盒测试暴露生产内部。
- **反向验证**:故意回退修复,确认恰好对应的测试失败。

### 11.4 CI(GitHub Actions,三个 job)

1. **主流水线**(pgvector/pg18 服务容器,`QUALY_REQUIRE_POSTGRES_TESTS=1` 防集成测试静默跳过,按 lockfile 缓存 `NODE_COMPILE_CACHE` 省约 2 分钟):
   `resolve --frozen-lockfile` → typecheck → `database check` → `generate` 必须 no-op 且工作区干净 → drop-guard → test(刻意在 build 之前)→ build → 发布 store 校验 → chunk 哨兵 → CSP 构建检查 → 公开产物检查 → `qualy deploy` → **生产 smoke** → 强制 CSP 下 Chromium 启动检查。
2. **browser**:保证冷缓存的浏览器套件。
3. **browser-webkit**:WebKit 冒烟(冷启动与品牌),捕捉被 Chromium 掩盖的引擎时序缺陷。

### 11.5 生产 smoke(`tools/quality/smoke-production.ts`)

经与 `pnpm start` 相同的 runner 真启动生产装配,断言:live / ready、壳安全头与 CSP、`/api/nope` 返回 404 `API_ROUTE_NOT_FOUND` 且带 UUID request id、生产环境 `/api/docs` 与 `/api/openapi.json` 为 404、manifest `no-store`、release 端点与 store 一致、**真实 store 上的四种旧标签页矩阵**、哈希资源 immutable 且 brotli、SIGTERM 与 SIGINT 各自退出 0,以及**篡改任一 hash 进程退出 1 并点名 release**。

### 11.6 当前测试规模(STATUS.md,2026-09-16)

- typecheck:exit 0
- `pnpm test`:247 文件通过 / 3 跳过;**1,781 项通过** / 17 跳过
- `pnpm test:browser`:57 文件 / **418 项**通过
- `pnpm test:browser:webkit`:2 文件 / 14 项通过

---

## 12. 工程方法论(面试可讲的「做事方式」)

- **ADR 驱动**:架构 ADR 0001-0003、领域 ADR 0004-0008、UI 平台 ADR;已裁决偏离逐条记录(综测设计文档 §32 已记录 77 条),未冻结业务问题单列。
- **Beta 依赖的证据纪律**:Effect v4 大量 API 在 `effect/unstable/**`,规定**不凭记忆写 API**,依据是 `repos/` 中与 catalog **同版本**的上游源码,检索顺序 ADR → 项目 pattern → LLMS.md → 上游测试 → dtslint → src。
  - `repos/vendor-lock.json` 记录 packageVersion、tag、**精确 commit** 与剥离后树的 `contentSha256`;`restore` 走 commit 而非可移动的 tag;`check` 在本地改一个字节即变红;vendored 树不进版本库(7,759 个外部文件不淹没 376 个自有文件),并剥离上游仓库中给 AI agent 的配置文件。
- **复杂度必须由已发生的问题证明**:数据层冻结规则 + 触发表,预防性建设被回滚归档。
- **上游优先**:缺陷报给上游并存档草稿,守行为不守补丁,达到零 patch。
- **对抗式审查**:大规模并行审查产出 85 个候选问题,经复现筛选保留 16 个,每个修复附带「移除修复即失败」的测试;无法复现的发现被拒绝。
- **收官纪律**:四条基础设施线(UI 平台、审计、遥测、开发态进程监督)完成后正式关账,没有真实需求不再重构。
- **会话验收**:验收命令真实执行并把输出摘录进 STATUS.md,不许只声称完成。

---

## 13. 面试故事素材(STAR 速查)

| 故事                    | 现象                          | 根因                                                      | 解决                                                                         |
| ----------------------- | ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 冷缓存双 React          | 浏览器套件只在冷缓存时全红    | 生成模块绝对路径不被 Vite 扫描 + pnpm 隔离下 React 多实例 | 相对路径 + scan 孪生文件、测试 root 改到拥有 React 的包、永远冷缓存的 CI job |
| 登录成功却 500          | 一次登录被回滚                | 客户端 36 字符 b3 trace id 写入 `varchar(32)`             | 严格校验 trace id 格式                                                       |
| 停用租户会话仍有效      | 安全级缺陷                    | 会话校验链漏查租户状态                                    | 单条查询覆盖 session / 用户 / 类型 / 租户启用与过期                          |
| CLS 日志 400            | 云端日志导出失败              | CLS 忽略 gzip 编码                                        | curl 最小探针定位,`compression: none`                                        |
| 审计分页丢行            | 翻页边界少数据                | PG 微秒 vs JS 毫秒                                        | 游标用 `occurred_at::text`                                                   |
| cookie 10 分钟失效      | 用户频繁掉登录                | `maxAge` 裸数字按毫秒解释                                 | 使用 Duration                                                                |
| `ltree` 不存在          | 干净环境所有插件组合失败      | 扩展只存在宿主迁移历史里                                  | 插件自带、sha 锁定、幂等的 baseline 片段                                     |
| CI teardown 挂起        | 测试结束进程不退              | 连接池 checkout 未归还                                    | AsyncLocalStorage 连接账本 + `pg_stat_activity` 报告;上游缺陷用 settle 规避  |
| `Buffer is not defined` | 页面崩溃                      | 契约文件四跳后把 pg 拖进浏览器                            | browser-graph 门禁真实打包检查                                               |
| 首屏错误丢失            | RUM 看不到首屏崩溃            | provider 未就绪时已被标记为已上报                         | 带页面快照的待发队列 + 身份去重                                              |
| 启动失败零输出          | grpc 配置下进程 exit 1 无日志 | logger 自身所在 layer 失败                                | logger 之外的第二报告器                                                      |
| 后端重启杀 HMR          | 每次改后端前端状态丢失        | Vite 在后端 scope 内                                      | 独立 Vite 进程 + 分阶段候选进程交接协议                                      |

---

## 14. 数字一览

| 指标                    | 数值                                    |
| ----------------------- | --------------------------------------- |
| 插件                    | 19 个(运行时 16,停用 2,detached 1)      |
| workspace 包            | 约 40+                                  |
| 实体 / 权限码(lock 中)  | 59 / 30                                 |
| 审计动作                | 29                                      |
| node 测试               | 1,781 项通过(247 文件)                  |
| 浏览器测试              | Chromium 418 项(57 文件)+ WebKit 14 项  |
| 每轮临时数据库          | 约 150 个                               |
| 冷启到端口              | 2.0s → 1.3s;后端重载约 1.1s             |
| 应用组合耗时 / 关闭耗时 | 10-13ms / 9ms                           |
| HttpApi 类型检查伸缩    | 500 端点 5.4s(约 6ms/端点)              |
| MikroORM 上游合入       | 6 个缺陷修复,零 patch                   |
| Argon2id                | 64MiB / t=3 / p=4,hash 36ms             |
| 前端启动预算            | 24KB 门禁;RUM SDK 128KB 按需加载        |
| 停用插件后产物          | 113 → 111 个 JS 资源;停用公式插件 → 100 |

---

## 15. 写简历时的注意事项

- **不要写成已交付**:公示快照(初步/最终)、排名与并列裁决、归档打印、ScoreRun、CAS/OIDC 登录、限流(代码中未找到返回 429 的限流器)、邮件、通用任务框架。
- 「腾讯云 RUM sourcemap 上传」对真实平台的复验仍待完成,可写「实现」,慎写「上线」。
- 「对抗式审查」若提及,建议表述为方法(候选发现 → 复现筛选 → 反向验证测试),不必强调规模。
- 数字均来自 STATUS.md / docs 截至 2026-09-16 的记录,面试前可再跑一次测试核对。

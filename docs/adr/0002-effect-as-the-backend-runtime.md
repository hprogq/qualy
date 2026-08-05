# ADR 0002:Effect 作为唯一后端运行时,替换 Cordis

- 状态:**已接受,M1 spike 已通过**(2026-08-05)
- 前提:[ADR 0001](0001-no-online-plugin-install.md)
- 相关:docs/effect-migration.md、docs/assembly-design.md 阶段 2

## 背景

ADR 0001 之后,Cordis 提供而 Effect 不提供的能力(动态 service 出现/消失重协调、插件状态机、
插件级 HMR)全部不再是产品需求。剩下真正需要的运行时能力是:类型化依赖、类型化业务错误、
资源生命周期、数据库事务、结构化并发、后台任务、超时重试、优雅关闭、启动失败传播。

这些 Effect 全部原生提供,而且在类型层面更强:`Effect<A, E, R>` 同时编码成功值、预期错误与所需
服务,而 Cordis 的 `inject` 只是运行时声明,TypeScript 不会把「这个方法依赖哪些服务」编进返回类型。

继续两者并存的代价是具体的:Assembly Core 管一遍静态插件拓扑,Cordis 再管一遍动态插件拓扑;
Cordis 管生命周期,Effect 管业务执行与事务;Cordis 的 service 图与 Effect 的 requirement 图并存。

## 决定

**后端只有一个运行时:Effect。** 迁移完成后仓库里零 `cordis` import。

- `@qualy/assembly` 保持独立,不依赖 Effect:它继续负责解析清单、校验依赖、生成 lock 与产物
- 装配产物从 `cordis.gen.yml` 改为 `runtime.gen.ts`——静态 TypeScript,不是运行时解释 YAML
- 整个应用一个 Effect runtime、一个根 Scope。数据库池、HTTP server、调度器、后台消费者全挂在
  根 Scope 上;SIGTERM 关闭根 Scope 释放全部资源。**不允许每个插件各自建 ManagedRuntime**
- 数据库走 `drizzle-orm/effect-postgres`,查询与事务返回原生 Effect
- 生产源码里的 `Effect.run*` 只允许出现在应用入口、CLI 边界、前端统一 API runtime 与测试边界

## 放行条件(M1 spike)

Effect v4 目前是 beta,本项目要用的模块住在 `effect/unstable/**`,beta 允许破坏它们。因此这条
ADR 在下面这个垂直切片通过之前**不得开始全量迁移**:

- PG18、UUIDv7、ltree、pgvector 与现有自定义 SQL 正常可用
- 事务内 `Effect.fail(DomainError)` 在写入之后确实回滚
- 未识别的 SQL 错误保持 defect 或基础设施错误,不被伪装成业务冲突
- 嵌套事务/savepoint 行为符合预期
- Node 24 下 SIGTERM 能关闭 HTTP server 与数据库池,连接零泄漏
- 数百 endpoint 规模下 typecheck 性能可接受

**结果:全部通过**(实测记录见 docs/effect-migration.md 的 M1a / M1b 两节)。放行。
唯一未覆盖的是完整 cookie 登录流与 HttpApi middleware,推到 M3 一并验。

## 后果

- 阶段 1 的「只有能力图,没有运行时图」裁决必须重开:静态 Layer 图要求依赖最终可构造,不能靠
  运行时延迟激活容忍环。跨插件环(org ↔ rbac)必须真的拆开,拆成 port / coordinator,而不是两个
  插件互相持有对方完整 service
- Server 的动态 contribution 注册/注销改为启动期一次性聚合:先收全部 router、校验错误码冲突、
  构建一次最终 handler、再监听
- route、permission、page 这类静态事实不应变成 Effect service,它们属于 assembly descriptor。
  Effect resource 留给数据库池、HTTP server、缓存、调度器、worker、外部客户端
- **禁止把 Cordis 的每个 Service 机械翻译成一个 Effect service**
- 版本纪律:`effect` 与全部 `@effect/*` 必须同版本,`repos/` 必须同步(见
  docs/agents/effect-source-policy.md)

# ADR 0003:Effect HttpApi 替换 oRPC

- 状态:**已接受;M1b 已验证核心属性,完整放行仍看 M3 切片**(2026-08-05)
- 前提:[ADR 0002](0002-effect-as-the-backend-runtime.md)
- 相关:docs/effect-migration.md

## 背景

只要后端整体迁到 Effect,oRPC 就从「核心 API 系统」退化成「Effect 与 HTTP 之间多出来的一层」。
两者会长期并存两套机制:错误类型(`Effect<A,E,R>` 对 contract error map)、Schema(Effect Schema 对
Zod)、middleware 错误通道、客户端返回值(Effect 对 Promise)、OpenAPI 生成。

当前的错误路径本身就是这层适配的产物:service 抛 DomainError → `apiErrorBoundary` 捕获 → 从
procedure 契约里查 error factory → 抛 ORPCError → 序列化。server 在运行期做这层动态转换,插件则
被要求「禁止手写 errorStatuses、禁止从契约反推错误联合」。这些纪律存在,是因为适配层本身容易写错。

## 决定

**主业务 API 迁到 Effect HttpApi,迁移完成后仓库零 `@orpc` import。**

- `HttpApi` / `HttpApiGroup` / `HttpApiEndpoint` 声明 method、path、path/query/header/body Schema、
  成功响应、多个错误响应及其状态码、middleware
- handler 返回 `Effect<Success, DeclaredError, R>`,不是 `Promise<Success>` 加一个声明不了的 throws
- 领域错误与公开 API 错误仍然是两套类型,但映射是**类型化**的:handler 用 `catchTags` / `mapError`
  把 `LoginFailure` 收口成 endpoint 声明的 `InvalidCredentials`,而不是靠一个不知道 service 会抛
  什么的全局 boundary
- 同一份定义同时产出:HTTP server、OpenAPI、Scalar 文档、类型化前端 client、测试 client
- 内部 worker / 流式任务 / 进程间调用如果出现,才考虑 Effect RPC;主业务 API 不用 RPC

## 不采用 Effect RPC 的理由

RPC 表达的是 `client.iam.updateUser({...})`,不是 `PATCH /tenants/{id}/users/{id}` 加 401/403/404/409
加 OpenAPI security scheme。本项目已经把 API 路径当作**活得比内部重构久的东西**冻结(见
scripts/tests/api-surface.test.ts),并且要考虑企业集成与第三方调用。这些都是 HttpApi 的形态。

## 代价

- **Schema 所有权要迁移**:contract、DTO、前端共享类型、OpenAPI annotation、错误 Schema、
  cursor/date/UUID 编码,现在都是 Zod。不能只换 handler 不换 Schema
- **前端 client 返回 Effect 而不是 Promise**。`Effect<A, E>` 有错误类型而 `Promise<A>` 没有,
  所以不能靠 TanStack Query 自动推断 `TError`,必须建一个 Effect → Query 适配层显式把 `E` 推成
  `TError`,并把 `AbortSignal` 桥接到 Effect 的 interruption。**页面里不允许散落 `Effect.runPromise`**
- HttpApi 在 v4 处于 `effect/unstable/httpapi`,beta 允许破坏它

## 放行条件(M3 切片)

**M1b 已经验掉大部分**:path/query/header/body、错误状态注解、客户端错误类型推导(且是窄的)、
OpenAPI + Scalar、TanStack Query 保留 `E` 并支持取消——全部实测通过,详见 effect-migration.md。

M3 仍要验的是 M1b 没覆盖的:完整 cookie 登录流(设置/读取/失效)、HttpApi middleware 与 principal
注入。先把 ping 迁过去证明整条闭环,通过之后才继续迁业务 API;不通过则保留 oRPC 作为传输边界。

## 后果

- 现有 CLAUDE.md 里整节「插件 API 纪律」(`defineDomainErrors`、`apiErrorBoundary`、
  `walkProcedureContractsSync`、`contribute(ns, router)`)在切换完成时一并作废,由 HttpApi 的
  endpoint 声明取代。**在切换完成之前它们仍然有效**,不得提前拆掉
- `scripts/tests/api-surface.test.ts` 冻结的路径集必须原样保留:换传输层不是改 URL 的借口。
  迁移期间建议同时保留 OpenAPI 快照,防止无意改变 path / method / status / required / error shape

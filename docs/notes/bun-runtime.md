# Bun 运行时可行性验证

## 结论与范围

2026-11-08 在 `spike/bun-web-toolchain` 上，将前一轮的[前端工具链对照](web-performance.md#bun-前端工具链对照2026-11-08)扩大到后端、生产 Web 宿主、CLI、开发子进程和公式沙箱。基线为 `3eff6a272`；运行时为 Node 24.22.1 与 Bun 1.4.4，保持现有 pnpm 安装树、Vitest、Effect、数据库驱动和插件装配。

Qualy 的业务与插件模型能够运行在 Bun 上，不需要重写服务、API、ORM、Query 或 RSC 框架。但当前不能把所有 Node 命令机械地替换为 Bun 并声称行为等价：受控认证出站请求不兼容，格式化 worker 的堆限制不生效，部分观测与验收工具行为也有差异。

可行性验证结束时保持了默认运行时；随后用户批准[仅接入前端开发服务](#正式接入-web-开发服务)。完整后端替换仍需先解决下面的缺口；authoring sandbox 保留 Node，是已有独立进程／镜像边界上的选择，不要求给每个插件增加运行时开关。没有更换包管理器、测试框架、数据库驱动或服务器适配器，也没有推送或部署。

## 验证方法

数据库验证全部通过 `createTestContext` 在本地 5433 测试实例创建独立库。未读取开发 `.env`，未访问 5432 开发库。生产冒烟的账号与记录来自临时 seed 和业务 API；测试完成或失败后停止自己的子进程，再删除自己的测试库。

Vitest 由指定运行时直接执行 `node_modules/vitest/vitest.mjs`，临时 setup 断言测试 worker 的实际运行时，避免把“Bun 调用 Node”计作兼容通过。既有测试里显式启动 `node` 的子进程不计为 Bun 证据。临时驱动和原始报告位于 `/private/tmp/qualy-bun-runtime`，不作为长期测试入口。

生产冒烟由 Bun 执行 `startQualyServer`，其 `process.execPath` 子进程也是 Bun；使用当前已安装的生产 Web release。前一轮 Bun 构建的 `apps/web/dist-rsc` 另用于 RSC 验收。浏览器可见的生产冒烟始终使用 `127.0.0.1:5186`；套件使用其既有内部端口。

这些后端检查用于判断兼容性，期间存在并行回归，不构成 Node／Bun 的后端性能对照。前端性能数据仍以前一轮受控测量为准。

## 实际结果

| 边界                                 | 结果与限制                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP、会话、文档身份、事务与实时通道 | 首批 56 项中 52 项通过，4 项失败落在 Undici 遥测传输；下述集中适配后，对应遥测组通过                                                                                     |
| 遥测与请求取消                       | `telemetry`、数据库 tracing、`client-closed`、`api-kit/request` 共 54 项，Node 与 Bun 各全部通过                                                                         |
| 沙箱、QuickJS、RPC 与 LSP            | 8 个文件、76 项在 Bun 下通过，包括执行、硬超时后恢复、Unix socket、真实 LSP 子进程生命周期；不等于 worker 堆保护有效                                                     |
| 宿主与子进程生命周期                 | `dev-child`、`dev-service-runner`、`supervised-handoff`、`headless-runtime`、`child-liveness`、`response-headers`、`runtime-memo`、`effect-shell` 共 29 项通过           |
| 开发服务与后端替换                   | `web-survives-backend` 的两项通过；实际 Bun service runner 与后端子进程通信，后端替换后 Vite 继续运行。未运行完整 supervisor 文件监听／故障恢复矩阵                      |
| 基础与综测业务、数据库回归           | 两组覆盖 221 个文件：1,717 项通过、16 项失败、3 项跳过、8 项因提前停止未执行。失败集中在 CAS／OIDC／GitHub／outbound 和一项默认 locale 测试。不能称为全仓通过            |
| 失败项的 Node 对照                   | CAS、OIDC、outbound 共 30 项通过；GitHub 与 RBAC 装配共 9 项通过                                                                                                         |
| 实际 CLI                             | Bun 子进程通过 `list`、`resolve --frozen-lockfile`、`assessment audit-scoring` 和禁止运行时 apply 的拒绝检查。使用独立产品目录、已有编译消息及临时库，不读取开发环境文件 |
| 实际生产宿主                         | Bun 启动、readiness、登录 HTML、登录 API、授权 manifest、会话读取、创建批次、名册 HTML 正文、身份拒绝均通过；真实 Chromium 在该生产宿主完成登录与退出                    |
| 完整 RSC 验收                        | 同一 Bun 构建产物在 Node 宿主全部 206 项通过；全部由 Bun 驱动时，退出测试中的代理请求返回 415，未完成。直接生产宿主的退出通过，不能据此把代理路径也记为通过              |

业务回归首次使用 `--bail=10`，157 个文件没有实际执行；随后只补跑这部分文件。统计来自实际 assertion，未把第一份 JSON 中没有 assertion 的文件算作通过。已完成的失败用例没有被删除或放宽。

## 一个已落实的集中修复

`packages/core/telemetry/src/sdk.ts` 原先使用 `NodeHttpClient.layerUndici`。Bun 下触发 `dispatcher.destroy is not a function`，影响 OTLP 导出和资源释放。

现在统一使用 Effect 官方 `FetchHttpClient.layer`，Node 与 Bun 走同一条实现，没有运行时判断。两个独立搭建 OTLP exporter 的测试 fixture 同步使用该传输，断言保持不变；删除 telemetry 已不需要的 `@effect/platform-node` 依赖，lock 由 pnpm 生成。

依据是实际读取的同版本源码：

- `repos/effect/packages/effect/src/http/FetchHttpClient.ts`：官方 Fetch 实现、取消信号和响应体作用域；`layer` 为公开接入点。
- `repos/effect/packages/platform/node/src/NodeHttpClient.ts`：Undici dispatcher 的释放路径。
- `repos/effect/packages/platform/bun/src/BunHttpClient.ts`：Bun 的 HTTP 客户端同样复用 Fetch 实现。

## 仍阻止完整等价迁移的差异

### 认证出站请求不能直接改成普通 fetch

`packages/plugins/base/auth/src/server/outbound.ts` 会先解析并检查所有 IP，再通过 Undici Agent 的自定义 lookup 固定连接地址，同时保持原 Host／TLS 名称。这是 DNS 重绑定防护的一部分。

Bun 的 Undici 兼容路径不能完成当前实现，实测包括 `agent.close is not a function`，安全出站测试 5 项失败，并影响 CAS、OIDC、GitHub 登录。Node 的对应组全部通过。

所需工作是更换这一个平台传输实现并保留全部策略：解析一次、所有地址检查、连接固定、TLS 名称、禁止自动重定向、响应大小、超时、取消与释放。不是改业务插件，但也不能为了通过测试删掉 Agent，换成会重新解析域名的普通 fetch。当前没有修改这条实现。

### Worker 堆上限在 Bun 下没有保护效果

`apps/sandbox-authoring/src/lsp/formatter.ts` 使用 `worker_threads.Worker` 的 `resourceLimits.maxOldGenerationSizeMb`。独立有界探针给 worker 设置 16 MiB，随后分段创建数组：Node 终止并报告 `ERR_WORKER_OUT_OF_MEMORY`；Bun 完成 1,200 万个元素的分配，没有执行该堆限制。

这与 [Bun 官方兼容性说明](https://bun.com/docs/runtime/nodejs-compat#nodeworker_threads)一致。QuickJS 自己的内存／栈／CPU 限制仍是另一层，其现有测试通过不能证明 formatter 的宿主堆保护也通过。保留 authoring sandbox 的 Node 进程是成本最小的方案；若要求纯 Bun，需要等价隔离或上游支持，不能静默削弱现有保护。

### 观测与工具还需要明确适配

- `packages/core/telemetry/src/resource.ts` 默认标记 `nodejs` 和 Node 版本；完整支持 Bun 时需报告真实运行时。
- `runtime-metrics.ts` 使用 `performance.eventLoopUtilization()`。Node 忙等／等待探针约为 0.59，Bun 为 0；[官方文档](https://bun.com/docs/runtime/nodejs-compat#nodeperf_hooks)也明确该 API 返回占位零值。不能把它当真实负载导出。当前未改变指标政策。
- RBAC 装配测试要求子进程在 `LC_ALL=da_DK.UTF-8` 下确实采用 `da-DK`；Bun 返回 `en-US`。这是环境 locale 探针失败，不能直接推导权限顺序已错误，也不能跳过 fixture 前提来宣称验证成立。产品的显式文档 locale 是另一条路径。
- Bun 驱动完整 RSC 验收时，测试代理转发的退出请求返回 415；Node 对照和 Bun 直接生产宿主退出正常。已缩小到集成路径，但没有证明具体原因，不归咎于业务退出实现，也未加入兼容分支。

## 迁移成本与下一步

前端工具进程的收益已有测量，接入成本主要在现有 dev service 的运行时选择、版本固定和日常回归；无需改变 surface 声明、collector 或插件归属。

主业务后端的业务代码迁移成本低，平台适配与等价验收成本中等。受控认证传输是一个集中边界；遥测的真实身份、指标与工具链政策也应集中处理。没有后端吞吐、延迟或内存收益数据，不能把前端编译收益推广到数据库业务。

完全不保留 Node 的成本目前不确定，关键在 formatter 的资源隔离，不是 TypeScript 能否启动。因此先保留 Node 后端／沙箱与 pnpm，不为了形式统一重写安全边界或加入大量运行时分支。若以后继续评估后端，先解决 outbound 并跑原安全组，再处理指标与完整 RSC 验收，最后才讨论发布镜像和默认命令。

本轮完整类型检查、改动文件的格式及类型 lint 通过；Node／Bun 遥测回归各 54 项通过。未执行全仓 Node、全量覆盖率、WebKit、Linux 镜像或部署验收，未访问真实外部认证服务、发送真实邮件或修改发布环境。

## 正式接入 Web 开发服务

2026-11-08，采用范围限定为 Node 监督者启动 Bun 的 Vite/RSC/SSR 开发服务。Node API、沙箱、CLI、测试驱动、生产构建及 pnpm 不变。使用方式、环境来源和显式 Node 回退以[开发进程说明](../development/runtime.md#开发服务运行时)为准；版本仍只在 `mise.toml` 固定。

`Dev.service` 增加可选的 `runtime` 声明，未声明时默认 Node。只有 Web 插件声明 Bun；监督者不根据插件名判断运行时，也不改全局 PATH 或 alias。运行时参与开发拓扑比较，避免声明改变后继续沿用旧服务。缺少可执行文件的 spawn 错误现在也会结束等待，不能挂住监督者或静默回退。

前端收益沿用已经完成的受控对照：新进程到首份登录 HTML 从 Node 的 8.31–8.62 s 降为 Bun 的 4.78–5.10 s；首次名单 HTML 首字节从 1.77–1.81 s 降为 0.805–0.813 s。方法、缓存条件、HMR 和构建数据见[前端测量](web-performance.md#bun-前端工具链对照2026-11-08)，不是本次混合链路的重新计时结果。

混合链路由 Node 驱动，使用解析出的真实 Web 开发服务声明，通过正式 `forkService` 启动 Bun；测试包装仅覆盖 Vite 的公开 `createServer` 选项以固定预览端口 5186 和临时缓存，未替换代理或渲染实现。Node API 位于隔离测试库，浏览器为独立 Chromium。14 项检查全部通过：

- 登录 POST、JSON 业务写入、真实浏览器登录和退出均经过 Bun Vite 代理；退出为 200，没有复现此前全部使用 Bun 的验收代理中的 415。
- 并发匿名／已登录、英文／中文文档保持各自的身份与 locale。
- 真实批次 WebSocket 能经代理完成升级；SSR 响应可读取分块并取消，后续请求继续正常。
- 名单 Client Component 与 StyleX 更新后，原搜索框 DOM 和输入保留，新的 gap 样式实际生效。
- 名单 Server Component 热更新自动刷新当前内容，原搜索框 DOM 和输入也保留。
- Node 后端停止、重新启动后，Bun Vite PID 不变，API 代理恢复；浏览器没有水合或运行时错误。

同时记录一项现有局限：修改批次列表的页面入口并调整其 StyleX 时会重建输入；相同改动在 Node 对照下也出现，不能据此宣称所有 RSC 页面入口的 HMR 都保持状态。本次不改页面边界或加入兼容分支。冷开发页面的交互验收等待客户端模块加载完成，未将 SSR 表单在水合前的可交互性作为已通过项。

保留的回归覆盖 `dev-runtime`、`dev-child`、`dev-service-runner`、`web-survives-backend` 与 plugin-kit 的服务收集。合计 19 项通过，包含实际 Bun／Node 执行身份、环境不被自动重读、父通道关闭后释放、缺失 Bun 时等待结束、显式 Node 回退、无请求体退出代理，以及后端替换。CI 的 Node 测试任务从 `mise.toml` 读取 Bun 版本供这些回归使用，不改构建和测试驱动运行时。

混合链路原始结果位于 `/private/tmp/qualy-bun-adoption`。临时 HMR 源码修改已恢复，测试服务和临时库已清理。完整类型检查、改动文件格式与类型 lint 通过；未重新运行全产品业务、覆盖率、WebKit、Linux 镜像、完整监督者文件监听／故障恢复矩阵，也未推送或部署。

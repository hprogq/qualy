# Qualy Development Supervisor & Staged Backend Reload

## 设计变更文档

**状态**：设计冻结，可进入 Phase 0/1 实现验证  
**目标分支**：以当前开发分支实际源码为准；实施前先核对本文列出的路径和现状  
**适用范围**：Qualy monorepo 的开发态进程生命周期、Backend 自动重载、Web/Vite 开发服务拆分  
**不改变**：生产态 Effect Runtime 装配模型、插件 Runtime Assembly、Browser Assembly 的所有权、ADR 中“Effect 是唯一后端 Runtime”的结论

---

## 0. 结论摘要

当前 `pnpm dev` 将 Vite 作为 Backend Effect Runtime 的一个资源挂在同一个 Node HTTP Server 上。这使任何 Backend 重启都会同时销毁 Vite，导致前端 HMR、React Fast Refresh、浏览器本地状态、Query cache 和 HMR WebSocket 一并丢失。

本次变更不实现“后端模块 HMR”，也不在进程内替换 Effect Layer、HTTP Route 或插件 Service。最终模型是：

- **Effect**：继续负责单个 Backend 进程内部的资源生命周期。
- **Vite**：继续负责 Browser module graph 与 HMR。
- **`@qualy/assembly`**：继续负责 Runtime Assembly。
- **`@qualy/web-build`**：继续负责 Browser Assembly，仍服务 `vite dev`、`vite build` 和 browser tests。
- **Dev Host**：新增的长期进程，只负责文件监听、候选进程 staging、进程切换和 shutdown。
- **Dev Service**：插件可通过 `external` extension point 声明开发态辅助进程；Web 插件以此声明独立 Vite Dev Service。
- **Backend reload**：使用 **staged candidate process**，不是 `node --watch`。
- **候选进程切换协议**：`prepare -> PREPARED -> commit -> ACCEPT -> acquire`。
- **旧 Backend**：在新 Candidate 完成纯装配前继续服务；Candidate PREPARE 失败时旧 Backend 不受影响。
- **资源边界**：Candidate 在收到 `ACCEPT` 之前必须 resource-cold；收到 `ACCEPT` 以后才允许进入 `Layer.launch()`、migration、DB、scheduler、HTTP bind 等有资源阶段。
- **不可回滚边界**：一旦 handoff commit 已开始并停止旧进程，不再尝试 rollback。
- **普通 Backend 修改**：只切 Backend，Vite 进程保持不动。
- **结构性修改**：stage 新 Backend 与新 Dev Services，整组切换。
- **浏览器源码修改**：仍由 Vite HMR 处理，Dev Host 不参与。

这是一个 **process supervisor**，不是 HMR runtime，也不是新的插件 Runtime。

---

# 1. 背景与当前问题

当前开发入口大致为：

```text
pnpm dev
  -> node --env-file-if-exists=.env --import tsx apps/server/src/run.ts development
  -> apps/server/src/main.ts
  -> verifyAssembly()
  -> makeApplication()
  -> Layer.launch()
  -> Web plugin development route
  -> import('vite')
  -> vite.createServer({ middlewareMode, shared Node http.Server })
```

当前架构把 Vite 生命周期放在 Backend Effect Scope 内。

因此：

```text
Backend source changes
        ↓
Backend process restart
        ↓
Effect root Scope closes
        ↓
Vite closes
        ↓
HMR websocket disappears
        ↓
Browser reload / local UI state loss
```

这不是 Vite 的问题，也不是 Effect 缺少 HMR 功能的问题，而是 **两个不同生命周期被错误绑定**：

- Backend Runtime 生命周期；
- Browser Dev Server 生命周期。

本次设计的核心目标是拆开这两个生命周期，而不是为 Effect 增加动态代码替换能力。

---

# 2. 设计目标

## 2.1 必须实现

1. 修改普通 Backend implementation 时自动重载 Backend。
2. Backend reload 不重启 Vite。
3. Browser HMR / React Fast Refresh 在 Backend reload 时持续可用。
4. Backend Candidate 存在语法、descriptor、Assembly composition 等 PREPARE 阶段错误时，当前 Backend 继续运行。
5. 快速连续保存不造成 restart storm。
6. 不在 migration / Runtime resource acquisition 中途为了追求最新源码而强杀 Backend。
7. Web 插件仍然完全可移除：
   - 没有 Web 插件时，不启动 Vite；
   - Server Host 不硬编码 `vite` 或 React。
8. Dev Service 必须是插件外部贡献，不进入 Runtime Layer graph。
9. Headless development 是正常模式。
10. Production 仍然是一个完整 Effect Runtime，不拆成微服务。
11. Windows / macOS / Linux 下 supervised shutdown 语义一致。
12. `QUALY_CONFIG`、`.env`、Backend 与 Web Dev Service 使用同一轮环境快照。
13. 保持 Browser Assembly 的唯一实现路径，不为 Dev Host 创建第二套 Browser Assembly。

## 2.2 尽量实现

1. Candidate PREPARE 失败时保持 last-known-good active process。
2. Dev Service 自身修改也采用 staged replacement。
3. linked/workspace 外部插件可被开发 watcher 发现。
4. Backend 暂时 unavailable 时，前端 read queries 自动短暂恢复。
5. 结构切换时尽量在停止旧世界之前完成新世界的无资源验证。

---

# 3. 明确不做

以下内容不属于本设计，且不得在实现过程中“顺便”引入：

- Cordis 恢复。
- Backend `node --watch`。
- Effect Layer 热替换。
- `LayerRef`/`ScopedRef` 驱动源码 HMR。
- HTTP Route 动态 unregister / replace。
- 自定义 ESM loader 或 module cache busting。
- 在线插件 install / uninstall。
- 两个完整 Backend Runtime 同时运行。
- blue-green Backend。
- Dev Host HTTP gateway。
- Dev Host 代理业务 HTTP。
- Dev Host 管理 Browser Assembly。
- 将完整 `Resolution` 序列化跨进程。
- Generation JSON / RuntimePlan / 第二套 Assembly 描述。
- Development dependency DAG / health dependency DAG。
- 通用 PM2/Kubernetes 式 process manager DSL。
- Dev Service 任意 shell command。
- 自动 rollback 已经 commit 的 handoff。
- 为了 shared contract 修改实现 filesystem snapshot / MVCC。
- 让 `resolutionHash` 或 `manifestHash` 驱动 development lifecycle。
- 让 Dev Host 理解 `Ui.page`、i18n、React、Vite 组件语义。

---

# 4. 最终架构

```text
                               pnpm dev
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │      Dev Host       │
                       │  long-lived process │
                       │  single lifecycle   │
                       │      authority      │
                       └──────────┬──────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
                 ▼                                 ▼
        Backend process                    Dev Service processes
        Effect Runtime                     plugin-declared
                 │                                 │
                 │                                 └── Web Dev Service
                 │                                      │
                 │                                      ▼
                 │                                     Vite
                 │                                      │
                 │                             Browser HMR / assets
                 │                                      │
                 └──────── HTTP API ◀──── /api proxy ───┘
```

Browser 开发入口：

```text
Browser
   │
   ▼
Vite :5173
   ├─ HTML
   ├─ JS/CSS
   ├─ React Fast Refresh
   ├─ HMR websocket
   └─ /api/**, /health/**
             │
             ▼
        Backend :3000
```

Backend 重载不会影响 Vite 自己的 HTTP/HMR 连接。

---

# 5. 三个解释器模型

同一个 `Plugin.define(...)` descriptor 可以被三个不同 Host/Interpreter 读取：

```text
                         Plugin Descriptor
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
      Runtime Assembler      Web Build          Dev Host
             │                  │                  │
           Effect              Vite            Processes
```

职责：

### Runtime Assembler

负责：

- Plugin services；
- Runtime Layer；
- API groups / handlers；
- prepare/afterServices extension points；
- Effect service graph。

### Web Build

由 `@qualy/web-build` 负责：

- Browser component registry；
- page/layout/slot；
- i18n browser aggregate；
- browser modules；
- Vite dev；
- Vite production build；
- browser test runner。

**不得迁移到 Dev Host。**

### Dev Host

只解释：

- `Dev.service(...)` external contributions；
- 文件变化；
- child process lifecycle。

这符合现有 `ExtensionPoint phase: 'external'` 的设计。

---

# 6. Dev Service 插件协议

## 6.1 声明位置

在 `@qualy/plugin-kit/dev` 增加一个 external extension point。

概念 API：

```ts
export interface DevServiceContribution {
  readonly id: string
  /**
   * Plugin package export subpath.
   * Example: "./dev" resolves as "@qualy/plugin-web/dev".
   */
  readonly module: `./${string}`
}

export const DevServices = ExtensionPoint.make<DevServiceContribution>('@qualy/plugin-kit/dev', {
  phase: 'external',
})

export const Dev = {
  service: (service: DevServiceContribution): PluginFeature =>
    Plugin.contribute(DevServices, service),
}
```

Web plugin：

```ts
Plugin.define(
  '@qualy/plugin-web',
  { config },

  Api.routes(...),

  Dev.service({
    id: 'web',
    module: './dev',
  }),
)
```

## 6.2 为什么使用 package export subpath

不要声明：

```ts
entry: './src/dev/index.ts'
```

使用：

```ts
module: './dev'
```

插件 `package.json`：

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./dev": "./src/dev/index.ts"
  }
}
```

Backend 在 Assembly PREPARE 中，通过当前 `PackageResolver` 从真正的 Host dependency graph 解析：

```text
@qualy/plugin-web/dev
        ↓
resolveModuleUrl(...)
        ↓
file:///real/path/.../src/dev/index.ts
```

Dev Host 不负责 package resolution。

---

# 7. DevServiceSpec

Backend 收集 active Runtime plugins 的 Dev Service contribution，生成纯数据：

```ts
interface DevServiceSpec {
  readonly key: string
  readonly pluginId: string
  readonly id: string

  /** resolved absolute file URL */
  readonly moduleUrl: string

  /**
   * Raw JSON-like plugin config snapshot from this resolved assembly.
   * Host does not interpret it.
   */
  readonly config: unknown

  readonly manifestDir: string

  /**
   * Real package root, for watch-root discovery.
   */
  readonly pluginRoot: string
}
```

稳定 key：

```text
${pluginId}:${serviceId}
```

例如：

```text
@qualy/plugin-web:web
```

只从：

```text
resolution.runtimePlugins
```

收集 Dev Services。

**disabled / detached plugin 不得启动 Dev Service。**

## 7.1 约束

- 同一个 plugin 内 service `id` 唯一。
- 最终 key 全局唯一。
- `module` 必须是合法 package export subpath。
- resolved module 必须存在。
- `config` 必须是 manifest 已有的 JSON-like 数据。
- Host 不 decode 插件 config。
- Host 不将 config 放入 argv 或日志。
- config 只通过 IPC 发送到该插件自己的 Dev Service runner。

---

# 8. Dev Service module API

Dev Service 显式分为两个阶段：

```ts
interface DevServiceContext {
  readonly plugin: {
    readonly id: string
    readonly config: unknown
    readonly manifestDir: string
  }

  readonly runtime: {
    /**
     * Internal loopback origin of the Backend Host.
     * Example: http://127.0.0.1:3000
     */
    readonly origin: string
  }
}

interface DevServiceModule<Prepared = void, E = unknown> {
  /**
   * Resource-cold validation/preparation.
   *
   * MUST NOT:
   * - bind ports
   * - start watchers
   * - connect to DB
   * - start timers/background loops
   * - mutate persistent product state
   * - rewrite active-world generated files
   */
  readonly prepare: (context: DevServiceContext) => Effect.Effect<Prepared, E>

  /**
   * Acquires the actual development resource.
   *
   * The returned scoped effect completes once acquisition is ready.
   * The Scope remains open until shutdown.
   */
  readonly acquire: (
    prepared: Prepared,
    context: DevServiceContext,
  ) => Effect.Effect<void, E, Scope.Scope>
}
```

简单 Dev Service：

```ts
prepare: () => Effect.void
```

Web Dev Service 则可在 `prepare()` 做：

- Web manifest config decode；
- `sourceRoot` 校验；
- Browser Assembly 纯收集；
- component/i18n/browser-module declaration 验证；
- aggregate source 生成到内存。

但不得：

- `vite.createServer()`；
- `listen()`；
- 写 `apps/web/.qualy/*`；
- 改 active Vite 的任何输入。

`acquire()` 才允许真正启动 Vite。

---

# 9. Staged Candidate 模型

这是整个设计的核心。

## 9.1 Active 与 Candidate

Dev Host 维护：

```ts
interface ActiveWorld {
  backend: ManagedBackend | null
  topology: readonly DevServiceSpec[]
  services: Map<string, ManagedService>
}

interface CandidateWorld {
  kind: 'backend' | 'service' | 'session'

  backend?: CandidateBackend
  topology?: readonly DevServiceSpec[]
  services?: Map<string, CandidateService>

  committed: boolean
}
```

不要引入：

- assembly epoch；
- runtime revision；
- generation hash；
- source revision。

Correctness identity 使用实际 child process handle。

可额外生成：

```text
backend#12
web#7
```

只用于日志，不用于状态判断。

---

# 10. Backend Candidate 启动栅栏

Backend 启动分成：

```text
PREPARING
    │
    ▼
PREPARED
    │
    │ Host ACCEPT
    ▼
STARTING
    │
    ▼
RUNNING
```

## 10.1 PREPARING

完成：

1. manifest resolution；
2. `verifyAssembly()`；
3. descriptor import；
4. capability / resolution；
5. application Layer composition；
6. Dev topology collection。

目标代码结构：

```ts
const resolution = await verifyAssembly(...)
const application = composeApplication(resolution, logging)
const topology = collectDevServices(resolution)

await supervisedPrepareFence(topology)

NodeRuntime.runMain(
  Layer.launch(application) ...
)
```

建议将当前 `makeApplication()` 重命名并改造成明确的纯 composition 函数，例如：

```ts
composeApplication(...)
```

如果实现核对后其中仍有真正异步纯工作，可以保持 async，但必须确认：

> 调用它不会 acquire Runtime resource。

## 10.2 PREPARED

Backend 向 Host：

```ts
{
  protocol: 1,
  type: 'prepared',
  role: 'backend',
  topology
}
```

此时 Candidate 必须 **resource-cold**。

Host 可以：

- `ACCEPT`；
- `REJECT`；
- 因为新的源码保存而直接淘汰 Candidate。

PREPARED 等待 Host 时不需要自动超时。

父 IPC disconnect 即 lifetime lease：

```text
parent disconnected
→ Candidate exits
```

可以在长时间等待时输出 warning，但不要自动进入 Runtime。

## 10.3 ACCEPT

Host：

```ts
{
  protocol: 1,
  type: 'accept'
}
```

之后 Backend 进入：

```text
Layer.launch(application)
```

此后允许：

- config Layer build；
- migration；
- DB；
- ORM；
- scheduler；
- boot hooks；
- HTTP bind；
- server routes。

这是 **resource ownership commit point**。

## 10.4 STARTING

一旦 ACCEPT：

- 不允许因为新保存自动 hard-kill；
- 可以在旁边 PREPARE 下一 Candidate；
- 当前 STARTING 必须自然：
  - 成功进入 RUNNING；
  - 或自己失败退出。

原因：当前 development boot 可能正在执行 migration。

## 10.5 RUNNING

Dev Host 只在 STARTING 阶段 probe：

```text
GET /health/live
```

得到 200 后：

```text
STARTING -> RUNNING
```

不要持续 health-monitor。

绝不因为：

```text
/health/ready = 503
```

自动 restart Backend。

---

# 11. PREPARED 的严格定义

PREPARED 不表示：

- DB 一定可连接；
- plugin config Layer 一定可 build；
- migration 一定成功；
- HTTP 一定可 bind；
- Backend 一定最终启动。

PREPARED 只表示：

> 当前进程已经完成所有被允许发生在资源 acquisition 之前的 module loading、Assembly resolution、application composition 和 development topology resolution。

V1 接受：

```text
bad plugin config
→ PREPARED
→ handoff
→ ACCEPT
→ Layer.launch
→ startup failure
```

不要为了覆盖这一失败类型，在 V1 中重复 build config Layer 或重构整个 ConfigChannel。

---

# 12. Runtime local dynamic import 约束

Staged Candidate 不是 filesystem snapshot。

因此必须新增一条 architecture invariant：

> Serving Runtime 中属于本地 mutable application source 的代码，必须在 PREPARE 阶段进入正常静态 module graph。ACCEPT 后不得首次通过 relative dynamic import 加载本地 Runtime implementation。

否则可能出现：

```text
PREPARED 使用 source B
保存 source C
ACCEPT
Runtime dynamic import('./foo.ts')
→ 实际加载 C
```

导致同一个进程混合两个源码 generation。

允许 lazy import 的典型情况：

- CLI command module；
- capability work module；
- stable external npm dependency；
- 明确不属于 serving Runtime 的工具模块。

现有类似：

```ts
Plugin.capability('permissions', () => import('./assembly/index.ts'))
Cli.command({ load: () => import(...) })
```

可以保留，因为这些并非 serving Runtime acquisition。

实施时增加一次源码审计/quality gate，发现真正的 server-local runtime lazy import 后改成静态 import。

---

# 13. Handoff Commit Point

Candidate 在 STAGING 阶段可以被更新版本淘汰。

但一旦开始 handoff：

```text
candidate.committed = true
```

就必须 pin。

之后即使再次保存：

- 不 REJECT pinned Candidate；
- 只记录需要下一轮 staging。

原因：

```text
A active
B PREPARED

开始停止 A
此时保存 C

如果丢 B
而 C 有错误
→ A 已停
→ B 被自己丢掉
→ C 又不可用
```

所以：

> **commit 之后，可用的 Candidate 优先于最新源码。**

---

# 14. Backend-only replacement

普通 server implementation 修改：

```text
Active:
Backend A
Vite W

Stage:
Backend Candidate B
```

流程：

```text
A continues serving
        │
        ├── B PREPARING
        │       │
        │       └── failure
        │             ↓
        │        keep A + W
        │
        └── B PREPARED
                │
                ▼
             COMMIT
                │
                ├── pin B
                ├── request A shutdown
                └── W untouched
                        │
                   wait A EXIT
                        │
                        ▼
                    ACCEPT B
                        │
                     STARTING
                        │
                     RUNNING
```

必须等待旧 Backend **整个 child process exit**，不能只等端口释放。

否则旧进程可能仍在：

- pool close；
- scheduler cleanup；
- telemetry flush；
- Effect finalizer。

---

# 15. Rapid save

## 15.1 Candidate 仍在 PREPARING/PREPARED，尚未 commit

```text
save B
→ candidate B

save C
→ kill/reject B
→ candidate C

save D
→ kill/reject C
→ candidate D
```

PREPARE 阶段 resource-cold，因此可以 aggressive latest-wins。

## 15.2 已 commit

```text
A shutdown started
B pinned
save C
```

B 不再替换。

```text
A exits
→ ACCEPT B
```

B RUNNING 后再 stage C。

允许：

```text
A -> B -> C
```

不允许为了少一次 reload 把已准备好的 B 丢掉。

## 15.3 Active Backend 正在 STARTING

```text
A STARTING
save B
→ B may PREPARE in parallel
```

如果 B PREPARED：

```text
wait
```

不能中断 A。

若 A：

- 成功 RUNNING → 再 handoff 到 B；
- startup failure 并退出 → 直接 ACCEPT B。

不要自动 hard-kill STARTING Backend。

---

# 16. Dev Service staged replacement

Dev Service runner 同样采用：

```text
import module
→ prepare()
→ PREPARED
→ ACCEPT
→ acquire()
→ READY
→ wait shutdown
```

## 16.1 Scope 结构

错误示例：

```ts
Effect.scoped(start(context))
// start return 后 Scope 立即关闭
```

正确结构：

```ts
Effect.scoped(
  Effect.gen(function* () {
    const prepared = yield* module.prepare(context)

    yield* reportPrepared
    yield* awaitAccept

    yield* module.acquire(prepared, context)

    yield* reportReady
    yield* awaitShutdown
  }),
)
```

`acquire()` 内的 `Effect.acquireRelease(...)` 资源保持到整个 runner Scope 关闭。

## 16.2 Dev Service 不得承担产品持久状态

Dev Service 允许：

- Vite；
- dev watcher；
- local inspector；
- development emulator；
- transient dev artifacts。

不得承担：

- DB migrations；
- 业务 scheduler；
- 产品持久数据修改；
- Runtime business worker。

因此 Dev Service shutdown deadline 可以比 Backend 更短。

---

# 17. Full Session Replacement

以下变化默认触发 full session stage：

- `qualy.yml`；
- Assembly lock；
- `.env`；
- plugin descriptor entry；
- workspace/package metadata；
- plugin shared declaration/config code；
- core assembly/plugin infrastructure；
- contracts that may change browser/server compatibility；
- other low-frequency structural inputs。

流程：

```text
Active Backend + Active Dev Services
                 │
                 ▼
        Backend Candidate PREPARE
                 │
                 ▼
            DevTopology
                 │
                 ▼
       Stage candidate Dev Services
                 │
                 ▼
     all required candidates PREPARED
                 │
                 ▼
               COMMIT
                 │
                 ├── pin all candidates
                 ├── stop all active Dev Services
                 └── stop active Backend
                         │
                    wait ALL EXIT
                         │
                         ▼
             ACCEPT new Backend/services
                         │
                         ▼
              acquire in parallel
```

full session commit 时不做 dependency graph。

---

# 18. Initial Boot 的特殊规则

没有 active world 时，不追求“整组全部 PREPARED 才能启动”。

例如：

```text
Backend candidate PREPARED
Web candidate PREPARE FAILED
```

应该：

```text
Backend ACCEPT -> run
Web -> failed
```

而不是因为 Vite 配置错误让 API 也无法开发。

有 active world 的 replacement 才要求：

> Candidate session 在 commit 前完成所需 Dev Services 的 PREPARE。

这是 deliberate asymmetry：

- **有旧世界**：优先保持完整 last-known-good。
- **无旧世界**：优先恢复任何可用部分。

---

# 19. Dev Service topology 变化兜底

文件分类不是 correctness authority。

普通 Backend-only Candidate PREPARED 后，Host 比较：

```text
candidate topology
vs
active topology
```

如果意外不同：

```text
backend-only candidate
→ promote to session candidate
```

先 stage 对应 Dev Services，再 commit。

因此即使某个开发者把会改变 Dev Service 声明的源码放进了错误目录，fresh Backend resolution 仍然能自我纠正。

比较的是纯 `DevServiceSpec`，不是 `resolutionHash`。

---

# 20. 文件监听

建议使用 **chokidar**，而不是自己实现跨平台 `fs.watch` normalization。

理由：

- atomic save；
- rename；
- editor temp files；
- recursive add/remove；
- ignore patterns；
- macOS/Windows/Linux 差异。

不要开启高延迟的 `awaitWriteFinish` 作为默认。

采用：

```text
chokidar normalized events
→ short debounce/batch
→ classify changed paths
→ one highest-level action
```

建议 batch 窗口约 100–250 ms，实际由 spike 调整。

---

# 21. Watch Classification

V1 使用保守规则，不构建完整 Node import graph。

## 21.1 Plugin package

约定目录：

```text
src/client/**
→ Browser implementation

src/server/**
→ Backend implementation

src/dev/**
→ Dev Service implementation

src/index.ts / descriptor entry
→ structural

其他 src/**
→ shared / structural
```

行为：

| 输入                      | 动作                            |
| ------------------------- | ------------------------------- |
| `src/client/**`           | Dev Host ignore，Vite HMR       |
| `src/server/**`           | stage Backend only              |
| `src/dev/**`              | stage corresponding Dev Service |
| descriptor entry          | full session stage              |
| plugin 其他 shared source | full session stage              |
| DB migration files        | stage Backend                   |
| plugin package.json       | full session stage              |

shared source 采用 full session 是 deliberate conservative choice。

## 21.2 Web-specific

- `packages/web/**` 普通 browser implementation：Vite HMR。
- `apps/web/vite.config.ts`：restart Web Dev Service。
- `packages/build/web/**`：restart Web Dev Service / full session，V1 可保守 full session。
- `@qualy/ui package.json#exports` 等 frontend package metadata：V1 直接 full session。

## 21.3 Core

以下低频基础设施变化可直接 full session：

- `packages/core/assembly/**`
- `packages/core/plugin-kit/**`
- Server bootstrap/dev-host protocol
- shared contracts

Dev Host 自身代码修改：

```text
apps/server/src/dev/**
```

不实现 self-HMR。

提示：

```text
Dev Host implementation changed; restart pnpm dev
```

---

# 22. Active Inputs 与 Desired Inputs

Watcher 必须同时关注：

1. **Active world inputs**；
2. **用户当前希望切换到的 desired bootstrap inputs**。

例：

```env
# old
QUALY_CONFIG=./qualy.yml
```

用户改成：

```env
QUALY_CONFIG=./configs/dev.yml
```

但新文件暂时不存在。

Candidate 失败，Active world 继续。

Host 仍必须 watch：

```text
./configs/dev.yml
```

这样用户随后创建文件时可自动重新 stage。

至少维护：

- `.env`；
- effective `QUALY_CONFIG` path；
- lock path；
- package metadata；
- workspace/package-manager metadata。

---

# 23. Linked / workspace plugin watcher

Backend PREPARED topology 应提供 active plugin 的 real package root。

利用 PackageResolver 已有 realpath 结果：

```text
normal installed package inside node_modules
→ do not recursively watch

realpath points outside normal node_modules
→ treat as linked/workspace package
→ watch package root
```

V1 不递归推导第三方插件的 transitive workspace dependency graph。

外部 linked plugin 的 package 内部变化可以保守地触发 full session。

---

# 24. Package Manager 变化

至少 watch：

- root `package.json`；
- relevant workspace `package.json`；
- `pnpm-lock.yaml`；
- `pnpm-workspace.yaml`。

可在 spike 中验证是否值得额外 watch：

```text
node_modules/.modules.yaml
```

用途仅是：

> `pnpm install` 完成后触发一次重新 staging。

不要 watch 整个 `node_modules/**`。

如果 `.modules.yaml` 在 pnpm 11 下不稳定或噪声太大，放弃自动检测，不为此构建 package-manager integration。

---

# 25. Environment Snapshot

当前 root `pnpm dev` 不应再使用：

```text
node --env-file-if-exists=.env ...
```

去启动长期 Dev Host。

否则 Dev Host 的 `process.env` 会永久持有启动时的旧 `.env`。

新模型：

```text
shell environment
+
current .env
=
effective child environment snapshot
```

每轮 candidate session 使用同一份 snapshot：

```text
Backend
Web Dev Service
other Dev Services
```

全部：

```ts
spawn(..., { env: snapshot })
```

`.env` 改动触发新 session staging。

使用 Node 24 自己的 env-file parsing 规则，不重新发明 dotenv 语义。

建议 precedence 保持：

```text
shell environment
> .env
```

然后 Host 显式写入：

```text
NODE_ENV=development
QUALY_DEV_SUPERVISED=1
QUALY_CONFIG=<absolute manifest path>
```

---

# 26. Manifest Selection 统一

当前 Server 与 Web Build 的 manifest 默认选择逻辑不同，本次必须修正。

目标 precedence：

```text
explicit ymlPath
>
QUALY_CONFIG
>
component-specific default
```

在 supervised dev 中，Dev Host 必须给所有 children 注入同一个：

```text
QUALY_CONFIG=/absolute/path/to/qualy.yml
```

因此 Backend 与 Vite Browser Assembly 必定读取同一 manifest。

`@qualy/web-build` 必须开始尊重 `QUALY_CONFIG`。

不要让 Web Dev Service 自己猜 manifest path。

---

# 27. Server Host config

Server Host 自己拥有的配置可以在 handoff 前纯验证，例如：

- `PORT`
- trusted proxy config
- API docs host config
- 其他 Server Host-only settings

建议将 parsing 抽成纯 helper：

```ts
parseServerSettings(env)
```

Backend 的 Effect Config layer 和 Dev Host 复用这一 parser。

特别是 `PORT`：

- Dev Host 需要它构造 internal runtime origin；
- Dev Host 需要它做端口冲突诊断；
- Web Dev Service 需要 proxy target。

不要复制两套 PORT 解析规则。

---

# 28. Dev Service Runtime Context

Dev Host 给 Dev Service：

```ts
{
  plugin: {
    id,
    config,
    manifestDir,
  },

  runtime: {
    origin: 'http://127.0.0.1:3000',
  },
}
```

`runtime.origin` 永远是内部 loopback target。

不要传：

```text
https://qualy-dev.hprogq.com
```

避免：

```text
Vite
→ public tunnel
→ Backend
```

绕一圈。

---

# 29. Web 插件拆分

当前 Web plugin development mode：

```text
Backend Runtime
→ raw NodeServer
→ Vite middleware mode
→ same server HMR websocket
```

迁移后：

## Runtime half

Production：

```text
Web plugin Runtime
→ serve static SPA assets
```

Development：

```text
Backend
→ 不启动 Vite
→ 不 serve SPA wildcard
```

Development Backend 只正常处理：

```text
/api/**
/health/**
其他Backend routes
```

## Dev half

新增：

```text
@qualy/plugin-web/dev
```

职责：

- parse shared Web manifest config；
- validate `sourceRoot`；
- prepare Browser Assembly；
- acquire standalone Vite；
- proxy Backend；
- close Vite on Scope shutdown。

---

# 30. Web Config 清理

删除开发/生产二选一的 Runtime 概念：

```text
QUALY_WEB_MODE
WebConfig.mode
```

不再需要。

可继续保留一个共同 manifest schema：

```text
sourceRoot?
assetRoot?
```

但使用方不同：

```text
production Runtime
→ assetRoot

Dev Service
→ sourceRoot
```

不要拆成两个互相 excess-property 冲突的 manifest schema。

同时 `apps/server/src/run.ts` 中 production 对 `QUALY_WEB_MODE=development` 的检查应随迁移删除。

---

# 31. Vite Dev Server

standalone Vite：

```text
Backend 127.0.0.1:3000
Vite    0.0.0.0:5173
```

要求：

```ts
server: {
  strictPort: true
}
```

不能在 5173 占用时静默改跑 5174。

保留现有：

- React plugin；
- Tailwind；
- `qualyPlugins()`；
- optimizeDeps；
- allowedHosts；
- chunk policy。

Dev Service 尽量启动现有 `apps/web/vite.config.ts`，不要复制一份 Vite 配置。

---

# 32. Web Candidate PREPARE 不得启动 Vite

当前 `qualyPlugins()` 在 Vite config 阶段会写：

```text
apps/web/.qualy/plugins.ts
apps/web/.qualy/scan.ts
```

这些正被 active Vite 使用。

因此 Web Candidate PREPARE 严禁：

```text
vite.createServer()
执行完整 Vite config side effects
写 .qualy/*
```

否则 Candidate 会污染 Active world。

`prepare()` 应使用纯 Browser Assembly collector 进行验证。

`acquire()` 才运行 Vite config/materialization。

---

# 33. Vite 与 Browser Assembly ownership

保持：

```text
@qualy/web-build
```

作为唯一 Browser Assembly 实现。

它继续服务：

- Vite dev；
- Vite build；
- Vitest browser。

Dev Host 不生成：

- `plugins.ts`；
- `scan.ts`；
- browser registry；
- i18n bundle。

可优化：

```text
collectWebPlugins once
→ build plugin source
→ build scan source
```

但不是 Dev Host 核心要求。

---

# 34. Vite long-lived cache

当前 Web Build resolution/cache 不是为 descriptor topology 动态刷新设计的。

因此结构性变化时：

```text
restart entire Web Dev Service process
```

不要依赖：

```text
viteServer.restart()
```

来解决 Node ESM / package metadata / Assembly cache。

普通 browser module 仍使用 HMR。

---

# 35. Backend Proxy

Vite 只 proxy：

```text
/api/**
/health/**
```

其他路径由 Vite SPA fallback。

不要 proxy 所有未知路径。

Proxy target：

```text
http://127.0.0.1:<backend-port>
```

优先保留原始 browser Host，不要默认复制常见示例的：

```ts
changeOrigin: true
```

必须验证：

- Host；
- `X-Forwarded-For`；
- `X-Forwarded-Proto`；
- trusted proxy；
- secure cookie；
- OAuth/CAS callback；
- client IP。

---

# 36. Backend Temporary Unavailability Protocol

Backend reload 期间 Browser 可能看到两个阶段：

### Backend 尚未监听

Vite proxy connect error：

```http
503 Service Unavailable
Retry-After: 1
X-Qualy-State: unavailable
```

### Backend 已 bind，但 real router 尚未 attach

保留现有 startup listener，并增加：

```http
503 Service Unavailable
Retry-After: 1
X-Qualy-State: starting
```

不要 hold API requests 等 Backend ready。

`starting` 与 `unavailable` 都属于：

```text
TransientBackendUnavailable
```

---

# 37. Browser Query Recovery

当前普通 transport error retry 不足以覆盖 HTTP 503 startup window。

需要在浏览器 HTTP client 的中央层识别：

```text
status == 503
AND
X-Qualy-State in { starting, unavailable }
```

转成明确的 transient error。

规则：

### Read query

允许 bounded retry/backoff。

### Mutation

不要自动 retry。

原因：

```text
POST已执行但response丢失
```

时重试会产生 duplicate write ambiguity。

### Runtime manifest

初始 manifest query 需要一个较长但有上限的自动恢复窗口。

不要 Backend 只离线 500ms 就永久进入手动 Retry 页面。

也不要无限 spinner。

---

# 38. SSE

现有 SSE reconnect/backoff 机制继续保留。

Backend restart：

```text
stream ends
→ live=false
→ reconnect/backoff
```

无需为 Dev Host 重新设计。

---

# 39. IPC Protocol

协议保持极小。

Backend / service child -> Host：

```ts
type ChildMessage =
  | {
      protocol: 1
      type: 'prepared'
      role: 'backend'
      topology: readonly DevServiceSpec[]
    }
  | {
      protocol: 1
      type: 'prepared'
      role: 'service'
      key: string
    }
  | {
      protocol: 1
      type: 'ready'
      role: 'service'
      key: string
    }
```

Host -> child：

```ts
type HostMessage =
  | {
      protocol: 1
      type: 'accept'
    }
  | {
      protocol: 1
      type: 'reject'
    }
  | {
      protocol: 1
      type: 'shutdown'
    }
```

不通过 IPC 传：

- logs；
- HTTP requests；
- metrics；
- Runtime services；
- Effect Layer；
- health probe；
- business data。

Logs 用 stdio。

Runtime health 用 HTTP。

---

# 40. Supervised Mode Detect

只有：

```text
QUALY_DEV_SUPERVISED=1
AND
process.send exists
```

时 Backend 才进入 PREPARED handshake。

因此：

```text
node ... run.ts development
```

仍能直接启动一个普通 development Backend。

Production 完全不进入该协议。

---

# 41. Shutdown

## 41.1 不替换 `NodeRuntime.runMain`

保留 Effect 官方 Node runtime runner。

Supervised shutdown 通过一个 Effect latch/race 接入 root lifecycle：

```text
Layer.launch(application)
race
supervisedShutdown
```

IPC shutdown：

```text
supervisedShutdown completes
→ Layer.launch interrupted
→ Scope closes
→ finalizers run
```

## 41.2 HTTP drain

当前 HTTP server 的 `hurry()` / idle-connection drain 不应靠：

```ts
process.emit('SIGTERM')
```

伪造 signal。

抽一个 host-internal 幂等：

```text
requestShutdown()
```

IPC shutdown：

```text
requestShutdown()
├─ trigger HTTP hurry/drain
└─ complete supervised shutdown latch
```

OS SIGINT/SIGTERM 仍由现有 NodeRuntime 路径处理。

所有 shutdown path 必须幂等。

## 41.3 Parent disconnect

所有 supervised child：

```ts
process.on('disconnect', requestShutdown)
```

Parent IPC connection 是 child lifetime lease。

Dev Host 被 IDE 强杀时，children 不应长期残留端口。

---

# 42. Shutdown deadline

### PREPARING / PREPARED Candidate

resource-cold：

- 可以 reject / terminate aggressively。

### Dev Service active process

development-only resource：

- graceful shutdown；
- short bounded deadline；
- hard kill fallback。

### Backend STARTING

可能正在 migration/resource acquisition：

- 不因 reload 自动 hard kill；
- 等它成功或失败；
- Ctrl+C 仍可结束整个 session。

### Backend RUNNING handoff

- graceful shutdown；
- 等 child exit；
- 可设置开发态 bounded fallback；
- deadline 应明显大于 HTTP 2s drain；
- 具体数值由 spike 测试确定。

---

# 43. Port Safety

Dev Host 应在启动 session 时做 Backend port 诊断。

避免：

```text
Vite正常启动
/api却代理到另一个恰好占3000的进程
```

Web Vite 使用 `strictPort: true`。

若外部进程占端口：

- 明确输出错误；
- 不静默选择其他端口。

---

# 44. Logging

Candidate failure 与 active failure 必须区别。

例如：

```text
backend reload failed; keeping backend#12
```

不同于：

```text
backend replacement failed after handoff; no backend is running
```

Web：

```text
web reload failed; keeping web#4
```

不同于：

```text
web failed during acquire; web development service is unavailable
```

Child detailed error 保留正常 stderr/Effect logging。

不要实现 IPC log transport。

建议 child log 附：

```text
source=backend
source=dev:web
```

或等效前缀。

---

# 45. Root `pnpm dev`

目标：

```json
{
  "scripts": {
    "dev": "node --import tsx apps/server/src/dev/host.ts"
  }
}
```

不要给长期 Dev Host 加：

```text
--env-file-if-exists=.env
```

Dev Host 自己 materialize child env snapshot。

Backend child 仍然启动现有：

```text
apps/server/src/run.ts development
```

并注入 supervised env + IPC channel。

Production `pnpm start` 保持单进程 Runtime。

---

# 46. Dev Host 自身

建议：

```text
apps/server/src/dev/
├─ host.ts
├─ protocol.ts
├─ state.ts
├─ watch.ts
├─ child.ts
└─ service-runner.ts
```

具体文件可按当前风格调整。

Dev Host 可以使用 Effect 管理 supervisor 本身：

```text
Queue<DevEvent>
Ref<DevState>
Scope
Fiber
Deferred
acquireRelease
```

所有事件进入一个串行 queue：

```text
watch event
backend prepared
service prepared
service ready
child exit
parent shutdown
Ctrl+C
```

由一个 reconcile fiber 顺序处理。

禁止多个 callback 各自直接：

```text
kill()
spawn()
replace()
```

---

# 47. State 模型

不要巨型枚举状态机。

使用 orthogonal data：

```ts
interface DevState {
  stopping: boolean

  active: {
    backend: ManagedBackend | null
    topology: readonly DevServiceSpec[]
    services: Map<string, ManagedService>
  }

  candidate: CandidateWorld | null

  pendingAction: null | 'backend' | { service: string } | 'session'
}
```

`pendingAction` 使用 action lattice 合并：

```text
browser-only
    <
service/backend
    <
session
```

同一个 batch 取最高动作。

commit 期间新变化写入 `pendingAction`，不改变 pinned Candidate。

---

# 48. Candidate supersession

可以被 supersede：

```text
PREPARING
PREPARED before commit
```

不能被 supersede：

```text
COMMITTED
STARTING
```

COMMITTED 后新保存只排下一轮。

---

# 49. Failure Semantics

## 49.1 Backend PREPARE failure

```text
Active Backend exists
→ keep Active Backend

No Active Backend
→ backend failed
→ wait next change
```

## 49.2 Dev Service PREPARE failure

Session replacement 且 Active world存在：

```text
reject whole candidate session
keep Active world
```

Initial boot：

```text
Backend may continue
failing Dev Service marked failed
```

## 49.3 Backend STARTUP failure after ACCEPT

不 rollback。

```text
old Backend already exited
new Backend startup failed
→ no Backend running
```

Vite 可继续。

下一保存重新 stage。

## 49.4 Dev Service acquire failure after ACCEPT

不 rollback。

Backend与其他 services 可继续。

---

# 50. Last-known-good 的准确承诺

保证：

> 新版本在 PREPARE 阶段失败时，不主动销毁正在运行的对应 Active process/world。

不保证：

- ACCEPT 后 startup failure rollback；
- 从已经变化的磁盘重新构造旧 generation；
- 旧进程 crash 后恢复旧源码；
- filesystem snapshot；
- shared client/server contract 原子切换。

---

# 51. Shared Contract Consistency

修改共享 API contract 时，Vite HMR 和 Backend staging 之间可能存在短暂：

```text
new browser client
→ old Backend
```

或相反。

V1 接受这种 eventual consistency。

明显的 contracts / Browser-runtime topology 文件可保守触发 full session restart，使最终 Browser full reload。

不要为消灭这几百毫秒窗口增加：

- gateway；
- generation negotiation；
- Browser pause；
- filesystem snapshot。

---

# 52. `NodeServer` 后续清理

当前公开 `NodeServer` service 的主要历史理由是让 Web plugin 获取 raw `http.Server`，以挂载 embedded Vite/HMR。

Vite 拆出以后应重新审计：

- 若没有插件再需要 raw server：
  - 将其收回 `apps/server` 内部；
  - 不再作为插件公共 service。
- 保留 host 自身 early bind / starting listener / drain 所需的内部实现。

该清理可放在 Web extraction 后，不阻塞第一阶段。

---

# 53. Migration

本次设计 **不改变** development migration 默认策略。

不要为了 Dev Host 立即强制：

```text
QUALY_MIGRATIONS=off
```

先测量 Backend-only restart 的实际耗时。

重要约束：

- ACCEPT 后 Backend STARTING 不自动 hard-kill；
- committed migration 文件视为 immutable；
- schema 改动生成新 migration。

## Adjacent hardening

`Backend startup migration` 与人工：

```text
qualy database migrate
```

可能存在跨进程竞争。

建议单独审计并考虑在 Qualy migration helper 外围增加 PostgreSQL advisory lock。

该问题不属于 Dev Host 核心，不应成为本次架构的前置复杂依赖。

---

# 54. Browser Build / Runtime Fingerprint：Adjacent Finding

不要使用当前 `resolutionHash` 驱动 Dev lifecycle。

另外，当前 production browser/runtime fingerprint 语义存在独立 debt：

- `resolutionHash` 对某些 runtime plugin state 很敏感；
- 但不完整覆盖所有 Browser topology，例如 UI page/layout/i18n/browser module declaration。

这与本次 Dev Host 无关。

记录为 adjacent debt，不在本次修复中扩大 scope。

---

# 55. Browser Build Open-world：Adjacent Finding

当前 Browser collector 若仍限制只接受特定 package namespace，则与 Plugin kernel 的 open-world 模型不完全一致。

新 Dev Service 绝不能复制这种 restriction：

```text
any active plugin id
→ may contribute Dev Service
```

Browser collector 是否同时开放第三方 plugin，单独处理。

---

# 56. Workspace dependency correctness：Adjacent Finding

实施前应修复当前已发现的 undeclared workspace import，例如 plugin package 源码 import 了 workspace package、但 `package.json` 未声明 dependency 的情况。

在这类质量门禁建立前，不要使用 workspace `package.json` dependency closure 作为 watcher correctness boundary。

Watcher V1 采用 conservative roots。

---

# 57. 测试矩阵

以下测试属于本次功能的核心验收，不是可选 polish。

## 57.1 Backend staged reload

1. 普通 backend file 修改：
   - old Backend 在 Candidate PREPARE 期间继续响应；
   - Candidate PREPARED 后才停止 old Backend；
   - Vite PID 不变。

2. Backend TS / import syntax error：
   - Candidate PREPARE failure；
   - old Backend 继续；
   - Vite 继续。

3. invalid plugin descriptor：
   - old Backend 继续。

4. invalid `qualy.yml`：
   - old Backend 继续。

5. rapid save：
   - PREPARING Candidate 可以 supersede；
   - 不形成 restart storm。

6. commit 期间再次保存：
   - pinned Candidate 不被丢弃；
   - 新变化排下一轮。

7. Active STARTING 时保存：
   - 可 PREPARE next Candidate；
   - 不 kill STARTING Backend。

8. STARTING Backend自己失败：
   - 若 next Candidate 已 PREPARED，直接切它。

9. handoff 等待完整 old child exit，而不是端口释放。

10. 不存在两个已 ACCEPT 的 Backend Runtime 同时活跃。

## 57.2 Resource-cold fence

11. Candidate 不 ACCEPT：

- DATABASE_URL 指向拒绝连接地址；
- Candidate 仍能到 PREPARED；
- 不出现 DB startup。

12. Candidate PREPARE 不 bind Backend port。

13. Candidate PREPARE 不启动 scheduler/timer/background business fiber。

14. relative runtime lazy-import quality audit通过。

## 57.3 Dev Service

15. Web `src/dev/**` 语法错误：

- old Vite保持。

16. Web Candidate PREPARE：

- 不启动 Vite；
- 不写 `apps/web/.qualy/*`。

17. Web candidate PREPARE成功、acquire失败：

- 不 rollback；
- Host标记web failed。

18. service-only edit：

- Backend PID不变。

19. backend-only edit：

- Web/Vite PID不变。

20. full session edit：

- Candidate Backend + services 全PREPARED后才commit active world。

21. initial boot Web prepare失败：

- Backend仍可启动。

## 57.4 HMR / Browser

22. Backend restart时 HMR websocket不断。

23. React component local state在backend-only reload后保持。

24. CSS HMR正常。

25. Runtime manifest query在短Backend outage后自动恢复。

26. mutation不自动retry transient 503。

27. SSE在Backend restart后自动reconnect。

## 57.5 Proxy

28. login/session cookie。

29. logout。

30. redirects。

31. streaming upload / large PUT。

32. AbortSignal。

33. SSE。

34. `Host` / `X-Forwarded-*`。

35. trusted proxy。

36. external HTTPS dev domain + WSS HMR。

## 57.6 Configuration

37. custom `QUALY_CONFIG`：

- Backend和Web Dev读取同一manifest。

38. `.env` change：

- 同一 candidate session children拿同一个env snapshot。

39. `PORT`非法：

- handoff前失败。

40. Vite port occupied：

- strict failure，不漂移到其他port。

41. Backend port occupied：

- Dev Host明确报错，不让Vite静默proxy到错误process。

## 57.7 Plugin topology

42. Web plugin disabled：

- no Web Dev Service。

43. headless assembly：

- no Vite。

44. DevService duplicate key：

- PREPARE failure。

45. linked plugin root change：

- watcher触发。

46. backend-only分类错误但实际 topology 变化：

- Host自动promote session replacement。

## 57.8 Lifecycle

47. Ctrl+C：

- Host + children正常结束；
- 无孤儿端口。

48. Host被强制终止：

- IPC disconnect后children退出。

49. repeated shutdown：

- 幂等，无double finalizer。

50. candidate PREPARED等待时parent断开：

- candidate退出。

---

# 58. 性能验证

在功能实现前后记录：

### Current baseline

- process startup；
- Assembly resolve；
- migration check/apply；
- ORM；
- boot hooks；
- Vite import/create/config；
- Browser collection；
- HTTP ready；
- shutdown。

### After extraction

单独测：

```text
Backend-only staged reload
```

关注：

- Candidate PREPARE；
- old Backend shutdown；
- new Backend STARTING；
- migration；
- ORM；
- `/health/live`。

如果 Backend-only reload 已足够快，不继续优化。

只有 profiling 证明 migration/pending migration 是主要耗时时，才单独讨论开发迁移策略。

Native Node TypeScript 与 `tsx` 的比较属于独立性能 spike，不影响本架构正确性。

---

# 59. 实施阶段

## Phase 0 — Baseline & invariants

目标：不改行为，先证明边界。

- 增加 opt-in startup/shutdown timing。
- 审计 Backend Runtime relative dynamic imports。
- 审计 descriptor/module import 是否存在副作用。
- 增加 resource-cold adversarial test fixture。
- 修复明显 undeclared workspace dependency。
- 记录当前 `pnpm dev` cold start / shutdown baseline。

退出条件：

- 可以明确指出 `Layer.launch` 前后资源边界；
- serving Runtime 本地 lazy imports 已清理或登记。

---

## Phase 1 — Dev declaration & supervised protocol

实现：

- `@qualy/plugin-kit/dev`
- `Dev.service(...)`
- `collectDevServices(resolution)`
- protocol types
- Backend PREPARED fence
- `QUALY_DEV_SUPERVISED`
- ACCEPT / REJECT
- supervised shutdown
- parent disconnect lease
- Dev Service generic runner

暂不加 watcher。

先通过人工脚本：

```text
spawn active
spawn candidate
prepared
handoff
```

验证状态语义。

退出条件：

- Candidate在ACCEPT前resource-cold；
- old Backend持续到commit；
- no double Runtime。

---

## Phase 2 — Web extraction

实现：

- Web `Dev.service({ id: 'web', module: './dev' })`
- `./dev` export
- standalone Vite Dev Service
- Web prepare/acquire
- standalone proxy
- `strictPort`
- Browser入口改为Vite
- development Backend不serve SPA/Vite
- production static Web保持
- 删除 `QUALY_WEB_MODE`
- shared Web config parse
- `QUALY_CONFIG`统一
- Web Build尊重`QUALY_CONFIG`

退出条件：

- Backend可反复手工重启，Vite PID/HMR保持；
- headless development正常；
- production build/start不回归。

---

## Phase 3 — Dev Host watcher & staging

实现：

- chokidar
- event batching
- action classification
- active/candidate world
- candidate supersession
- pinned commit
- backend/service/session handoff
- linked plugin roots
- desired bootstrap inputs
- env snapshot
- port checks
- status logging

退出条件：

- rapid-save matrix通过；
- candidate errors不破坏active world；
- no orphan children。

---

## Phase 4 — Browser transient recovery

实现：

- Vite proxy unavailable 503；
- Backend starting header；
- central transient error classification；
- bounded read-query retry；
- manifest recovery；
- mutation不retry；
- proxy integration matrix。

---

## Phase 5 — Cleanup & optimization

根据实际结果决定：

- `NodeServer` public service回收；
- Browser collection duplicate work优化；
- startup timing移除或转为debug instrumentation；
- watcher classification细化；
- package install retrigger改善。

不要在 Phase 1–4 未稳定前做这些优化。

---

# 60. 验收命令

至少：

```text
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
pnpm vendor:check
```

并增加专门的 Dev Host integration suite。

现有生产 smoke 必须继续通过。

---

# 61. 代码审查门禁

实现完成后应增加架构门禁，防止回退：

1. Backend Runtime 不允许 import `vite`。
2. Web plugin server/runtime 不允许 acquire Vite。
3. Dev Host source 不允许 import React/Vite-specific implementation。
4. Business plugins不得直接操作 Dev Host。
5. Dev Services仅通过 external extension point声明。
6. Serving Runtime禁止未批准的 relative dynamic local import。
7. `src/client/**`不得被 Backend Runtime import。
8. Dev Service `prepare()` 的测试证明不bind端口/不触碰DB。
9. Headless assembly测试证明不启动Web companion。
10. Production runner不依赖Dev Host。

---

# 62. Rejected Alternatives

## Cordis

拒绝。

它解决的是动态插件 Runtime lifecycle，而当前需求只是 development process restart。恢复Cordis会引入第二套后端生命周期模型。

## Effect in-process HMR

拒绝。

Effect可以管理 resource refresh，但不能解决 TypeScript/ESM module code replacement；HttpRouter也不是为动态remove/replace设计。

## `node --watch`

拒绝。

无法表达：

- staged candidate；
- PREPARE fence；
- old active preservation；
- migration-safe coalescing；
- Dev Service topology；
- session handoff。

同时会成为第二个process lifecycle owner。

## Disposable Resolver

拒绝。

Candidate Backend本身已经是fresh ESM process和未来真正要运行的process。单独Resolver会重复resolution并产生TOCTOU。

## Generated Runtime Plan

拒绝。

当前Resolution包含Layer/function/Context key等运行对象，不应创造第二套serializable Assembly。

## Stable Dev Gateway

V1拒绝。

Vite自己作为Web development ingress即可。Dev Host不应该顺便变成HTTP/WS proxy server。

---

# 63. 关键设计不变量

实现中遇到细节冲突时，以这些 invariant 为准。

### Invariant A

**Dev Host 是唯一 OS child process lifecycle authority。**

### Invariant B

**Vite只负责 Browser module lifecycle；Effect只负责单Backend内部resource lifecycle。**

### Invariant C

**Candidate 在 ACCEPT 前必须 resource-cold。**

### Invariant D

**旧Runtime只有在新Candidate PREPARED之后才允许进入handoff。**

### Invariant E

**handoff commit 后 Candidate 被 pin，不追逐更新版本。**

### Invariant F

**两个完整 Backend Runtime 不得同时处于 resource-owning 状态。**

### Invariant G

**必须等待旧 Backend child process EXIT 后才 ACCEPT 新 Backend。**

### Invariant H

**STARTING Backend 不因为reload自动hard-kill。**

### Invariant I

**Browser Assembly始终属于 `@qualy/web-build`。**

### Invariant J

**Dev Host不理解Vite/React/UI业务语义。**

### Invariant K

**文件分类只是性能策略；fresh Backend topology report才是Dev Service topology真相。**

### Invariant L

**commit之后不rollback。**

---

# 64. Claude 实施要求

实施时：

1. 先阅读当前实际源码，不要仅按本文路径猜文件内容。
2. 若当前 branch 已与本文引用的结构变化，保留本文的 architecture invariant，再调整具体路径。
3. 不得重新引入本文 Rejected Alternatives。
4. 每个 Phase 独立保持可运行。
5. 不要一次性重写 Assembly。
6. 不要为了 Dev Host 重构所有 Plugin descriptor 为lazy。
7. 不要顺手修 production fingerprint/open-world Browser collector 等 adjacent debt，除非它直接阻塞本阶段。
8. 任何新增复杂机制必须先证明本文现有模型无法解决具体失败场景。
9. 每完成一个 Phase，运行对应测试和主验收命令。
10. 出现架构级反例时停止并报告；普通实现问题直接修复，不重新设计整个系统。

---

# 65. 最终目标行为

正常开发应达到：

```text
修改 React / StyleX / CSS
→ Vite HMR
→ Backend untouched

修改 Backend handler/service/repository
→ stage Backend Candidate
→ old Backend continues
→ Candidate PREPARED
→ handoff Backend only
→ Vite/HMR untouched

Backend代码写坏
→ Candidate fails
→ old Backend + Vite继续

修改 Vite Dev Service实现
→ stage Web Candidate
→ old Vite继续
→ PREPARED
→ handoff Web only

修改 qualy.yml / descriptor / package topology / .env
→ stage candidate session
→ prepare Backend + Dev Services
→ success后整组commit
→ Browser reconnect/full reload

Backend startup失败
→ Vite仍可运行
→ 修复并保存
→ stage新Backend

没有Web plugin
→ pnpm dev只有Backend
```

最终要得到的不是“后端 HMR”，而是：

> **Backend 快速、安全、可自动重启；Browser development runtime 稳定常驻；插件仍然决定开发环境里有哪些额外服务；Effect、Vite、Assembly 和 Dev Host 各自只管理自己真正拥有的生命周期。**

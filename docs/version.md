# Qualy Web Release Protocol 与运行中版本漂移恢复机制实施方案

> 状态:Phase A–F 已于 2026-09-14 落地,实现形态与运维要点见 docs/web-release.md;本文保留为设计依据。

## 0. 任务目标

为 Qualy 建立一套正式的 Web Release Protocol，解决以下问题：

1. 浏览器缓存旧 `index.html`，服务器已经发布新 JS/CSS，导致入口资源或动态 chunk 404。
2. 用户已经运行旧版 SPA，新版本发布后再进入尚未加载过的页面，旧代码尝试加载已被删除的 lazy chunk。
3. 用户长时间保持标签页打开，服务器已经发布新版，希望能够感知新版，但不能粗暴自动刷新导致表单内容丢失。
4. 浏览器使用旧前端，而后端已经更新到不兼容协议，避免最终表现成随机 Zod decode error、页面异常或 500。
5. `pnpm dev`、`pnpm build + pnpm start` 和未来真正 CI/CD 使用同一套版本协议，不为生产部署另写一套。
6. 发布过程中保证一个运行中的 server 始终服务它启动时确认的那个 Web shell，不出现“旧 API + 新 index.html”或半发布状态。
7. 旧 hashed assets 在合理时间窗口内继续可访问。
8. 不引入 Service Worker/PWA，不增加另一层难以诊断的缓存状态。

这次工作不是“加一个刷新按钮”，而是把 Web release 作为 Qualy runtime 的正式基础设施能力。

---

# 1. 开工前必须遵守的仓库规则

开始实现前按仓库 `CLAUDE.md` 执行：

1. 阅读根 `CLAUDE.md`。
2. 阅读 `STATUS.md`。
3. 涉及 Effect API 的部分，先阅读：
   `docs/agents/effect-source-policy.md`
4. 本任务会修改浏览器 HttpClient / server middleware，因此必须实际阅读仓库 `repos/` 中与当前 catalog 版本一致的 Effect v4 HttpClient / HttpServer API 源码。
5. 不凭记忆猜：

   - HttpClient request transform
   - response inspection
   - HttpServerResponse
   - middleware composition

6. 如 Effect 实际 API 与本设计中的伪代码命名不同，以实际源码为准，但保持本设计定义的行为和边界。
7. Node 继续使用 strip-only TypeScript：

   - 禁止 enum
   - 禁止 parameter property
   - 禁止 namespace

8. 不引入 codegen。
9. 普通单元测试仍必须能在 `pnpm build` 之前运行；不要重新让 `@qualy/plugin-web` tests 依赖真实 staged bundle。
10. 完成后真实执行验收命令、更新 `STATUS.md`、Conventional Commit 英文提交。

---

# 2. 现状与本次不应破坏的性质

当前已有以下良好性质，必须保留。

## 2.1 Development

`pnpm dev` 不是直接执行 `vite`。

当前结构：

```text
pnpm dev
└── apps/server/src/dev/host.ts
    ├── backend process
    └── web dev service
        └── Vite
```

Vite 是独立进程。

普通 backend replacement：

```text
Backend A
↓
Backend B
```

不能导致：

```text
Vite restart
browser full reload
React state lost
```

本任务不得破坏这个性质。

---

## 2.2 Production

当前：

```text
pnpm build
├── vite build
└── packages/build/web/src/stage.ts

pnpm start
└── apps/server/src/run.ts production
    └── @qualy/plugin-web
        └── sirv staged bundle
```

这已经是真实 production path。

不要使用 `vite preview` 作为 Qualy production runtime。

---

## 2.3 Cache policy

当前 production 已经有：

```text
HTML / extensionless SPA navigation
Cache-Control: no-cache

/assets/... hashed resources
Cache-Control: public, max-age=31536000, immutable
```

保留这个方向。

但本次顺手修复一个隐含问题：

当前 sirv 的 `maxAge + immutable` 实际覆盖了所有有扩展名的静态文件，因此：

```text
/favicon.svg
/favicon.png
/apple-touch-icon.png
```

这些没有 hash 的 URL 也可能获得 immutable caching。

新静态资源结构中必须变成：

```text
/assets/*
    immutable

release shell 下的：
index.html
favicon.svg
favicon.png
apple-touch-icon.png
其他非 hashed public 文件
    no-cache
```

---

# 3. 核心概念必须分开

不要把下面三个概念混为一个版本号。

## 3.1 Assembly Resolution Hash

现有：

```ts
resolutionHash
```

含义：

> 当前 server / browser bundle 使用哪一套 Qualy plugin assembly。

它继续负责防止：

```text
Web built for Assembly A
Server runs Assembly B
```

不得拿它替代 Web build ID。

修改一个普通 React 文件可能：

```text
resolutionHash 不变
Web chunk 已改变
```

所以它不是 Web release ID。

---

## 3.2 Web Release ID

新增：

```text
releaseId
```

含义：

> 浏览器当前执行的是哪一次具体 Web build / dev Vite session。

它必须在每次 production Web build 时不同。

开发态则表示：

> 一次 Vite dev-service 生命周期。

普通 HMR 不改变 releaseId。

Vite 真正 restart 后改变。

releaseId 只要求：

```text
相等 / 不相等
```

不要比较大小。

不要给它承担 SemVer 语义。

---

## 3.3 Client Protocol

新增一个小整数：

```text
clientProtocol
```

它表示：

> 浏览器和 API 之间的兼容协议代际。

它不会每次 build 都变化。

初始：

```ts
CURRENT_CLIENT_PROTOCOL = 1

SERVER_MIN_CLIENT_PROTOCOL = 1
SERVER_MAX_CLIENT_PROTOCOL = 1
```

以后做 breaking API migration 时采用：

第一阶段：

```text
旧客户端 = 1
新客户端 = 2

新 server:
min = 1
max = 2
```

先兼容两代。

发布新 Web 后等待旧客户端自然淘汰。

最后 contract：

```text
min = 2
max = 2
```

旧客户端这时才明确收到“客户端版本不受支持”。

---

# 4. 新增 release contract

建议新增：

```text
packages/contracts/release/
```

package：

```text
@qualy/release-contract
```

保持框架无关：

- 不依赖 React
- 不依赖浏览器
- 不依赖 server runtime
- 如果需要 runtime validation，可使用项目已有、合适的轻量 schema 方案；不要为了几个字段拖入 Web runtime。

建议导出：

```ts
export const RELEASE_SCHEMA = 1 as const

export const QUALY_RELEASE_ENDPOINT = '/__qualy/release'

export const QUALY_CLIENT_RELEASE_HEADER = 'x-qualy-web-release'
export const QUALY_CLIENT_PROTOCOL_HEADER = 'x-qualy-client-protocol'
export const QUALY_CLIENT_UNSUPPORTED_HEADER = 'x-qualy-client-unsupported'

export const CURRENT_CLIENT_PROTOCOL = 1
export const SERVER_MIN_CLIENT_PROTOCOL = 1
export const SERVER_MAX_CLIENT_PROTOCOL = 1
```

定义：

```ts
export interface WebReleaseIdentity {
  readonly schema: 1
  readonly releaseId: string
  readonly mode: 'development' | 'production'
  readonly clientProtocol: number
}
```

Production installation metadata：

```ts
export interface InstalledWebRelease extends WebReleaseIdentity {
  readonly resolutionHash: string
  readonly installedAt: string
  readonly assets: readonly string[]
}
```

Release probe：

```ts
export interface ReleaseProbe {
  readonly schema: 1
  readonly releaseId: string
  readonly mode: 'development' | 'production'
  readonly clientProtocol: number
  readonly serverProtocol: {
    readonly min: number
    readonly max: number
  }
}
```

约束 releaseId：

```text
只允许安全 URL/file-name 字符
例如：
[A-Za-z0-9._-]
最大长度约 128
禁止 / \ .. 路径逃逸
```

所有从磁盘读到的 releaseId 都必须验证，不能把 `current.json` 当可信路径直接 `path.join()`。

---

# 5. Vite：增加 qualyRelease plugin

位置：

```text
packages/build/web/src/vite.ts
```

或者为避免文件继续膨胀：

```text
packages/build/web/src/release-vite.ts
```

再由 `./vite` export。

最终 `apps/web/vite.config.ts` 类似：

```ts
plugins: [
  qualyRelease(),
  qualyPlugins(),
  qualyBootFrame(...),
  stylex(...),
  react(),
]
```

---

## 5.1 Production build ID

允许 CI 显式提供：

```text
QUALY_RELEASE_ID
```

未来推荐：

```text
<git-sha>-<ci-run-id>
```

但本地：

```bash
pnpm build
```

也必须工作。

如果 production build 没有 `QUALY_RELEASE_ID`：

生成：

```text
local-<UTC timestamp>-<random hex>
```

不要只用 Git SHA。

原因：

```text
工作区有未提交修改
同一个 commit build 两次
```

都必须能够区分。

---

## 5.2 Development ID

每次 Vite plugin instance 创建时：

```text
dev-<random id>
```

保存整个 Vite process 生命周期。

普通 HMR：

```text
dev-a
→ dev-a
```

Vite restart：

```text
dev-a
→ dev-b
```

---

## 5.3 virtual module

新增：

```text
virtual:qualy/release
```

导出：

```ts
export const webRelease: WebReleaseIdentity
```

apps/web 新增对应 `.d.ts`，类似现有：

```text
virtual-qualy-plugins.d.ts
```

不要让 `@qualy/web-runtime` 自己 import Vite virtual module。

Composition root：

```text
apps/web
```

负责把 virtual release identity 传给 runtime。

这是重要边界。

---

## 5.4 Production metadata

Vite production build 输出一个仅供 staging 使用的 metadata，例如：

```text
apps/web/dist/.qualy-web-build.json
```

内容：

```json
{
  "schema": 1,
  "releaseId": "...",
  "mode": "production",
  "clientProtocol": 1
}
```

推荐由 Vite plugin 的 bundle emission API 生成，而不是 build 完成后再从源码猜。

需要验证实际 Vite 8 / Rolldown plugin API。

---

# 6. Production Release Store

当前 flat layout：

```text
client-dist/
  index.html
  assets/
```

改成：

```text
client-dist/
├── current.json
├── assets/
│   ├── index-AAA.js
│   ├── index-AAA.js.br
│   ├── index-AAA.js.gz
│   ├── widgets-BBB.js
│   ├── ...
│
└── releases/
    ├── release-A/
    │   ├── index.html
    │   ├── index.html.br
    │   ├── index.html.gz
    │   ├── favicon.svg
    │   ├── favicon.png
    │   ├── apple-touch-icon.png
    │   └── .qualy-release.json
    │
    └── release-B/
        └── ...
```

核心原则：

```text
shell 分 release 固定
hashed assets 跨 release 共存
```

---

# 7. 重构 stage.ts 为 release installer

当前：

```ts
rmSync(target)
cpSync(source, target)
```

必须删除。

拆成可复用函数：

```text
packages/build/web/src/release-store.ts
```

例如：

```ts
installWebRelease(options)
readCurrentWebRelease(store)
resolveReleaseRoot(store, id)
gcWebReleases(store, policy)
```

`stage.ts` 只是调用 installer。

未来真正 CI/CD 也复用 installer，不重新写部署逻辑。

---

## 7.1 install 顺序

严格：

```text
1. 读取 apps/web/dist/.qualy-web-build.json
2. 校验 release metadata
3. 读取当前 assembly lock
4. 获得 resolutionHash
5. 复制新 /assets 到 shared asset store
6. 确保 compression twins 完整
7. 创建完整 release shell temp directory
8. 写 .qualy-release.json
9. 将完整 temp release 移到 releases/<id>
10. 最后更新 current.json
11. 最后执行安全 GC
```

原则：

```text
assets first
release shell second
current pointer last
```

无论任何中间步骤失败：

```text
current
```

不得指向半成品。

---

## 7.2 Shared assets

遍历：

```text
apps/web/dist/assets/**/*
```

安装到：

```text
client-dist/assets/**/*
```

如果目标不存在：

```text
copy
```

如果已经存在：

必须校验字节一致。

同一个 hashed filename 出现不同内容：

```text
hard failure
```

因为这说明：

```text
content hash invariant 已破坏
```

不能静默覆盖。

---

## 7.3 Release shell

所有不是 `/assets` 的输出：

```text
index.html
favicon.*
apple-touch-icon.*
其他 public 文件
```

进入：

```text
releases/<releaseId>/
```

`.qualy-release.json`：

```json
{
  "schema": 1,
  "releaseId": "...",
  "mode": "production",
  "clientProtocol": 1,
  "resolutionHash": "...",
  "installedAt": "...",
  "assets": ["assets/index-AAA.js", "assets/widgets-BBB.js"]
}
```

记录整个 build 的所有 asset 文件，而不只是 index.html 直接引用的文件。

因为 dynamic chunks 通常不会全部出现在 HTML 中。

---

# 8. Compression 重构

当前 stage 对整个目录递归重复压缩。

改成：

```text
ensureCompressed(file)
```

语义：

- 新 asset 首次写入时生成 `.br/.gz`
- 已存在且 compression twin 完整则跳过
- release-specific index/public 文件正常压缩
- 已压缩格式不重复处理
- 仍保持 Brotli/Gzip 当前质量策略

这样旧 asset 不会每次 build 重压。

---

# 9. Release retention / GC

不要无限累积，但也不要 build B 后立即删除 A。

默认建议：

```text
至少保留最近 5 个 release
并保留最近 72 小时安装的所有 release
```

最终 retained set 是两条规则的并集。

允许部署环境配置，例如：

```text
QUALY_WEB_RELEASE_RETAIN_COUNT=5
QUALY_WEB_RELEASE_RETAIN_HOURS=72
```

未来正式生产可改成：

```text
7 天
```

磁盘成本远小于版本漂移事故成本。

GC：

1. 找出保留 release。
2. 读取每个 `.qualy-release.json.assets`。
3. 计算所有仍被引用的 shared asset。
4. 删除没有任何 retained release 引用的 asset。
5. 删除旧 release directory。
6. 不允许删除 current release。
7. metadata 损坏时宁可不 GC，也不要猜。

---

# 10. Production server 必须 pin release

当前 `@qualy/plugin-web` 启动时直接对整个 assetRoot 建 sirv。

改为：

```text
server boot
↓
读取 current.json
↓
解析 releaseId
↓
读取 releases/<releaseId>/.qualy-release.json
↓
验证：
    index.html 存在
    metadata schema 正确
    releaseId 一致
    resolutionHash == AssemblyInfo.resolutionHash
↓
把这个 release 固定在当前进程生命周期
```

关键：

**之后每个请求不能重新读取 current.json。**

即使磁盘后来：

```text
current: B → C
```

正在运行的 Server B 仍然必须：

```text
GET /
→ B/index.html

GET /__qualy/release
→ B
```

直到这个 process 被替换。

这是为了保证：

```text
一个 process
= 一个 API assembly
= 一个 Web shell release
```

---

# 11. Production static serving 拆成两套 middleware

## 11.1 Hashed assets

只处理：

```text
/assets/*
```

root：

```text
client-dist/
```

于是：

```text
/assets/foo.js
→ client-dist/assets/foo.js
```

配置：

```text
etag true
brotli true
gzip true
single false
maxAge 1 year
immutable true
```

headers：

```text
Cache-Control: public, max-age=31536000, immutable
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

不存在的 asset：

```text
404
```

绝不能 fallback index.html。

---

## 11.2 Pinned shell

root：

```text
client-dist/releases/<pinnedRelease>/
```

处理：

```text
/
/batch/...
/favicon.svg
...
```

配置：

```text
single true
brotli true
gzip true
```

所有 shell/public files：

```text
Cache-Control: no-cache
```

document/SPA navigation 继续获得：

```text
X-Frame-Options
COOP
CSP
Reporting-Endpoints
```

普通 favicon 等不需要 document-only headers。

这样也顺便修掉现在 favicon 被 immutable 缓存的问题。

---

# 12. Release probe endpoint

固定：

```text
GET /__qualy/release
```

不要放：

```text
/api/*
```

原因：

这是浏览器 runtime 的恢复基础设施。

它不能依赖可能正在发生兼容性错误的 typed business API。

Production 由 `@qualy/plugin-web` 回答：

```json
{
  "schema": 1,
  "releaseId": "release-B",
  "mode": "production",
  "clientProtocol": 1,
  "serverProtocol": {
    "min": 1,
    "max": 1
  }
}
```

注意：

`releaseId` 必须来自当前 process boot 时 pinned 的 release。

不是每次读取 `current.json`。

headers：

```text
Cache-Control: no-store
Content-Type: application/json
X-Content-Type-Options: nosniff
Cross-Origin-Resource-Policy: same-origin
```

不需要鉴权。

不要暴露：

- filesystem path
- git remote
- secrets
- deployment credentials

releaseId 本身是公开诊断信息。

---

# 13. Development release endpoint

不要让 backend 实现开发态的 `/__qualy/release`。

Development 的浏览器入口本来就是 Vite。

因此由 `qualyRelease()` Vite plugin：

```ts
configureServer(...)
```

提供同一个：

```text
GET /__qualy/release
```

内容：

```json
{
  "schema": 1,
  "releaseId": "dev-...",
  "mode": "development",
  "clientProtocol": 1,
  "serverProtocol": {
    "min": 1,
    "max": 1
  }
}
```

普通 backend restart：

```text
Vite 没变
releaseId 没变
```

不会误报新版。

Vite 真 restart：

```text
dev-A → dev-B
```

旧 tab 会检测到 session 已变。

---

# 14. pnpm dev / pnpm start 的预期行为

## pnpm dev

支持 Release Protocol，但不使用 production asset retention。

语义：

```text
普通 HMR
    不提示刷新

backend replacement
    不提示刷新

Vite process restart
    releaseId 改变
    旧 tab 可提示刷新

dynamic import 网络错误
    进入资源恢复逻辑
```

Vite 本身继续负责开发模块图。

不要把 production release store 套进 Vite dev。

---

## pnpm start

这是完整 production 行为验证入口。

流程：

```bash
pnpm build
pnpm start
```

能够本地真实验证：

- production Vite chunks
- release store
- HTML no-cache
- immutable assets
- old asset retention
- `/__qualy/release`
- runtime update detection
- client protocol
- production server pin

不需要等 CI/CD。

---

# 15. Browser ReleaseCoordinator

新增：

```text
packages/web/runtime/src/release.ts
```

并 export：

```text
@qualy/web-runtime/release
```

这个文件本身无 import side effects。

提供显式：

```ts
createReleaseCoordinator(...)
```

或：

```ts
installReleaseCoordinator(...)
```

Composition root 传入：

```ts
webRelease
```

不能让 runtime package 自己 import：

```text
virtual:qualy/release
```

---

# 16. Coordinator 状态模型

建议：

```ts
type ReleaseState =
  | {
      kind: 'current'
    }
  | {
      kind: 'update-available'
      latest: ReleaseProbe
    }
  | {
      kind: 'reload-required'
      reason: 'release-skew' | 'asset-load-failed' | 'client-protocol'
      latest?: ReleaseProbe
    }
```

Coordinator 提供：

```ts
subscribe(listener)
getSnapshot()
check(options)
dismissAvailable()
requireReload(reason, details?)
reload()
start()
stop()
```

React 通过：

```ts
useSyncExternalStore
```

消费。

---

# 17. Update check 策略

不要高频 polling。

启动时记录：

```text
current webRelease
lastCheck = now
```

事件：

### visibilitychange

当页面重新 visible：

```text
如果距离上次 check >= 5min
    GET /__qualy/release
```

### pageshow

如果：

```ts
event.persisted === true
```

说明可能从 bfcache 恢复旧 document：

```text
force check
```

### online

浏览器重新上线时：

```text
如果之前处于 asset-load-failed
或已有很久没检查
    check
```

### concurrency

多个事件同时触发：

```text
只允许一个 in-flight probe
```

共享 Promise。

---

# 18. Probe 的判断原则

```ts
latest.releaseId !== current.releaseId
```

才表示：

```text
有新版 Web release
```

不要根据：

- 日期
- SemVer
- assembly hash
- API version

猜 Web update。

probe 请求：

```ts
fetch('/__qualy/release', {
  cache: 'no-store',
})
```

失败时：

```text
普通 background check:
    静默忽略

preload failure recovery:
    转 asset-load-failed
```

不能把网络失败误报成：

```text
Qualy 已更新
```

---

# 19. vite:preloadError

Coordinator 安装时监听：

```text
vite:preloadError
```

立即：

```ts
event.preventDefault()
```

然后 force probe。

结果：

### A. endpoint 成功，releaseId 不同

```text
reason = release-skew
reload-required
```

文案：

```text
Qualy 已更新

当前版本无法继续加载该页面。
刷新后即可继续使用。

[刷新页面]
```

### B. endpoint 成功，releaseId 相同

说明不是 deploy skew。

可能：

- 网络错误
- 浏览器 extension
- asset 临时失败

显示：

```text
页面资源加载失败

请检查网络后刷新页面。

[刷新页面]
```

不要宣称系统更新。

### C. endpoint 也失败

同样：

```text
asset-load-failed
```

不要猜。

---

# 20. 不要尝试 retry 同一个 dynamic import

不要设计：

```text
dynamic import failed
→ import() again
```

浏览器 / module loader 对 failed import 的行为并不适合作为可靠恢复机制。

这个场景最终恢复动作就是：

```text
full document reload
```

但必须先给用户说明，而不是每次失败自动强刷。

---

# 21. Release recovery UI 必须位于 Runtime 之外

这是非常重要的实现边界。

不要把 blocking recovery 只放在：

```text
RuntimeProvider
Toaster
Manifest
Page component
```

因为发生故障时这些东西本身可能还没加载成功。

建议：

```text
main.tsx
↓
ReleaseProvider / coordinator
↓
App
    ReleaseRecoveryGate
        ColdStart
            I18nProvider
            ThemeProvider
            UiProvider
            RuntimeProvider
```

`ReleaseRecoveryGate` 位于能够独立 takeover 的足够高位置。

---

# 22. Recovery 文案与 bootstrap i18n

刚刚建立的：

```text
bootstrapMessages
```

继续承担：

> catalog 还没准备好时必须能够出现的文案。

为 release recovery 增加少量必要 copy。

例如：

```text
updateAvailableTitle
updateAvailableHint
reload

releaseSkewTitle
releaseSkewHint

assetFailedTitle
assetFailedHint
```

中文：

```text
Qualy 已更新
刷新后即可使用最新版本。

当前版本无法继续加载该页面。
刷新后即可继续使用。

页面资源加载失败
请检查网络后刷新页面。

刷新页面
```

英文给正常自然表达。

正常 runtime catalog 中也添加对应 `common/*` messages。

测试保证 bootstrap copy 与 common zh-CN catalog 保持一致。

不要直接同步 import 整个 catalog 到 boot graph。

---

# 23. 正常“有新版”不要自动 reload

普通 visibility probe 检测到：

```text
A != B
```

状态：

```text
update-available
```

但应用继续运行。

显示一个低打扰的 persistent notice / toast：

```text
Qualy 已更新

刷新后即可使用最新版本。

[稍后] [刷新]
```

“稍后”：

- 当前 tab 不再重复显示同一个 releaseId。
- 如果以后检测到 C，再重新提示。
- 不阻止操作。

不要：

```text
setInterval + 自动 location.reload()
```

特别是管理员可能正在编辑表单。

---

# 24. Blocking 与 non-blocking 的区别

只有以下情况 blocking：

```text
vite:preloadError
client protocol unsupported
```

此时当前 app 已不能保证正常继续。

普通：

```text
发现服务器有新 release
```

只是 non-blocking。

---

# 25. HTML 入口资源失败的恢复

`vite:preloadError` 只能在应用 JS 已经运行以后工作。

如果浏览器拿到旧 HTML，但它引用的 entry JS 本身已经不存在：

```text
应用 JS 根本不会启动
```

这时只能依赖现有 index.html boot/watchdog。

因此增强当前 boot script：

把现有 20s watchdog 的展示逻辑提取成幂等：

```text
showRecovery(kind)
```

增加 capture-phase：

```text
window error
```

如果：

```text
#qualy-boot 仍然存在
并且失败目标是：
SCRIPT
或 stylesheet LINK
并且 URL 属于当前 origin / assets
```

立即显示：

```text
页面资源加载失败，刷新页面
```

不要等 20 秒。

普通长时间未接管仍保持现有：

```text
20s:
加载时间较长，刷新页面
```

所有文字继续来自 bootstrap copy data block。

修改 inline boot script 后必须同步：

```text
INLINE_BOOT_SCRIPT_HASH
```

并让现有 `index-html.test.ts` 继续守住字节完全一致。

---

# 26. API client identity

不要让插件页面自己加 header。

当前所有 HttpApiClient 最终都经过：

```text
@qualy/web-runtime/api.ts
clientFor()
```

就在这里集中加入：

```text
X-Qualy-Web-Release: <releaseId>
X-Qualy-Client-Protocol: <number>
```

但是 reusable runtime 不应 import Vite virtual module。

所以：

`RuntimeProvider` 增加类似：

```ts
clientIdentity?: {
  releaseId: string
  clientProtocol: number
}
```

apps/web：

```ts
<RuntimeProvider
  registry={registry}
  clientIdentity={webRelease}
/>
```

tests/custom ClientProvider 仍允许不提供。

---

# 27. Effect HttpClient 实现要求

不要直接 monkeypatch：

```ts
window.fetch
```

继续在 Effect HttpClient / HttpApiClient transport 层完成。

在写代码前阅读仓库对应 Effect v4 源码，找到当前版本实际支持的：

- request mapping / request header transform
- response effect inspection
- transform composition

现有：

```text
withoutTracePropagation
```

继续保留。

最终 transport 同时负责：

```text
no fake trace propagation
+
Qualy browser identity headers
+
compatibility response signal
```

但实现 API 名必须来自实际源码，不允许按设计文档猜。

---

# 28. Server client compatibility middleware

新增 host-level middleware，例如：

```text
apps/server/src/client-compatibility.ts
```

它只关心：

```text
/api/*
```

不影响：

```text
/health
/__qualy/release
static shell
```

规则：

### 没有 X-Qualy-Client-Protocol

通过。

原因：

不是所有 API client 都一定是 Qualy Web：

- CLI
- 外部集成
- 测试 client

不能因为缺 browser header 把整个 API 变成 Web-only。

### 有合法 protocol 且：

```text
min <= protocol <= max
```

通过。

### 有 header 但不支持

直接返回 infrastructure response：

```http
409 Conflict
X-Qualy-Client-Unsupported: 1
Content-Type: application/json
Cache-Control: no-store
```

body：

```json
{
  "code": "QUALY_CLIENT_PROTOCOL_UNSUPPORTED",
  "received": 1,
  "supported": {
    "min": 2,
    "max": 2
  }
}
```

不进入具体业务 handler。

---

# 29. Middleware 顺序

必须继续尊重 origin/security。

兼容检查不应在 origin guard 之前泄漏额外信息。

目标语义：

```text
request context
access log
metrics
response headers
origin guard
client compatibility
router
```

根据 Effect middleware 实际包裹方向正确实现。

必须用测试证明顺序，而不是只看代码排列猜。

---

# 30. 浏览器收到 client unsupported

浏览器 transport 在 raw response 层看到：

```text
status = 409
X-Qualy-Client-Unsupported = 1
```

通知 ReleaseCoordinator：

```text
reload-required
reason = client-protocol
```

UI：

```text
Qualy 需要更新

当前页面版本已无法与服务器继续通信。
刷新后即可继续使用。

[刷新页面]
```

原 API request 可以继续按原有错误路径失败。

不要试图把 compatibility failure 强塞进每个插件的 typed domain error union。

它是基础设施信号，不是业务错误。

---

# 31. 不要强制要求 server 与 browser releaseId 相等

API request 可以发送：

```text
X-Qualy-Web-Release
```

但 server 不应该：

```text
if releaseId !== server releaseId
    reject
```

原因：

我们明确希望：

```text
旧 Web A
+
新 Server B
```

在兼容窗口内继续正常运行。

只根据：

```text
clientProtocol
```

判断硬兼容。

releaseId 主要用于：

- diagnostics
- logs
- update detection

不是 compatibility gate。

---

# 32. Runtime API compatibility rollout

未来 breaking change 必须遵守：

```text
Expand
↓
新 server 支持 protocol 1 + 2
↓
Deploy server
↓
Deploy Web protocol 2
↓
等待旧 client 淘汰
↓
Contract
↓
server min protocol 提升到 2
```

禁止：

```text
同时删除旧 API 字段
+
发布新 Web
+
假设所有浏览器马上刷新
```

浏览器是长生命周期 client。

---

# 33. Server pin + shared asset store 对未来蓝绿部署的意义

未来流程可以：

```text
当前：
Server A
pinned Release A

部署：
installer 安装 Release B
current -> B
但 Server A 已经 pin A
所以仍然服务 A

启动 Server B
Server B 读取 current
pin B

健康检查 B

切流量：
A → B

A drain / shutdown
```

期间 shared store：

```text
assets A
assets B
```

都存在。

所以运行中的旧 tab：

```text
A lazy chunk
```

即使请求落到新 Server B，也能继续从 shared asset store 得到旧 hashed file。

这是最终生产模型。

---

# 34. 未来 Docker/CI/CD 要求

不要把历史 asset retention 只放在容器 writable layer。

否则：

```text
Container A 被删除
↓
A assets 同时消失
```

版本漂移问题重新出现。

未来 deployment：

```text
persistent assetRoot
```

应该是：

- host volume
- persistent Docker volume
- 或之后迁移 COS/CDN

例如：

```text
/var/lib/qualy/web
```

CI build 产生 release artifact。

部署时调用同一个：

```text
installWebRelease(source, persistentStore)
```

然后启动新 Qualy process。

当前本地仍使用：

```text
packages/plugins/infra/web/client-dist
```

即可。

---

# 35. 当前 CI 需要修改的地方

CI 已经执行：

```text
pnpm test
pnpm build
plugin chunk sentinel
pnpm qualy deploy
production smoke
```

保留顺序。

普通 tests 仍然必须在 build 前运行。

当前：

```bash
test -f packages/plugins/infra/web/client-dist/index.html
```

将失效。

不要换成另一个 Bash hardcode。

建议增加跨平台工具：

```text
tools/quality/check-staged-web.ts
```

它：

1. 读取 `current.json`
2. 校验 current release metadata
3. 校验 release/index.html
4. 校验所有 declared assets 存在
5. 校验 assembly fingerprint
6. 输出当前 releaseId

CI 改：

```bash
node tools/quality/check-staged-web.ts
```

---

# 36. 更新 index-html tests

当前：

```text
client-dist/index.html
```

检查必须适配 release store。

不要把测试复制一套 current-pointer parser。

让 `@qualy/web-build/release-store` 暴露纯 FS helper，例如：

```ts
readCurrentRelease(...)
```

test 使用它找到：

```text
releases/<current>/index.html
```

继续验证：

```text
staged inline script bytes
==
source inline script bytes
```

CSP invariant 不得削弱。

---

# 37. @qualy/plugin-web tests

现有 `effect-web.test.ts` 使用自己的临时 assetRoot，非常好。

修改 fixture 为新的 release store：

```text
tmp/
  current.json
  assets/
  releases/test-release/
    index.html
    .qualy-release.json
```

继续禁止测试依赖真实 `pnpm build`。

增加测试：

### serving

```text
browser path
→ pinned shell

/api/nope
→ 404, not HTML
```

### asset cache

```text
/assets/current-hash.js
→ 200
→ immutable
```

### retained old asset

store 中放一个 current shell 不引用的：

```text
/assets/old-hash.js
```

仍然：

```text
200 + immutable
```

### shell public file

```text
/favicon.svg
→ no-cache
→ NOT immutable
```

### release endpoint

```text
/__qualy/release
→ exact pinned release
→ no-store
```

### assembly mismatch

保持现有：

```text
release metadata resolutionHash != AssemblyInfo
→ server build fails
```

### missing metadata/current

全部启动失败。

### pin invariant

这是关键测试：

1. server 启动时 current=A。
2. 请求 `/` → A。
3. 在磁盘把 current 改成 B。
4. 再请求 `/` → 仍然 A。
5. `/__qualy/release` → 仍然 A。

证明 process 没有 live-follow `current.json`。

---

# 38. Release store unit tests

新增独立测试。

### install A

断言：

```text
current=A
A shell exists
A assets exists
```

### A → B

断言：

```text
current=B
A shell retained
B shell exists
A asset retained
B asset exists
```

### asset collision

同 filename，不同 bytes：

```text
throws
current unchanged
```

### incomplete installation

故意让 source metadata/file 缺失：

```text
throws
current remains previous
```

### GC

A/B/C/D/E/F + timestamps：

验证 retained release union 和 asset reference GC。

### duplicate install

同一个 release 再 install：

- identical → idempotent 或明确安全成功
- metadata/content 不同 → hard fail

releaseId 绝不能静默覆盖已有不同 release。

---

# 39. ReleaseCoordinator tests

Coordinator 应设计为可注入：

- fetch
- clock
- event target

不要所有测试都依赖真实 window timer。

测试：

1. same release → current
2. different release → update-available
3. background probe 网络失败 → 保持原状态
4. preload error + different release → release-skew
5. preload error + same release → asset-load-failed
6. preload error + probe failure → asset-load-failed
7. concurrent check → only one fetch
8. visibility < throttle → no check
9. visibility after throttle → check
10. persisted pageshow → force check
11. dismiss B → B 不重复提示
12. later C → 再提示
13. client protocol notification → reload-required
14. blocking state 不被普通成功 probe 降级掉

---

# 40. Browser UI tests

增加浏览器层测试：

### update available

显示：

```text
Qualy 已更新
稍后
刷新
```

“稍后”不 reload。

### release skew

blocking screen。

### resource failure

不得写“Qualy 已更新”。

### locale

zh-CN 与 en-US 都验证。

### reload action

测试可注入 reload handler，不要真的把 Vitest 页面 reload 掉。

---

# 41. Production smoke 增强

现有 smoke 继续验证：

- health
- shell
- manifest
- CSP
- hashed asset
- Brotli
- shutdown

增加：

### shell cache

```text
GET /
Cache-Control = no-cache
```

### favicon

```text
GET /favicon.svg
Cache-Control = no-cache
不包含 immutable
```

### release probe

```text
GET /__qualy/release
200
Cache-Control = no-store
```

读取本地 current release metadata，断言：

```text
probe.releaseId == staged current releaseId
```

### current hashed asset

继续断言 immutable。

---

# 42. 本地 A → B 手工验收场景

必须实际验证一次。

## Production simulation

```bash
pnpm build
pnpm start
```

浏览器打开，记录：

```text
Release A
```

保持 tab 不刷新。

停止 server。

改一个 lazy page 文件。

```bash
pnpm build
pnpm start
```

得到：

```text
Release B
```

检查 store：

```text
A assets 仍存在
B assets 存在
current=B
```

旧 A tab：

1. 打开之前没打开过的 lazy page。
2. 旧 A chunk 应该仍能 200。
3. 不应该白屏。
4. tab 从后台回来后检测 B。
5. 显示“Qualy 已更新”。
6. 点刷新。
7. 新页面运行 B。

---

# 43. Missing old chunk hard recovery 手工验收

手工复制环境或测试 fixture：

1. 浏览器运行 A。
2. 发布 B。
3. 故意删除 A 的某个尚未加载 lazy chunk。
4. 进入该页面。

预期：

```text
vite:preloadError
↓
probe says B
↓
blocking:
Qualy 已更新
当前版本无法继续加载该页面
[刷新页面]
```

不能：

```text
白屏
无限 spinner
raw JS error
```

---

# 44. Network failure 手工验收

当前 release 不变。

DevTools offline。

打开尚未加载的 lazy page。

预期：

```text
页面资源加载失败
```

不能说：

```text
Qualy 已更新
```

恢复网络后点击刷新正常。

---

# 45. Development 手工验收

启动：

```bash
pnpm dev
```

记录：

```text
/__qualy/release
dev-A
```

### 修改普通 React component

HMR：

```text
release still dev-A
无 update notice
```

### 修改 backend

backend replacement：

```text
Vite 仍 dev-A
无 update notice
```

### 真正 restart Web dev service / 整个 pnpm dev

新：

```text
dev-B
```

旧 tab 检测：

```text
dev-A != dev-B
```

可提示刷新。

---

# 46. API protocol tests

Server middleware：

### 无 header

```text
pass
```

### protocol=1, range 1..1

```text
pass
```

### protocol=0

```text
409
unsupported header
```

### protocol=2, server max=1

```text
409
```

### future compatibility simulation

server range：

```text
1..2
```

client 1 与 2 都通过。

---

# 47. Client transport tests

验证每个 HttpApiClient request 都携带：

```text
X-Qualy-Web-Release
X-Qualy-Client-Protocol
```

不允许每个插件重复实现。

验证 raw response：

```text
409 + X-Qualy-Client-Unsupported
```

能触发 coordinator compatibility signal。

需要按照 Effect source policy 用真实当前版本 API 实现和测试。

---

# 48. Cross-tab 同步（建议本次做）

ReleaseCoordinator 可以使用：

```text
BroadcastChannel('qualy:release')
```

一个 tab 检测到：

```text
Release B
```

广播：

```json
{
  "type": "release-observed",
  "releaseId": "B"
}
```

其他旧 tab 可以立即进入：

```text
update-available
```

不必等自己下一次 visibility check。

要求：

- 不支持 BroadcastChannel 时静默退化。
- 收到的数据按 contract 校验。
- blocking failure 仍以当前 tab 自己的错误为准。
- 不在 channel 传业务数据。

这是低成本改进，可做。

---

# 49. 不做 Service Worker

本任务明确不要：

```text
Service Worker
Workbox
PWA precache
offline-first
```

原因：

当前需要解决的是：

```text
release lifecycle
```

而不是 offline。

SW 会再增加：

```text
browser HTTP cache
+
SW cache
+
running JS
+
server deployment
```

四层版本状态。

当前没有收益。

---

# 50. 明确禁止的简化方案

不要实现以下方案。

### 方案 A

```ts
window.addEventListener('vite:preloadError', () => location.reload())
```

无条件自动刷新。

错误原因不一定是版本更新，而且可能破坏未保存状态。

### 方案 B

每 30 秒轮询 version。

没有必要。

使用：

```text
visibility
pageshow/bfcache
online
failure
```

即可。

### 方案 C

build 后直接：

```text
rm -rf client-dist
```

这是本任务要消灭的问题。

### 方案 D

把 releaseId 当 API compatibility。

错误。

### 方案 E

把 resolutionHash 当 Web build ID。

错误。

### 方案 F

所有旧版本 API 永久兼容。

不需要。

只实现 protocol compatibility window。

### 方案 G

给 hashed assets `no-cache`。

错误。

hashed asset 应长期 immutable。

### 方案 H

给 favicon 等未 hash URL `immutable`。

也错误。

### 方案 I

每个请求重新读取 current.json。

错误。

server 必须 pin release。

---

# 51. 建议的文件改动图

预计：

```text
packages/contracts/release/
  package.json
  src/index.ts

packages/build/web/src/
  vite.ts
  release-vite.ts            # 可选拆分
  release-store.ts
  stage.ts

packages/build/web/package.json

apps/web/
  vite.config.ts
  src/
    main.tsx
    App.tsx
    virtual-qualy-release.d.ts
    release-ui.tsx            # 如 UI 不放 runtime
  tests/
    release.browser.test.tsx

packages/web/runtime/
  package.json
  src/
    release.ts
    api.ts
    index.tsx                  # RuntimeProvider clientIdentity

packages/web/i18n/
  src/
    messages.ts
    bootstrap.ts
    catalogs/zh-CN.ts
  tests/...

packages/plugins/infra/web/
  package.json
  src/
    server/index.ts
  tests/
    effect-web.test.ts
    ...

apps/server/src/
  client-compatibility.ts
  serve-middleware.ts

tools/quality/
  check-staged-web.ts
  smoke-production.ts

tools/tests/
  index-html.test.ts

.github/workflows/ci.yml

STATUS.md
```

根据实际职责可以调整文件拆分，但不要跨越上述架构边界。

---

# 52. 建议实现顺序

## Phase A：Release identity

先完成：

```text
release contract
qualyRelease Vite plugin
virtual module
production build metadata
dev endpoint
```

测试。

---

## Phase B：Release store

完成：

```text
installWebRelease
shared assets
versioned shell
current pointer
compression
retention/GC
```

修改 stage。

测试 A→B retention。

---

## Phase C：Production serving

修改 plugin-web：

```text
pin current release
shared asset serving
shell serving
release endpoint
cache split
assembly verification
```

先把 production smoke 修通。

---

## Phase D：Browser recovery

完成：

```text
ReleaseCoordinator
visibility/pageshow
vite:preloadError
blocking recovery
normal update notice
bootstrap i18n
HTML entry asset failure recovery
```

---

## Phase E：API compatibility

完成：

```text
client identity headers
server protocol middleware
unsupported client signal
blocking recovery
```

---

## Phase F：CI / hardening

完成：

```text
check-staged-web
smoke
browser tests
cross-tab optional
docs
STATUS
```

---

# 53. 建议提交拆分

遵守 Conventional Commits，英文。

可以按：

```text
feat(web): introduce web release identities

refactor(web): stage web builds into a retained release store

feat(web): serve pinned releases and retained hashed assets

feat(web): recover cleanly from browser release skew

feat(server): gate incompatible web client protocols

test(web): cover release skew and production retention
```

不要写内部 phase 编号进 commit message。

---

# 54. 最终验收命令

至少真实执行：

```bash
pnpm qualy resolve --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:browser
pnpm test:browser:webkit
pnpm build
node tools/quality/check-staged-web.ts
node apps/web/scripts/check-chunks.ts
pnpm qualy database check
```

数据库环境允许时：

```bash
pnpm qualy deploy
node tools/quality/smoke-production.ts
```

然后做上面描述的手动 A→B production skew 验收。

所有结果摘录进 `STATUS.md`。

---

# 55. Definition of Done

只有全部满足才算完成。

1. `pnpm build` 不再删除所有旧 hashed chunks。
2. 两次 build 后 A/B chunks 能共存。
3. production server 启动时 pin release。
4. server 运行期间 current pointer 改变不会改变它服务的 shell。
5. `index.html` 和未 hash public files `no-cache`。
6. `/assets/*` immutable。
7. `/__qualy/release` production/dev 都存在且 no-store。
8. `pnpm dev` 普通 HMR/backend reload 不产生 update notice。
9. Vite restart 可以产生新 dev release identity。
10. 正常检测到新版不会自动刷新。
11. `vite:preloadError` 有明确 recovery screen。
12. network preload failure 不谎称“系统已更新”。
13. entry JS/CSS 在应用启动前失败时，HTML shell 能立即提供刷新入口。
14. API client 自动带 release/protocol headers。
15. server 能明确拒绝不兼容 Qualy Web client。
16. API protocol rejection 会进入 reload-required，而不是随机页面错误。
17. assembly fingerprint protection 仍然存在。
18. tests 仍能在 `pnpm build` 前正常运行。
19. production smoke 通过。
20. 不引入 Service Worker。
21. 不引入第二套 production web server。
22. 不破坏现有 dev supervisor/Vite 独立生命周期。
23. 不破坏 CSP boot script hash invariant。
24. 不破坏 ColdStart/theme/i18n 目前已经建立的首屏行为。

最终应形成这样的行为模型：

```text
                    ┌──────── browser running A ────────┐
                    │                                    │
Release A assets ───┤                                    │
Release B deploy ───┼─ old A assets remain available    │
                    │                                    │
                    └──────────────┬─────────────────────┘
                                   │
                          release probe sees B
                                   │
                     ┌─────────────┴─────────────┐
                     │                           │
                 app still works             chunk missing /
                     │                       protocol broken
                     │                           │
               non-blocking update          blocking recovery
                     │                           │
                user chooses refresh ────────────┘
                     │
                     ▼
                 new HTML B
                     │
                     ▼
                 running B
```

核心原则：

> 旧版本尽量继续可运行；新版可以被感知；真正不兼容时明确阻断；用户刷新后必须可靠恢复。

不要把 release deployment 当成缓存事故后的补丁，而要把它作为 Qualy runtime 的正式生命周期协议。

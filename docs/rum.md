# Qualy 浏览器可观测性与腾讯云 RUM 接入实施设计

状态：设计冻结候选
目标代码基线：`hprogq/qualy` `main` @ `9696efbdc5aae732f933996ba0c69e8168470219`
日期：2026-09-14

---

# 1. 结论

Qualy 应接入腾讯云 RUM，但不把腾讯云 Aegis SDK 直接写进业务代码，也不把 RUM 扩展成第二套全栈 observability。

最终职责边界：

```text
Browser
│
├── @qualy/web-observability
│       │
│       └── Tencent RUM provider
│              ├── JS / Promise error
│              ├── React component error
│              ├── JS/CSS resource failure
│              ├── Web Vitals / page performance
│              ├── release correlation
│              └── optional API client-side metrics
│
│              X-Qualy-Request-Id
│                       │
└───────────────────────┼─────────────┐
                        ▼             │
Server                                │
│                                     │
├── Qualy structured logs / CLS ◄─────┘
│       request_id
│       trace_id
│
└── Effect OTLP
        ↓
   OTel Collector
        ↓
   Tencent APM / TMP
```

现有 OTel 不做任何替换。Qualy 已经明确把服务端 traces / metrics 经标准 OTLP 输出，并要求应用本身不依赖腾讯云 APM/TMP/CLS SDK；RUM 应遵循同一种“能力有边界、vendor 不侵入业务”的哲学。

第一阶段不启用：

- Session Replay / 用户录屏；
- 点击行为采集；
- console 日志上报；
- API request/response body；
- request header；
- 用户姓名、学号、邮箱或内部用户 ID；
- WebSocket 自动监控；
- 静态资源全量测速；
- browser → server `traceparent`；
- RUM 作为产品 PV/用户行为分析系统。

第一阶段的核心目标只有四个：

```text
生产浏览器异常可见
        +
minified stack 能恢复源码
        +
错误知道来自哪个 Qualy release
        +
必要时可以通过 requestId 查到后端请求
```

腾讯 RUM SDK 原生覆盖 JS、Promise、Ajax 和资源加载异常；页面性能、API 测速、资源测速则是独立能力。

---

# 2. Qualy 当前架构基线

## 2.1 服务端 observability 已经完整，不重新建设

现有设计已经包括：

```text
Effect spans / metrics
        ↓
effect/unstable/observability
        ↓ OTLP
Collector
        ├── Tencent APM
        └── TMP

structured logs
        ↓
CLS

Audit / SignIn
        ↓
requestId + traceId
```

因此不安装 Aegis Node SDK，不把 server logs、traces、metrics 再发送一份给 RUM。

---

## 2.2 requestId 已经成为可靠浏览器—后端关联键

当前 `/api/**` 与 `/health/**` 响应统一返回：

```http
X-Qualy-Request-Id: <uuid>
```

这个值来自 Qualy 自己 mint 的 `RequestContext.requestId`，不进入业务 JSON body；静态资源不携带该 header。

因此第一阶段无需为了 RUM 修改后端 tracing。

关联方式：

```text
RUM event
   │
   │ X-Qualy-Request-Id
   ▼
CLS / structured log
   │
   │ trace_id
   ▼
Tencent APM trace
```

---

## 2.3 Qualy 已有非常合适的 React 错误捕获边界

所有动态插件：

```text
layout
page
slot
renderer
```

均经过 `PluginComponentBoundary`。

该 boundary 已有：

```ts
onError?: (error: unknown) => void
```

并在 `componentDidCatch` 中拥有：

```text
error
componentId
component kind
```

这些正是 RUM 最需要的诊断上下文。

因此：

```text
业务插件
```

不得直接出现：

```ts
aegis.error(...)
```

错误监控必须集中在 Web Runtime 边界。

---

## 2.4 页面具有稳定的低基数身份

Qualy 的页面不是匿名 pathname，而有：

```ts
PageRef {
  id
  path
}
```

其中 `path` 可以是：

```text
/assessment/batches/:batchId
```

并且 contract 明确禁止 page path 自带 query/hash。

React Router 当前已经通过 manifest 中的 page pattern 对 pathname 做 `matchPath()`。

因此 RUM 不应该看到：

```text
/assessment/batches/0199f03e-.../review?studentId=2023...
```

而应该看到：

```text
page.id = assessment/review
route   = /assessment/batches/:batchId/review
```

这也是 Qualy 后端 OTel 使用 route template 避免高基数的同一原则。

---

## 2.5 Browser Assembly 是 superset build

这是本设计非常重要的前提。

`Ui.browser()` 声明的模块通过 BrowserModules extension point，被 Vite browser aggregate 作为 side-effect import 加入 bundle。

而当前 Vite plugin 有意设计为：

```text
development / browser tests
→ active plugin set

production vite build
→ all plugin superset
```

目的是部署后启用一个插件时不必重新构建 Web release。

因此即使：

```yaml
'@qualy/plugin-rum-tencent':
  enabled: false
```

production artifact 中仍可能包含腾讯 provider 的 lazy chunk。

这意味着：

> disabled 的含义应是“不初始化、不下载 Aegis chunk、不上报、不扩大 CSP”，而不是“构建制品里一个字节都不存在”。

这是当前 Browser Assembly 模型的自然结果，不应为了 RUM 改变它。

---

# 3. 目标与非目标

## 3.1 必须实现

1. 捕获 production 浏览器 JS exception。
2. 捕获 unhandled Promise rejection。
3. 捕获 React ErrorBoundary 已处理的插件组件异常。
4. 捕获影响应用运行的 JS/CSS chunk/resource failure。
5. SourceMap 将生产压缩堆栈还原到 TS/TSX。
6. 每条事件明确对应当前浏览器实际运行的 `webRelease.releaseId`。
7. 不上传业务敏感数据。
8. RUM 不可用不得影响 Qualy。
9. Provider disabled 时不得向腾讯发送任何请求。
10. Provider implementation 不泄漏进业务插件。
11. 保留以后迁往 Sentry/其他 RUM 的结构空间。
12. 现有严格 CSP 不得放宽。
13. SourceMap 不得公开部署。
14. 普通 CI 不依赖腾讯云凭证或腾讯云网络。
15. 开发环境默认完全不向腾讯云上报。

---

## 3.2 第一阶段明确不做

```text
产品分析 / 用户画像
Session Replay
真实 UIN
表单行为追踪
点击热图
console 日志采集
业务日志
后端异常采集
后端 tracing
后端 metrics
接口 body 采集
公式源码采集
附件元数据采集
浏览器完整分布式 tracing
```

RUM 是 runtime diagnostics，不是 Audit，也不是 analytics。

---

# 4. 腾讯云 RUM 选型约束

当前 Web SDK 为 `aegis-web-sdk`，npm 当前版本为 `1.41.15`；它自带 TypeScript declarations。

正式实施时不直接写：

```json
"aegis-web-sdk": "^1.41.15"
```

而是在 workspace catalog 精确 pin：

```yaml
aegis-web-sdk: 1.41.15
```

但版本号最终以 Phase 0 实际验证通过的版本为准。

Aegis 当前默认/主要配置中：

- `onError` 默认 `true`；
- `reportApiSpeed` 默认 `false`；
- `reportAssetSpeed` 默认 `false`；
- `pagePerformance` 默认 `true`；
- `webVitals` 默认 `true`；
- `blankScreen` 默认 `false`；
- `consoleLog` 默认 `false`；
- `clickElementLog` 默认 `false`；
- `aid` 默认 `true`；
- `spa` 默认 `false`；
- `random` 默认 `1`；
- `repeat` 默认 `5`。

国内 Web 上报推荐：

```text
https://rumt-zh.com
```

腾讯同时提供新加坡和美国上报域名；不同 endpoint 对应不同数据地域。Qualy 国内 provider 第一版固定使用国内 endpoint，不允许配置任意 URL。

---

# 5. 总体架构

新增两层，而不是在 `apps/web` 直接初始化 Aegis。

```text
┌─────────────────────────────────────────┐
│              Qualy Browser              │
│                                         │
│  App / web-runtime / release recovery   │
│                  │                      │
│                  ▼                      │
│       @qualy/web-observability          │
│        vendor-neutral boundary          │
│                  │                      │
│          provider registry              │
│                  │                      │
│                  ▼                      │
│   @qualy/plugin-rum-tencent             │
│                  │                      │
│                  ▼                      │
│          aegis-web-sdk                  │
└─────────────────────────────────────────┘
```

两者职责：

### `@qualy/web-observability`

Qualy-owned API。

它只认识：

```text
exception
diagnostic
page context
release
```

不知道：

```text
Aegis
Sentry
ext1/ext2/ext3
Tencent project ID
rumt-zh.com
```

### `@qualy/plugin-rum-tencent`

deployment provider。

它负责：

```text
腾讯 runtime config
Aegis SDK
CSP contribution
privacy mapping
Tencent hooks
SourceMap control-plane tooling
```

---

# 6. `@qualy/web-observability` 设计

> **实施经过两次移动,最终形态如下(2026-09-15)**:
>
> 1. **RUM Phase 1 取消了这个包**,整套(vocabulary + provider 注册表)按 Storage 的能力/提供者
>    模式落在 `@qualy/plugin-rum`(能力)与 `@qualy/plugin-rum-tencent`(提供者)。
> 2. **plugin-refactor Phase C 把其中 vendor-neutral 的一半抽了回来**,原因与本节当初的理由不同:
>    不是「observability 该有个包」,而是**平台层不得依赖可选插件**——组件边界、路由观察器和组合根
>    都要调用 `captureException`,而它们是平台。
>
> 现在:`@qualy/browser-observability`(`packages/web/observability/`)持有 port——
> `captureException` / `captureDiagnostic` / `setObservedPage` / `observedPageUrl` /
> `sanitizePath` / `sanitizeUrl` / `installSink(sink): Dispose` / early queue / bootstrap;
> `@qualy/plugin-rum` 只剩「哪个 provider」这件事(`BrowserRumProvider`、注册表、`startBrowserRum`);
> vendor 代码全在 `@qualy/plugin-rum-tencent`。下面的类型名 `BrowserObservabilitySink` 实际叫
> `ObservabilitySink`,`ExceptionContext` 的 `componentId` / `componentKind` 在 Phase B 换成了
> `surface: BrowserSurface`(见 docs/browser-public-surface.md)。

建议新建：

```text
packages/web/observability/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── bootstrap.ts
    ├── provider.ts
    ├── context.ts
    └── sanitize.ts
```

包名：

```text
@qualy/web-observability
```

不依赖 React，不依赖 Effect，不依赖任何 vendor SDK。

核心接口概念：

```ts
export interface ObservedPage {
  readonly pageId?: string
  readonly route?: string
}

export interface ExceptionContext {
  readonly componentId?: string
  readonly componentKind?: 'layout' | 'page' | 'slot' | 'renderer'
  readonly pageId?: string
  readonly route?: string
  readonly requestId?: string
}

export interface DiagnosticContext {
  readonly [key: string]: string | number | boolean | undefined
}

export interface BrowserObservabilitySink {
  captureException(error: unknown, context?: ExceptionContext): void
  captureDiagnostic(code: string, context?: DiagnosticContext): void
  setPage(page: ObservedPage): void
  destroy?(): void
}

export interface BrowserObservabilityProvider {
  readonly id: string

  start(input: {
    releaseId: string
    mode: 'development' | 'production'
  }): Promise<BrowserObservabilitySink | null>
}
```

公共操作：

```ts
registerBrowserObservabilityProvider(provider)

startBrowserObservability(webRelease)

captureException(error, context)

captureDiagnostic(code, context)

setObservedPage(page)
```

要求：

```text
任何 public method 都不得 throw 到业务调用方。
```

监控平台挂了，Qualy 必须继续运行。

这沿用现有 OTel 的原则：telemetry export 是 best-effort，不能成为产品 availability dependency。

---

# 7. Early error queue

仅仅在 React render 前初始化 RUM 还不够。

当前 `main.tsx` 顶层已经 import：

```text
App
release
ReleaseRecoveryGate
```

ESM 会先执行整个 import graph，之后才执行：

```ts
releases.start()
createRoot(...)
```

因此如果 App import graph 自身发生 exception，普通 `main()` 初始化仍然来不及。

建议：

```ts
import '@qualy/web-observability/bootstrap'
```

作为 `main.tsx` 第一个 import。

`bootstrap.ts` 只负责：

```text
window.error
window.unhandledrejection
```

保存到一个**内存 bounded queue**。

约束：

```text
最多 20 条
不使用 localStorage
不发送网络
不保存 DOM
不保存 form values
不读取 user/session
```

Provider ready 后：

```text
flush queue
detach temporary listeners
```

之后交给真正 RUM provider。

不要为了更早捕获异常去修改 `index.html` 的可信 inline boot script。

当前 inline script 由 CSP hash 精确固定；把第三方监控引入这里会把一个非常简单可靠的启动恢复层变成 vendor-dependent bootstrap。Qualy 刚刚建立的 CSP invariant 不值得为此破坏。

---

# 8. Tencent provider 插件

建议目录：

```text
packages/plugins/infra/rum-tencent/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── api.ts
    ├── server/
    │   ├── config.ts
    │   ├── routes.ts
    │   └── policy.ts
    └── client/
        ├── register.ts
        ├── provider.ts
        ├── privacy.ts
        ├── url.ts
        └── version.ts
```

插件：

```text
@qualy/plugin-rum-tencent
```

整体模式直接参考 `@qualy/plugin-storage-cos`：

```text
Plugin config
+
server Layer
+
ShellPolicy contribution
+
Ui.browser(...)
```

COS provider 已经证明了这种架构：deployment provider 自己注册 CSP，browser side 只注册 driver，而且大型 Browser SDK 延迟到真正使用时才 dynamic import。

---

# 9. Browser provider 必须 lazy-load Aegis

`client/register.ts` 应该非常小：

```ts
registerBrowserObservabilityProvider(tencentRumProvider)
```

不能：

```ts
import Aegis from 'aegis-web-sdk'
```

因为 production build 是 Browser superset。

否则即便某学校完全没启用 RUM：

```text
Aegis
```

仍可能进入 boot graph。

正确模式：

```text
register module executes
        ↓
probe public runtime config
        ↓
provider disabled?
   ├── yes → return null
   └── no
        ↓
dynamic import('aegis-web-sdk')
        ↓
new Aegis(...)
```

所以 disabled deployment：

```text
Aegis vendor chunk 存在于 superset artifact
但不会下载
不会执行
不会连接腾讯
CSP 也不会增加 rumt-zh.com
```

---

# 10. Runtime public config

RUM reporting ID 本身必须交给浏览器，所以不是 secret。

但不应该在 Vite build 时写入：

```text
VITE_TENCENT_RUM_ID
```

因为这会把 deployment config 固化进 artifact。

推荐 provider 暴露：

```text
GET /api/infra/rum/config
```

响应：

```json
{
  "schema": 1,
  "provider": "tencent-rum",
  "id": "pGUV...",
  "hostUrl": "https://rumt-zh.com",
  "environment": "production",
  "sampleRate": 1
}
```

不得包含：

```text
Tencent SecretId
Tencent SecretKey
numeric SourceMap ProjectID
user info
session
releaseId
```

尤其 `releaseId` **不能由服务器返回**。

假设：

```text
browser tab = release A
server       = release B
```

A 的浏览器异常必须记录：

```text
version=A
```

而不是 B。

因此版本唯一来源：

```ts
webRelease.releaseId
```

当前 release contract 就是专门区分“浏览器正在运行哪个 build”与服务器/assembly identity。

Provider disabled 时 endpoint 不存在：

```text
GET /api/infra/rum/config
→ 404
→ API_ROUTE_NOT_FOUND
```

浏览器 adapter 将它视为：

```text
provider inactive
```

而不是错误。

当前 `/api` fallback 已经保证 unmatched API route 返回结构化 TaggedError，而不会错误地落到 SPA shell。

production superset 下，这意味着 disabled RUM 仍会多一次很小的 config 404 probe；这个代价可以接受，换来的是 deployment 可在不重建 Web release 的情况下决定是否启用 provider。

---

# 11. 配置模型

默认 `qualy.yml`：

```yaml
'@qualy/plugin-rum-tencent':
  enabled: false
```

开发仓库默认关闭。

Provider 激活后，建议主要使用 deployment environment：

```text
QUALY_RUM_TENCENT_ID=
QUALY_RUM_TENCENT_ENV=production
QUALY_RUM_TENCENT_SAMPLE_RATE=1
```

第一版不提供任意 `hostUrl`。

固定：

```text
site = China mainland
host = https://rumt-zh.com
```

这样：

```text
数据地域
CSP
SourceMap 项目
runtime reporting endpoint
```

不会因一个自由字符串配置产生不一致。

腾讯当前建议国内业务使用国内地域，上报域名使用 `rumt-zh.com`。

---

# 12. RUM Version 与 Qualy Release

Aegis `version`：

```text
最多 60 字符
^[0-9a-zA-Z.,:_-]{1,60}$
```

Qualy release ID：

```text
最多 128
[A-Za-z0-9._-]
```

不能因此收紧 Qualy 的 release contract。

在 Tencent adapter 中建立唯一函数：

```ts
rumVersionForRelease(releaseId)
```

规则：

```text
若腾讯可直接接受
→ 原样

否则
→ q-<deterministic digest>
```

禁止简单：

```ts
releaseId.slice(0, 60)
```

因为会制造 collision。

浏览器初始化和 SourceMap uploader 必须共享**完全同一个 mapping 实现**。

因此：

```text
Qualy releaseId
      │
      ├── Browser ReleaseCoordinator
      ├── X-Qualy-Web-Release
      └── rumVersionForRelease()
                 │
                 ├── Aegis.version
                 └── SourceMap Version
```

---

# 13. 功能启用矩阵

## Phase 1 默认

| RUM 能力           | 状态         | 原因                                  |
| ------------------ | ------------ | ------------------------------------- |
| JS error           | 开           | 核心目标                              |
| Promise rejection  | 开           | 核心目标                              |
| React caught error | 手动上报     | ErrorBoundary 有上下文                |
| JS resource error  | 开           | lazy chunk 极重要                     |
| CSS resource error | 开           | 页面可用性                            |
| image/media error  | 默认过滤     | URL 更可能含业务资源，价值较低        |
| page performance   | PoC 通过后开 | 有价值，但需验证 lazy init 精度       |
| Web Vitals         | PoC 通过后开 | 有真实优化价值                        |
| API speed          | Phase 3 再开 | 避免 typed 4xx 噪声                   |
| asset speed        | 关           | chunk 数量高，第一版无必要            |
| SPA PV             | 关           | 不拿 RUM 做产品 analytics             |
| blank screen       | 关           | 与 ColdStart/ReleaseRecovery 语义重叠 |
| consoleLog         | 关           | 可能包含诊断或实体信息                |
| clickElementLog    | 关           | 隐私面无必要扩大                      |
| websocketHack      | 关           | Formula/editor reconnect 噪声大       |
| lag monitor        | 后续         | Monaco/复杂编辑器阶段再考虑           |
| memory/OOM         | 后续         | 当前优先级低                          |
| `aid`              | 初始关       | 不需要持久浏览器身份                  |
| `uin`              | 不设置       | 禁止真实用户身份                      |
| trace injection    | 关           | requestId 足够                        |
| Session Replay     | 不使用       | 敏感业务数据风险过高                  |

腾讯当前确实默认开启 page performance/Web Vitals，而 API/asset speed、blank screen、console/click、WebSocket 和卡顿均可单独控制。

---

# 14. 一个重要修正：第一阶段不要直接开 API Speed

Aegis 不只是“测速”，还自动监控 Ajax/Fetch 异常。官方错误监控明确把 Ajax 请求异常列为自动错误来源。

而 Qualy 有很多合法 4xx：

```text
400 BAD_REQUEST
401 session expired
403 ACCESS_DENIED
404 *_NOT_FOUND
409 optimistic conflict / protocol
422 validation
```

这些不是 JavaScript crash。

如果不做控制，RUM 很容易变成：

```text
大量正常 domain outcome
→ Ajax error
→ 前端异常面板
```

因此 Phase 1：

```ts
reportApiSpeed: false
```

并在 `beforeReport` 中根据**经过实际 SDK 1.41.x 源码/类型确认过的字段**过滤 Ajax domain noise。

腾讯 Web SDK 明确允许 `beforeReport()` 返回 `false` 阻止一条错误日志上报。

如果 Phase 0 发现当前 SDK 没有可靠、公开的 status/url 字段可用于判断，不得靠解析错误字符串实现。

此时直接：

```text
第一阶段过滤全部 AJAX_ERROR
```

而不是制造脆弱逻辑。

5xx 已经有后端 OTel/APM/metrics。

浏览器 network error 的精细监控可以放 Phase 3。

---

# 15. 数据允许清单

RUM 允许发送：

```text
Qualy release / mapped RUM version
environment
stable page id
route template
component id
component kind
JS error message
JS stack
source file / line
hashed JS/CSS asset name
browser / OS / engine
normalized API route（Phase 3）
HTTP method/status/duration（Phase 3）
X-Qualy-Request-Id（Phase 3）
```

这里的：

```text
assessment/BatchPage
assessment/review
/layout-default/DefaultLayout
```

属于工程诊断身份，不是用户数据。

---

# 16. 数据禁止清单

不得上传：

```text
Cookie
Authorization
session id
CSRF token
raw query string
URL hash
UUID / raw entity id
学号
姓名
邮箱
手机号
身份证信息
组织成员详情
申报内容
审核意见
表单输入
搜索关键词
API request body
API response body
附件文件名
附件内容
COS 临时凭据
公式源码
公式测试 JSON
AuditEvent detail
SignInEvent detail
```

Aegis 配置必须明确：

```ts
api: {
  apiDetail: false,
  reportRequest: false,
  reqHeaders: [],
}
```

腾讯文档明确指出：

```text
apiDetail=true
```

会上传接口请求参数和返回值，而：

```text
reportRequest=true
```

会使接口信息全量上报。

Qualy 不允许开启这两个能力。

---

# 17. 隐私处理采用多层防线

不能仅依赖一个最终 hook。

顺序：

```text
① 不采
   apiDetail=false
   reportRequest=false
   no uin
   no req headers

② URL normalization
   pagePerformance.urlHandler
   reportApiSpeed.urlHandler

③ 类型级过滤
   beforeReport
   beforeReportSpeed

④ 最终 wire scrub
   beforeRequest

⑤ Browser test 拦截实际 outbound payload
```

Aegis Web SDK 当前提供：

```text
beforeReport
beforeReportSpeed
beforeRequest
```

其中 `beforeRequest` 在所有实际上报前执行，可以修改或返回 `false` 阻止发送；该能力要求 SDK ≥1.24.44。

不要使用早期讨论中的 `onBeforeSend` 命名；当前 Web 文档实际使用的是上述 hooks。

---

# 18. URL Sanitization

建立一个单独的纯函数模块：

```text
@qualy/web-observability/sanitize
```

不能把隐私处理写成 Aegis-specific regex。

页面首先通过 manifest 匹配：

```text
actual:
  /assessment/batches/019abc.../review

observed:
  pageId = assessment/review
  route  = /assessment/batches/:batchId/review
```

如果 manifest 尚未加载，则 fallback sanitizer：

```text
去 query
去 hash
UUID → :id
长随机 token → :id
长数字实体标识 → :id
百分号解码后的敏感片段不得原样保留
```

腾讯 RUM 本身也提供 `pagePerformance.urlHandler` 和 `reportApiSpeed.urlHandler`，官方示例就是把 `/user/1000`、`/user/1001` 聚合为 `/user/:id`。

但具体 normalization 规则由 Qualy 定义，Tencent adapter 只调用它。

---

# 19. 页面上下文接入

在：

```text
packages/web/runtime/src/route-builder.tsx
```

增加一个非视觉组件，例如：

```tsx
<ObservedRoute pages={options.manifest.pages} />
```

内部：

```text
useLocation()
+
matchPath(page.path)
+
setObservedPage({
  pageId: page.id,
  route: page.path
})
```

这样：

- 不修改每个业务 Page；
- 路由身份始终来自授权后的 manifest；
- 不暴露 route params；
- locale 切换无影响；
- provider 无关。

当前 `DocumentTitle` 已使用几乎同样的 matching 逻辑，因此不引入第二套路由解释。

---

# 20. React ErrorBoundary 接入

修改：

```text
packages/web/runtime/src/component-boundary.tsx
```

当前：

```ts
componentDidCatch(error) {
  console.error(...)
  this.props.onError?.(error)
}
```

调整为：

```text
console diagnostic
+
captureException(error, {
  componentId,
  componentKind: kind,
  current observed page
})
+
optional caller onError
```

保持用户界面行为完全不变。

重试仍然：

```text
setState({failed:false})
```

监控不得改变 recovery semantics。

还要增加 dedup：

```text
WeakSet<Error>
+
短 TTL fingerprint fallback
```

避免：

```text
React caught error
+
window.onerror
```

产生两份相同事件。

---

# 21. Missing component

当前 missing component 不是 throw，而是 console error：

```text
manifest 和 browser bundle 不一致
```

这种属于非常有价值的 deployment diagnostic。

改为：

```ts
captureDiagnostic('component-missing', {
  componentId,
  componentKind,
  releaseId,
})
```

不要伪装成 JavaScript exception。

Tencent provider 可映射到：

```text
reportEvent()
```

Aegis 当前提供 custom event `reportEvent`。

建议自定义事件只使用固定 code 和低基数字段：

```text
release-skew
client-protocol
component-missing
```

禁止把 Error message 或用户数据塞进 event name。

---

# 22. ReleaseRecovery 集成

当前 recovery reasons：

```text
release-skew
client-protocol
asset-load-failed
```

处理：

```text
update-available
→ 正常部署
→ 不上报

asset-load-failed
→ resource error 本身通常已经可见
→ 可额外发低频 diagnostic

release-skew
→ 发 diagnostic

client-protocol
→ 发 diagnostic
```

尤其 `release-skew` 很值得监控。

因为 Qualy release store 会保留旧版本 assets，让旧 tab 在新部署后仍可继续加载自己的 lazy chunks。

如果用户最终被迫进入 release-skew blocking recovery，通常意味着值得调查的 deployment/retention 状态。

---

# 23. Aegis 初始化时机

Provider registration module会随 `virtual:qualy/plugins` 很早进入 module graph。

推荐流程：

```text
web-observability bootstrap listeners
        ↓
browser modules evaluate
        ↓
Tencent provider registered
        ↓
GET /api/infra/rum/config
        ↓
active?
 ├── no → disabled
 └── yes
       ↓
dynamic import aegis-web-sdk
       ↓
new Aegis(...)
       ↓
flush early queue
       ↓
detach temporary global listeners
```

腾讯建议 Aegis 尽可能早初始化，否则早期错误或首屏性能可能丢失。

但 Qualy 不应为了早几十毫秒而：

- 阻塞 React；
- 同步等待腾讯；
- 把 Aegis 放进 inline boot；
- 让 disabled deployment 下载 Aegis。

所以 Phase 0 必须实际测试这种 lazy initialization 对：

```text
LCP
FCP
first-screen timing
JS exception
Promise rejection
```

的影响。

如果 page performance 数据由于 delayed init 不可靠，则：

```text
错误监控先上线
pagePerformance / WebVitals 延后
```

不能为了性能指标破坏 Qualy boot architecture。

---

# 24. SourceMap 是必须项

没有 SourceMap：

```text
shared-XYZ.js:1:48172
```

不是可接受的 production debugging。

当前 Vite 没有开启 source map。

Production 改为：

```ts
build: {
  sourcemap: 'hidden',
  ...
}
```

但是绝不能只改这一行。

---

# 25. 当前 release store 会错误公开 `.map`

当前 `installWebRelease()` 会：

```text
walk(dist/assets)
→ 所有非压缩 twin 文件
→ copy 到 shared assets
```

而 `.map` 甚至当前被列为 `COMPRESSIBLE`。

因此如果现在直接开启 hidden sourcemap：

```text
*.js.map
```

会被复制到：

```text
packages/plugins/infra/web/client-dist/assets/
```

并可公开访问。

必须同步修改 release store：

```text
*.map
*.map.br
*.map.gz
```

永远不属于 Web release asset。

建议：

```text
isDebugArtifact(file)
```

明确排除 `.map`。

同时将 `.map` 从：

```ts
COMPRESSIBLE
```

移除。

SourceMap 留在：

```text
apps/web/dist
```

直到上传工具完成即可。

---

# 26. staged artifact gate

增强：

```text
tools/quality/check-staged-web.ts
```

当前它已经检查：

```text
current release
index.html
所有声明 asset 存在
resolutionHash
```

增加：

```text
client-dist/**
```

不得存在：

```text
*.map
*.map.br
*.map.gz
```

这必须成为 load-bearing CI invariant。

---

# 27. SourceMap uploader

新增：

```text
tools/observability/tencent-rum-sourcemaps.ts
```

它是 control-plane tooling，不属于 Browser runtime，也不属于 server runtime。

输入：

```text
apps/web/dist
```

首先读取：

```text
.qualy-web-build.json
```

通过现有 release contract 解码，从而获得**构建本身的真实 releaseId**。

不得让 CI 手工再传一份：

```text
--version
```

否则 browser release 与 SourceMap version 可能漂移。

流程：

```text
read .qualy-web-build.json
        ↓
rumVersionForRelease(releaseId)
        ↓
find **/*.js.map
        ↓
calculate MD5
        ↓
DescribeReleaseFiles(ProjectID, FileVersion)
        ↓
已存在同名同 hash？
 ├── yes → skip
 └── no
       ↓
DescribeReleaseFileSign
       ↓
temporary COS credential
       ↓
upload map
       ↓
CreateReleaseFile
       ↓
DescribeReleaseFiles verify
```

腾讯 RUM 当前正式暴露：

```text
DescribeReleaseFileSign
CreateReleaseFile
DescribeReleaseFiles
```

三个 API；`ReleaseFile` 数据中包含 Version、FileKey、FileName、FileHash。

腾讯官方 SourceMap 自动上传示例同样采用：

```text
DescribeReleaseFileSign
→ COS upload
→ CreateReleaseFile
→ DescribeReleaseFiles
```

并使用临时 COS 凭据。

---

# 28. SourceMap control-plane secrets

Uploader 需要的 Tencent Cloud credential 与 browser reporting ID 完全不同。

建议 CI secrets：

```text
TENCENTCLOUD_SECRET_ID
TENCENTCLOUD_SECRET_KEY
QUALY_TENCENT_RUM_PROJECT_ID
```

这里 `PROJECT_ID` 是 numeric RUM control-plane project ID。

不是：

```text
Aegis reporting id
```

腾讯 API `CreateReleaseFile` 明确使用 numeric `ProjectID`。

这些 secrets：

```text
不能进入 qualy.yml
不能进入 qualy.lock.json
不能进入 .env.example 的真实值
不能进入 application runtime
不能进入 browser
不能写进 log
```

Uploader 通过腾讯 Cloud API permanent credential 换取短时 SourceMap COS credential。

---

# 29. Uploader 与正常 build 解耦

当前：

```text
pnpm build
→ vite build
→ stage.ts
```

不要改为：

```text
pnpm build
→ 必须成功访问 Tencent
```

推荐新增：

```text
pnpm rum:tencent:sourcemaps
```

> **实施偏离（2026-09-14）**：根 package.json 不放插件级命令——这是插拔式系统，终端命令由插件经
> `Cli.command` 注册。实际落地为 `qualy rum sourcemaps`：命名空间 `rum` 归当前 provider
> （`@qualy/plugin-rum-tencent`，一次只允许一个 provider，所以不会有第二个来抢），
> `context: 'assembly'`，模块懒加载，服务端 boot 不付费。实现从 `tools/observability/` 移进插件
> （`packages/plugins/infra/rum-tencent/src/cli/sourcemaps.ts`）。依赖用
> `tencentcloud-sdk-nodejs-rum`（220 KB）而不是 §47 写的整包（解包 44 MB）。

Deployment/release pipeline：

```text
QUALY_RELEASE_ID=...
pnpm build

pnpm rum:tencent:sourcemaps   # 有 production RUM 才跑

build/package/deploy
```

这样：

```text
Tencent RUM unavailable
```

不会让 Qualy 本身无法构建。

普通 PR CI：

```text
永远不需要 Tencent credentials
```

---

# 30. SourceMap uploader failure policy

命令本身：

```text
失败 → exit non-zero
```

因为显式执行上传工具的人需要知道上传失败。

但是：

```text
应用部署是否因此失败
```

由 deployment pipeline 决定。

推荐 production release 初期：

```text
SourceMap upload failure
→ release pipeline warning
→ 允许应用继续部署
```

稳定后可以改为 strict。

无论如何：

```text
RUM control plane
```

都不是 Qualy runtime availability dependency。

---

# 31. API request correlation：Phase 3

如果 Phase 3 开启 API speed：

```ts
reportApiSpeed: {
  urlHandler: normalizeApiUrl,
},
api: {
  apiDetail: false,
  reportRequest: false,
  reqHeaders: [],
  resHeaders: ['x-qualy-request-id'],
  usePerformanceTiming: false,
}
```

腾讯明确支持 response header allowlist。

当前 Qualy same-origin，因此读取：

```text
X-Qualy-Request-Id
```

不需要额外 CORS expose。

未来若前后端拆域，再显式增加：

```text
Access-Control-Expose-Headers
```

---

# 32. 为什么 `usePerformanceTiming` 第一阶段关闭

腾讯文档说明：

```text
usePerformanceTiming=true
```

依赖“请求 URL 唯一”，同 URL 并发可能错误匹配，并建议使用 timestamp 等方式保证唯一。

Qualy 不应该为了 RUM：

```text
给 API URL 人工添加 timestamp
```

所以继续使用 SDK 默认计时。

---

# 33. API URL 只允许 `/api/**`

Phase 3 的 API speed filter：

```text
same-origin + /api/**
```

其他：

```text
rumt-zh.com
COS
release probe
favicon
assets
third-party endpoint
```

全部过滤。

`beforeReportSpeed` 官方可以检查：

```text
url
type
duration
method
status
payload
```

并允许返回 `false` 阻止测速上报；其中 `payload` 提供本地判断，但官方说明它本身不会上报。

Qualy 可以利用这一点进行严格 allowlist，而不是 blocklist。

---

# 34. typed 4xx 处理

期望行为：

```text
2xx
→ speed metric

4xx expected domain outcome
→ 可有 speed metric
→ 不成为 RUM error issue

429
→ 可保留为 operational warning

5xx
→ 保留异常

status 0 / network failure
→ 保留异常
```

但只有在当前 pinned Aegis SDK 的 public hook payload 能可靠判断这些状态时才实现。

禁止：

```text
parse log.msg
```

去猜 HTTP status。

若无法可靠过滤：

```text
Phase 3 不启用 API speed
```

比错误数据污染更好。

---

# 35. Browser traceparent：暂缓

腾讯当前支持：

```ts
api: {
  injectTraceHeader: 'traceparent',
  injectTraceUrls: [...]
}
```

并建议使用 `injectTraceUrls` allowlist。

但 Qualy 当前 browser HttpClient 特意关闭 Effect 的 trace propagation，因为浏览器没有真实 exporter，不希望构造 orphan parent。

第一阶段已有：

```text
RUM
→ requestId
→ logs
→ traceId
→ APM
```

已经足够。

只有实际发现：

```text
大量问题发生在 request 抵达 server 之前
```

才进入未来 trace integration 阶段。

---

# 36. CSP

当前 shell：

```text
connect-src 'self'
```

插件可向 `connect-src` 增加精确 HTTPS host；wildcard、路径和明文 HTTP 都会被拒绝。

RUM plugin active 时：

```ts
ShellPolicy.register({
  owner: '@qualy/plugin-rum-tencent',
  'connect-src': ['https://rumt-zh.com'],
})
```

inactive 时：

```text
不贡献任何 endpoint
```

不要 CDN 引入 SDK。

使用 npm bundle：

```text
script-src
```

无需改变。

尤其禁止：

```text
'unsafe-eval'
*
https:
```

Qualy 已有 build gate 和真实 Chromium CSP enforce gate。

---

# 37. Aegis 版本升级门禁

Phase 0 安装 `aegis-web-sdk` 后立刻运行：

```text
pnpm typecheck
pnpm test
pnpm build
node tools/quality/check-csp-build.ts
node tools/quality/check-staged-web.ts
CSP enforce Chromium
```

如果 SDK bundle 出现：

```text
eval
new Function
Function(string)
```

则：

```text
拒绝该版本
```

而不是放宽 CSP。

这与当前 Qualy “browser bundle 不从字符串执行代码”的 invariant 一致。

---

# 38. Aegis 文档与源码 authority

腾讯 Web 文档存在新旧页面并存。

因此开发时 authority 顺序固定为：

```text
1. 实际 pin 的 aegis-web-sdk 类型定义 / package source
2. 当前腾讯云 Web RUM 官方文档
3. Phase 0 实际 browser/network probe
```

Phase 0 必须新增：

```text
docs/notes/aegis-web-sdk.md
```

记录实际验证：

```text
version
configuration field
hook payload
CSP behaviour
bundle behaviour
SourceMap matching rule
Ajax error shape
```

以后升级 SDK 时重新执行同一组 gate。

---

# 39. 推荐 Aegis 初始策略

仅作为设计目标；编码时必须按 pinned SDK 类型确认。

```ts
new Aegis({
  id: config.id,
  hostUrl: 'https://rumt-zh.com',

  version: rumVersionForRelease(webRelease.releaseId),
  env: mapEnvironment(config.environment),

  random: config.sampleRate,
  repeat: 5,

  aid: false,
  spa: false,

  onError: true,

  pagePerformance: {
    urlHandler: sanitizeObservedPageUrl,
  },

  webVitals: true,

  reportApiSpeed: false,
  reportAssetSpeed: false,

  blankScreen: false,
  consoleLog: false,
  clickElementLog: false,
  websocketHack: false,

  lagMonitor: {
    enabled: false,
  },

  api: {
    apiDetail: false,
    reportRequest: false,
    reqHeaders: [],
  },

  beforeReport,
  beforeReportSpeed,
  beforeRequest,
})
```

`aid:false` 需要在 PoC 中验证 RUM error/performance 分析是否仍满足需求。

如果影响可接受，保持关闭。

绝不设置：

```text
uin = Qualy user id
```

腾讯说明 UIN 本质上就是供业务侧索引用户的唯一身份。

Qualy 第一阶段没有必要承担这项数据治理成本。

---

# 40. 自定义字段映射

建议：

```text
version
→ Qualy release

ext1
→ pageId

ext2
→ componentKind

ext3
→ componentId / diagnostic code
```

这些必须是：

```text
低基数
工程含义
无业务身份
```

React caught error 可以使用：

```text
msg = normalized Error.message
trace = sanitized Error.stack
ext1 = pageId
ext2 = kind
ext3 = componentId
```

Aegis 支持主动 `error()` 并允许自定义 ext/trace 数据。

不要把：

```text
batchId
studentId
orgId
```

放进 ext。

---

# 41. Provider failure semantics

所有情况：

```text
config 404
config timeout
Tencent endpoint down
Aegis chunk load fail
Aegis constructor fail
privacy hook fail
report fail
```

都必须：

```text
Qualy 正常继续运行
```

最多：

```text
console.warn once
```

不得：

```text
显示 toast
显示全屏错误
卡 ColdStart
自动刷新
阻止 API
阻止登录
```

Observability 不能成为 observable application 的单点故障。

---

# 42. 分阶段实施

## Phase 0 — SDK / Tencent PoC 与危险点验证

预计：0.5～1.5 小时。

目标：

在正式改架构前确认腾讯能力真的满足 Qualy。

完成：

```text
创建测试 RUM application
记录 browser reporting ID
记录 numeric ProjectID

pin aegis-web-sdk candidate

验证：
JS throw
Promise rejection
JS chunk/resource failure
React caught error 的主动上报
beforeReport payload
beforeReportSpeed payload
beforeRequest payload
aid=false
CSP
bundle eval/new Function
```

额外制作一个最小 production source map：

```text
throw Error
→ minified build
→ upload SourceMap
→ 腾讯控制台恢复到真实 .tsx 文件 + 行号
```

必须完成 `docs/notes/aegis-web-sdk.md`。

Phase 0 Gate：

```text
CSP 不兼容
或
SourceMap 无法可靠恢复
或
隐私 hooks 无法稳定过滤
```

则停止正式接入，重新比较 Sentry/ARMS。

---

## Phase 1 — Vendor-neutral Browser Observability + Tencent Error Monitoring

预计：2～3 小时。

新增：

```text
@qualy/web-observability
@qualy/plugin-rum-tencent
```

完成：

```text
early bounded error queue
provider registry
runtime config endpoint
Tencent lazy adapter
CSP contribution
release mapping
URL sanitizer
privacy hooks
React boundary capture
missing-component diagnostic
route/page context
release-recovery diagnostic
```

默认：

```text
plugin disabled
```

第一阶段只要求 error monitoring 正常。

API speed 仍关闭。

验收：

```text
RUM down → Qualy 正常
plugin disabled → 无 Tencent network
plugin active → Aegis lazy download
React crash → fallback 正常 + RUM event
raw UUID/query → outbound payload 中不存在
CSP enforce → 通过
```

---

## Phase 2 — SourceMap Production Pipeline

预计：1.5～2.5 小时。

完成：

```text
Vite hidden source maps
release-store excludes *.map
remove .map compression handling
check-staged-web no-map invariant
Tencent SourceMap uploader
exact release→RUM version sharing
upload idempotence
real staging stack restoration
```

普通 CI 不使用 Tencent credentials。

验收：

```text
apps/web/dist
→ 有 .map

client-dist
→ 0 个 .map

Tencent RUM
→ 有对应 version SourceMap

人工 Error
→ stack 恢复真实 .tsx 行
```

---

## Phase 3 — API Client-side Performance 与 requestId Correlation

预计：1～2 小时。

仅在 Phase 0 已确认 hooks 的公开数据结构足够可靠后实施。

开启：

```text
reportApiSpeed
```

但只接受：

```text
same-origin /api/**
```

返回头仅：

```text
x-qualy-request-id
```

不上传 request body、response body、request headers。

验收：

```text
RUM API duration
server access duration
```

可以对照。

并能够：

```text
RUM requestId
→ CLS
→ traceId
→ APM
```

---

## Phase 4 — 上线前生产 rollout

预计：1～2 小时。

时间：

```text
正式上线前约 1～2 周
```

完成：

```text
production RUM application
production reporting ID
SourceMap ProjectID
CI secrets
alert rules
费用告警
隐私复核
staging soak 24～72h
production sample strategy
```

建议初始：

```text
random = 1
```

原因是 Qualy 当前流量规模远低于腾讯每天 50 万条免费额度；降低 random 会同时丢掉一部分真正异常，现阶段没有必要。腾讯当前国内 RUM 按量价格仍为 0.34 元/万条，每主账号每天共享 50 万条免费额度。

优先通过：

```text
关闭无用 feature
```

控制流量，而不是随机丢错误。

---

## Phase 5 — 可选 Browser→Server Trace Integration

上线运行一段时间后再决定。

只有发现：

```text
requestId correlation 无法覆盖大量真实故障
```

才启用：

```ts
injectTraceHeader: 'traceparent'
injectTraceUrls: [/^\/api\//]
```

腾讯当前推荐 `traceparent` 作为 RUM/APM 的 OpenTelemetry 协议。

开启前必须重新审查：

```text
Effect browser propagation policy
server traceparent inheritance
CORS
origin guard
sampling
RUM/APM trace semantics
```

不在当前接入范围内。

---

# 43. Tests

## Unit

必须覆盖：

```text
rumVersionForRelease
URL sanitizer
UUID masking
numeric id masking
query/hash stripping
provider registry
bounded queue
dedup
provider failure isolation
config schema
privacy hook
CSP source registration
release-store map exclusion
SourceMap file hashing/idempotence
```

---

## Browser tests

使用 fake provider，不访问腾讯：

```text
PluginComponentBoundary throw
→ fake sink 收到一次

Promise rejection
→ early queue / provider 收到

provider start rejects
→ UI 正常

route /items/<uuid>?student=...
→ event 只含 route pattern

ErrorBoundary retry
→ 正常恢复
```

---

## Production browser gate

继续运行现有：

```text
check-csp-build
check-staged-web
production smoke
Chromium CSP enforce
WebKit smoke
```

CI 当前已经真正启动 production host 并让 Chromium 在 enforce CSP 下打开关键页面，这一 gate 必须保留。

---

# 44. 真实腾讯 staging smoke

这部分不是普通 CI。

每次重大 SDK upgrade 或 production integration 变化执行：

```text
throw new Error(
  `qualy-rum-probe-${releaseId}`
)
```

验证：

```text
RUM event 收到
version 正确
environment 正确
stack 指向真实 TSX
line number 正确
component ID 正确
page ID 正确
```

然后准备测试数据：

```text
name = QUALY_PRIVATE_SENTINEL_NAME
studentNo = 999999999999
query = QUALY_PRIVATE_SENTINEL_QUERY
```

在腾讯控制台及实际 outbound payload 中搜索：

```text
必须 0 命中
```

这应成为隐私验收的硬 gate。

---

# 45. 告警策略

上线初期只设置少量信号。

建议：

```text
JS / Promise error
→ 错误数或错误率突然升高

新 release
→ error regression 人工观察

page performance
→ LCP 明显恶化后再定阈值

API
→ Phase 3 后再决定
```

不要一开始对：

```text
每一个 4xx
每一个 resource error
每一次 slow request
```

建立告警。

腾讯 RUM 告警支持错误日志、页面性能、静态资源、API、自定义事件等策略类型。

先运行一段时间取得 baseline，再冻结阈值。

---

# 46. CI / Deployment 安排

普通 CI：

```text
pnpm qualy resolve --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
check-staged-web
check-chunks
check-csp-build
production smoke
check-csp-enforce
browser suites
```

全部不依赖腾讯。

Release CI：

```text
QUALY_RELEASE_ID=<release>

pnpm build

if Tencent RUM production enabled:
    pnpm rum:tencent:sourcemaps

package / deploy
```

SourceMap uploader必须读取 `.qualy-web-build.json`，而不是接受另一个人工 version。

---

# 47. 依赖变更

workspace catalog：

```text
aegis-web-sdk = exact pinned version
tencentcloud-sdk-nodejs = exact pinned version
```

已有：

```text
cos-nodejs-sdk-v5
```

但 SourceMap tooling 若从 root `tools/` 执行，需要显式声明可解析依赖，不能依赖 pnpm accidental hoisting。

Tencent SDK 仅属于 tooling。

Aegis 仅属于：

```text
@qualy/plugin-rum-tencent
```

不能成为：

```text
@qualy/web-runtime
@qualy/web-observability
apps/web
```

直接 vendor dependency。

`apps/web` 只需要声明：

```text
@qualy/plugin-rum-tencent
```

作为 Browser Assembly 可解析插件 dependency。

---

# 48. package sideEffects

RUM provider package 应类似 COS：

```json
{
  "sideEffects": ["./src/client/register.ts"]
}
```

现有 COS provider 就是这一模式。

避免 bundler 错误 tree-shake provider registration。

---

# 49. 文件级改动预计

新增：

```text
packages/web/observability/**
packages/plugins/infra/rum-tencent/**
tools/observability/tencent-rum-sourcemaps.ts
docs/notes/aegis-web-sdk.md
```

修改：

```text
pnpm-workspace.yaml
apps/web/package.json
apps/web/src/main.tsx
apps/web/vite.config.ts

packages/web/runtime/src/component-boundary.tsx
packages/web/runtime/src/route-builder.tsx

packages/build/web/src/release-store.ts

tools/quality/check-staged-web.ts

qualy.yml
.env.example

.github/workflows/<release/deployment workflow when present>
```

可能修改：

```text
packages/web/runtime/src/api.ts
```

只在 Phase 3 requestId/API observation 需要额外 transport integration 时。

当前 server `X-Qualy-Request-Id` 已经完成，所以不要再改 HTTP error body。

---

# 50. SourceMap 数据本身的安全性

`.map` 可能包含：

```text
sources
sourcesContent
项目目录结构
完整源码
```

因此它应被视为：

```text
private debugging artifact
```

而不是 Web asset。

规则：

```text
可以：
CI workspace
腾讯 RUM SourceMap storage

不可以：
client-dist
public assets
COS public static site
GitHub artifact（若公开）
用户下载
```

---

# 51. 腾讯 RUM 与 Sentry 的未来迁移

未来如果换 Sentry：

保持：

```text
@qualy/web-observability
ErrorBoundary integration
ObservedPage
URL sanitizer
releaseId
requestId
privacy policy
tests
```

替换：

```text
@qualy/plugin-rum-tencent
        ↓
@qualy/plugin-rum-sentry

Tencent source-map uploader
        ↓
Sentry source-map uploader

CSP endpoint
alert configuration
provider config
```

业务插件：

```text
0 修改
```

这就是本次增加 provider-neutral layer 的价值。

历史腾讯 RUM Issue/趋势不会自动迁移到 Sentry，这一点无法像 OTel Collector exporter 一样透明解决；但新事件切换成本会被控制在 provider 层。

---

# 52. 不建议的实现

以下方案直接否决。

### 直接在 `main.tsx`

```ts
import Aegis from 'aegis-web-sdk'
new Aegis(...)
```

问题：

```text
vendor 泄漏进 composition root
disabled deployment 仍付启动成本
配置与 artifact 绑定
迁移困难
```

### 每个 ErrorBoundary 自己调用 Aegis

问题：

```text
vendor spread
privacy 规则无法统一
未来迁移需要全仓修改
```

### CDN script

问题：

```text
扩大 script-src
第三方 script 成为 boot dependency
CSP attack surface 变大
```

### 开 `apiDetail`

直接否决。

### 开 `reportRequest`

直接否决。

### 打开 `uin`

第一阶段直接否决。

### Session Replay

当前直接否决。

### 为 Aegis 添加 `unsafe-eval`

直接否决。

### SourceMap 跟随 Web release 部署

直接否决。

### RUM 上传失败阻止应用运行

直接否决。

---

# 53. Phase 0 需要确认的开放问题

实现前只剩这些需要实测，而不是产品决策：

1. `aegis-web-sdk` 当前 pin 版本是否完全通过 Qualy CSP no-eval gate。
2. delayed dynamic initialization 是否仍能可靠获得 Qualy需要的 page performance/Web Vitals。
3. current `beforeReport` 中 Ajax error 的 status/url shape 是否足够稳定，可不解析字符串地过滤 typed 4xx。
4. `aid:false` 对错误聚合和性能页面是否存在不可接受损失。
5. Tencent SourceMap 的 `FileName` 对 Vite `assets/foo-HASH.js.map` 最佳匹配方式究竟是 basename 还是相对 asset path。
6. React 19 ErrorBoundary caught error 与 Aegis global listener 是否会重复上报，以及具体 dedup 行为。
7. Safari/WebKit 下 Aegis error/resource monitoring 是否表现一致。

这些答案全部进入：

```text
docs/notes/aegis-web-sdk.md
```

不是靠记忆或旧博客决定。

---

# 54. Definition of Done

整个“现在开发”的 RUM foundation 完成必须同时满足：

```text
[ ] @qualy/web-observability 不 import 腾讯代码

[ ] @qualy/plugin-rum-tencent 是唯一 Aegis owner

[ ] 默认 qualy.yml 中 provider disabled

[ ] disabled 时 0 Tencent network request

[ ] active 时 SDK lazy load

[ ] CSP 只增加 https://rumt-zh.com

[ ] script-src 不改变

[ ] 无 unsafe-eval

[ ] JS error 能被 RUM 收到

[ ] Promise rejection 能被 RUM 收到

[ ] React caught error 能被 RUM 收到

[ ] component id/kind 正确

[ ] release version 正确

[ ] raw UUID/query/form value 不出现在 outbound data

[ ] uin 不设置

[ ] API body 永不采集

[ ] SourceMap 能恢复到 TSX

[ ] public staged release 中 0 个 .map

[ ] RUM 服务失败不影响 Qualy

[ ] pnpm typecheck 通过

[ ] pnpm test 通过

[ ] pnpm build 通过

[ ] check-staged-web 通过

[ ] check-csp-build 通过

[ ] production smoke 通过

[ ] Chromium CSP enforce 通过

[ ] browser tests 通过

[ ] WebKit smoke 通过

[ ] STATUS.md 更新

[ ] Conventional Commit
```

---

# 55. 建议开发顺序与工期

现在完成：

```text
Phase 0  SDK/SourceMap PoC
Phase 1  Browser observability abstraction + Tencent errors
Phase 2  SourceMap pipeline
```

视 Phase 0 结果和剩余时间决定是否顺带完成：

```text
Phase 3  API speed + requestId
```

预计：

| 阶段           |    工作量 |
| -------------- | --------: |
| Phase 0        | 0.5～1.5h |
| Phase 1        |     2～3h |
| Phase 2        | 1.5～2.5h |
| Phase 3        |     1～2h |
| 上线前 Phase 4 |     1～2h |

因此现在做出**完整可靠的浏览器错误监控 + SourceMap foundation**：

```text
约 4～7 小时
```

把 API performance 也同时收口：

```text
约 5～9 小时
```

这个量级仍明显小于之前的 OTel 工程。

而且现在做的时机很好，因为：

```text
releaseId
requestId
统一 API error shape
CSP
release recovery
PluginComponentBoundary
Browser Assembly
```

这些依赖边界刚刚稳定。

上线前真正剩下的应该只有：

```text
正式腾讯项目
Secrets
告警阈值
费用告警
staging soak
production 开关
```

而不是临上线再修改 Browser Runtime、release store 和 build pipeline。

---

# 56. 最终架构裁决

Qualy Browser Observability 的长期原则冻结为：

```text
业务代码
    │
    ▼
Qualy-owned observability vocabulary
    │
    ▼
Deployment-selected provider
    │
    ├── Tencent RUM
    └── future Sentry / others
```

服务端继续：

```text
Qualy
  ↓
standard OTLP
  ↓
Collector
  ↓
backend of choice
```

两条路线的可移植性程度不同，但原则一致：

> Qualy 定义自己需要观察什么；vendor 只负责把这些事实存储、分析和展示。

腾讯 RUM 第一阶段负责的是：

```text
browser runtime failures
+
browser real-user performance
+
source-map debugging
```

而不是 Qualy 的第二套日志、追踪、审计或用户分析系统。

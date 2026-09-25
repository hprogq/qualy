# Qualy 插件隔离与 Browser Public Surface 收口设计

对应代码基线：`3e01e6a2d9cbeda2581671b45727ef268861d564`

> 进度:**Phase A 已落地(2026-09-15)**——health `NotReady` 收为空体、HTML description 去架构宣告、
> 生产 API docs 404 有验收、`ReleaseProbe` V2(`{schema, releaseId}`)、生产 release id 改不透明
> 并分出私有 `QUALY_BUILD_REVISION`、新增 docs/browser-public-surface.md。落地形态与仍未收口的项
> 以那份文档为准,本文保持为设计依据不回改。
>
> 进度:**Phase B 已落地(2026-09-15)**——浏览器按 surface 寻址(四张 loader 表)、Manifest V2、
> `componentKey()` 删除、`LayoutDeclaration.provider` 删除、`LoginPresentation.component` 删除、
> 诊断改 surface、私有 `.qualy-browser-surfaces.json`、client protocol 1 → 2。
> 两处按 §36/§99 的阶段划分推迟:`@qualy/app-contract`(§101 列在 B,§36/§99 列在 F)留给 Phase F,
> manifest 不加冗余的 `schema` 字段(§7/§67)——破坏性由 client protocol 承担,见 §68。
>
> 进度:**Phase C 已落地(2026-09-15)**——`@qualy/browser-observability` 建立(port + early queue +
> sanitize + context + bootstrap),`web-runtime` 与 `apps/web` 不再 import `@qualy/plugin-rum` 的
> 上报词汇;`plugin-rum` 只剩 provider 选择;登录渲染器接入统一 surface 边界(复审提出);
> 平台不依赖插件实现由 `plugin-isolation` 门禁守,剩余边具名列出。
> `apps/web` 仍有一行 `startBrowserRum` import——浏览器插件还没有可以运行的生命周期,归 Phase E。
>
> 进度:**Phase D1 已落地(2026-09-15)**——Web 构建改 active-only(`all` 从聚合彻底消失,
> `environment.command` 不再决定装配语义),旧 tab assembly 兼容按 §42–§46 实现
> (`X-Qualy-Web-Release` → store 查 `resolutionHash` → 同则放行、异则 409 `assembly`、
> 查不到则 409 `release`;判断经 `@qualy/api-kit/client-assembly` 单槽注册表倒置,host 不点名插件),
> 409 body 去掉 `received`/`supported`,`check-chunks --expect-absent` 按 binding 判定。
> §111 的旧 tab 矩阵进了 production smoke,对真实 store 跑。
>
> 进度:**D1.1(复审补丁)**——旧 tab 判定补上 `browserContractHash`(surface 身份指纹,安装时从私有
> surface map 的键算),`resolutionHash` 一个人不够:surface 声明不在 lock 里。
>
> 进度:**Phase D2 已落地(2026-09-15)**——collector 不再把 apps/web 的依赖当作「这个插件能否构建」
> 的依据,`apps/web/package.json` 的插件清单随之删除(生产依赖只剩 `@qualy/plugin-rum`,归 Phase E;
> 五个测试用依赖归 Phase G),`plugin:add` 不再写这份清单。两者都由 `plugin-isolation` 具名钉住。
>
> 进度:**Phase D3 已落地(2026-09-15)**——三处 `startsWith('@qualy/')` 发现过滤删除,身份判据统一为
> 「default export 是自称本包名的描述器」(resolve 期已有,硬失败);新增 `tools/tests/open-world.test.ts`:
> 一个 `@acme/qualy-probe` 合成包(另一 scope、自带 exports、用已发布的 kit 写描述器、带组件/catalog/
> browser module)走完 resolve 与 collector,并验证跨 scope 的 surface 冲突照样硬失败;另有一例扫全树
> 禁止 scope 判据回潮(测试目录除外,`plugin:add` 具名例外)。
>
> 进度:**Phase D4 已落地(2026-09-15)**——`ClientComponentRef.module`(以及 i18n / browser 模块)
> 改为**包导出子路径**,经 `resolvePluginExport` 走包自己的 `exports` 解析;51 个引用与 12 个包的
> exports 同批更新;带扩展名在声明处硬失败。新增 `tools/fixtures/acme-dist-probe`
> (**只有 package.json + dist/**)与 `tools/tests/dist-only-plugin.test.ts`,证明 resolve、
> 宿主 assemble、浏览器聚合、真实 `vite build` 下的动态 import 分块、i18n 与 browser 贡献全部成立。
>
> 进度:**Phase E 已落地(2026-09-15)**——`@qualy/plugin-kit/browser` 提供 `Browser.module()` /
> `BrowserPlugin` / `Dispose` / `startBrowserPlugins`;`Ui.browser()` 与顶层副作用注册删除;
> rum-tencent、storage-local、storage-cos 迁为 `setup` + disposer,RUM 能力自己用 `start` 起
> (`./start.ts` 改**动态** import——静态会把 128 KB api client 拉回冷启,browser-graph 门禁当场抓到);
> `apps/web` 最后一条插件实现 import 删除。
>
> 进度:**Phase F 已落地(2026-09-15)**——`@qualy/auth-contract/session`(Viewer/Authenticated/
> CurrentUser/CurrentViewer/公共 auth 错误/cookie 名)与新包 `@qualy/app-contract`(manifest wire +
> `appApiGroup`)建立;`plugin-auth/server/session.ts` 不再转出契约名;`web-runtime` 与
> `plugin-ui-registry` 互不 import。`plugin-isolation` 的两条具名例外**清空**,并新增
> 「一个插件只能经 owner 发布的表面触到另一个插件」门禁(24 条具名表面,其中 2 条标为仍是实现)。

## 1. 背景与目标

Qualy 现有插件底座已经具备比较完整的服务端装配能力：

```text
qualy.yml
→ resolution
→ PluginDescriptor
→ ExtensionPoint / capability
→ active / disabled / detached
→ runtime assembly
→ Effect Scope
```

这一层不应推翻。

本轮重构解决两个相互关联的问题：

第一，完善真正的第三方插件隔离：

```text
plugin package
≠
host implementation
```

插件只通过 descriptor、contract、capability 和公开 platform API 与宿主交互；插件禁用或移除后，除明确保留的持久化数据外，不留下运行时行为。

第二，收紧 Browser Public Surface：

> Browser knows product semantics; server knows assembly semantics.

浏览器可以知道：

```text
当前用户能访问什么页面
页面路径是什么
页面的产品 ID
某次请求是否失败
某个页面组件是否崩溃
当前运行的是哪个 opaque release
完成上传或 RUM 上报所必需的公开/临时数据
```

浏览器不应该知道：

```text
哪个 npm package 实现某个页面
当前 assembly 安装/启用了哪些 plugins
plugin dependency graph
layout provider 是谁
某个 component 对应哪个源码文件
disabled plugin 有什么功能
readiness 失败的是哪个 infrastructure provider
server 内部 capability/provider 名
数据库/模块/源码实现信息
```

安全边界仍然全部在服务端：

```text
authentication
authorization
tenant isolation
resource authorization
rate limit
CSRF / origin checks
input validation
audit
```

本轮不是通过“隐藏接口”代替这些安全机制，而是贯彻最小披露原则。

---

# 2. 本轮必须确立的架构不变量

完成后仓库必须满足以下规则。

### 2.1 Plugin lifecycle

```text
active
→ server layer 存在
→ API 存在
→ UI surface 存在
→ browser lifecycle 存在
→ CSP contribution 存在
→ jobs/listeners/provider 存在

disabled
→ package/data 可保留
→ 上述行为全部不存在

detached
→ runtime/browser 行为全部不存在
→ 持久数据按 capability retention 继续保留

uninstalled
→ package 不再存在
→ runtime/browser 行为不存在
→ 数据是否删除由 purge/retention 单独决定
```

`disable !== DROP DATA`。

---

### 2.2 Public browser information

Browser wire protocol 不允许出现：

```text
pluginId
plugin package name
module path
source file path
layout provider
assembly resolution graph
disabled plugin list
database provider
internal readiness check name
```

产品 surface identity 可以存在：

```text
assessment/review
workspace-shell/v1
layout/header-actions
auth method type
```

这些属于客户端实际操作的产品概念，而不是 implementation identity。

---

### 2.3 Production artifact

Production Web artifact 默认：

```text
只包含 active plugins 的 browser code
```

而不是：

```text
active + disabled installed plugin superset
```

这意味着：

```text
plugin enable / disable
→ assembly 发生变化
→ 下一次 deployment 重新构建 Web release
```

这是有意的设计选择。

当前 Vite plugin 在 `vite build` 时直接设置 `all = true`，release 会生成 superset；这正是本轮要取消的行为。

这也是本设计和原报告最大的不同。原报告保留 superset，强调“存在于 disk ≠ 执行”；本设计进一步要求：

> 对 production browser 来说，没有启用的 implementation 最好连 artifact 都不要进入。

以后如果确实出现“同一个 artifact 给几十种 assembly 复用”的现实需求，可以再增加显式的 `universal` build mode，但不能作为默认模式。

---

# 3. UI Manifest V2：去掉 implementation identity

## 3.1 当前问题

当前 manifest wire 中包含：

```ts
interface ManifestLayout {
  contract: string
  provider: string
  component: string
}

interface ManifestPage {
  id: string
  path: string
  component: string
  layout: string
  title?: UiText
}
```

server 又通过：

```ts
componentKey(owner, componentRef)
```

把 implementation information 映射到浏览器。当前 `componentKey()` 本质生成：

```text
<plugin basename>/<source basename>
```

例如：

```text
assessment/ReviewPage
layout-default/WorkspaceShell
auth-local/LoginMethod
```

这直接把 plugin/module information 变成了 public protocol。

Manifest 同时还发送 layout `provider`，但 route builder 实际只需要 `contract` 对 page 分组，并不消费 `provider`。

因此不要给 `componentKey()` 再套一层 SHA/hash。

更好的方案是：

> 浏览器 registry 按 surface identity 寻址，而不是按 implementation identity 寻址。

---

# 4. Surface-addressed Component Registry

这是本轮最重要的一处结构性修改。

目前：

```text
Plugin
→ ClientComponentRef
→ componentKey(plugin, source file)
→ manifest component string
→ browser registry lookup
```

改成：

```text
Plugin
→ Surface Declaration
→ public surface identity
→ browser registry lookup
```

## 4.1 Page

已有：

```ts
PageDeclaration {
  page.id
  page.path
  component
  layout
}
```

page id 本身全局唯一，server registry 已经拒绝重复 page ID 和重复 route path。

因此 browser registry：

```ts
registry.pages[page.id]
```

manifest：

```ts
interface ManifestPage {
  id: NamespacedId
  path: string
  layout: LayoutContractId
  title?: UiText
}
```

不再发送：

```text
component
```

---

## 4.2 Layout

`layout.contract` 本来就是 page 与 shell 之间的公共 product contract，并且当前 registry 已强制同一个 contract 只能存在一个 provider。

因此：

```ts
registry.layouts[layout.contract]
```

manifest：

```ts
interface ManifestLayout {
  contract: LayoutContractId
}
```

删除：

```text
provider
component
```

`provider` 彻底变成 server/build internal metadata。

---

## 4.3 Slots

不要要求所有 slot contribution `id` 全局唯一。

按：

```ts
registry.slots[slot.key][slot.id]
```

寻址。

manifest 保持：

```ts
slots: Record<
  SlotKey,
  {
    id: NamespacedId
    order: number
  }[]
>
```

删除：

```text
component
```

因此 browser 知道：

```text
header/actions
assessment/foo-action
```

但不知道：

```text
@qualy/plugin-foo
./client/FooAction.tsx
```

---

## 4.4 Login renderer

当前 LoginMethod 把：

```text
type
code
name
mode
component
```

传给 browser；`LoginPage` 再通过 `useComponent(method.component)` 动态获取 renderer。

改成：

```ts
type LoginPresentation = { mode: 'component' } | { mode: 'redirect'; href: string }
```

browser registry：

```ts
registry.login[method.type]
```

因此：

```text
type = local
```

已经足够确定使用哪个 renderer。

删除 `component` 字段。

这还顺带消灭了：

```ts
componentKey(found.owner, declared.component)
```

在 auth server 中的使用。

---

# 5. 最终 ComponentRegistry

建议明确成：

```ts
export interface ComponentRegistry {
  readonly pages: Readonly<Record<NamespacedId, RegisteredComponent>>

  readonly layouts: Readonly<Record<LayoutContractId, RegisteredComponent>>

  readonly slots: Readonly<Record<string, Readonly<Record<NamespacedId, RegisteredComponent>>>>

  readonly login: Readonly<Record<string, RegisteredComponent>>
}
```

不要继续暴露：

```ts
useComponent(name: string)
```

这种无类型的 implementation-key API。

改成内部 resolver：

```ts
resolvePageComponent(pageId)
resolveLayoutComponent(contract)
resolveSlotComponent(slotKey, itemId)
resolveLoginComponent(type)
```

如果确实需要通用 API，则使用结构化地址：

```ts
type ComponentAddress =
  | { kind: 'page'; id: NamespacedId }
  | { kind: 'layout'; id: LayoutContractId }
  | { kind: 'slot'; slot: string; id: NamespacedId }
  | { kind: 'login'; id: string }
```

绝不能再恢复：

```text
plugin/module filename
```

作为 browser component address。

---

# 6. 删除 `componentKey()`

完成 surface registry 后：

```ts
componentKey(pluginId, ref)
```

不再有存在价值。

当前仓库里它的核心生产用途只有：

```text
web collector
ui manifest
auth sign-in
```

这三个地方全部迁移后直接删除 `componentKey()`。

这样同时解决原报告指出的第三方 namespace collision：

```text
@qualy/plugin-auth
@acme/plugin-auth

→ 以前都可能归一为 auth/*
```

不需要再设计 component-key v2。

---

# 7. `/app/manifest` V2

最终建议：

```ts
interface Manifest {
  schema: 2

  layouts: readonly {
    contract: LayoutContractId
  }[]

  pages: readonly {
    id: NamespacedId
    path: string
    layout: LayoutContractId
    title?: UiText
  }[]

  collections: Readonly<Record<string, readonly unknown[]>>

  slots: Readonly<
    Record<
      string,
      readonly {
        id: NamespacedId
        order: number
      }[]
    >
  >
}
```

保留当前极其重要的 authorized projection：

```text
PUBLIC
AUTHENTICATED
permissionOf(...)
```

不可见 page、slot、collection、navigation group 不发送。

当前 manifest 已经正确做到按 viewer projection，甚至会删除没有任何可见子项的 navigation group，避免泄露隐藏产品区域；这部分逻辑不动。

### 不增加：

```text
plugins
providers
capabilities
assembly
activePlugins
resolutionHash
```

尤其：

```text
GET /__qualy/browser-assembly
```

正式从设计中删除。

---

# 8. Production Web build 改为 active-only

当前：

```ts
all = environment.command === 'build'
```

改成：

```ts
all = false
```

或者彻底删除 `all` 概念。

`qualyPlugins()`：

```text
vite dev
vite build
browser tests
```

全部使用：

```text
current active resolution
```

删除：

```text
plugins.all.ts
scan.all.ts
readEntries({ all: true })
```

在 Web collector 中 disabled plugin 不进入：

```text
components
catalogs
errorMessages
browser modules
```

结果：

```text
rum-tencent disabled
→ JS artifact 中没有其 browser module
→ 没有 aegis-web-sdk edge
→ CSP 也没有 rumt-zh.com

storage-cos disabled
→ browser 中没有 COS provider code
```

这比运行时 projection 再过滤一遍更简单。

---

# 9. `apps/web` 不再是 plugin install root

当前 `apps/web/package.json` 直接依赖 assessment/auth/org/rbac/rum/storage 等所有 plugin implementation。

删除所有：

```text
@qualy/plugin-*
```

implementation dependency。

保留：

```text
brand
ui
ui-contract
app-contract
browser-observability
web-i18n
web-runtime
release-contract
web-build
React/Vite
```

唯一插件 install authority：

```text
qualy.yml.application.workspace
```

当前即：

```text
apps/server
```

Web build：

```text
qualy.yml
→ resolution
→ descriptor
→ resolvePackageDir(plugin)
→ component/browser/i18n refs
```

直接使用插件实际安装位置。

删除 collector 中：

```ts
const webDeps = ...
if (!webDeps.has(entry.name)) throw ...
```

插件不再需要人为加入 `apps/web/package.json`。

---

# 10. Open-world plugin discovery

当前 collector 仍有：

```ts
if (!entry.name.startsWith('@qualy/')) continue
```

正式删除。

插件身份唯一判定：

```ts
isPluginDescriptor(defaultExport) && descriptor.id === packageId
```

不再允许任何：

```ts
startsWith('@qualy/')
startsWith('@qualy/plugin-')
```

参与 plugin discovery。

`@qualy/plugin-*` 只是官方插件 naming convention。

必须增加真实 fixture：

```text
@fixture/qualy-probe
```

或：

```text
@acme/qualy-probe
```

证明：

```text
resolve
build
manifest
component
i18n
browser lifecycle
tests
```

全部不依赖 `@qualy` scope。

---

# 11. Browser lifecycle：替换 `Ui.browser()` side effect

当前 `BrowserModules` 明确声明：

> module loaded for side effects when app boots.

这不是理想的第三方插件契约。

即使 active-only build 已经保证 disabled plugin 不会进入 artifact，仍建议消灭 top-level registration side effect。

## 11.1 API ownership

`BrowserModules` 不属于 UI registry。

RUM、Storage transport 都不是 UI surface。

建议迁移到：

```text
@qualy/plugin-kit/browser
```

提供：

```ts
Browser.module('./client/browser.ts')
```

取代：

```ts
Ui.browser(...)
```

---

## 11.2 Lifecycle contract

```ts
export type Dispose = () => void

export interface BrowserPluginContext {
  readonly release: {
    readonly releaseId: string
    readonly clientProtocol: number
  }
}

export interface BrowserPlugin {
  setup?(context: BrowserPluginContext): void | Dispose

  start?(context: BrowserPluginContext): void | Promise<void>
}
```

约束：

```text
setup
→ 只能注册轻量 browser capability
→ 不加载大型 vendor SDK
→ 必须返回 disposer

start
→ setup 全部完成后调用
→ 可以异步
→ 不得阻塞产品 first render
```

登出信号（2026-09-25）：`@qualy/web-runtime/identity` 的 `onSignOut(listener)` 返回 disposer，
由 `useSessionTransition` 在离开一个已登录身份时（登出、以他人身份登录）触发；从匿名登录不触发，
会话过期也不触发（多半是同一个人回来，本机暂存的内容留给他）。插件在 `setup` 里注册、把 disposer
交回宿主，用来清掉本浏览器替上一个人保存的未提交内容（首个用户：综测审核草稿）。子路径零依赖，
不进 `BrowserPluginContext`——ctx 仍只有 release。

generated aggregate：

```ts
import browser0 from '...'
import browser1 from '...'

export const browserPlugins = [browser0, browser1]
```

Browser module 中不再：

```ts
registerXxx(...)
```

顶层直接执行。

---

# 12. Registration API 全部可撤销

例如 Storage 当前：

```ts
registerUploadDriver(driver): void
```

改成：

```ts
registerUploadDriver(driver): Dispose
```

RUM：

```ts
registerRumProvider(provider): Dispose
```

所有 Browser registry 遵循：

```text
register
→ owner exists
→ dispose
→ registry restored to previous empty state
```

这不是为了支持 production hot-disable。

主要为了：

```text
test isolation
HMR
runtime reset
插件生命周期一致性
第三方插件开发体验
```

Server side 继续依赖 Effect Scope；当前 UI registry 等已经通过 `Effect.acquireRelease` 做 scoped registration，这个模式是正确的。

---

# 13. Browser Observability 从 plugin implementation 抽到 platform

这是报告里应保留的重要结论。报告最后也已经修正为 platform browser-observability port。

当前：

```text
apps/web/main.tsx
→ @qualy/plugin-rum/client

web-runtime
→ @qualy/plugin-rum
```

`main.tsx` 直接 import bootstrap、captureDiagnostic、startBrowserRum。

`component-boundary.tsx` 也直接 import plugin-rum。

甚至 `@qualy/web-runtime/package.json` 明确依赖：

```json
"@qualy/plugin-rum": "workspace:*",
"@qualy/plugin-ui-registry": "workspace:*"
```

这些都违反：

```text
platform runtime
→ optional plugin implementation
```

---

# 14. 新包 `@qualy/browser-observability`

建议路径：

```text
packages/web/observability/
```

package：

```text
@qualy/browser-observability
```

它只包含 vendor-neutral browser primitives：

```ts
captureException(...)
captureDiagnostic(...)
setObservedPage(...)
currentObservedPage()
observedPageUrl()
sanitizePath()
sanitizeUrl()

installSink(sink): Dispose
```

以及：

```text
bootstrap.ts
queue.ts
context.ts
sanitize.ts
sink.ts
```

当前 `plugin-rum` 中以下代码迁过来：

```text
early error listeners
early failure queue
observed page state
exception dedup
safe sink invocation
URL sanitizer
```

`BrowserRumProvider`、Tencent provider selection 等继续属于：

```text
plugin-rum
plugin-rum-tencent
```

依赖方向变成：

```text
apps/web
   ↓
browser-observability

web-runtime
   ↓
browser-observability

plugin-rum
   ↓
browser-observability

plugin-rum-tencent
   ↓
plugin-rum
```

平台永远不知道腾讯 RUM 是否存在。

---

# 15. RUM Browser API 再瘦一层

当前 `/app/observability`：

```json
{
  "schema": 1,
  "provider": "tencent",
  "config": {...}
}
```

active-only build + single-provider barrier 后，browser 不需要知道：

```text
provider=tencent
```

因为当前 artifact 里本来只可能有当前 active provider。

改成：

```ts
{
  schema: 2,
  config: Record<string, unknown> | null
}
```

例如：

```json
{
  "schema": 2,
  "config": {
    "id": "Dv3JDFEPn8GxJ24amb",
    "environment": "production",
    "sampleRate": 1
  }
}
```

无 provider：

```json
{
  "schema": 2,
  "config": null
}
```

Reporting ID 本身不是 secret。

真正禁止 browser 出现的是：

```text
SecretId
SecretKey
SourceMap upload credentials
Tencent API credentials
```

---

# 16. RUM browser provider registry 改为单槽

当前：

```ts
Map<string, BrowserRumProvider>
activateRumProvider(selectedCode, ...)
```

active-only + server barrier 已保证同一 assembly 最多一个 provider 后，可以收敛：

```ts
let provider: BrowserRumProvider | null

registerRumProvider(provider): Dispose

activateRumProvider(config, release)
```

Browser provider 不再需要：

```ts
provider: 'tencent'
```

这个 public dispatch key。

server 内部仍可保留：

```text
code = tencent
```

用于 assembly/provider selection。

这是 server implementation information，不再上 wire。

---

# 17. Release protocol 收口

当前公开 `/__qualy/release` 返回：

```json
{
  "schema": 1,
  "releaseId": "...",
  "mode": "production",
  "clientProtocol": 1,
  "serverProtocol": {
    "min": 1,
    "max": 1
  }
}
```

但 release coordinator 判断 update 实际核心是：

```text
server.releaseId === browser.releaseId
```

Browser protocol incompatibility已经由 API transport 单独通知 coordinator。

因此建议 `ReleaseProbe V2`：

```ts
{
  schema: 2,
  releaseId: ReleaseId
}
```

不再返回：

```text
server mode
server protocol window
```

browser 自身：

```text
webRelease.clientProtocol
```

仍保留，因为每个 API request 需要它。

---

# 18. Release ID 必须是 opaque deployment identity

Production 不再推荐：

```text
git SHA
branch
semantic version
CI run number
```

直接作为 public release ID。

使用：

```text
r_DyR1F9J8C5pQ...
```

等随机 opaque value。

内部建立私有关联：

```text
public release ID
→ git commit
→ CI run
→ build timestamp
→ assembly resolutionHash
```

这个 mapping 只留 CI/artifact metadata/RUM release management。

Browser 只需要：

```text
equal / different
```

当前 release contract 本来就明确 releaseId 不具有排序或 semantic version 含义，只做 identity/equality。

---

# 19. Health endpoint 修复实际信息泄漏

当前 readiness：

```ts
new NotReady({
  check: check.name,
})
```

会把失败 probe 名发给匿名 caller。虽然源码注释说原因只进日志，但 `check` 本身仍在 body。

改：

```ts
export class NotReady ...
  'NotReady',
  {},
  ...
```

wire：

```json
{
  "_tag": "NotReady"
}
```

server log 保留：

```text
readiness check postgres failed
cause
requestId
traceId
```

---

# 20. API documentation

当前机制已经正确：

```text
QUALY_API_DOCS=auto
development → on
production  → off

public
→ explicit production exposure
```

不需要重新设计。

只增加 production acceptance：

```text
/api/docs         → 404
/api/openapi.json → 404
```

除非测试显式设置：

```text
QUALY_API_DOCS=public
```

---

# 21. Error Public/Private Boundary

统一规则：

## Public error

只能包含：

```text
_tag
用户做决定必须知道的业务字段
客户端做分支必须知道的协议字段
```

例如：

```json
{
  "_tag": "ACCESS_DENIED"
}
```

或：

```json
{
  "_tag": "CONFLICT",
  "version": 4
}
```

## Private diagnostics

只能进入：

```text
server logs
CLS
APM
RUM
```

包括：

```text
stack
Effect Cause
SQLSTATE internal detail
constraint name
table name
plugin owner
provider
module path
filesystem path
raw exception message
```

保持：

```text
X-Qualy-Request-Id
```

作为浏览器与服务端之间的唯一主要 diagnostic correlation handle。

这比把 request ID 塞进 JSON body 更干净。

---

# 22. SourceMap 保持现状

这一部分当前已经正确：

```ts
sourcemap: 'hidden'
```

SourceMap：

```text
生成
→ 上传 RUM
→ 不进入 release store
```

不要修改这个模型。

SourceMap 本身就是实现信息恢复机制，因此 production browser 完全没必要再承担额外 implementation diagnostics。

---

# 23. Production asset 名称去语义化

当前 JS chunk：

```text
<chunk.name>-[hash].js
```

有可能出现：

```text
ReviewPage-...
FormulaCodeEditor-...
WorkspaceShell-...
```

改 production JS：

```ts
entryFileNames: 'assets/e-[hash].js'
chunkFileNames: 'assets/c-[hash].js'
```

CSS/assets 单独评估，因为当前 StyleX `cssInjectionTarget` 对 entry stylesheet 名有依赖。

第一阶段不要同时把全部 CSS 名改掉。

先把：

```text
production JS chunk names
```

去语义化。

SourceMap 可以正常根据 generated file name 匹配，不受影响。

---

# 24. HTML metadata

当前 description：

```text
Qualy: Plugin based comprehensive quality evaluation system
```

会主动向 crawler 宣告内部 architecture。

改为产品描述：

```text
Qualy — Comprehensive quality evaluation and workflow platform
```

或：

```text
Qualy
```

“plugin-based” 属于 implementation information，不属于页面 SEO 必需内容。

---

# 25. `@qualy/app-contract`

`web-runtime` 当前还直接 import：

```text
@qualy/plugin-ui-registry/api
```

这仍是：

```text
platform runtime → plugin implementation
```

建议新建：

```text
packages/contracts/app
@qualy/app-contract
```

负责：

```text
Manifest V2 schemas
/app/manifest HttpApi contract
其他真正属于 application shell 的公共 wire protocol
```

依赖：

```text
effect
@qualy/ui-contract
@qualy/i18n-contract
@qualy/auth-contract
```

然后：

```text
plugin-ui-registry
→ implements @qualy/app-contract

web-runtime
→ consumes @qualy/app-contract
```

最终 `@qualy/web-runtime/package.json` 不再依赖：

```text
@qualy/plugin-ui-registry
@qualy/plugin-rum
```

---

# 26. Auth session contract 下沉

报告识别出的另一个重要问题是多个插件直接 import：

```text
@qualy/plugin-auth/server/session-contract
@qualy/plugin-auth/server/session
```

这些 production cross-plugin implementation imports 应消失。

迁移到：

```text
@qualy/auth-contract/session
```

包括：

```text
Viewer
Authenticated
CurrentUser
CurrentViewer
session principal DTO
public auth errors
middleware/service contracts
```

然后：

```text
plugin-auth
→ provides implementation

ui-registry
org
rbac
audit
assessment
formula
→ imports @qualy/auth-contract/session
```

第三方插件作者不应知道：

```text
plugin-auth/src/server/*
```

的目录布局。

---

# 27. 跨插件 implementation import CI 规则

正式建立：

> Plugin A production code 不允许 import Plugin B implementation。

允许：

```text
@qualy/*-contract
@qualy/plugin-kit
@qualy/api-kit
@qualy/web-runtime
@qualy/browser-observability
明确的 capability facade
```

过渡期允许：

```text
@qualy/plugin-foo/plugin
```

因为这些 entrypoint 当前承担 descriptor/capability declaration API。

禁止：

```text
@qualy/plugin-foo/server/**
@qualy/plugin-foo/client/**
@qualy/plugin-foo/db
@qualy/plugin-foo/src/**
```

长期再考虑把：

```text
plugin-database/plugin
plugin-ui-registry/plugin
```

重命名成真正的 capability package。

本轮没必要一起重命名。

---

# 28. DB schema dependency 不并入 runtime dependency

保留现在的独立概念：

```text
runtime dependency
schema dependency
capability dependency
source import dependency
```

不要试图统一成一张图。

例如：

```ts
Db.entities(..., {
  dependsOn: [
    '@qualy/plugin-org',
    '@qualy/plugin-auth'
  ]
})
```

是 schema ownership/FK ordering。

这与：

```ts
Plugin.define(..., {
  dependsOn: [...]
})
```

不是同一个概念。

真正要禁止的是 hidden edge：

```text
代码依赖 B
但 descriptor/capability/schema 没有任何显式关系
```

---

# 29. Browser tests ownership

原报告这一点保留。

最终：

```text
plugin-rum/tests/*.browser.test.tsx
plugin-rum-tencent/tests/*.browser.test.tsx
plugin-auth/tests/*.browser.test.tsx
plugin-org/tests/*.browser.test.tsx
assessment/tests/*.browser.test.tsx
formula/tests/*.browser.test.tsx
```

`apps/web/tests` 只保留：

```text
composition
host boot
release recovery
full manifest integration
CSP
whole-product smoke
```

Runner 仍集中。

不要每个插件自己启动一套浏览器。

---

# 30. 新建 `@qualy/testkit/browser`

建议：

```text
packages/testkit/browser
```

提供：

```ts
renderPlugin(...)
createTestRegistry(...)
createManifest(...)
createCatalogs(...)
createBrowserPluginHarness(...)
createObservabilitySink(...)
```

单插件 browser test 不允许 import：

```text
virtual:qualy/plugins
```

只有 host/composition integration test 可以使用完整 virtual aggregate。

这样第三方插件在独立 repo 中也能测试。

---

# 31. Plugin CLI 与第三方安装体验

这部分不是 Browser security 的前置条件，但属于插件化最终完成态。

拆分：

```text
repo-local scaffolding

pnpm plugin:scaffold @qualy/plugin-foo
```

与真正产品命令：

```text
qualy plugin add @acme/foo
qualy plugin enable @acme/foo
qualy plugin disable @acme/foo
qualy plugin remove @acme/foo
```

新的 active-only Web build 模型意味着：

```text
add/enable/disable/remove
→ 更新 resolution
→ deployment 必须 rebuild Web release
```

这应由正常 deployment pipeline 完成，而不是试图依赖一个 universal browser artifact。

---

# 32. Public Surface CI Gate

新增：

```text
tools/quality/check-public-web.ts
```

不要使用“JS 中一个 `@qualy/plugin-` 字符串都不能存在”这种过于脆弱的规则。

应该检测真正的 invariant。

至少检查：

```text
1. staged release 中 0 *.map
2. JS 中没有 sourceMappingURL
3. production JS filename 不含 component/source basename
4. disabled fixture plugin sentinel 不出现在 artifact
5. Manifest schema 不包含 provider/component/plugin 字段
6. public release probe 不包含 serverProtocol/mode
7. health failure 不包含 readiness implementation 名
8. default production /api/docs 与 /api/openapi.json 不可访问
9. public HTML 不出现 “plugin based”
10. server-only secrets 没有进入 Web artifact
```

---

# 33. Plugin Isolation Gate

新增：

```text
tools/tests/plugin-isolation.test.ts
```

检查：

```text
third-party scope fixture 可以正常 resolve
collector 不存在 @qualy scope discovery
apps/web 无 plugin implementation dependency
packages/web/* 无 optional plugin implementation dependency
跨 plugin implementation import 被拒绝
disabled browser plugin 不进 production artifact
browser lifecycle disposer 能彻底清理
plugin removal 后没有 CSP/provider/listener/registry residue
```

---

# 34. Public Manifest tests

至少测试三种 viewer：

```text
anonymous
ordinary authenticated
privileged admin
```

断言：

```text
只能看到自己可见页面
不可见 navigation group 不存在
不可见 slot 不存在
manifest 不出现 permission code
manifest 不出现 plugin owner
manifest 不出现 layout provider
manifest 不出现 component/module identity
```

当前 authorized projection 本身不要重写，只修改最后 projection shape。

---

# 35. Production bundle fixture

建立一个测试插件：

```text
@fixture/qualy-public-surface-probe
```

browser code 带唯一字符串：

```text
QUALY_DISABLED_PLUGIN_SENTINEL_72AF...
```

测试：

```text
active
→ production dist contains sentinel

disabled
→ production dist does NOT contain sentinel
```

同一 fixture 顺便验证：

```text
第三方 scope
page
layout/slot
i18n
browser module
build
```

形成一个真正的 third-party acceptance plugin。

---

# 36. 开发阶段划分

## Phase A — Policy + low-risk public wire cleanup

修改：

```text
health NotReady
HTML description
production API docs test
ReleaseProbe V2
opaque production release ID policy
docs/browser-public-surface.md
```

不碰 component registry。

DoD：

```text
typecheck
unit tests
production API docs 404
health no implementation field
release recovery tests
```

---

## Phase B — Surface-addressed browser registry + Manifest V2

修改：

```text
ui-contract component registry model
web collector
ui-registry manifest
app manifest schema
web-runtime route builder
slots
auth login renderer
browser tests
```

删除：

```text
componentKey()
Manifest*.component
ManifestLayout.provider
LoginPresentation.component
```

DoD：

```text
所有页面正常
layout preload 正常
slots 正常
local login 正常
component missing diagnostics 正常
RUM component context 使用 surface ID
manifest 无 implementation identity
```

这是本轮风险最高的一阶段，单独提交。

---

## Phase C — Browser Observability platform extraction

新建：

```text
@qualy/browser-observability
```

迁移：

```text
bootstrap
queue
context
sanitize
captureException
captureDiagnostic
setObservedPage
sink
```

修改：

```text
apps/web
web-runtime
plugin-rum
plugin-rum-tencent
```

删除：

```text
apps/web → plugin-rum
web-runtime → plugin-rum
```

DoD：

```text
early errors 仍捕获
React boundary 仍上报
route privacy 仍成立
Tencent RUM SourceMap 仍能还原
RUM disabled 时产品完全正常
```

---

## Phase D — active-only production build + open-world discovery

修改：

```text
qualyPlugins()
collectWebPlugins()
apps/web/package.json
plugin discovery
catalog discovery
permission discovery
```

删除：

```text
build all=true
*.all.ts
@qualy scope filtering
apps/web plugin dependency check
```

加入：

```text
third-party fixture plugin
disabled sentinel test
```

DoD：

```text
disabled RUM 不进入 artifact
disabled COS 不进入 artifact
third-party plugin 无需改 apps/web 即可 build
resolutionHash/release mismatch 继续 fail
```

---

## Phase E — Browser lifecycle

新增：

```text
@qualy/plugin-kit/browser
Browser.module()
BrowserPlugin
Dispose
```

替换：

```text
Ui.browser()
```

迁移：

```text
storage-local
storage-cos
rum-tencent
rum capability startup
```

所有 registration 返回 disposer。

DoD：

```text
setup → registry exists
dispose → registry empty
duplicate registration 正确拒绝
browser reset 无残留
HMR/test 不串状态
vendor SDK 仍 lazy
```

---

## Phase F — Contract / implementation boundary

新增/迁移：

```text
@qualy/app-contract
@qualy/auth-contract/session
```

清除：

```text
web-runtime → plugin-ui-registry
other plugins → plugin-auth/server/**
跨 plugin db/server/client implementation imports
```

加 CI gate。

DoD：

```text
平台层 0 optional plugin implementation dependency
production plugin A 不能 import plugin B/server|client|db
```

---

## Phase G — Browser test ownership + testkit

建立：

```text
@qualy/testkit/browser
```

迁移 package-owned browser tests。

`apps/web/tests` 只剩 host/composition tests。

DoD：

```text
一个 fixture plugin 独立使用 testkit 可以完成 browser test
无 virtual:qualy/plugins dependency
Chromium 全套 + WebKit engine-sensitive smoke 都通过
```

(最后一条按实际策略写:Chromium 跑 host + 每个包的 browser test + 第三方 fixture;
WebKit 只跑对引擎差异敏感的那两个文件——冷启动交接与品牌绘制,两处 WebKit 曾经抓到、
Chromium 看不到的缺陷就在那里。整套跑两遍是为一类只存在于两个文件里的缺陷付全套成本。)

---

## Phase H — Plugin management UX

最后实现：

```text
qualy plugin add
qualy plugin enable
qualy plugin disable
qualy plugin remove
```

明确：

```text
assembly mutation
→ rebuild required
```

保留 DB retention/detached 模型。

这是插件系统产品化阶段，不应和前面的 runtime refactor 混在同一个提交。

---

# 37. 推荐提交粒度

不要一个 commit 完成全部。

建议：

```text
refactor(web): minimize the public release probe

refactor(ui): address browser components by public surfaces

refactor(observability): move browser reporting port into the platform

refactor(web): build only the active browser assembly

refactor(plugins): discover plugins by descriptor rather than package scope

refactor(web): give browser plugin effects a lifecycle

refactor(contracts): move shell and session protocols out of plugin implementations

test(plugins): prove third-party isolation and public browser boundaries

refactor(tests): return browser tests to their owning packages
```

每个阶段都必须保持 main 可运行。

---

# 38. 必须保留的现有设计

本轮不要顺手破坏：

```text
Effect Scope server lifecycle
DB retention
active/disabled/detached
typed HttpApi
API path single-source
requestId header
release recovery gate
authorized UI projection
CSP exact source registration
hidden SourceMap pipeline
RUM privacy scrubber
per-definition API clients
```

尤其 SourceMap 私有化和当前 CSP 模型已经是正确答案，不要因为“减少逆向”再增加 JS obfuscator。

JS obfuscation：

```text
收益有限
build/debug 风险大
SourceMap 复杂度高
性能变差
```

不加入本设计。

---

# 39. 最终生产浏览器应该看到什么

一个普通用户抓 Network，合理看到：

```text
GET /api/app/manifest

{
  schema: 2,
  layouts: [
    { contract: "workspace-shell/v1" }
  ],
  pages: [
    {
      id: "assessment/batches",
      path: "/assessment/batches",
      layout: "workspace-shell/v1",
      title: ...
    }
  ],
  collections: ...,
  slots: ...
}
```

看不到：

```text
@qualy/plugin-assessment
layout-default/provider
assessment/BatchListPage
./client/BatchListPage.tsx
```

release：

```json
{
  "schema": 2,
  "releaseId": "r_WV7joC3..."
}
```

health failure：

```json
{
  "_tag": "NotReady"
}
```

RUM：

```json
{
  "schema": 2,
  "config": {
    "id": "...",
    "environment": "production",
    "sampleRate": 1
  }
}
```

API error：

```json
{
  "_tag": "ACCESS_DENIED"
}
```

以及 response header：

```text
X-Qualy-Request-Id: ...
```

这是足够的 browser debugging surface。

---

# 40. 最终 Production Artifact Contract

假设 deployment 当前 active assembly 为：

```text
auth
auth-local
org
rbac
assessment
storage
storage-local
```

而以下插件已安装但 disabled：

```text
storage-cos
rum
rum-tencent
assessment-formula
```

production Web artifact 必须满足：

```text
存在：

auth browser code
auth-local browser code
org browser code
rbac browser code
assessment browser code
storage browser capability code
storage-local browser transport code

不存在：

storage-cos browser code
COS SDK edge
rum browser provider code
rum-tencent browser code
aegis-web-sdk
formula editor browser code
formula editor i18n
formula-specific browser lifecycle
```

这里的“不存在”指真实 dependency graph 和 staged artifact 均不包含。

不是：

```text
包含了，只是不执行
```

因此 production artifact 是：

```text
WebRelease =
  Browser Host
  + Active Assembly Browser Projection
```

而不是：

```text
Browser Host
+ Installed Plugin Superset
```

当前 `qualyPlugins()` 在 `vite build` 时通过：

```ts
all = environment.command === 'build'
```

主动切换成 superset，这一行为需要删除。

---

# 41. Active-only Build 必须同时解决旧 Tab Assembly Compatibility

这是实施 active-only 前必须补上的协议，否则会产生部署兼容性回归。

## 41.1 当前行为

浏览器每个 API request 已经携带：

```text
X-Qualy-Web-Release
X-Qualy-Client-Protocol
```

但当前 server compatibility middleware 明确只判断：

```text
clientProtocol
```

并且源码专门说明：

> release id 不在这里判断；旧页面和新 server 在 protocol window 内应该继续工作，release id 只用于 diagnostics/logs。

这对：

```text
A release
→ B release

但 assembly 完全相同
```

非常合理。

例如纯 UI 修复部署：

```text
Release A:
auth + org + assessment

Release B:
auth + org + assessment
```

旧 tab A 完全可以继续调用 server B。

但是 active-only 后出现另一种变化：

```text
Release A:
auth + org + assessment + formula

Release B:
auth + org + assessment
```

旧 tab A 中 formula component 仍存在，但 server B 已经没有 formula API。

反方向也一样：

```text
A 无 formula
B 新增 formula
```

旧 tab A 如果之后刷新 `/app/manifest`，可能得到自己 bundle 根本没有的 surface。

因此必须区分：

```text
code release changed
```

和：

```text
browser/server assembly changed
```

---

# 42. 不向 Browser 暴露 resolutionHash，利用现有 releaseId 反查

不要新增：

```text
X-Qualy-Assembly-Hash
resolutionHash
browserAssemblyHash
```

给 Browser。

现有请求已经带：

```text
X-Qualy-Web-Release: <releaseId>
```

服务端完全可以自行通过 releaseId 找到这个旧 release 的私有 metadata：

```text
releaseId
→ InstalledWebRelease
→ resolutionHash
```

而当前 production server 自己也知道：

```text
current AssemblyInfo.resolutionHash
```

因此兼容判断应该全部发生在 server：

```text
Browser A
    │
    │ X-Qualy-Web-Release: r_A
    ▼
Server B
    │
    ├─ lookup r_A private metadata
    │
    ├─ r_A.resolutionHash
    │
    └─ currentAssembly.resolutionHash
            │
            ├─ equal
            │    → allow
            │
            └─ different
                 → force client reload
```

Browser 永远不知道这两个 hash。

---

# 43. Client Compatibility V2

当前：

```text
409
X-Qualy-Client-Unsupported: 1
```

只代表 protocol incompatibility。

建议扩展成：

```text
X-Qualy-Client-Unsupported:
  protocol
  assembly
  release
```

语义：

```text
protocol
→ client protocol 不在 server window

assembly
→ browser release 属于不同 assembly

release
→ browser 声称的 production release 已不可识别/
   metadata 已不存在
```

Browser transport：

```ts
type ClientUnsupportedReason = 'protocol' | 'assembly' | 'release'
```

然后：

```text
protocol
→ reload-required/client-protocol

assembly
→ reload-required/assembly-skew

release
→ reload-required/release-expired
```

用户界面可以复用同一份“此页面需要重新加载”文案，不需要向用户解释 assembly。

RUM diagnostic 可以记录：

```text
client-protocol
assembly-skew
release-expired
```

这些是低基数工程事实。

---

# 44. Compatibility 判断规则

Production API request：

```text
无 X-Qualy-Web-Release
→ 非 Web caller，例如 CLI/integration
→ 不做 release assembly 判断

有 release header
→ validate ReleaseId

release == current pinned release
→ allow

release != current
→ lookup installed/retained release metadata
```

如果旧 release：

```text
存在
+
resolutionHash == current resolutionHash
```

则：

```text
allow
```

这正是现有 release retention 想要支持的：

> 旧 tab 继续工作。

如果：

```text
resolutionHash != current
```

则：

```text
409 assembly unsupported
```

如果：

```text
release metadata 已不存在
```

则：

```text
409 release unsupported
```

这不会把 assembly metadata 暴露给 Browser。

---

# 45. 为什么不能简单“releaseId 不同就强制 reload”

因为这会破坏当前非常好的 rollout 性质。

普通代码发布：

```text
Release A → Release B
```

并不应该强迫所有打开表单的用户立即 reload。

当前 release coordinator 明确只通过 releaseId equality 判断“有新版本”，并把它视为：

```text
update-available
```

而不是 fatal error。

所以兼容策略必须是：

```text
release differs
+
assembly same
→ update available, old tab continues

release differs
+
assembly differs
→ old tab cannot safely continue
→ reload required
```

这样才能同时获得：

```text
active-only artifact
+
old-tab graceful rollout
```

---

# 46. ReleaseProbe V2 与 Assembly Compatibility 相互独立

因此前文的：

```ts
ReleaseProbe V2 {
  schema: 2
  releaseId
}
```

仍然成立。

`/__qualy/release` 不需要告诉 Browser：

```text
assembly changed
resolutionHash
serverProtocol window
```

它仍然只回答：

```text
host currently serves which release
```

真正的 hard incompatibility 在 API transport 第一次交互时通知。

这保持职责非常干净：

```text
/__qualy/release
→ update awareness

API compatibility middleware
→ can this browser continue talking to this server?
```

当前 release coordinator 本来也只使用 probe 的 `releaseId` 做 update detection。

---

# 47. Surface-addressed Registry 的真实生成结构

前文 `ComponentRegistry` 的方向正确，但 build output 不建议生成一个运行时大对象：

```ts
{
  pages: Record<...>,
  layouts: Record<...>,
  ...
}
```

更适合生成四个 loader registry：

```ts
export const pageComponents = {
  'assessment/batches': () => import('.../BatchListPage'),
}

export const layoutComponents = {
  'workspace-shell/v1': () => import('.../WorkspaceShell'),
}

export const slotComponents = {
  'layout/header-actions': {
    'auth/account-menu': () => import('.../AccountMenu'),
  },
}

export const loginComponents = {
  local: () => import('.../LoginMethod'),
}
```

这里：

```text
key
→ public product surface identity

value
→ build-time-only implementation import edge
```

Browser public wire 只有 key。

---

# 48. Build Collector 不再收集“component refs 列表”，而收集“surface bindings”

当前 collector 先把所有 `ClientComponentRef` 拉平：

```ts
componentRefs(descriptor)
```

再根据：

```ts
componentKey(pluginId, ref)
```

生成 registry key。

改成：

```ts
interface BrowserSurfaceBindings {
  pages: Map<PageId, ClientComponentRef>
  layouts: Map<LayoutContractId, ClientComponentRef>
  slots: Map<SlotKey, Map<NamespacedId, ClientComponentRef>>
  login: Map<LoginDriverType, ClientComponentRef>
}
```

collector 直接遍历 descriptor declaration：

```text
Ui.page
→ page.id

Ui.layout
→ layout.contract

Ui.slot
→ slot.key + slot.id

LoginDriver
→ driver.type
```

每一种 identity 单独进行 conflict detection。

---

# 49. Conflict 检测仍必须发生在 Build

不能因为 server registry 已经检查过就取消 build gate。

Build 必须拒绝：

```text
两个 page claim 同一个 page.id

两个 layout implementation claim 同一个 contract

同一个 slot 下两个 contribution claim 同一个 id

两个 login driver claim 同一个 type
```

原因：

```text
server refusal
```

不能代替：

```text
browser build refusal
```

否则可能出现 server 还没启动，Web artifact 已经把后一个 import 覆盖前一个的问题。

---

# 50. `LayoutDeclaration.provider` 建议连内部 declaration 都删除

前文只要求 manifest 不发送：

```text
provider
```

但继续看当前 registry 后，这个字段本身也没有必要保留。

当前：

```ts
LayoutDeclaration {
  contract
  provider
  component
}
```

而 registry 已经额外保存：

```ts
Owned<LayoutDeclaration> {
  declaration
  owner
}
```

`owner` 就是实际声明该 layout 的 plugin。

因此：

```text
provider
```

是第二份 implementation identity，并且理论上可以和真实 owner 不一致。

建议直接改：

```ts
interface LayoutDeclaration {
  readonly contract: LayoutContractId
  readonly component: ClientComponentRef
}
```

duplicate error：

当前：

```text
layout contract X is claimed by provider A and provider B
```

改：

```text
layout contract X is claimed by owner A and owner B
```

owner 来自 registry，不来自插件自己填写的数据。

这进一步贯彻：

> implementation owner 由 assembly 决定，不由 implementation 自己重复声明。

---

# 51. Browser Diagnostics 改成 Surface Diagnostics

当前 component boundary 上报：

```ts
{
  ;(componentId, componentKind)
}
```

并且 `componentId` 当前是 implementation-derived registry key。

Surface registry 完成后应改成：

```ts
type BrowserSurface =
  | {
      kind: 'page'
      id: NamespacedId
    }
  | {
      kind: 'layout'
      id: LayoutContractId
    }
  | {
      kind: 'slot'
      slot: string
      id: NamespacedId
    }
  | {
      kind: 'login'
      id: string
    }
```

RUM context：

```ts
interface ExceptionContext {
  readonly surface?: BrowserSurface
  readonly pageId?: string
  readonly route?: string
}
```

例如：

```json
{
  "surface": {
    "kind": "page",
    "id": "assessment/review"
  }
}
```

而不是：

```json
{
  "componentId": "assessment/ReviewPage"
}
```

---

# 52. Missing Component 诊断也按 Surface

当前：

```text
component-missing
componentId
componentKind
```

改：

```text
surface-missing
surface.kind
surface.id
```

slot 则再带：

```text
surface.slot
```

这既有足够调试价值，也不泄露源码实现。

---

# 53. 私有 Surface Symbol Map

Surface address 已经足以给大多数工程诊断使用，但对于：

```text
surface-missing
chunk mapping
build diagnosis
```

内部人员仍然可能希望知道它最终来自哪里。

因此 build 生成：

```text
.qualy-private/browser-surfaces.json
```

例如：

```json
{
  "page:assessment/review": {
    "owner": "@qualy/plugin-assessment",
    "module": "./client/review/ReviewPage",
    "export": "default"
  },

  "layout:workspace-shell/v1": {
    "owner": "@qualy/plugin-layout-default",
    "module": "./client/WorkspaceShell",
    "export": "default"
  },

  "slot:layout/header-actions:auth/account-menu": {
    "owner": "@qualy/plugin-auth",
    "module": "./client/AccountMenu",
    "export": "default"
  }
}
```

文件规则与 SourceMap 相同：

```text
apps/web/dist private staging
→ 可以

packages/plugins/infra/web/client-dist
→ 不可以

public static assets
→ 不可以
```

增加 `check-staged-web` gate：

```text
browser-surfaces.json
不得进入 staged public release
```

---

# 54. `ClientComponentRef` 仍然保留，但它是 Build Contract，不是 Wire Contract

不要因为 manifest 不再传 component ref 就删除 `ClientComponentRef`。

它仍然解决：

```text
server descriptor
→ 不 import React

build collector
→ 知道应该产生哪个 import() edge
```

所以关系变成：

```text
ClientComponentRef
      │
      │ build-time only
      ▼
Browser Surface Loader Registry

Surface Identity
      │
      │ public
      ▼
Manifest / API
```

这两个身份必须正式区分。

---

# 55. 第三方插件的 Module Ref 不能再依赖 `<package>/src`

这是当前方案还必须补的一块。

现有 `ClientComponentRef` 注释明确规定：

```text
module path relative to plugin src/
```

而 collector 实际直接：

```ts
path.resolve(packageDir, 'src', ref.module)
```

这意味着第三方正常发布：

```text
my-plugin/
  dist/
    index.js
    client/Page.js
```

但不发布 `src/` 时，Qualy 无法构建它。

这与“第三方插件是独立 npm package”直接冲突。

---

# 56. Module Ref V2：改成 Package Export Subpath

推荐新的引用：

```ts
Ui.react('./client/ReviewPage')
```

而不是：

```ts
Ui.react('./client/ReviewPage.tsx')
```

含义不再是：

```text
<package>/src/client/ReviewPage.tsx
```

而是：

```text
当前 plugin package 的 export subpath
./client/ReviewPage
```

于是 package 可以自己决定真实实现位置。

First-party workspace：

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./client/ReviewPage": "./src/client/ReviewPage.tsx"
  }
}
```

第三方 published package：

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./client/ReviewPage": "./dist/client/ReviewPage.js"
  }
}
```

descriptor 完全一样：

```ts
Ui.react('./client/ReviewPage')
```

---

# 57. Collector 使用 Assembly Resolver，而不是 `packageDir/src`

Assembly 当前已经提供：

```text
resolvePluginModuleUrl(...)
resolvePackageDir(...)
```

因此 browser collector 应使用：

```text
pluginId
+
module subpath
→ package export specifier
→ Assembly resolver
```

概念：

```ts
resolvePluginExport(pluginId, './client/ReviewPage')
```

最终得到：

```text
file:///.../dist/client/ReviewPage.js
```

或者 workspace：

```text
file:///.../src/client/ReviewPage.tsx
```

build tool 不再知道：

```text
src
dist
.tsx
.js
```

这些 packaging implementation。

---

# 58. I18n 与 Browser Lifecycle Module 也必须使用同一种 ModuleRef

不能只修 React component。

当前：

```text
Ui.i18n('./client/i18n.ts')
Ui.browser('./client/register.ts')
```

collector 同样通过：

```text
packageDir/src
```

解析。

因此统一改成：

```text
ModuleRef
```

用于：

```text
Client component
I18n catalog
Browser lifecycle
未来其他 browser external modules
```

不要每种 feature 各自定义一套“相对 src 路径”。

---

# 59. `ModuleRef` 应属于 Plugin Platform，而不是 UI

建议：

```text
@qualy/plugin-kit/module
```

定义：

```ts
export interface PluginModuleRef {
  readonly subpath: string
  readonly export: string
}
```

或更窄：

```ts
export interface BrowserModuleRef {
  readonly subpath: `./${string}`
  readonly export: string
}
```

`ui-contract` 的：

```ts
ClientComponentRef
```

内部引用它：

```ts
interface ClientComponentRef {
  renderer: string
  module: PluginModuleRef
}
```

以后：

```text
server lazy module
CLI command
browser module
```

也可以共享 package subpath resolution primitive。

---

# 60. Descriptor Purity 必须列入最终目标

当前 assembly import descriptor 时，会执行 plugin root module。

虽然 descriptor 本身主要是 declaration，但不少 plugin root 又静态 import：

```text
server Layer
handler Layer
DB entities
runtime implementation
```

因此现在：

```text
qualy resolve
```

的“无副作用”主要依靠开发纪律。

真正开放第三方后，这不够。

最终原则：

> Importing a plugin descriptor must not initialize runtime implementation.

---

# 61. Descriptor 允许包含的内容

Root descriptor module 可以包含：

```text
plain data
Schema
ExtensionPoint contribution
capability declaration
module reference
small pure helper
```

不能在 descriptor import 期间：

```text
connect database
open socket
start timer
install global listener
read request state
start worker
instantiate vendor SDK
spawn process
create background fiber
```

---

# 62. Runtime Implementation 逐步改成 Lazy ModuleRef

长期从：

```ts
Plugin.layer(serviceLayer)
```

变成类似：

```ts
Plugin.runtime({
  module: './server/runtime',
  export: 'layer',
})
```

API：

当前如果直接塞 handler layer：

```ts
Api.group(api, handlers)
```

长期：

```ts
Api.group(api, {
  module: './server/api',
  export: 'handlers',
})
```

DB：

当前：

```ts
Db.entities(entities)
```

长期可以考虑：

```ts
Db.entities({
  module: './db',
  export: 'entities',
})
```

真正加载时机：

```text
qualy resolve
→ descriptor only

database resolve
→ DB schema module

server boot
→ runtime/API modules

browser build
→ browser module refs
```

这个阶段优先级低于 Browser/Public Surface，但必须列入第三方插件完成态。

---

# 63. 不要一次性把所有 Plugin.layer 改掉

Descriptor purity 建议分两步。

第一步：

```text
增加规则和 test
确保现有 root module 没有 observable side effect
```

第二步：

```text
再逐类将 runtime implementation 改成 lazy module refs
```

避免在 Browser 重构期间同时重写 server assembly loader。

---

# 64. Public Collections 需要正式纳入 Browser Public Surface Policy

Manifest V2 仍然有：

```ts
collections: Record<string, unknown[]>
```

这其实是剩余最大的“任意 public payload”出口。

任何插件都可以贡献：

```ts
Ui.collection(...)
```

然后 authorized projection 将 value 发给 Browser。

因此必须规定：

> UI collection contribution 的 value 本身就是 public browser protocol。

插件作者不能把：

```text
plugin owner
database id not intended for UI
provider implementation
internal config
permission catalog
backend diagnostics
```

塞进 collection。

---

# 65. 所有 Public Collection Token 应强制携带 Schema

当前 registry 对带 schema 的 token 会验证 value，但 schema 允许缺失。

建议最终：

```ts
UiCollectionToken<T>
```

对所有会进入 manifest 的 collection：

```text
schema required
```

这样：

```text
descriptor contribution
→ schema validation
→ authorized projection
→ browser
```

wire shape 有明确 contract。

如果确实存在 server-only collection，则应该定义另一种：

```text
ServerCollectionToken
```

而不是让 public collection token 的 schema 可选。

---

# 66. Manifest V2 应搬到 `@qualy/app-contract`

当前 Manifest interface 实际定义在：

```text
plugin-ui-registry/src/server/manifest.ts
```

也就是说 Browser wire contract 属于 implementation plugin。

这与前面确立的依赖方向冲突。

新建：

```text
packages/contracts/app/
```

提供：

```text
Manifest V2 Schema
Manifest type
appApiGroup
/app/manifest endpoint
public shell protocol
```

然后：

```text
plugin-ui-registry
→ implements endpoint

web-runtime
→ consumes contract
```

而不是：

```text
web-runtime
→ plugin-ui-registry implementation
```

---

# 67. Manifest Schema 必须是 Effect Schema，而不是 TS interface-only

建议：

```ts
export const ManifestLayoutSchema = ...
export const ManifestPageSchema = ...
export const ManifestSlotSchema = ...

export const AppManifestSchema =
  Schema.Struct({
    schema: Schema.Literal(2),
    layouts: ...,
    pages: ...,
    collections: ...,
    slots: ...,
  })
```

Browser typed HttpApi client直接由同一 contract 得到类型。

这样 Manifest V2 不再存在：

```text
server TS interface
browser another copy
tests another hand-written shape
```

> **裁决(2026-09-15,Phase B 落地时):`schema: Schema.Literal(2)` 这一条否决,不再实施。**
> 「Manifest 由一份 Effect Schema 单源」这半条已经成立,而且本来就是实情:形状定义在
> `plugin-ui-registry/src/api.ts` 的 HttpApiEndpoint 上,服务端投影与浏览器 typed client
> 同出一源,测试不另写手抄形状。**被否决的只有版本字段本身**——
>
> manifest 经 typed client 传输,而 client protocol 已经在 handler 之前拒绝了不兼容的浏览器;
> §68 自己也把「Manifest wire shape breaking」定义为 client protocol change。再加一个没有任何
> 消费者会分支的 `schema`,就是同一条规则的第二个版本源,而两个版本源迟早不同步。
>
> 版本所有权因此明确为:**manifest 文档的代次由 `CURRENT_CLIENT_PROTOCOL` 单独承载**。
> 与 `/__qualy/release` 探针的 `schema` 不同——那份文档在 typed client 之外被裸 fetch、由一个
> guard 读,没有传输层替它把关,所以它需要自己的代次。
>
> 谁要把 `schema` 加回 manifest,先推翻这段裁决。

---

# 68. Manifest V1 不需要长期兼容

Qualy 当前 Browser 和 server 是同一 deployment pipeline，并且已经有：

```text
release compatibility
client protocol
release recovery
```

Manifest 不是公开第三方 API。

因此 V1 → V2 可以作为一个 breaking browser protocol change。

实施时：

```text
CURRENT_CLIENT_PROTOCOL
1 → 2
```

或者如果当前整体尚未上线、没有需要保留的旧生产 tab，可以直接迁移并保持 generation，由项目当前 compatibility policy决定。

从架构严格性看：

```text
Manifest wire shape breaking
```

应视为 client protocol change。

---

# 69. Active-only Build 引入后 Build Identity 必须明确

原来：

```text
release
→ superset
```

之后：

```text
release
→ exact active assembly
```

因此 Web build metadata 必须继续记录：

```text
releaseId
resolutionHash
```

但：

```text
resolutionHash
```

只留 private installed metadata。

Browser runtime只拿：

```text
releaseId
clientProtocol
mode（bundle内部）
```

其中 `mode` 甚至不需要离开 bundle。

---

# 70. `QUALY_RELEASE_ID` 与 private build revision 分开

Production pipeline 建议区分：

```text
QUALY_RELEASE_ID
→ public opaque browser identity

QUALY_BUILD_REVISION
→ private git commit/build revision
```

例如：

```text
QUALY_RELEASE_ID=
r_7YmxgRUPZoHV0r5m

QUALY_BUILD_REVISION=
3e01e6a2d9cbeda2581671b45727ef268861d564
```

private build metadata：

```json
{
  "releaseId": "r_7YmxgRUPZoHV0r5m",
  "revision": "3e01e6...",
  "resolutionHash": "...",
  "ciRun": "...",
  "builtAt": "..."
}
```

public release probe：

```json
{
  "schema": 2,
  "releaseId": "r_7YmxgRUPZoHV0r5m"
}
```

---

# 71. RUM Version 继续从 Public Release ID 派生

当前 Tencent RUM：

```text
RUM version
← browser webRelease.releaseId
```

这保持不变。

如果 public release id控制在 Tencent 60 字符限制内：

```text
RUM version = releaseId
```

就不再需要 hash fallback。

推荐 public production release 格式本身直接满足：

```text
Tencent RUM max length
Qualy filesystem/header constraints
```

例如：

```text
r_<22~32 chars base64url>
```

---

# 72. Browser Lifecycle Host 的执行顺序必须固定

完成 `Browser.module()` 后，`apps/web` boot 顺序建议冻结：

```text
1. browser-observability/bootstrap
   安装最早期 error/rejection queue

2. release identity 初始化

3. evaluate generated active browser plugin declarations
   只允许 pure module evaluation

4. BrowserPlugin.setup()
   同步注册 lightweight capability
   收集 disposer

5. release coordinator start

6. BrowserPlugin.start()
   非阻塞启动异步 provider
   例如 fetch RUM config + import Aegis

7. React render

8. unload/test reset/HMR
   reverse-order dispose
```

这里 `start()`：

```text
不得被 await 后才 render
```

否则一个 telemetry/storage provider 可以阻塞 UI。

---

# 73. `BrowserPlugin.start()` 不应该成为 Service Locator

`BrowserPluginContext` 不要提供：

```text
all plugins
assembly
database
auth provider
generic getService()
```

保持极小：

```ts
interface BrowserPluginContext {
  readonly release: {
    releaseId: string
    clientProtocol: number
  }
}
```

真正 capability registration 仍然通过它自己的 package：

```text
storage provider
→ @qualy/plugin-storage/client

RUM provider
→ @qualy/plugin-rum/client
```

BrowserPlugin lifecycle 只解决：

```text
什么时候执行
什么时候释放
```

不负责发明第二个 DI container。

---

# 74. Browser Lifecycle Disposer 顺序

setup：

```text
A
B
C
```

dispose：

```text
C
B
A
```

使用 stack：

```ts
const disposers: Dispose[] = []

...
disposers.push(dispose)

...
for (const dispose of disposers.reverse())
  safely(dispose)
```

任何 disposer throw：

```text
console.warn once
继续 dispose 其他 owner
```

不能因为一个第三方插件 cleanup 失败阻止其余 teardown。

---

# 75. RUM Registry 改成单槽之后还要保留 duplicate hard-fail

不要改成：

```text
第二个 provider 自动覆盖第一个
```

Browser active artifact 理论上只会包含一个 provider。

如果仍然出现两个：

```text
这是 broken assembly/build
```

所以：

```ts
registerRumProvider(provider)
```

第二次注册不同对象时应：

```text
throw in development/test
warn + refuse second in production
```

或者统一构建阶段 hard fail。

推荐构建阶段 hard fail，browser runtime只处理不可能状态。

---

# 76. Storage Driver 不一定要改成单槽

Storage 与 RUM 不同。

一个系统可能同时存在：

```text
旧 attachment → cos
新 attachment → local
另一个 tenant → s3
```

因此：

```ts
Map<driverCode, UploadDriver>
```

仍然合理。

但注册必须变成 disposer。

这里不要为了“统一 RUM”把 Storage 错误地改成 single provider。

---

# 77. Third-party Plugin Package ABI

开放第三方前，插件 package 至少要能声明：

```json
{
  "qualy": {
    "plugin": 1
  }
}
```

更完整可以是：

```json
{
  "qualy": {
    "pluginApi": 1
  }
}
```

resolver 在执行 descriptor 前先读取 package metadata。

如果：

```text
pluginApi > host supported
```

直接报：

```text
@acme/foo requires Qualy Plugin API 2;
this host supports 1
```

而不是等到：

```text
某个 import/export 不存在
```

才失败。

---

# 78. Contract packages 最终必须成为真实 semver SDK

目前很多：

```text
@qualy/*-contract
@qualy/plugin-kit
@qualy/ui
```

仍是：

```text
private: true
version: 0.0.0
exports → src
```

真正第三方开发前需要发布：

```text
compiled ESM
.d.ts
real semver
documented exports
peer dependency ranges
```

第三方插件应当只依赖这些。

这个工作不是 Browser Public Surface 重构的前置，但属于插件平台正式开放前的 DoD。

---

# 79. Cross-plugin Import Gate 需要区分“实现”和“契约”

不能粗暴禁止所有：

```text
@qualy/plugin-*
```

因为当前：

```text
@qualy/plugin-database/plugin
@qualy/plugin-ui-registry/plugin
```

实际上承担 capability declaration facade。

过渡期规则：

```text
允许：
@qualy/plugin-X/plugin

禁止：
@qualy/plugin-X/server
@qualy/plugin-X/server/*
@qualy/plugin-X/client
@qualy/plugin-X/client/*
@qualy/plugin-X/db
任意内部 src path
```

然后逐步把 declaration facade 迁到：

```text
@qualy/database-contract/plugin
@qualy/ui-contract/plugin
```

最终实现 plugin import allowlist 才能归零。

---

# 80. `@qualy/auth-contract/session` 应优先迁移

这是 Contract Boundary Phase 中最值得先做的。

因为当前 auth 已经有一个真正的 contract package，login driver registry 甚至已经使用 scoped registration，而且注释明确把它定位为跨插件稳定接口。

因此 session 继续留：

```text
plugin-auth/server/session-contract
```

已经没有架构理由。

迁移：

```text
Viewer
Authenticated
CurrentUser
CurrentViewer
session principal
public auth errors
```

到：

```text
@qualy/auth-contract/session
```

可以一次消掉多个 production implementation edge。

---

# 81. UI Contract 还需要做 Domain Ownership 清理

当前 `ui-contract` 如果包含：

```text
people-picker
person-card
org-node-picker
```

这类身份/组织领域 surface，则应继续拆：

```text
@qualy/auth-contract/ui
@qualy/org-contract/ui
```

真正 generic UI contract 只保留：

```text
PageRef
LayoutContract
generic Slot/Collection primitive
navigation primitive
ClientComponentRef
```

原则：

```text
平台 UI contract
不能知道
“用户”“组织节点”“测评项目”
```

这些是领域 contract。

---

# 82. Browser Test Ownership 迁移时不要破坏 Single React Invariant

测试文件可以回各包：

```text
packages/plugins/.../tests/*.browser.test.tsx
```

但 browser runner继续由一个 host 执行。

不要：

```text
每个 package 自己 vite browser config
```

因为：

```text
React
ReactDOM
StyleX
Mantine
browser runtime
```

必须保持同一个 resolver/instance。

原报告对此判断是正确的。

---

# 83. `@qualy/testkit/browser` 不得默认加载产品 Assembly

Testkit 的核心约束：

```text
single plugin test
≠
whole Qualy composition test
```

因此：

```ts
renderPlugin(...)
```

必须由测试自己显式提供：

```text
components
manifest fragment
catalogs
runtime context
fake API
```

不能内部：

```ts
import 'virtual:qualy/plugins'
```

只有：

```text
apps/web/tests/composition.*
```

允许使用真实 aggregate。

---

# 84. Public Web Gate 不应试图证明“无法逆向”

Gate 的目标不是：

```text
攻击者看不懂 JS
```

而是：

```text
我们没有主动发布不必要的 implementation metadata
```

所以 `check-public-web.ts` 不应检查：

```text
JS 中不能出现 assessment
JS 中不能出现 auth
JS 中不能出现 function name
```

这些不可维护。

应该检查明确的不变量：

```text
source map
source path
disabled sentinel
plugin package ID wire fields
manifest implementation fields
semantic JS filenames
default OpenAPI exposure
private config secret sentinel
```

---

# 85. 增加 Browser Artifact Secret Sentinel Test

除了静态关键字扫描，还应做真正的 build test。

CI 注入：

```text
QUALY_SERVER_PRIVATE_SENTINEL=
QUALY_PRIVATE_SENTINEL_6E77...
```

到一个明确 server-only config fixture。

构建 Web 后：

```text
grep staged artifact
```

必须：

```text
0 hit
```

这样可以证明：

```text
某次错误 import
```

没有把 server config object tree-shake 进 browser。

---

# 86. Manifest Disclosure Test 使用 Sentinel Plugin

Fixture：

```text
@fixture/qualy-public-surface-probe
```

内部故意使用非常醒目的 implementation metadata：

```text
package:
@fixture/qualy-public-surface-probe

source:
SecretImplementationPage.tsx

layout owner:
fixture/internal-layout-provider
```

Public surface：

```text
fixture/public-page
fixture/public-slot
```

Manifest 必须：

```text
包含：
fixture/public-page
fixture/public-slot

不包含：
@fixture/qualy-public-surface-probe
SecretImplementationPage
internal-layout-provider
./client/
```

这比只看 TypeScript interface 更能防止回归。

---

# 87. Dist-only Plugin Acceptance Test

建立真正 npm tarball fixture。

package：

```text
fixture-plugin/
  dist/
    index.js
    client/Page.js
    client/i18n.js
  package.json
```

明确：

```text
不包含 src/
```

执行：

```text
pnpm pack
→ install into synthetic application.workspace
→ qualy resolve
→ vite build
→ server boot
→ browser smoke
```

成功才算 third-party module ABI 成立。

这是第三方化不可缺的一条 gate。

---

# 88. Descriptor Purity Test

建立 malicious fixture：

```ts
globalThis.__QUALY_DESCRIPTOR_SIDE_EFFECT__ = true
```

或尝试：

```text
timer
network/socket
filesystem mutation
```

不建议真的让 CI 打外部网络。

可以通过 instrumented globals/fakes 检测：

```text
import descriptor
```

阶段只允许 descriptor declaration。

更实际的第一版 gate：

```text
first-party plugin root modules
禁止：
setInterval
setTimeout at top level
Effect.run*
new Worker
new WebSocket
listen(
connect(
```

再辅以 fixture test。

---

# 89. Active-only Build 的 Dev/Test/Production 模式

最终构建模式明确只有：

```text
active
```

用于：

```text
vite dev
vite build
browser test
```

未来如果真的需要 superset：

```text
qualy web build --universal
```

必须是显式特殊模式。

不要再让：

```text
environment.command === 'build'
```

隐式改变 plugin selection 语义。

这条很重要：

> build tool command 不应该偷偷决定 assembly 语义。

assembly 应由：

```text
qualy.yml + resolution
```

决定。

---

# 90. `readEntries({ all })` 不必因此从 Assembly Core 删除

`all` 在 assembly tooling 仍可能有合理用途，例如：

```text
DB retention inspection
migration analysis
plugin management
doctor
uninstall safety checks
```

只需要：

```text
Web collector
```

永远读取：

```text
active entries
```

不要为了 Browser policy 改坏 assembly core 的 detached/disabled introspection 能力。

---

# 91. Browser Public Surface 与 Server Logs 的信息级别要明确分离

Production browser：

```text
surface id
page id
route template
release id
request id
public error tag
```

Server log：

```text
plugin owner
module
provider
internal error
trace id
request id
release id
assembly hash
database failure
```

Build/private artifacts：

```text
git revision
source module mapping
surface → implementation map
SourceMap
full resolution
dependency graph
```

形成三层：

```text
Public Browser
Private Runtime Diagnostics
Private Build Diagnostics
```

不要再让一个字段同时服务三个层级。

---

# 92. `console.error` 也属于 Public Browser Surface

虽然 console 不通过 HTTP wire 发送，但用户和自动化脚本都能读。

当前 component boundary 会打印：

```text
component <componentId> failed
```

surface registry 后应改为：

```text
page assessment/review failed
```

或者：

```text
surface page:assessment/review failed
```

不能打印：

```text
plugin
module path
source file
provider
```

SourceMap stack本身可能在 DevTools 中显示 minified bundle stack，这是不可避免且合理的。

---

# 93. Server startup logs 可以继续丰富

不要因为 Browser 最小披露而把服务端日志也降级。

例如：

```text
plugin @qualy/plugin-rum-tencent active
browser reporting provider tencent selected
layout workspace-shell/v1 supplied by ...
```

都可以在 server-side structured logs 保留。

最小披露政策只限制：

```text
public wire
public HTML
public assets
browser console
```

不是限制 operator diagnostics。

---

# 94. API Error Policy 再增加一个“不回显 input”规则

除了不返回 internal exception，还应明确：

```text
public error 默认不得回显 raw user input
```

例如不要：

```json
{
  "_tag": "INVALID_QUERY",
  "value": "用户刚输入的大段内容"
}
```

除非客户端确实需要定位字段，并且返回的是：

```text
field path
public validation code
bounded public metadata
```

例如：

```json
{
  "_tag": "VALIDATION_FAILED",
  "issues": [
    {
      "path": "name",
      "code": "too_long"
    }
  ]
}
```

避免错误协议变成另一个隐私泄漏渠道。

---

# 95. Public Runtime Config 应实行 Allowlist 构造

例如 Tencent RUM 当前：

```ts
publicConfig: { ...settings }
```

虽然当前 `settings` 都可公开，但这种模式长期危险。

规则应改成：

```ts
publicConfig: {
  id: settings.id,
  environment: settings.environment,
  sampleRate: settings.sampleRate,
}
```

禁止：

```ts
publicConfig: { ...serverSettings }
```

任何 public config endpoint 都必须：

> 显式构造 allowlist DTO。

不能通过：

```text
spread config object
```

决定什么是 public。

---

# 96. Public Config Schema 与 Server Config Schema 必须分开

不要：

```ts
TencentRumConfigSchema
```

既作为 server config，又直接作为 browser response。

定义：

```ts
TencentRumServerConfig
TencentRumPublicConfig
```

即使今天字段完全一样，也不要合并。

原因：

以后 server config 增加：

```text
projectId
secretId reference
alerting config
sourceMap policy
```

不会自动进入 public endpoint。

---

# 97. Storage Grant 也遵循显式 Public DTO

同样：

```text
StorageBackendSettings
```

和：

```text
UploadGrant
```

必须是两个 contract。

Browser grant 只获得完成一次上传需要的数据。

临时 COS credential 是例外：

```text
它虽然敏感
但浏览器为了 direct upload 必须得到
```

安全来自：

```text
short TTL
scope to object/key
size constraints
server authorization
reservation
```

不是来自隐藏 provider 名。

---

# 98. Phase 顺序需要做一个调整

你当前 Phase D：

```text
active-only
+
open-world discovery
```

我建议拆开。

因为 active-only 涉及旧 tab compatibility，是 deployment semantics；open-world discovery 涉及 package resolution，是 plugin ABI。

更安全的顺序：

```text
Phase D1
active-only + assembly compatibility

Phase D2
remove apps/web plugin deps

Phase D3
open-world scope discovery

Phase D4
package-export ModuleRef / dist-only plugin
```

每一阶段都能单独定位回归。

---

# 99. 修订后的完整阶段依赖

```text
A
Low-risk public wire cleanup
        ↓
B
Surface registry + Manifest V2
        ↓
C
Browser observability extraction
        ↓
D1
Active-only Web build
+
old-tab assembly compatibility
        ↓
D2
apps/web zero plugin implementations
        ↓
D3
Open-world descriptor discovery
        ↓
D4
Package-export ModuleRef
+
dist-only plugin support
        ↓
E
Browser lifecycle
        ↓
F
Contract / implementation boundary
        ↓
G
Browser test ownership + testkit
        ↓
H
Descriptor purity
        ↓
I
Public third-party SDK / package ABI
        ↓
J
Plugin management CLI
```

原报告把整体工作拆为 P1～P6 的基本思路是对的，但在当前 active-only/Public Surface 决策下，需要把 browser build、module ABI 和兼容协议进一步拆开。

---

# 100. Phase A 文件级修改

主要修改：

```text
apps/server/src/health.ts

packages/contracts/release/src/index.ts
packages/contracts/release/tests/*

packages/web/runtime/src/release.ts
packages/web/runtime/tests/release*

packages/build/web/src/release-vite.ts
packages/plugins/infra/web/src/server/index.ts

apps/web/index.html

tools/quality/smoke-production.ts
```

增加：

```text
docs/browser-public-surface.md
```

这一阶段不要碰 plugin registry。

---

# 101. Phase B 文件级修改

主要：

```text
packages/contracts/ui/src/components.ts
packages/contracts/ui/src/declarations.ts

packages/build/web/src/collect.ts

packages/plugins/infra/ui-registry/
  src/server/registry.ts
  src/server/manifest.ts
  src/api.ts

packages/web/runtime/
  src/route-builder.tsx
  src/index.tsx
  src/component-boundary.tsx

packages/contracts/auth/src/login.ts
packages/plugins/base/auth/src/server/sign-in.ts
packages/plugins/base/auth/src/client/LoginPage.tsx
```

新增：

```text
packages/contracts/app/
```

删除：

```text
componentKey()
Manifest*.component
ManifestLayout.provider
LoginPresentation.component
```

---

# 102. Phase B 特别注意 Login Provider

当前 auth server 会：

```text
driver declaration
→ found.owner
→ componentKey(owner, ref)
→ LoginMethod.component
```

改造后：

```text
driver.type
→ browser login registry key
```

所以：

```ts
LoginPresentation =
  | { mode: 'component' }
  | { mode: 'redirect'; href: string }
```

Login driver declaration仍然保存：

```text
ClientComponentRef
```

给 build collector。

public list methods endpoint不再发送 ref-derived string。

---

# 103. Phase C 文件级修改

新增：

```text
packages/web/observability/
```

迁移自：

```text
packages/plugins/infra/rum/src/client/
```

包括：

```text
bootstrap.ts
queue.ts
context.ts
sanitize.ts
capture/dedup/safe sink
```

修改：

```text
apps/web/src/main.tsx
packages/web/runtime/src/component-boundary.tsx
packages/web/runtime/src/route-builder.tsx
packages/web/runtime/package.json

packages/plugins/infra/rum/src/client/*
packages/plugins/infra/rum-tencent/src/client/*
```

当前 `apps/web`、component boundary 和 web-runtime 对 `plugin-rum` 的直接依赖确实存在。

---

# 104. Phase D1 文件级修改

> **前置修复(2026-09-15 记,Phase B 复审提出)**:`apps/web/scripts/check-chunks.ts` 的
> `--expect-absent` 分支在找不到 binding 时仍然 `expectAbsent.split(':').pop()`,想从 surface
> 名猜出 chunk basename。surface 与 module 在 Phase B 已经正式解耦,这个 fallback 不再可靠。
> D1 要做 disabled sentinel,**必须先换掉它**:absent 判定改用 build metadata / Rollup 输出,
> 或一个专门的 disabled sentinel,不要再从 surface 名推 chunk 名。正向的「每个 surface 都有
> 独立 chunk」已改成按 module basename 统计唯一模块数,不受影响。

修改：

```text
packages/build/web/src/vite.ts
packages/build/web/src/collect.ts

apps/server/src/client-compatibility.ts

packages/contracts/release/src/index.ts
packages/web/runtime/src/api.ts
packages/web/runtime/src/release.ts

packages/plugins/infra/web/
release store lookup/service
```

删除 Web build：

```text
all=true
plugins.all.ts
scan.all.ts
```

新增：

```text
release → resolutionHash compatibility lookup
assembly-skew browser reload reason
```

---

# 105. Phase D2/D3/D4 文件级修改

D2：

```text
apps/web/package.json
packages/build/web/src/collect.ts
```

删除 apps/web plugin dependencies。

D3：

```text
packages/build/web/src/collect.ts
tools/tests/catalogs.test.ts
permission fixtures
任何 @qualy scope discovery
```

D4：

```text
packages/contracts/ui/src/components.ts
packages/core/plugin-kit/src/module.ts
packages/core/assembly resolver
packages/build/web/src/collect.ts

所有 plugin package.json exports
```

加入 dist-only fixture。

---

# 106. Phase E 文件级修改

新增：

```text
packages/core/plugin-kit/src/browser.ts
```

定义：

```text
BrowserModules extension point
Browser.module()
BrowserPlugin
BrowserPluginContext
Dispose
```

删除 UI capability 中：

```text
BrowserModules
Ui.browser()
```

当前 `BrowserModules` 确实属于 UI registry 只是历史便利，而 RUM 等使用它并不属于 UI surface。

迁移：

```text
storage-local
storage-cos
rum-tencent
```

当前 Tencent provider 正是通过 `Ui.browser('./client/register.ts')` 注册浏览器半边。

---

# 107. Phase F 文件级修改

新增/扩展：

```text
@qualy/auth-contract/session
@qualy/app-contract
```

迁移所有：

```text
plugin-auth/server/session*
plugin-ui-registry/api
```

被其他 package 消费的 contract。

增加 dependency gate。

这个阶段先不要大规模改 DB entity relationship。

---

# 108. Phase G/H 不与 Runtime 重构混 commit

本计划定义到 Phase H 为止。标题原本写作 “G/H/I/J”，但下文四组里只有两组有目标、文件清单与
DoD，另外两组从头到尾没有——**不存在被定义过的 Phase I 或 J**，不要按这个标题去开发一个。

有 Phase 的两组:

Browser tests(Phase G)：

```text
物理归属迁移
testkit
```

Plugin manager(Phase H)：

```text
add
enable
disable
remove
```

没有 Phase 的两组。它们是想法,不是计划;真要做,各自先写自己的目标与 DoD:

```text
Descriptor purity   lazy runtime refs
SDK                 compiled packages / semver / plugin API version
```

`purge` 同样属于这一类——本轮明确不实现,`disable` 与 `remove` 都不删数据(§2.1)。

有 Phase 的这些分别提交。

---

# 109. 每个 Phase 的 Rollback 条件

A：

```text
release recovery 出现异常
→ rollback A
```

B：

```text
任何 page/layout/slot/login 无法从 surface resolve
→ rollback B
```

C：

```text
early error capture/RUM privacy regression
→ rollback C
```

D1：

```text
旧 tab + 新 server 兼容行为不可证明
→ 不允许上线 active-only
```

D4：

```text
dist-only third-party plugin 不能 build
→ open-world 不宣称完成
```

E：

```text
registration 无法稳定 teardown
→ Browser lifecycle 不算完成
```

不要跨 Phase 用 feature flag 长期维持两套 registry。

迁移完成后旧路径直接删除。

---

# 110. Required Test Matrix

每次主要阶段至少覆盖四种 assembly：

| Assembly                    | 用途                                    |
| --------------------------- | --------------------------------------- |
| 最小 core                   | 证明宿主不偷偷依赖 optional plugin      |
| 默认 Qualy                  | 回归正常产品                            |
| default + disabled provider | 证明 disabled 无 browser/server residue |
| third-party fixture         | 证明 open-world                         |

并至少覆盖：

```text
development
production build
production server
Chromium browser
WebKit browser
```

---

# 111. 旧 Tab Deployment Matrix

active-only 上线前必须专门测试：

```text
A → B code-only
same resolutionHash
→ old A tab continues

A → B plugin enabled
different resolutionHash
→ first API request forces reload

A → B plugin disabled
different resolutionHash
→ first API request forces reload

A release no longer retained
→ force reload

protocol incompatible
→ force reload

new release merely available
→ notice only, no forced reload
```

这组测试是 Phase D1 的硬 gate。

---

# 112. Public Surface Security Matrix

需要验证：

```text
Manifest
→ 无 implementation identity

Release
→ 只有 opaque release identity

Health
→ 无 failed provider identity

RUM config
→ 只有 explicit allowlisted public config

Storage grant
→ 只有完成一次上传所需数据

Errors
→ public domain facts only

HTML
→ product semantics only

JS filenames
→ no source/component semantic names

SourceMap
→ private only

OpenAPI
→ production default unavailable
```

---

# 113. Plugin Removal Matrix

每个 optional fixture plugin：

```text
active
→ API exists
→ UI exists
→ Browser setup runs
→ CSP exists
→ service/job exists

disabled
→ API gone
→ UI gone
→ browser code absent from artifact
→ CSP gone
→ service/job gone
→ DB retained

detached
→ same runtime behavior as disabled
→ retained capability data stays

purged
→ retained persistent resources removed

uninstalled
→ package resolution no longer required
```

这应该成为 plugin architecture 的核心 acceptance test。

---

# 114. 最终依赖方向

最终理想状态：

```text
                Platform Contracts
     ┌──────────────────────────────────┐
     │ plugin-kit                       │
     │ api-kit                          │
     │ app-contract                     │
     │ ui-contract                      │
     │ auth-contract                    │
     │ rbac-contract                    │
     │ browser-observability            │
     └──────────────────────────────────┘
            ↑                  ↑
            │                  │
     first-party plugin   third-party plugin
            │                  │
            └────────┬─────────┘
                     │
              Assembly Host


apps/web
→ platform only

web-runtime
→ platform only

apps/server
→ assembly/platform only

禁止：

platform
→ optional plugin implementation

禁止：

plugin A
→ plugin B implementation
```

---

# 115. 最终 Browser Dependency Graph

```text
apps/web
│
├── brand
├── app-contract
├── release-contract
├── browser-observability
├── ui
├── ui-contract
├── web-runtime
├── web-i18n
│
└── generated active browser aggregate
       │
       ├── active plugin surface loaders
       ├── active plugin catalogs
       └── active BrowserPlugin lifecycle modules
```

这里：

```text
apps/web/package.json
```

本身不认识任何具体 plugin。

---

# 116. 最终 Server Dependency Graph

```text
apps/server
│
├── assembly
├── api-kit
├── release-contract
├── telemetry
└── application.workspace resolver
       │
       └── active plugin descriptors
```

server composition root 也不应该：

```text
import auth
import assessment
import formula
import storage-cos
```

具体 plugin 全由 assembly 获得。

---

# 117. “足够调试信息”的最终定义

Browser 允许保留：

```text
releaseId
requestId
public page ID
route template
surface kind
surface product ID
public error tag
HTTP status
RUM stack after minification/source map
browser/OS/performance context
```

这已经足以从：

```text
browser incident
```

走到：

```text
RUM
→ release
→ source map
→ requestId
→ server log
→ traceId
→ APM
```

因此没有必要再把：

```text
pluginId
source module
provider
resolutionHash
```

暴露给 Browser。

---

# 118. 不应做的“安全增强”

本设计明确禁止通过以下方式实现信息最小化：

```text
AES 加密 manifest
前端保存解密 key
API path hash/乱码
JS 内 request signing secret
全量 JavaScript obfuscation
把所有 API 合并成 opaque RPC number
隐藏 HTTP status
删除 requestId
禁用 SourceMap 上传
```

它们要么没有真正安全收益，要么会破坏 observability 和维护性。

---

# 119. 最终 CI Hard Gates

最终 main 不能合并，除非满足：

```text
pnpm typecheck
pnpm test
pnpm build

browser Chromium
browser WebKit

production smoke
CSP build gate
CSP enforce gate

check-staged-web
check-public-web
plugin-isolation
third-party dist-only fixture
old-tab compatibility matrix
disabled-plugin artifact sentinel
SourceMap private gate
```

其中最后五个是本轮新增的核心保障。

---

# 120. 本轮最终 Definition of Done

完成后必须能陈述以下事实，而且都有自动测试证明。

**两处与 §108 的裁决对齐**(2026-09-15 收尾时校正):

- 第 22 条 `purge 才是 destructive lifecycle` **不属于本轮**。§108 已裁决 purge 本轮明确不实现;
  这一条描述的是插件平台未来的形状,不是 A–H 的验收项。留在这里只是因为它说明了
  「为什么 disable/remove 不删数据」——**第 21 条才是本轮要证明的**。
- 第 23 条的 `browser test` 一段由**另一个** fixture 完成(`acme-browser-probe`,它自己的包、
  自己的 `@qualy/testkit/browser` 用例);其余各段由 `acme-dist-probe` 一条链跑通,
  包含真实的 `pnpm pack` → `pnpm install`。一条链一个包的字面读法没有实现,也不打算实现:
  浏览器测试需要一个带 React 的包,而 dist-only 那个包的意义正是它什么都不带。

```text
1.
Browser Manifest 不携带 plugin/module/provider identity。

2.
Browser component resolution 完全使用 public surface identity。

3.
componentKey() 不存在。

4.
disabled plugin 不进入 production Web artifact。

5.
apps/web 不依赖具体 plugin implementation。

6.
packages/web 不依赖 optional plugin implementation。

7.
第三方 scope plugin 可以正常被 resolver/build/runtime 使用。

8.
第三方 dist-only npm package 不需要发布 src/。

9.
Browser plugin side effect 有明确 setup/dispose 生命周期。

10.
platform browser observability 不依赖 RUM plugin。

11.
server/browser public config 使用显式 allowlist DTO。

12.
old tab 在同 assembly 的新 release 上继续工作。

13.
old tab 遇到不同 assembly 时被明确要求 reload。

14.
Browser 永远看不到 resolutionHash。

15.
Health readiness 不泄露 implementation check。

16.
Production OpenAPI 默认关闭。

17.
Production JS filename 不暴露 component/source basename。

18.
SourceMap 永远不公开部署。

19.
跨 plugin production implementation import 被 CI 拒绝。

20.
package-owned browser tests 与 package 一起存在和删除。

21.
disable/remove 不删除 persistent data。

22.
purge 才是 destructive lifecycle。

23.
一个独立第三方 fixture plugin 能完成：
resolve
→ build
→ boot
→ browser test
→ disable
→ remove。

24.
移除插件后：
0 API
0 UI
0 CSP
0 job
0 browser registration
0 vendor network
0 test residue。
```

达到这些条件后，Qualy 才可以比较准确地宣称：

> Qualy 的插件不是主仓库里的“模块”，而是具有稳定契约、独立生命周期、独立测试和明确公共边界的可发布扩展单元。

同时 Browser 的安全边界也会从：

```text
“前后端是一套代码，所以多给点信息没关系”
```

变成：

```text
“Browser 只获得完成产品行为所需的信息；
assembly 与 implementation 始终属于服务端和私有调试域。”
```

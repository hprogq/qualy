可以。前面几轮已经把主要架构问题基本收敛了。下面这份可以直接作为 Qualy 的 Paraglide 实施 ADR/执行说明底稿。

我会把目标定义成一句话：

> **Qualy 使用 Paraglide JS 作为唯一的消息编译器，以插件自有 ICU MessageFormat 1 JSON 为唯一翻译源；浏览器静态文案编译为 tree-shakable ESM message functions，服务端 presentation 文案在响应边界按 document locale 渲染为 string；locale 在 document 生命周期内不可变，切换语言执行受 leave guard 保护的整页 reload。**

---

# 1. 依赖与版本

Qualy 现在是 Vite 8.2.0 + TypeScript 7.0.2，这一点对版本选择很重要。Paraglide 2.20 专门修了 Vite 8/Rolldown 的 message barrel tree-shaking，2.21 又修了 TypeScript 7 下 `emitTsDeclarations`，所以不要选更早版本。:chatgpt-content-reference{index="0"}

截至现在，建议精确 pin：

```yaml
# pnpm-workspace.yaml

catalog:
  '@inlang/paraglide-js': 2.25.4
  '@inlang/plugin-icu1': 1.1.0
  '@inlang/sdk': 3.0.6

  # 只有 Qualy 自己的 message contract generator
  # 最终确实需要直接解析 ICU 时才加
  '@messageformat/parser': 5.1.1
```

`@inlang/paraglide-js@2.25.4` 当前是 npm latest。:chatgpt-content-reference{index="1"}  
`@inlang/plugin-icu1@1.1.0` 当前公开版本就是 1.1.0。:chatgpt-content-reference{index="2"}  
`@inlang/sdk@3.0.6` 当前公开版本是 3.0.6。:chatgpt-content-reference{index="3"}

安装层面全部应该是 **build/dev dependencies**：

```json
{
  "devDependencies": {
    "@inlang/paraglide-js": "catalog:",
    "@inlang/plugin-icu1": "catalog:",
    "@inlang/sdk": "catalog:"
  }
}
```

第一版不要安装：

```text
@inlang/paraglide-js-react
@lingui/react
@lingui/cli
任何 PO plugin
任何 inlang native-format plugin
```

Qualy 当前没有 message markup，因此 React adapter 没有用途。

迁移完成后删除：

```text
@lingui/core
@lingui/message-utils
```

以及浏览器端 ICU runtime compiler。

---

# 2. canonical 消息格式：ICU1 JSON

每个插件自己拥有：

```text
packages/plugins/.../xxx/
├── messages/
│   ├── en-US.json
│   └── zh-CN.json
├── src/
└── package.json
```

例如：

```json
{
  "entry_submit": "Submit",
  "entry_count": "{count, plural, one {# entry} other {# entries}}",
  "record_search": "Name or {businessNo}"
}
```

中文：

```json
{
  "entry_submit": "提交",
  "entry_count": "{count, plural, other {# 条申报}}",
  "record_search": "姓名或{businessNo}"
}
```

**不要继续存在：**

```ts
defineMessage({
  id: '...',
  defaultMessage: '...',
})
```

也不要：

```ts
defaults: {
  "zh-CN": "...",
  "en-US": "..."
}
```

翻译只有 JSON 这一份。

ICU1 插件支持 `select`、`plural`、`selectordinal`、exact match、offset、`#`、number/date/time formatter，并使用 `@messageformat/parser`。:chatgpt-content-reference{index="4"}

而且 inlang 当前仓库已经有 deeply nested `select + plural + selectordinal` 的 round-trip 测试，所以复杂嵌套不再只是理论支持。

---

# 3. 不让每个插件拥有自己的 Paraglide runtime

浏览器侧必须坚持：

```text
所有 active plugins
        ↓
Qualy assembly collector
        ↓
一个临时 inlang project
        ↓
一次 Paraglide compilation
        ↓
一个 browser runtime
```

不能：

```text
auth 自己 compile
assessment 自己 compile
org 自己 compile
```

否则：

```text
多个 runtime
多个 locale state
重复 registry
无法全局 tree-shake
```

这违背整个迁移目的。

---

# 4. assembly 如何生成 inlang project

建议新增：

```text
packages/build/i18n/
```

或者并入现在：

```text
@qualy/web-build
```

增加：

```ts
prepareI18nAssembly(...)
```

它读取 assembly 中所有 active plugin 的 message contribution。

插件 descriptor 概念上从：

```ts
Ui.i18n('./client/i18n.ts')
```

改成：

```ts
I18n.messages('./messages')
```

或者继续挂在现有 extension point 上，但贡献的是：

```ts
{
  namespace: 'assessment',
  directory: './messages'
}
```

不是 runtime catalog module。

collector 做：

```text
发现 active plugins
→ 找 messages/en-US.json
→ 找 messages/zh-CN.json
→ 校验 namespace ownership
→ 校验 key 重复
→ 校验所有 locale 完整
→ 合并
```

生成：

```text
.qualy/i18n-build/
├── messages/
│   ├── en-US.json
│   └── zh-CN.json
└── project.inlang/
    └── settings.json
```

这个目录：

```text
gitignored
ephemeral
不可手工编辑
不可写回 plugin source
```

---

# 5. 为什么要 merge，而不是多个 pathPattern

`@inlang/plugin-icu1` 支持多个 `pathPattern`，但它的写回行为并不保持原始插件 ownership；官方明确说明多个 pattern 是 one-way merge。:chatgpt-content-reference{index="5"}

所以 Qualy 不应该把：

```text
plugin A/messages
plugin B/messages
plugin C/messages
```

直接作为一个可写 inlang project。

正确模型：

```text
plugin JSON
  = source of truth

.qualy/i18n-build
  = compilation workspace
```

inlang 永远不向插件源文件自动 export。

---

# 6. project.inlang/settings.json

生成内容大致：

```json
{
  "$schema": "https://inlang.com/schema/project-settings",
  "baseLocale": "en-US",
  "locales": ["en-US", "zh-CN"],
  "modules": ["../../node_modules/@inlang/plugin-icu1/dist/index.js"],
  "plugin.inlang.icu-messageformat-1": {
    "pathPattern": "./messages/{locale}.json"
  }
}
```

路径不要写 CDN：

```text
https://cdn.jsdelivr.net/...@latest
```

CI/生产 build 应该用 pnpm 已经精确锁定的本地 package，保持：

```text
offline-capable
lockfile-reproducible
compiler version pinned
```

inlang 官方支持直接从 `node_modules` 加载 local plugin。:chatgpt-content-reference{index="6"}

`baseLocale`：

```text
en-US
```

因为现有 source copy 本质上是 English。

但另有：

```ts
defaultDocumentLocale = 'zh-CN'
```

二者绝对不要混成一个概念。

---

# 7. 使用 @inlang/sdk 做 build gate

`@inlang/sdk` 不进产品 runtime，只给 build tooling。

加载临时 project：

```ts
const project = await loadProjectFromDirectory({
  path: buildProjectPath,
})

const errors = await project.errors.get()

if (errors.length !== 0) {
  throw new AggregateError(errors)
}
```

官方也建议加载 project 后先检查 `project.errors`。:chatgpt-content-reference{index="7"}

然后用 normalized inlang model 做 Qualy 自己的检查：

```text
message completeness
input names
formatter contract
namespace ownership
plugin ownership
```

---

# 8. Paraglide Vite 配置

生产和开发采用不同 output structure。

官方明确推荐：

```text
development → locale-modules
production  → message-modules
```

因为 dev server 不 bundle，message-modules 会产生很多模块请求；production 则需要 message-level tree-shaking。:chatgpt-content-reference{index="8"}

Qualy 配置概念上：

```ts
paraglideVitePlugin({
  project: generatedProjectPath,
  outdir: generatedBrowserOutdir,

  outputStructure: mode === 'production' ? 'message-modules' : 'locale-modules',

  emitTsDeclarations: true,
})
```

Qualy 使用 TS 7，因此 `emitTsDeclarations: true` 要求至少采用已经修复 TS7 支持的 Paraglide 版本；2.25.4 满足。:chatgpt-content-reference{index="9"}

---

# 9. 第一版不要启用 per-locale build

保持：

```ts
experimentalPerLocaleBuild: false
```

或者直接不配置。

Paraglide现在已经能在 Vite 8 为每个 locale 创建独立 Rolldown environment，但仍明确标记 experimental。:chatgpt-content-reference{index="10"}

Qualy 第一版目标应该是：

```text
Paraglide stable message-modules
+
Qualy 现有 code splitting
```

而不是一次同时切：

```text
i18n framework
+
message format
+
server localization
+
per-locale build
```

以后这个 experimental 标志稳定后再单独 benchmark。

---

# 10. Browser message API

浏览器业务代码最终应该非常简单：

```ts
import * as m from '@qualy/messages/assessment'
```

然后：

```tsx
<Button>{m.entrySubmit()}</Button>
```

参数：

```tsx
m.entryCount({
  count: rows.length,
})
```

术语：

```tsx
m.recordSearch({
  businessNo: useTerm(authTerms.businessNumber),
})
```

不再出现：

```text
useI18n()
format()
formatText()
LocalizedText
MessageDescriptor
defaultMessage
```

React component 不需要 Provider。

这是 Paraglide 最重要的结构收益之一。

---

# 11. @qualy/messages/<namespace> 是 Qualy 的稳定 ABI

业务代码不要直接 import：

```ts
src / paraglide / messages.js
```

因为那会让插件依赖 assembly 生成目录。

应该有一层生成 facade：

```text
@qualy/messages/auth
@qualy/messages/org
@qualy/messages/assessment
```

作用有三个：

```text
隐藏 Paraglide generated path
隔离 plugin namespace
补 Qualy 更严格的参数类型
```

生产 JS facade 应尽可能是纯 re-export：

```ts
export {
  assessment_entry_submit as entrySubmit,
  assessment_entry_count as entryCount,
} from '<generated-paraglide-module>'
```

并：

```json
{
  "sideEffects": false
}
```

Paraglide 2.20 已经专门给自己的 `messages/` 输出加了 `sideEffects: false`，以便 Vite 8/Rolldown 对 barrel 做 per-entry tree-shaking。:chatgpt-content-reference{index="11"}

所以**第一版不要写 AST import rewrite**。

先让 Rolldown 做正常 tree-shaking。

只有 PoC 证明 barrel 仍然造成错误 chunk graph，才考虑 transform。

---

# 12. 参数类型：Qualy facade 比 Paraglide 更严格

Paraglide已经能推导部分 literal matches，但 ICU 带 catch-all `other` 时类型仍会退化。

因此 Qualy 自己的 generator 只补 ICU 真正表达出的强约束。

例如：

```text
plural         → number
selectordinal  → number
number         → number
date/time      → Date
普通 variable → 不猜领域类型
select         → 不用翻译文件定义领域 enum
```

于是生成：

```ts
export const entryCount: (inputs: { count: number }) => string
```

而不是暴露：

```ts
count: NonNullable<unknown>
```

date/time：

```ts
m.createdAt({
  when: new Date(dto.createdAt),
})
```

Qualy facade contract：

```text
Date only
```

不支持：

```text
Date | number
ISO string
```

DTO string → application `Date` → localization。

---

# 13. 不要重新发明第二个 ICU parser

优先：

```text
inlang normalized model
```

推导参数 contract。

只有 normalized model 确实缺少所需信息时，才直接使用：

```text
@messageformat/parser@5.1.1
```

而且版本要精确 pin。

这是因为当前 Lingui 6.6 和 ICU1 plugin 本来就使用这套 parser lineage，迁移时保持 grammar 一致最安全。

不要再引入：

```text
@formatjs/icu-messageformat-parser
```

形成第二套 ICU grammar truth。

---

# 14. Server 不再传 UiText

这是新的硬边界。

插件/server 内部：

```ts
Text
```

HTTP：

```ts
string
```

例如：

```ts
interface PermissionDefinition {
  code: string
  name: Text
}
```

API DTO：

```ts
interface PermissionDto {
  code: string
  name: string
}
```

projection：

```ts
return {
  code: permission.code,
  name: renderText(permission.name, renderContext),
}
```

忘了 render：

```ts
name: permission.name
```

TypeScript 直接报错。

不要让 api-kit 自动递归遍历 response 做隐式翻译。

---

# 15. Text 不是 Lingui MessageDescriptor

重新设计：

```ts
type Text = MessageText | TermText | LiteralText
```

只有三个 constructor：

```ts
text(message, inputs)

term(termRef)

literal(value)
```

例如：

```ts
text(m.recordSearch, {
  businessNo: term(authTerms.businessNumber),
})
```

这里不要存在：

```text
message id
defaultMessage
fallback
catalog
```

`Text` 只是一个 server-side render plan。

---

# 16. renderText 是同步纯函数

每个请求开始时先准备：

```ts
interface RenderContext {
  locale: SupportedLocale
  terms: ReadonlyMap<TermId, string>
}
```

租户术语一次性读出并放进 request context。

然后：

```ts
renderText(text, context): string
```

纯同步。

不要：

```ts
renderText(): Effect<string>
```

导致每个 projection 都 `yield*`。

数据库 I/O 在：

```text
构造 RenderContext
```

阶段已经完成。

---

# 17. Server 不允许隐式 locale

浏览器 message：

```ts
m.save()
```

可以从 document locale 取语言。

服务端绝对不能：

```ts
m.save()
```

然后偷偷拿：

```text
baseLocale
global locale
AsyncLocalStorage locale
```

服务端所有格式化必须显式：

```ts
rawMessage(inputs, {
  locale: ctx.locale,
})
```

建议生成 server facade，使 locale 参数成为必填：

```ts
type ServerMessage<I> = (inputs: I, locale: SupportedLocale) => string
```

底层实现：

```ts
const save = (inputs, locale) => paraglide.save(inputs, { locale })
```

于是服务端想漏 locale：

```ts
save({})
```

直接 type error。

这比依赖 ambient locale 更符合 Qualy 的 Effect/request-context 设计。

---

# 18. locale 生命周期

新增干净的：

```text
@qualy/locale-contract
```

只保留：

```ts
supportedLocales
SupportedLocale
defaultDocumentLocale
LocaleSchema
```

旧：

```text
@qualy/i18n-contract
```

迁移完成后删除。

最终解析优先级：

```text
设备已有 explicit locale cookie
>
登录时账户 preferredLocale
>
navigator.languages / Accept-Language
>
defaultDocumentLocale = zh-CN
```

cookie：

```text
qualy.locale
```

只在：

```text
用户明确选择语言
或
新设备登录且本机没有 cookie、账户已有 preferredLocale
```

时写入。

不要把首次 navigator 推导结果自动固化。

---

# 19. document locale 一旦建立就不可变

boot script：

```text
resolve locale
→ <html lang>
→ data-locale
```

例如：

```html
<html lang="zh-CN" data-locale="zh-CN"></html>
```

这个 document 存活期间：

```text
data-locale 永远不变
```

Paraglide browser `getLocale()` 应只读取它。

可以通过官方提供的 custom strategy / `overwriteGetLocale` 实现。Paraglide明确支持自定义 client/server locale resolution。:chatgpt-content-reference{index="12"}

---

# 20. 每个 API request 带 X-Qualy-Locale

浏览器 HTTP client：

```http
X-Qualy-Locale: zh-CN
```

值来自：

```ts
document.documentElement.dataset.locale
```

而不是重新读 cookie。

这是为了多标签正确性。

例如：

```text
Tab A = 中文 document
Tab B 切换英文 → 更新 cookie + reload

Tab A 不刷新
```

A 继续：

```http
X-Qualy-Locale: zh-CN
```

B：

```http
X-Qualy-Locale: en-US
```

所以不会出现：

```text
页面中文
API 突然返回英文
```

的问题。

---

# 21. 切换语言

不直接用 React `setState`。

Qualy 提供：

```ts
changeLocale(locale)
```

流程：

```text
用户选语言
→ leave guard
→ 若 authenticated：
    更新 user.preferredLocale
    server Set-Cookie qualy.locale
→ 若 anonymous：
    写 qualy.locale cookie
→ full document reload
```

Paraglide本身默认也把语言切换设计成 document navigation/reload；`reload:false` 是窄用途 escape hatch。:chatgpt-content-reference{index="13"}

因此不重新构造 reactive i18n context。

---

# 22. preferredLocale

用户表新增 nullable：

```ts
preferredLocale: SupportedLocale | null
```

语义：

```text
账户级语言偏好
= 新设备默认语言
+ out-of-band notification 默认语言
```

device cookie：

```text
当前设备 override
```

新设备登录：

```text
本机无 cookie
+
preferredLocale != null
→ Set-Cookie preferredLocale
```

本机已有 cookie：

```text
永不被登录覆盖
```

---

# 23. 邮件 locale

不能简单用 request locale。

规则固定为：

```text
给当前请求者本人发邮件
→ 当前 document locale

管理员给别人发邮件
→ recipient.preferredLocale
→ product default

后台主动邮件
→ recipient.preferredLocale
→ product default
```

现有：

```text
mail-copy.ts
mailLocaleOf(Accept-Language)
```

最终全部删除。

邮件正文直接使用同一份 Paraglide message source。

---

# 24. 术语系统重做

现在：

```ts
defaults: {
  zh-CN: '学工号',
  en-US: 'Student or staff ID'
}
```

整块删除。

术语拆成：

```text
TermRef
TermDefinition
```

跨插件共享的：

```ts
authTerms.businessNumber
```

只保留：

```ts
{
  id: 'auth/business-number'
}
```

不携带 message function。

server declaration：

```ts
defineTerm({
  ref: authTerms.businessNumber,
  default: text(m.termBusinessNumber),
  label: text(m.termBusinessNumberLabel),
  description: text(m.termBusinessNumberDescription),
})
```

这样：

```text
TermRef
= domain identity

Paraglide message
= default translation

tenant override
= tenant data
```

三件事彻底拆开。

---

# 25. effective terms 跟 document context 一起下来

普通页面不要再调用：

```text
GET terminology
```

再等 React Query 回来。

manifest/document context 中直接带当前语言已经解析好的：

```json
{
  "terms": {
    "auth/business-number": "学工号"
  }
}
```

于是：

```ts
useTerm(authTerms.businessNumber)
```

只做同步 map lookup。

好处：

```text
没有额外 RTT
没有默认词 → 租户词 flash
不需要所有 locale 的 term override 下发给普通页面
```

管理员“术语设置”页面仍使用专门 API，因为它需要同时编辑所有 locale。

---

# 26. Browser static 文案与 server presentation 文案分界

最终非常明确：

Browser 自己知道的：

```text
按钮
空状态
dialog
field hint
feature 内错误
```

直接：

```ts
m.xxx()
```

Server 决定内容的：

```text
manifest title
permission label
audit action name
login driver label
node usage
server-selected display phrase
```

server：

```text
renderText(...)
→ string
```

然后 browser 直接显示。

这也是为什么迁移完成后：

```text
UiText wire
formatText()
wire dispatch table
defaultMessage
```

都可以删除。

---

# 27. API error 仍然由 browser 翻译

API transport 应继续返回：

```text
error code / _tag
```

而不是 server-localized error string。

例如：

```ts
const messages = {
  USER_NOT_FOUND: m.userNotFound,
  SESSION_EXPIRED: m.sessionExpired,
}
```

feature chunk 到的时候，错误消息一起到。

公共：

```text
transport
auth required
access denied
backend unavailable
```

放小型 platform-common message namespace。

---

# 28. Bootstrap

删除手写：

```ts
bootstrapMessages
```

但 boot script 本身保留。

build 阶段：

```text
Paraglide message
→ 对 zh-CN 渲染
→ 对 en-US 渲染
→ 生成 #qualy-boot-copy
```

最终 HTML 仍可以是：

```json
{
  "zh-CN": {...},
  "en-US": {...}
}
```

但这是：

```text
generated artifact
```

而不是第四套 translation source。

---

# 29. 插件隔离

新增门禁：

```text
assessment 不允许 import @qualy/messages/auth
auth 不允许 import @qualy/messages/org
```

插件只能：

```text
自己 namespace
platform common
明确 contract
```

跨插件词汇：

```text
TermRef
```

而不是 import 对方 translation。

同时禁止 browser client import：

```text
server Text
plugin descriptor/surfaces declaration module
server Paraglide facade
```

尤其现在：

```text
ItemEditor.tsx
→ ../../../surfaces.ts
```

这种结构要拆掉。

---

# 30. 第三方 dist-only plugin

第三方插件发布：

```text
dist JS
+
messages/en-US.json
+
messages/zh-CN.json
+
message contribution metadata
```

**不发布自己的一套 browser Paraglide runtime。**

宿主：

```text
发现 plugin
→ merge messages
→ central compile
```

插件源码里的 message facade specifier：

```text
@qualy/messages/<namespace>
```

作为 host-resolved ABI。

Standalone plugin development：

```text
plugin-kit
→ 只为当前 plugin 生成临时 facade/types
→ Vite/Vitest/typecheck 都可用
```

assembly build：

```text
→ host-generated facade
```

published dist：

```text
→ specifier 保持 external，由宿主解析
```

这是 PoC 必须证明的硬要求之一。

---

# 31. HMR

由于真正 source 位于：

```text
plugin/messages/*.json
```

但 Paraglide读的是：

```text
.qualy/i18n-build/messages/*.json
```

Qualy build plugin 必须 watch 原始 plugin message 文件。

修改：

```text
assessment/messages/zh-CN.json
```

后：

```text
watch event
→ regenerate merged locale JSON
→ Paraglide recompile
→ Vite HMR
```

不能要求开发者重启 dev server。

---

# 32. 缺译必须硬失败

不要依赖：

```text
baseLocale fallback
```

Qualy assembly gate 必须保证：

```text
en-US keys == zh-CN keys
```

缺一个：

```text
build failure
```

参数集合/formatter contract 不同：

```text
build failure
```

所以用户绝不会因为漏翻而静默看到英语。

---

# 33. 迁移差分测试

第一轮迁移必须对现有全部消息做：

```text
Lingui old renderer
vs
Paraglide ICU1 renderer
```

覆盖：

```text
en-US
zh-CN
```

复杂消息自动生成 representative inputs：

```text
plural: 0 / 1 / 2 / large
select: every explicit branch + other
selectordinal
nested combinations
```

结果必须完全一致。

迁移完成、Lingui删除后，不需要 CI 永久运行旧 Lingui；保留 migration golden 即可。

---

# 34. 性能 PoC

先建立 production-representative Lingui baseline：

```text
compile-time catalog
current locale only
no defaultMessage
no runtime ICU compiler
真实 Vite/Rolldown build
```

不要求它真的可上线。

Paraglide对比：

```text
login
batch list
my entries
org tree
```

指标按：

```text
1. first-screen request count
2. <1 KB / <2 KB chunk count
3. static closure Brotli bytes
4. critical request chain
5. LCP
6. FCP/TBT
7. dev cold start / HMR
8. build time
```

现有：

```text
qualyChunkGraph
```

继续负责：

```text
禁止 chunk cycle
禁止 formula/editor 泄漏到 boot
boot budget
```

不要为了 Paraglide放宽已有 gate。

---

# 35. 推荐实施阶段

我会拆成六个 commit/phase：

**Phase A：基础设施。** 加依赖、ICU1 source format、assembly merge、inlang project、Paraglide compiler、generated facade。先不改页面。

**Phase B：PoC。** 迁 `layout-default + auth public + assessment entry`，完成 Lingui/Paraglide production build A/B，先证明 chunk graph。

**Phase C：全量 browser static copy。** 4193+ 条 descriptor 全部迁 ICU JSON + message functions，删除 `defineMessage` / browser compiler / giant `i18n.ts`。

**Phase D：server Text + HTTP string projection。** manifest、RBAC、audit、login driver、org usage 等逐一把 `UiText` wire 换成 string。

**Phase E：locale + terminology。** cookie、`preferredLocale`、`X-Qualy-Locale`、reload、TermRef/TermDefinition、document terms。

**Phase F：收尾。** mail、bootstrap、errors、删除 Lingui 和 `@qualy/i18n-contract`，跑全量 differential/gates/Lighthouse/release smoke。

---

## 最终依赖图应该长这样

```text
Plugin ICU1 JSON
        │
        ▼
 Qualy assembly collector
        │
        ▼
ephemeral inlang project
        │
        ├──── @inlang/sdk
        │       └─ Qualy validation/type metadata
        │
        ▼
@inlang/plugin-icu1
        │
        ▼
 @inlang/paraglide-js
        │
     ┌──┴────────────┐
     │               │
 Browser          Server
     │               │
message funcs      Text renderer
     │               │
static UI         HTTP strings
```

而最终仓库中应该**不存在**：

```text
Lingui runtime
runtime ICU compiler
MessageDescriptor
defaultMessage
UiText HTTP schema
formatText()
loadCatalogs()
I18nProvider
hand-written bootstrapMessages
hand-written mail-copy
per-locale term defaults in TS
```

这就是我会让 Claude Code 按照执行的最终方案。最先做的不是大规模迁 4000 条消息，而是把 **Phase A + Phase B 跑通，并看 production Rolldown chunk graph**；只要这一关健康，后面的迁移基本已经没有架构级未知数了。

对，你这个质疑是对的。**如果把 `@qualy/messages/assessment` 理解成仓库里真实存在的 `@qualy/messages` 包，那这个设计就是错的。** 第三方插件当然不可能去修改 Qualy 自己的中央包。

我前面用这个路径是为了表达“assembly 生成的 message facade”，但这个写法太像真实 npm package，容易把架构带偏。

我现在会把方案改成：**根本不创建一个静态的 `@qualy/messages` 包。**

更适合 Qualy open-world plugin 体系的是一个“按 importer 归属解析”的虚拟模块：

```ts
import * as m from 'virtual:qualy/messages'

m.entrySubmit()
m.recordSearch({ businessNo })
```

关键点是，同样这一句：

```ts
import * as m from 'virtual:qualy/messages'
```

在不同插件里看到的不是同一个模块。

例如：

```text
@qualy/plugin-assessment/src/client/Foo.tsx
    ↓
virtual:qualy/messages
    ↓
assessment 自己的消息

@qualy/plugin-auth/src/client/Bar.tsx
    ↓
virtual:qualy/messages
    ↓
auth 自己的消息

@acme/plugin-foo/dist/client/X.js
    ↓
virtual:qualy/messages
    ↓
第三方 acme/foo 自己的消息
```

Vite `resolveId(source, importer)` 本来就知道 **是谁在 import**，所以 Qualy build plugin 可以根据 `importer` 所属的 plugin root，决定它对应哪个 message namespace。

这样比：

```ts
@qualy/messages/assessment
```

干净很多。

---

### 整体流程应该是这样

第三方插件自己发布：

```text
@acme/qualy-plugin-foo/
├── dist/
│   └── client/...
├── messages/
│   ├── en-US.json
│   └── zh-CN.json
├── qualy.yml
└── package.json
```

自己的客户端源码：

```ts
import * as m from 'virtual:qualy/messages'

export function Foo() {
  return <h1>{m.title()}</h1>
}
```

插件注册：

```ts
I18n.messages('./messages')
```

这里完全没有：

```text
@qualy/messages
```

这个真实 package。

用户安装：

```bash
pnpm add @acme/qualy-plugin-foo
```

然后 assembly collector 发现：

```text
plugin id
package root
messages directory
browser modules
```

把：

```text
Qualy 内置插件 messages
+
@acme 插件 messages
+
其他第三方插件 messages
```

合并成临时 inlang project。

再 **统一执行一次 Paraglide compile**。

于是仍然只有：

```text
one Paraglide runtime
one locale state
one compilation
```

没有每个插件自己携带 runtime。

---

## 那 `virtual:qualy/messages` 最终怎么变成真实 JS？

assembly build 会动态生成一个很薄的 facade。

比如 Paraglide 最终生成：

```ts
assessment_entry_submit
assessment_record_search
auth_login_title
acme_foo_title
```

Qualy 知道每个 key 属于哪个插件。

对于 assessment importer，它生成：

```ts
// virtual module，只对 assessment 可见

export {
  assessment_entry_submit as entrySubmit,
  assessment_record_search as recordSearch,
} from '/.qualy/paraglide/messages.js'
```

对于第三方 Acme：

```ts
// 另一个 virtual module

export {
  acme_foo_title as title,
  acme_foo_description as description,
} from '/.qualy/paraglide/messages.js'
```

所以：

```text
源码 API
virtual:qualy/messages
        │
        │ importer-aware
        ▼
插件自己的 facade
        │
        ▼
同一个中央 Paraglide compilation
```

非常适合 Qualy。

而且这还天然解决了一个我们之前想靠 `plugin-isolation.test.ts` 防的问题：

> assessment 能不能 import auth 的消息？

不能。

因为 assessment 的：

```ts
virtual: qualy / messages
```

压根不 export auth message。

---

# standalone plugin 怎么开发？

这个必须同时解决，否则第三方 SDK 不完整。

第三方作者独立开发自己的插件时：

```text
没有 Qualy 主仓库
没有完整 assembly
```

`@qualy/plugin-kit` 提供一个开发插件，例如概念上：

```ts
qualyPlugin({
  descriptor: './qualy.yml',
})
```

它读取当前插件：

```text
./messages/en-US.json
./messages/zh-CN.json
```

临时为**这一个插件**创建 inlang project + Paraglide compilation。

然后：

```text
virtual:qualy/messages
```

就指向这份 standalone 临时输出。

所以：

```text
插件独立开发
→ 只编译自己

Qualy assembly
→ 所有插件统一编译
```

源码完全不用改。

---

# TypeScript 怎么认识这个 virtual module？

这也是不能忽略的一层。

plugin-kit 根据当前插件的 ICU JSON 生成：

```text
.qualy/
└── messages.d.ts
```

例如：

```ts
declare module 'virtual:qualy/messages' {
  export function entrySubmit(): string

  export function entryCount(inputs: { count: number }): string

  export function recordSearch(inputs: { businessNo: string }): string
}
```

这个 declaration 只进入**当前插件自己的 browser tsconfig**。

这一点和 Qualy 现有 typecheck 架构尤其契合，因为现在插件 browser projects 本来就是逐个 typecheck 的。

因此不会出现：

```text
assessment 的 virtual module declaration
+
auth 的 declaration
```

在同一个 TS project 里互相冲突的问题。

---

# 第三方插件发布时怎么办？

这里更关键。

第三方插件编译自己的 dist 时：

```text
virtual:qualy/messages
```

**必须保持 external。**

不能被 bundle 成它 standalone 编译出来的 Paraglide runtime。

也就是说发布出来的 JS 可以仍然是：

```js
import { title } from 'virtual:qualy/messages'
```

同时 package 带：

```text
messages/en-US.json
messages/zh-CN.json
```

宿主安装后：

```text
Qualy assembly Vite plugin
      ↓
看到 importer 位于
node_modules/@acme/qualy-plugin-foo
      ↓
查 assembly metadata
      ↓
知道 plugin namespace
      ↓
解析 virtual:qualy/messages
```

所以第三方插件作者完全不需要：

```text
修改 Qualy 中央 messages 包
提交 PR
申请 namespace 文件
```

这才是真正的 open-world plugin。

---

# 为什么我甚至更喜欢 importer-scoped virtual module，而不是动态的 `@qualy/messages/<namespace>`

也可以实现：

```ts
import * as m from '@qualy/messages/acme-foo'
```

并让 Qualy resolver wildcard 动态生成。

技术上没问题。

但有几个缺点。

第一，它看起来太像真实 npm package：

```text
@qualy/messages
```

正是你刚才产生疑问的原因。

第二，插件作者要重复自己的 namespace：

```text
qualy.yml:
namespace = acme-foo

source:
@qualy/messages/acme-foo
```

两个地方可能漂移。

第三，它允许作者试图：

```ts
import * as auth from '@qualy/messages/auth'
```

然后还要另外写 isolation gate 阻止。

issuer-scoped：

```ts
virtual: qualy / messages
```

则语义直接是：

> “给我当前插件自己的 messages。”

没有 namespace 参数，自然不会串插件。

所以我现在更倾向这个。

---

# Server 侧要和 Browser 分开考虑

还有一个重要点：不要为了统一语法，让 server 也强依赖这个 Vite virtual module。

Browser：

```ts
import * as m from 'virtual:qualy/messages'

m.foo()
```

没问题，因为 browser 本来就经过 Vite assembly build。

Server 的 plugin declaration 不应该要求 Node 运行时去解析：

```text
virtual:qualy/messages
```

否则你要给 Node 搞 loader/import map，没必要。

Server 可以使用插件自己构建时生成的 **data-only message refs**。

例如第三方插件发布时同时生成：

```text
dist/message-refs.js
```

内容只有：

```ts
export const messages = {
  navigationTitle: {
    key: 'acme-foo/navigation-title',
  },
} as const
```

没有翻译，没有 runtime。

server：

```ts
text(messages.navigationTitle)
```

assembly 中央 renderer：

```text
message ref
→ centralized Paraglide server messages
→ locale
→ string
```

不过这一层实现还能继续打磨；最重要的是：

> **Browser message functions 与 Server message identity 不必强行共用同一个 module ABI。**

它们用途不同。

Browser 追求：

```text
static ESM imports
tree shaking
code splitting
```

Server 追求：

```text
stable typed identity
assembly rendering
无 Vite runtime dependency
```

不要为了表面统一把两边绑死。

---

# 因此我会修改前面实施方案中的这一条

之前：

```ts
import * as m from '@qualy/messages/assessment'
```

改成：

```ts
// browser plugin code
import * as m from 'virtual:qualy/messages'
```

完整含义：

```text
                 Plugin-owned ICU JSON
                         │
                         ▼
                assembly collector
                         │
                         ▼
              one Paraglide compilation
                         │
       ┌─────────────────┼──────────────────┐
       │                 │                  │
       ▼                 ▼                  ▼
 assessment facade    auth facade        acme facade
       ▲                 ▲                  ▲
       │                 │                  │
virtual:qualy/messages  same specifier    same specifier
       ▲                 ▲                  ▲
       │                 │                  │
 assessment importer   auth importer      acme importer
```

**它不是一个 package，而是 Qualy plugin build ABI。**

这样第三方插件反而是最自然的：

```text
安装插件
→ assembly 发现它
→ 自动吃它自己的 ICU JSON
→ 自动产生它自己的虚拟 message facade
```

用户完全不需要也不应该修改任何中央 `messages` 包。

所以你刚才指出的问题是成立的：**如果我们真的做一个静态 `@qualy/messages` workspace package，那是设计错误；应该改成 assembly 动态生成、按 plugin importer 隔离的 virtual module。**

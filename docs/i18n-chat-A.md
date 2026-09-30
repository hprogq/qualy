你阅读Qualy代码帮我思考下吧。确实Gzip过了之后54kb。

**alt-svc**
h3=":443"; ma=2592000
**cache-control**
public,max-age=31536000,immutable
**content-encoding**
br
**content-length**
54703
**content-type**
text/javascript
**date**
Wed, 30 Sep 2026 11:48:36 GMT
**etag**
W/"54703-1790754546584"
**last-modified**
Wed, 30 Sep 2026 07:49:06 GMT
**referrer-policy**
strict-origin-when-cross-origin
**strict-transport-security**
max-age=31536000; includeSubDomains
**vary**
Accept-Encoding
**via**
1.1 Caddy
**x-content-type-options**
nosniff

还有就是好像响应头里没说明gzip，是否要加。

我重新按 Qualy 当前的 i18n、Vite 分块、release-store 和静态资源服务器走了一遍。这里有两个结论比较明确：

**一，54,703 字节不是 gzip，是 Brotli 后的大小。二，54.7 KB 这个中文语言包本身不算失控，但它位于首屏硬依赖上，再叠加约 94 KB 的英文 `defaultMessage`，这套结构值得优化。**

先说响应头。你现在拿到的是：

```http
Content-Encoding: br
Content-Length: 54703
Vary: Accept-Encoding
```

所以浏览器实际收到的是 **54,703 bytes 的 Brotli 数据**。而且 Qualy 不是动态临时压缩：`release-store.ts` 在构建时就同时生成：

```text
xxx.js.br   Brotli quality 11
xxx.js.gz   gzip level 9
```

`plugin-web` 的 `sirv` 又明确配置了：

```ts
brotli: true,
gzip: true,
```

因此当前链路实际上是：

```text
Chrome:
Accept-Encoding: gzip, deflate, br, ...
        ↓
Qualy 发现 .br
        ↓
Content-Encoding: br
Content-Length: 54703
```

这完全正确。

### 不要再加 `Content-Encoding: gzip`

那反而是协议错误。

`Content-Encoding` 的含义不是：

> “服务器支持哪些压缩算法”

而是：

> “这一次响应体实际用了什么编码”

你这次发的是 Brotli 字节，所以：

```http
Content-Encoding: br
```

只能这样写。

如果写：

```http
Content-Encoding: gzip
```

浏览器会把 Brotli 数据当 gzip 解，直接失败。

如果写：

```http
Content-Encoding: br, gzip
```

意思是“这个 payload 被连续编码了两层”，也不是你的情况。

服务器是否支持 gzip 不需要响应头主动声明。客户端通过请求：

```http
Accept-Encoding: gzip
```

来协商。

你现在的：

```http
Vary: Accept-Encoding
```

也正是正确的缓存语义。

事实上 Qualy 当前已经有 gzip fallback，只是 Chrome 明明支持压缩率更好的 Brotli，自然没有理由给它 gzip。

你可以自己验证：

```bash
curl -I \
  -H 'Accept-Encoding: gzip' \
  'https://qualy.hprogq.com/assets/xxx.js'
```

应该得到：

```http
Content-Encoding: gzip
```

而：

```bash
curl -I \
  -H 'Accept-Encoding: br' \
  ...
```

就是：

```http
Content-Encoding: br
```

我甚至建议把 production smoke 顺手补完整。你现在 `smoke-production.ts` 已经明确断言：

```ts
Accept-Encoding: br
→ Content-Encoding === 'br'
```

既然构建系统刻意维护 `.br` 和 `.gz` 两份 twin，可以再补两条很便宜的断言：

```text
Accept-Encoding: gzip → gzip
Accept-Encoding: identity → 无 Content-Encoding
```

不是高优先级，但可以把这套契约彻底钉死。

---

### 再说 54.7 KB 到底大不大

这里要结合 Qualy 的架构来看，不能单看数字。

现在 `vite.config.ts` 已经专门做了一件事：

```ts
name: (id) => {
  const locale = /...locales|catalogs.../.exec(id)
  return `locale-${locale}`
}
```

也就是说所有插件的：

```text
auth zh-CN
rbac zh-CN
org zh-CN
assessment zh-CN
formula zh-CN
...
```

最后被 Vite 合成**一个 `locale-zh-CN` chunk**。

这是合理的。

因为 `I18nProvider` 当前启动逻辑是：

```ts
await Promise.all(
  commonCatalog,
  ...所有插件当前 locale 的 catalog
)

i18n.load(...)
i18n.activate(...)

setActivated(...)
```

在 `activated` 之前：

```tsx
if (activated === undefined) return fallback
```

所以当前语言包本来就是**应用首次呈现的硬依赖**。

既然所有插件 locale 启动时都得拿，与其发 8～10 个小请求，不如像现在这样合成一个 54 KB 请求。这一层我反而**不建议拆回去**。

而且它还有两个优点：

- `Cache-Control: public,max-age=31536000,immutable`
- 文件名是 content hash

只要中文 catalog 内容没变，下一个 Qualy release 仍然可以继续命中同一份资产；并不是每次发布都必然重新下 54 KB。

所以：

> **单看 54.7 KB Brotli，我不会为了把它压成 40 KB 去大改架构。**

而且你已经是 Brotli quality 11，再从压缩参数上榨基本没什么意思。

---

真正值得注意的是当前 i18n 的**重复负担**。

Qualy 的源码定义是：

```ts
{
  id: 'assessment/entry/submit',
  defaultMessage: 'Submit for review'
}
```

中文 catalog 又有：

```ts
{
  'assessment/entry/submit': '提交审核'
}
```

而 `PluginCatalogs` 当前甚至明确设计成：

```ts
interface PluginCatalogs {
  namespace: string
  messages: readonly MessageDescriptor[]
  locales: ...
}
```

`definePluginMessages()` 又会生成：

```ts
catalogs: {
  namespace,
  messages: Object.values(declared),
  locales
}
```

更关键的是，构建生成的 `virtual:qualy/plugins` 会**静态 import 每一个插件的 `catalogs` 和 `errorMessages`**：

```ts
import { catalogs as authCatalogs } from '.../auth/i18n'
import { catalogs as assessmentCatalogs } from '.../assessment/i18n'
...
```

这意味着所有插件的 `i18n.ts` 在启动图中都是有意义的模块，而不只是当前页面才动态加载。

所以 Claude 测出来：

> English `defaultMessage` 首屏约 94 KB gzip

是非常符合这套代码结构的。

对于中文用户，当前逻辑大体相当于：

```text
启动 JS 内：
约 94 KB English defaultMessage

+

locale-zh-CN：
54.7 KB Brotli 中文

————————————

一百多 KB 的双语文案
```

这才是我认为需要处理的地方。

---

### 我不会优化“中文 54 KB”，我会优化“英文 + 中文同时进入首屏”

这两件事区别很大。

现在的 `fallbackLocale = 'en-US'` 设计是：

> English 不需要 catalog，因为 English 就放在每个 descriptor 的 `defaultMessage` 里。

这个设计最开始很方便：

```ts
format({
  id: descriptor.id,
  message: descriptor.defaultMessage
})
```

中文 catalog 加载失败时还能自然退回英文。

但项目已经增长到现在这个量级以后，它的成本变成了：

> **所有用户都付 English 的字节；中文用户再额外付中文的字节。**

所以我认为现在已经到了值得反过来的规模。

目标架构应该是：

```text
源码 authoring：

id
defaultMessage: English
zh-CN translation

        ↓ build

生产运行时：

代码：
id

locale-en-US:
English text

locale-zh-CN:
Chinese text
```

中文用户：

```text
JS + 54KB zh-CN
```

英文用户：

```text
JS + en-US catalog
```

而不是中文用户：

```text
JS(内含全部 English) + zh-CN
```

---

### 但不要改 `UiText` 的服务端协议

这里我会特别小心。

你现在跨服务端边界的：

```ts
UiText =
  | {
      kind: 'message'
      id: string
      defaultMessage: string
    }
  | {
      kind: 'literal'
      value: string
    }
```

我认为这个仍然可以保留。

因为这个 `defaultMessage` 是服务端针对**实际出现的一条业务文本**发送的 fallback，不是把整个产品的英文 catalog 一次性塞进 JS。

比如 manifest 返回：

```json
{
  "kind": "message",
  "id": "assessment/navigation/batches",
  "defaultMessage": "Assessments"
}
```

这种几十字节的 fallback 非常合理，还能保持插件协议自描述。

真正需要消除的是：

> browser bundle 里静态携带的**全部** `client/i18n.ts` defaultMessage。

两者不要混为一谈。

---

### 我认为最合适的优化路径是做 build-time extraction，而不是手拆全部插件

不建议让 Claude 去干这种事：

```text
assessment/
  entry-messages.ts
  review-messages.ts
  batch-messages.ts
  admin-messages.ts
  ...
```

那会把当前还算清楚的 i18n 架构弄碎，而且新增页面很容易重新退化。

也不建议按页面拆 `zh-CN`。54 KB 一个 locale chunk 本身很合理。

我会要求 Claude 做一个很窄的 PoC：

1. Source authoring **完全不变**，开发者仍然写：

```ts
{
  id,
  defaultMessage
}
```

2. build 阶段从所有 descriptor 自动生成：

```text
locale-en-US
```

3. production browser output 中，能静态消除的 descriptor `defaultMessage` 不再进入启动 graph。

4. `I18nProvider` 对 `en-US` 和 `zh-CN` 使用相同逻辑：

```text
resolve locale
→ preload one locale chunk
→ load
→ activate
```

5. 如果非英文 catalog 真正加载失败，再 fallback：

```text
zh-CN load failed
→ dynamic load en-US
→ activate en-US
```

这样仍然保留现在的 resilience，只是失败路径才付 English 的下载成本。

6. `bootstrapMessages` 不动。

你当前：

```ts
bootstrapMessages
```

那些“加载中 / 重试 / 页面资源加载失败 / Qualy 已更新”本来就是特意为 catalog 到达前存在的小表，几十条文字而已。这个设计很好，不应该为了统一把它重新拖进完整 catalog。

---

### 还有一个非常值得先做的小改动

在正式做 build transform 之前，我会先检查：

```ts
PluginCatalogs.messages
```

到底有没有必要存在于浏览器运行时。

现在它的注释自己就已经说明：

```ts
// every message the plugin declares,
// so completeness can be checked
```

它主要服务于：

- collector 的 namespace / duplicate 检查；
- `catalogs.test.ts` 的 completeness；
- build-time validation。

而实际浏览器 `loadCatalogs()` 根本没用：

```ts
plugin.messages
```

它只用：

```ts
plugin.locales
```

所以从职责上看，当前：

```ts
PluginCatalogs
```

其实混了两种东西：

```text
Build metadata
+ Runtime locale loaders
```

这值得拆开。

例如概念上：

```ts
interface PluginCatalogDeclaration {
  namespace
  messages
  locales
}

interface RuntimeCatalogs {
  namespace
  locales
}
```

build collector 可以继续检查完整 declaration。

浏览器 virtual module 只发：

```text
namespace + locale loaders
```

不过注意：**单改这个未必能直接省掉全部 94 KB**。

因为同一个 `i18n.ts` 还导出了：

```ts
errorMessages
messages
catalogs
```

而 aggregate 又必须 import `errorMessages`。

因此 bundler 可能仍然需要执行整个 `definePluginMessages(...)`，那些字符串仍然留下。

所以要通过 bundle analyzer / output grep 实测，不要凭架构猜。

---

### 我建议直接给 Claude 一个明确的实验目标

不是让它“优化语言包”，而是：

> 保持所有源码 i18n authoring、UiText wire contract、catalog completeness gate、英文 fallback 行为不退化，尝试将生产首屏中的静态 English defaultMessage 移出启动 JS，生成 en-US catalog。不得按页面手拆 message 文件。先做 PoC，不提交大规模重构。分别测 login / batches / entries / org-tree 的 cold mobile Lighthouse，报告 boot graph Brotli bytes、locale bytes、LCP phase breakdown。若首屏 Brotli 总量减少不足 50 KB 或 LCP 中位数无稳定改善，则撤销 PoC。

这个停止条件很重要。

因为虽然理论上能省约 94 KB，但真实构建中这些字符串可能和当前 chunk 的其它代码共同压缩，实际新增成本未必正好 94 KB。

---

还有一点：你说“54 KB gzip”需要纠正到报告里。

从你贴出的生产响应：

```http
content-encoding: br
content-length: 54703
```

准确说法应该是：

> **`locale-zh-CN` 的生产 Brotli transfer size 为 54.7 KB。**

而不是 gzip。

而且这是 **Brotli quality 11** 压完以后的结果，已经相当接近当前内容形态的压缩极限。因此如果要继续降，应该删掉/延后不需要的内容，而不是继续折腾压缩参数。

所以最终我的判断是：

**响应头完全正常，不要加 gzip。54.7 KB Brotli 的中文 catalog 单独看可以接受，但 Qualy 当前“English defaultMessage 常驻启动 JS + 中文 catalog”存在结构性重复，现在已经值得做一次 build-time extraction PoC。优先消灭重复英文，不要拆碎 54 KB 中文包。**

那你帮我想想语言包还可以怎么优化，要把语言包拆成多个文件吗，用到的时候再加载而不是全量下载

可以拆，但我不建议把现在这个 54.7 KB 的 `locale-zh-CN` 直接按“每个插件一个文件”拆开然后全部 `Promise.all`。那样很可能更差。

我重新按 Qualy 当前实现看了一遍，真正的问题是这三层叠在一起：

```text
所有插件的 client/i18n.ts
        ↓
virtual:qualy/plugins 静态聚合所有 catalogs / errorMessages
        ↓
I18nProvider 启动时 loadCatalogs(locale, 所有插件)
        ↓
所有 locale loader 都完成以后才 activated
        ↓
应用才能正式渲染
```

而 Vite 现在又刻意把所有 `zh-CN.ts`：

```ts
locales/zh-CN.ts
catalogs/zh-CN.ts
```

合并成一个 `locale-zh-CN` chunk。这个设计其实是之前一个正确优化：避免启动时 8 个甚至更多小语言文件请求。

所以现在的 54.7 KB 并不是“一个文件太大”的简单问题，而是：

> **所有页面，无论登录页、组织树还是申报页，都必须等待整个产品的中文文案。**

这才值得解决。

### 我建议分两阶段，不要直接大拆

第一阶段优先级最高的仍然是前面说的：

**把 English `defaultMessage` 从生产启动 JS 里抽成 `en-US` catalog。**

因为现在中文用户实际上付的是：

```text
约 94 KB English defaultMessage
+
54.7 KB Brotli zh-CN
```

先把重复英语移走，理论收益比把 54.7 KB 拆成几个文件还大，而且架构更干净。

做完这一步以后，再看剩下的 `locale-zh-CN` 多大。如果还是 50 KB 左右，我认为值得做 lazy catalog。

---

### 真要拆，我会做“shell + feature catalogs”，而不是“一个插件一个包”

Qualy 有一个特殊问题：很多文字并不属于当前页面本身。

比如页面真正打开之前就已经需要：

- 顶部/侧边导航名称；
- page title；
- layout 文案；
- 登录方式名称；
- Session Recovery；
- 通用错误；
- manifest 中携带的 `UiText`。

所以不能简单说：

> 进入 Assessment 页面才加载 assessment 中文包。

因为 Assessment 可能已经在左侧导航里出现了。如果中文翻译没加载，用户会先看到英文 `Assessments`，随后再变成“测评”，这就是明显的 i18n flash。

因此我认为最合理的是两级语言包。

第一层是很小的 **shell catalog**，首屏必须加载：

```text
locale-zh-CN-shell
├─ common
├─ layout
├─ navigation labels
├─ page titles
├─ Session / release / load failures
├─ 当前登录入口需要的名称
└─ 其他会在 surface 挂载前出现的文字
```

理想目标我会控制在大约 **5–15 KB Brotli**。

第二层才是页面功能 catalog：

```text
locale-zh-CN-org
locale-zh-CN-entry
locale-zh-CN-review
locale-zh-CN-assessment-admin
locale-zh-CN-formula
...
```

进入对应功能才加载。

这样登录页就不会为了：

> “认定调整说明”“申诉”“公式测试”“批量认定”“目录导入”

这些根本看不到的文字支付网络成本。

---

### 尤其是 `assessment/core`，它最值得拆

你现在 `packages/plugins/assessment/core/src/client/i18n.ts` 是明显的超大聚合模块。

里面同时存在：

```text
entry/*
review/*
record/*
batch/*
items/*
staff/*
person/*
navigation/*
permission/*
audit/*
...
```

而对应的 `zh-CN.ts` 也是一整张巨大表。

这比“有 10 个插件”更值得关注。

比如普通学生进入“我的申报”，实际需要的大致是：

```text
assessment/navigation/*
assessment/entry/*
assessment/progress/*
少量 batch/*
少量 common status
```

他完全不需要：

```text
review/*
staff/*
record/*
admin/*
items editor/*
```

所以即便你做到“每插件 lazy”，学生打开一个 assessment 页面以后仍然会把整个 assessment core catalog 拉下来，收益有限。

因此如果第二阶段真正要做，我会按**稳定业务域**粗分，而不是按源码文件随便拆：

```text
assessment-shell
assessment-entry
assessment-review
assessment-admin
assessment-record
```

Formula 本来就是单独 plugin，可以自己一个 lazy catalog。

Org / RBAC / Audit / Settings 可以根据实测决定合并成一个 `admin` catalog，别拆得过细。

---

### 不建议拆成几十个文件

例如这种我不建议：

```text
entry-list.zh-CN.js
entry-detail.zh-CN.js
entry-history.zh-CN.js
entry-upload.zh-CN.js
entry-appeal.zh-CN.js
...
```

原因正好和你 Vite 配置里的那段经验一致。

Qualy 已经踩过“小 chunk 太多”的坑。HTTP/2/HTTP/3 虽然没有 HTTP/1.1 六连接问题那么严重，但每一个模块仍然有：

- request scheduling；
- header / stream 开销；
- module evaluation；
- Vite preload graph；
- 缓存记录；
- 压缩上下文无法跨文件共享。

54 KB 的一整个文本包压缩率通常会比十个 5 KB 小包更好。

所以我希望最后不是：

```text
1 × 54 KB
↓
18 × 2–5 KB
```

而是类似：

```text
shell       8 KB
entry      10 KB
review     12 KB
admin      11 KB
org/admin   8 KB
formula     6 KB
```

一个用户首屏一般只拿：

```text
shell + 当前 feature
```

也就是 15–20 KB 左右，而不是 54 KB。

---

### 页面代码和语言包应该一起 preload

这里可以很好地接你这一轮刚做的：

> 冷启动时当前页面代码和布局一起预取。

现在已经存在：

```text
manifest 到达
↓
知道当前 layout / page
↓
提前 preload 对应代码
↓
React render
```

以后应该变成：

```text
manifest 到达
↓
确定当前 surface
↓
Promise.all([
  preload layout code,
  preload page code,
  preload locale shell,
  preload current surface catalog
])
↓
一次 commit
```

这样不会出现：

```text
页面 JS 到了
↓
开始 render
↓
才发现中文包没到
↓
再次等待
```

也不会出现英文闪一下再变中文。

这一点非常适合 Qualy 当前架构。

---

### 但是当前 `I18nProvider` 必须改

现在它的模型是：

```ts
loadCatalogs(locale, catalogs)
  .then(activate)
```

而 `loadCatalogs()` 会把**所有 plugin catalogs**：

```ts
Promise.all(...)
```

全部加载。

如果做 lazy catalog，这个模型要变成：

```text
I18nRuntime
├─ activate locale
├─ loadCatalog(namespace/group)
├─ ensureCatalogs(groups[])
└─ 已加载 catalog 可增量 merge
```

Lingui 本身支持向已经激活的 locale 增量 `load()` message，不需要每次重建整个 i18n instance。

概念上：

```ts
await i18nRuntime.ensure([
  'shell',
  'assessment-entry',
])
```

之后：

```ts
i18n.load('zh-CN', newMessages)
```

即可。

这才是真 lazy i18n，而不是把同样的 `Promise.all` 换成多个 HTTP 文件。

---

### 还要把 `errorMessages` 一起处理

这是很容易遗漏的一块。

当前 `virtual:qualy/plugins` 不光静态 import：

```ts
catalogs
```

还静态 import：

```ts
errorMessages
```

而 `errorMessages` 本身又携带：

```ts
{
  message: {
    id,
    defaultMessage
  },
  values: ...
}
```

所以即便你把 `zh-CN.ts` 拆漂亮了，如果所有 feature 的 error registry 仍然首屏静态 import，大量 English `defaultMessage` 还是会留在 boot graph。

最终应该让：

```text
feature page code
feature error registry
feature locale catalog
```

形成同一个 lazy feature boundary。

比如进入审核页时才注册：

```text
assessment-review errors
assessment-review translations
assessment-review code
```

通用：

```text
AUTH_REQUIRED
SESSION_EXPIRED
ACCESS_DENIED
BAD_REQUEST
```

继续留在 shell/global 层即可。

---

### 我甚至会利用现在的 surface/plugin collector 自动生成这些关系

不要在 `apps/web` 手写：

```ts
if (page === xxx) load('assessment-entry')
```

这违反你现在很重要的 open-world/plugin discipline。

更合适的是让 plugin 自己声明：

```ts
surface:
  assessment.entry
  → catalog group assessment-entry
```

然后 `collectWebPlugins()` 在生成：

```ts
pageComponents
layoutComponents
loginComponents
```

的同时再生成：

```ts
pageCatalogs
layoutCatalogs
loginCatalogs
```

例如概念上：

```ts
export const pageCatalogs = {
  'assessment/entry': () => import('...locale/entry/zh-CN'),
}
```

当然具体 API 不一定长这样，但归属应该来自 plugin contribution，而不是 composition root 知道每个业务插件。

---

### 我会怎么决定值不值得

我建议不要一下让 Claude 重构完，而是让它做三个 PoC 对比：

| 方案 | 目的 |
|---|---|
| 当前 | 54.7 KB 全量 zh-CN |
| A：只抽 English defaultMessage | 看重复英文消除后的收益 |
| B：English 抽离 + shell/feature lazy catalog | 看真正按需语言包收益 |

然后对四个页面测：

```text
登录
批次列表
我的申报
组织树
```

记录：

```text
首屏 Brotli bytes
locale bytes
关键请求数量
LCP median
FCP
TBT
首次导航到未加载 feature 的耗时
二次访问 cache 后耗时
```

我给一个很明确的门槛：

如果 lazy catalog 能让常见手机首屏再减少 **30–50 KB Brotli 以上**，并稳定降低 LCP 约 **200 ms+**，值得正式做。

如果最后只是：

```text
54 KB → 43 KB
LCP 4.2s → 4.1s
```

不值得为此引入复杂的 catalog lifecycle。

---

所以我的建议不是简单的“拆”或“不拆”。

**应该拆，但顺序是：**

1. 先把静态 English `defaultMessage` 从生产 boot graph 抽成 `en-US` catalog；
2. 保留一个小型 `shell` 中文包；
3. 把真正的大业务文案按 4–6 个稳定 feature group lazy load；
4. 当前页面的 catalog 与页面 JS 同时 preload；
5. error registry 也跟 feature lazy，而不是继续全局静态 import；
6. 不按每个组件、每个页面拆几十个小 chunk。

对 Qualy 当前规模，我认为这比继续让所有页面都硬等一个 **54.7 KB Brotli 全产品中文包**更合理。登录页尤其没必要为整个综测系统的审核、公式、组织管理文案买单。

`defaultMessage`不一定是英语啊，虽说本项目确实是这样做的。`defaultMessage`的作用就是在语言包加载失败的情况下不要显示为空白或者i18n的id，所以你还是得想想，或者是考虑换一下整个项目的i18n构造之类。你看看怎么合适。

你这个纠正是对的。把 `defaultMessage` 直接等同于 “English catalog” 在语义上不够干净。它真正应该表达的是：

> **当正常翻译机制不可用时，这条消息至少还能显示什么。**

本项目恰好统一用英文写 `defaultMessage`，这是 Qualy 的 authoring convention，不应该反过来成为 `MessageDescriptor` 这个抽象的语义。

我重新结合 Qualy 现在的实现想了一遍。我认为不要简单做“把英文抽成语言包”，也不用换 i18n 库；应该改的是 Qualy 自己现在的 i18n 装配模型。当前真正的问题是 `defaultMessage`、catalog completeness、错误翻译注册、locale loader 四件事被绑在了一个 `definePluginMessages()` 产物里，又被 `virtual:qualy/plugins` 全局静态导入。

现在实际上是：

```text
插件 i18n.ts
│
├─ messages
│   └─ { id, defaultMessage }
│
├─ errorMessages
│   └─ { message: { id, defaultMessage }, values }
│
└─ catalogs
    ├─ namespace
    ├─ messages ← 为构建期完整性检查服务
    └─ locales  ← 真正运行时需要的 loader

             ↓

virtual:qualy/plugins
把所有插件 i18n.ts 静态 import

             ↓

首屏把全产品 defaultMessage 带进来
+
I18nProvider 又全量下载 54.7KB zh-CN
```

这里最不合理的其实不是 `defaultMessage`，而是：

**构建期元数据和浏览器运行时数据没有分离。**

---

我会把 Qualy 的 i18n 重构成“Message Group / Catalog Group”模型，但保留 `defaultMessage`。

源代码里开发者仍然写：

```ts
const submit = {
  id: 'assessment/entry/submit',
  defaultMessage: 'Submit for review',
}
```

这很好，不需要改变。

`defaultMessage` 继续承担：

- 开发环境 fallback；
- catalog 加载失败后的兜底；
- 测试和诊断；
- 服务端 `UiText` 的 self-describing fallback；
- 插件没有翻译时至少有可读内容。

不要删。

真正要变的是它**什么时候进入浏览器**。

---

### 第一层：不要再全局 import 所有插件的 MessageDescriptor

这一步我认为比拆 `zh-CN` 更应该先做。

现在 `virtual:qualy/plugins` 会生成：

```ts
import { catalogs as authCatalogs } from 'auth/i18n'
import { errorMessages as authErrors } from 'auth/i18n'

import { catalogs as assessmentCatalogs } from 'assessment/i18n'
import { errorMessages as assessmentErrors } from 'assessment/i18n'

// ...
```

这等于告诉 bundler：

> 所有 i18n 模块都是启动依赖。

于是 assessment 的：

```text
申诉
复核
重新认定
公式计算
行政认定
审核路线
...
```

对应的英文 defaultMessage，即使登录页永远用不到，也必须进 boot graph。

这个应该先解除。

---

### 第二层：把现在的 PluginCatalogs 拆成“声明”和“运行时”

目前：

```ts
interface PluginCatalogs {
  namespace: string
  messages: readonly MessageDescriptor[]
  locales: ...
}
```

这个接口实际上混了两种用途。

`messages` 是：

```text
build/test time metadata
```

用于：

- namespace 检查；
- duplicate message id；
- catalog completeness；
- orphan translation 检查。

而 `locales` 才是：

```text
browser runtime
```

所以应该概念上拆成：

```ts
interface MessageDeclaration {
  namespace: string
  messages: readonly MessageDescriptor[]
  locales: ...
}

interface RuntimeCatalogGroup {
  load(locale): Promise<MessageCatalog>
}
```

collector 在构建阶段读取完整 `MessageDeclaration` 做现在所有严格检查。

但生成给浏览器的 virtual module **不再带 `messages`**。

也就是说：

```text
messages/defaultMessage
不是为了 catalog completeness
被迫留在浏览器启动图里。
```

这一刀即使暂时不做 lazy locale，也可能已经能砍掉一部分 boot graph。

---

### 第三层才是你问的：语言包要不要拆

要。

但我现在会比上一条更明确：

**不是“插件一个语言包”，而是“shell + feature group”。**

Qualy 比较适合：

```text
core/shell
auth
org
assessment-entry
assessment-review
assessment-admin
assessment-record
formula
```

大约 6～10 个组就够了，不要几十个。

例如 `assessment/core` 当前那个 `i18n.ts` 非常大，我看里面同时塞着：

```text
navigation
entry
review
record
staff
person
batch
items
audit
permission
...
```

学生进入“我的申报”完全没必要加载：

```text
review/*
record/*
staff/*
items editor/*
administrative/*
```

所以这一块确实应该切。

---

### 但 `defaultMessage` 应该跟 feature 一起 lazy，而不是全局消失

这是我现在认为最稳妥的第一版。

例如：

```text
用户进入“我的申报”
        ↓
同时 preload
        ↓
assessment-entry 页面代码
assessment-entry messages/defaultMessage
assessment-entry zh-CN catalog
```

也就是：

```ts
Promise.all([
  loadPage(),
  loadMessageGroup('assessment-entry'),
  loadLocaleGroup('zh-CN', 'assessment-entry'),
])
```

假设中文语言包成功：

```text
显示中文
```

假设：

```text
locale-zh-CN-assessment-entry.js
```

因为发布错位、网络异常、缓存损坏之类加载失败：

```text
assessment-entry 页面 JS
本身已经带 defaultMessage
        ↓
仍然可以显示 fallback
```

这就完整保留了你说的 `defaultMessage` 价值。

而且它解决了现在最大的浪费：

```text
不是登录页携带整个 Qualy 的 defaultMessage

而是：

登录页
→ auth 的 defaultMessage

我的申报
→ assessment-entry 的 defaultMessage

审核工作台
→ assessment-review 的 defaultMessage
```

中文用户仍然会在**当前 feature**里同时付：

```text
fallback text + Chinese text
```

但不会再为**整个产品**同时付两份语言。

这已经是一个相当大的结构改善，而且不用搞复杂编译器。

---

### shell 需要单独处理

这里不能天真地完全按页面 lazy。

因为用户还没打开页面之前，已经要显示：

```text
导航栏
页面名称
布局
用户菜单
Session Recovery
加载失败
Release Recovery
通用按钮
```

这些应该属于：

```text
core/shell
```

并始终加载。

你现在 `bootstrapMessages` 其实已经是这个思想的更早一层：

```text
catalog 尚未存在
↓
仍然需要：
加载中
重试
页面加载失败
Qualy 已更新
...
```

这个不要动。

最终实际上有三层：

```text
Layer 0
bootstrapMessages
几百字节
HTML/boot 阶段

Layer 1
shell catalog
大约几 KB
应用框架、导航、通用错误

Layer 2
feature catalog
按实际页面加载
entry / review / admin / formula ...
```

这套结构和 Qualy 很匹配。

---

### 错误翻译也必须跟着 feature 拆

这一点非常关键，否则你拆了 zh-CN，94KB `defaultMessage` 还是下不去多少。

现在每个插件：

```ts
errorMessages
```

也被全局聚合：

```ts
export const errorMessages = {
  ...authErrorMessages,
  ...assessmentErrorMessages,
  ...
}
```

而每一个错误注册又带：

```ts
message: {
  id,
  defaultMessage
}
```

所以 Assessment 几十种拒绝原因全都可能进入登录页启动图。

未来应该变成：

```text
global errors
├─ AUTH_REQUIRED
├─ SESSION_EXPIRED
├─ ACCESS_DENIED
├─ BAD_REQUEST
└─ transport/runtime errors

feature errors
├─ assessment-entry
├─ assessment-review
├─ assessment-admin
└─ ...
```

进入 feature 时注册：

```ts
i18n.registerGroup(group)
```

加载过之后可以留在内存里，不需要卸载。

---

## 是否应该进一步做到“正常情况下连当前 feature 的 defaultMessage 都不下载”？

技术上可以，而且这是第二阶段可以考虑的。

也就是 source 仍然写：

```ts
{
  id,
  defaultMessage
}
```

但 production build 时做 extraction：

```text
source
        ↓
build compiler

runtime JS:
id

zh-CN catalog:
中文

fallback catalog:
defaultMessage
```

正常中文用户：

```text
page JS + zh-CN
```

不会下载 fallback。

只有语言包加载失败：

```text
zh-CN chunk failed
        ↓
load fallback catalog
        ↓
仍然有可读页面
```

这个理论上是最省流量的模型。

但这里会带来真正的 build compiler。

你必须保证：

```text
defaultMessage extraction
message id
ICU placeholders
error registry
catalog completeness
open-world plugins
source maps
development behavior
```

全都不漂移。

所以我现在**不建议第一步就做这个**。

先做 feature lazy，实际看数据。

假如从：

```text
boot graph:
676 KB Brotli
locale:
54.7 KB
default messages:
约 94 KB
```

变成：

```text
登录页：
shell + auth catalog ≈ 10 KB
shell + auth fallback ≈ 10~20 KB
```

LCP 已经明显下降，那完全没必要再造 extraction compiler。

---

## 我也不建议换 i18next / FormatJS

你现在已经用了 Lingui 的：

```ts
setupI18n()
compileMessage()
```

Lingui 本身完全支持：

```text
后续继续 i18n.load(locale, moreMessages)
```

也就是说增量 catalog 不需要换引擎。

Qualy 自己已经建立了很多很有价值的东西：

```text
UiText
MessageDescriptor
namespace ownership
plugin catalogs
error translation typing
catalog completeness gate
server/browser language boundary
```

现在换 i18next 之类并不会解决：

> “为什么所有插件 catalog 都在首屏？”

因为这是你的**composition model**造成的，不是 Lingui 造成的。

换库反而要重写大量已经正确的边界。

所以我的选择是：

> **保留 Lingui，重构 Qualy 的 i18n composition。**

---

## 还有一个语义我会顺便修

当前代码里：

```ts
export const fallbackLocale = 'en-US'
```

然后注释是：

```ts
// defaultMessage is the english fallback
```

你刚才指出的问题就在这里。

我建议至少把概念改成：

```ts
export const sourceLocale = 'en-US'
```

或者：

```ts
export const authoringLocale = 'en-US'
```

表达的是：

> Qualy 当前约定所有源码 `defaultMessage` 使用 en-US 编写。

而不是：

> defaultMessage 的定义就是 English。

`defaultMessage` 仍然只是 fallback text。

这样以后契约语义会清楚很多：

```text
MessageDescriptor.defaultMessage
= emergency fallback

authoringLocale
= 本项目约定 fallback 文本当前使用哪种语言

SupportedLocale
= 用户可以选择的语言

Catalog
= 某 locale 的正式翻译
```

四件事不再混为一谈。

---

我最终会把 Qualy 目标架构定成这样：

```text
                     build / CI
                         │
     ┌───────────────────┴──────────────────┐
     │                                      │
Message declarations                  locale catalogs
{id, defaultMessage}                  zh-CN / ...
     │                                      │
namespace / completeness                    │
duplicate / ICU tests                        │
     │                                      │
     └──────────── 不直接全塞进 boot ───────┘


Browser
────────────────────────────────────────────

bootstrap
  ↓
bootstrapMessages

App shell
  ↓
shell message group
shell locale group

Manifest resolves current surface
  ↓
┌─────────────────────────────────────┐
│ Promise.all                         │
│                                     │
│ page/layout code                    │
│ feature fallback descriptors        │
│ feature locale catalog              │
└─────────────────────────────────────┘
  ↓
render

locale chunk failed
  ↓
feature defaultMessage 继续工作
```

然后如果实际测出来仍然值得继续：

```text
Phase 2

feature defaultMessage
      ↓ build extraction
fallback catalog
      ↓
只在 locale load failure 时请求
```

这才是我认为既尊重 `defaultMessage` 的真正用途，又适合 Qualy 当前插件架构和性能需求的方案。

所以我会修正上一轮建议：**不要以“把 defaultMessage 变成 en-US 语言包”为核心。先把“全产品 i18n 全局静态装配”改成“shell + feature 增量装配”；`defaultMessage` 保留，并跟实际 feature 一起 lazy。之后如果数据证明还值得，再做 fallback extraction。**

你再认真阅读下Qualy源码，根据其他生产项目的实践，考虑下对于Qualy来说怎么做是最合适的。

我重新按 Qualy 当前的 i18n 链路完整看了一遍，包括 `App.tsx`、`packages/web/i18n`、`i18n-contract`、`collect.ts`、surface registry、route builder、各插件的 `client/i18n.ts`，尤其是 `assessment/core` 现在大量页面共同引用一个 `assessmentMessages` 的方式。结合 Lingui、FormatJS 这类生产工具的标准做法，我会把之前的建议再收敛一下。

结论是：

**Qualy 不适合继续维持“全产品一个 locale chunk + 全产品 defaultMessage 常驻首屏”的结构，但也不适合简单地把 54.7 KB 拆成十几个语言包。最合适的是：保留 Lingui，改成“构建期提取/预编译 + source locale + shell catalog + 按 feature lazy catalog”，同时把 `defaultMessage` 从生产静态 JS 中移出，但保留它作为源码 authoring 和 wire fallback。**

这其实正是 Lingui 自己生产构建的方向：开发时保留 source/default message，生产时移除它们和运行时 message compiler，真正依赖编译好的 catalog；source locale 本身也作为一个 catalog 动态加载。Lingui 官方也明确建议动态加载当前语言的 catalog。 FormatJS 也专门提供 `removeDefaultMessage`，说明“源码保留 defaultMessage，但生产 bundle 不必永久携带它”是很成熟的模式。

### Qualy 现在真正的问题

现在并不是单纯 `zh-CN` 的 54.7 KB 太大。

`App.tsx` 是：

```tsx
<I18nProvider
  catalogs={catalogs}
  errorMessages={errorMessages}
  fallback={<LoadingScreen />}
>
  ...
</I18nProvider>
```

而 `loadCatalogs()` 是：

```ts
const sources = [
  commonCatalogs,
  ...plugins.map(plugin => plugin.locales)
]

await Promise.all(...)
```

也就是：

> **所有 active plugin 的当前语言 catalog 不到齐，整个应用就不激活。**

与此同时，`collect.ts` 生成的 `virtual:qualy/plugins` 又是静态：

```ts
import { catalogs as authCatalogs } from '.../auth/i18n'
import { errorMessages as authErrors } from '.../auth/i18n'

import { catalogs as assessmentCatalogs } from '.../assessment/i18n'
import { errorMessages as assessmentErrors } from '.../assessment/i18n'
```

所以两头都全局化了：

```text
JS 侧：
所有插件的 MessageDescriptor/defaultMessage
所有插件的 errorMessages

locale 侧：
所有插件的 zh-CN
```

这才导致中文用户首屏同时承担那批英文 fallback 和 54.7 KB Brotli 中文。

而且还有第三个问题：当前：

```ts
instance.setMessagesCompiler(compileMessage)
```

意味着你把 raw ICU strings 发给浏览器，再让浏览器编译。

生产项目一般会把 ICU 编译放在 build 阶段。Lingui 自己的生产模式就是这么干的，可以让生产 bundle 不再承担 source messages 和 compiler。

所以这次最好别只围着“54 KB 怎么拆”打补丁，而是把 i18n 的生产模型理顺。

---

## 我认为 Qualy 最终应该有三层语言资源

第一层保持你现在已经做得很好的 `bootstrapMessages`。

```text
Layer 0 — bootstrap

加载中
页面加载失败
刷新
Qualy 已更新
release skew
maintenance
...
```

这些在 React/i18n runtime 都还没起来的时候就必须显示，因此应该继续内联。不要动。

第二层是 **shell catalog**。

它应该包含真正“应用壳启动就必须知道”的内容，例如：

```text
common/*
layout/*
导航组
页面导航名称
document title
Session Recovery
通用错误/空态
用户菜单少量通用文字
```

这个 catalog 应该在进入正式应用之前加载。

但这里有个 Qualy 特有的细节：你的导航和 page title 是 manifest 里的 `UiText`，来自各业务插件 descriptor，所以 shell catalog 不是单纯 `@qualy/web-i18n` 自己的 common 文案。

构建器应该把所有 active plugin 中**会出现在 manifest/shell 上的 message id**提取出来，合并成类似：

```text
locale-shell-zh-CN.js
locale-shell-en-US.js
```

我预计这一块不会很大，理想是几 KB 到十来 KB Brotli。

第三层才是 **feature catalog**。

例如：

```text
auth/login
auth/account
auth/iam

org

assessment/batch
assessment/entry
assessment/review
assessment/record
assessment/admin

formula
```

不需要每个页面一个，更不要每个组件一个。

---

## `assessment/core` 是必须真正拆的地方

这一点我现在比之前更确定。

因为我查了引用关系，`assessment/core` 大量模块都是：

```ts
import { assessmentMessages as m } from '../i18n.ts'
```

包括：

```text
entry/*
review/*
record/*
batch/*
roster/*
items/*
access/*
各种 page
```

这意味着即使你把 `zh-CN.ts` 网络上拆成多个 chunk，但源码里的：

```ts
assessmentMessages = {
  几百甚至上千条 descriptor
}
```

仍然是一个共同依赖。

Rollup 很容易把这个 `i18n.ts` 变成所有 assessment 页面共同依赖的大 shared chunk。

所以：

> **仅拆 translation file，而不拆 message declaration，本质上只解决一半。**

对 Assessment，我会实际拆源码：

```text
client/i18n/
  shell.ts
  batch.ts
  entry.ts
  review.ts
  record.ts
  admin.ts
```

然后：

```ts
// entry/*
import { entryMessages as m } from '../i18n/entry.ts'
```

而不是所有东西都继续 import 巨大的：

```ts
assessmentMessages
```

这样才会形成真正的：

```text
MyEntries page
→ entry JS
→ entry fallback descriptors（开发态/需要时）
→ entry locale

Review page
→ review JS
→ review locale
```

Formula 可以先不细拆，除非测出来它也很大。Org 本身规模较小，也没必要为了架构洁癖拆成五份。

---

## `defaultMessage` 怎么处理，我现在建议这样定

你前一条指出得对：

```text
defaultMessage !== English catalog
```

这个类型层面的语义应该保持。

但对 Qualy 本身，应该明确增加：

```ts
sourceLocale = 'en-US'
```

而不是继续叫：

```ts
fallbackLocale = 'en-US'
```

二者区别是：

```text
defaultMessage
= 每条消息源码里提供的可读 fallback

sourceLocale
= Qualy 约定这些 defaultMessage 当前使用的语言
```

Qualy 当前 source locale 就是 en-US。

这也是成熟 i18n 系统通常要求的。FormatJS 明确要求 `defaultLocale` 与 `defaultMessage` 所使用的 locale 一致，否则连消息内部的日期、数字格式都可能出现混合语言。

因此源码仍然写：

```ts
{
  id: 'assessment/entry/submit',
  defaultMessage: 'Submit for review'
}
```

开发环境也继续享受：

```text
没 catalog
→ defaultMessage
```

但是 production build 不应该把这些字符串全部永久塞进 JS。

---

## 生产环境的 fallback 不应该靠“永远携带全套 defaultMessage”

这是我这次最重要的判断。

现在你的设计是：

```text
zh-CN chunk 加载失败
↓
activate({})
↓
每一个 descriptor 自带 defaultMessage
↓
全站还能显示英文
```

它确实很鲁棒。

但代价是：

> 每一次正常访问，都为一个极低概率故障永久下载几十 KB fallback。

大型生产项目通常不是这么换可靠性的。

更合理的是：

```text
请求 zh-CN feature catalog
          ↓
成功
→ 正常中文

失败
          ↓
请求 sourceLocale=en-US 的同一 feature catalog
          ↓
成功
→ 英文 fallback

仍失败
          ↓
显示 bootstrap recovery screen
→ “语言资源加载失败，请刷新页面”
```

Lingui 本身的生产方式就是 source locale 也进入 catalog，因为生产构建会移除 source/default message。

这对 Qualy尤其合理，因为你已经有：

- hashed immutable asset；
- old-release asset retention；
- release skew detection；
- asset load recovery；
- boot watchdog；
- `bootstrapMessages`。

如果：

```text
当前 locale catalog 失败
+
source locale catalog 也失败
```

那已经不是“一条翻译缺失”了，而是**静态资源交付发生故障**。

这时候继续拼命让业务页面半残运行，反而不如明确进入资源恢复 UI。

因此没必要用 94 KB 常驻数据为这种情况兜底。

---

## 但 `UiText.defaultMessage` 不要删

这里必须和静态前端 descriptor 区分。

你现在服务端可以发：

```ts
{
  kind: 'message',
  id: 'assessment/navigation/batches',
  defaultMessage: 'Assessment rounds'
}
```

这个 wire contract 我认为非常好。

继续保留：

```ts
MessageRef {
  id
  defaultMessage
}
```

因为它有几个价值：

- server/plugin contribution 是 self-describing 的；
- 客户端 catalog 暂时没有这个 ID 时仍能显示；
- plugin/version skew 下不至于显示 raw id；
- 服务端日志、mirror、非浏览器环境可以用 `plainText()`。

这些 payload 只包含实际返回的几个 message，不是把全站消息塞进网络。

所以最终可以出现两个稍微不同的概念：

```ts
// source / build-time
MessageDescriptor {
  id
  defaultMessage
}

// production browser runtime after transform
RuntimeMessageDescriptor {
  id
}

// wire
MessageRef {
  id
  defaultMessage
}
```

这是合理的，不需要强行把三个生命周期压成一个物理结构。

---

## 我不会换掉 Lingui

认真看完后，这一点我也比较确定。

你现在的问题不是 Lingui 能力不够，而是实际上只用了它：

```text
setupI18n
i18n.load
i18n._
compileMessage
```

但没有采用它生产优化的那一半：

```text
extract
compile
strip source messages
dynamic compiled catalogs
```

换 i18next / React Intl 不能自动解决：

```text
virtual:qualy/plugins 全局静态 import i18n
```

和：

```text
assessmentMessages 一个大对象被全 assessment 共享
```

这两个才是根因。

相反，Lingui 官方 production macro 本身就会把 `message`、comment 等非运行时数据移掉，只留下 message id。

所以最好是：

> **保留 Lingui core，引入 Qualy 自己的 build-time i18n compiler。**

不一定非要采用 `.po`。

---

## 我反而建议暂时继续用 TS catalog

你当前：

```ts
locales/zh-CN.ts
```

有很不错的工程属性：

- 正常 TypeScript；
- 现有 tests 可以 import；
- completeness/orphan gate 很严；
- ICU argument mismatch 有测试；
- plugin namespace 有门禁；
- 不需要再引入翻译平台文件格式。

目前只有中英文两种语言，也没有专业 TMS 流程。

所以没必要为了“生产项目都用 PO”就迁 `.po`。

可以让构建插件读取现有 TS catalog，然后：

```text
raw ICU TS
      ↓ build
compileMessageOrThrow
      ↓
compiled catalog JS chunk
```

生产浏览器只拿 compiled messages。

这样可以顺便去掉：

```ts
@lingui/message-utils/compileMessage
```

这一整段浏览器运行时编译路径。

如果未来接 Crowdin/Lokalise/Transifex，再考虑 PO interchange；你的 contract 注释本来也已经为此留了口。

---

## 对 Qualy，我会具体这样落地

如果让我给 Claude Code 一个最终实施顺序，我会定成：

1. **先改概念，不改 UI 行为。** `fallbackLocale` → `sourceLocale`；源码 `defaultMessage` 保留；wire `MessageRef.defaultMessage` 保留。

2. **引入 build-time catalog compilation。** 继续以 TS catalog 为 authoring source，但 production 输出 Lingui compiled catalog，不再在浏览器 `setMessagesCompiler(compileMessage)`。先量一次因此减少的 boot JS 和 TBT。

3. **把 build-time declaration 与 runtime catalog 分离。** 当前 `PluginCatalogs.messages` 主要是 build/test metadata，不应该因为 completeness gate 就被带进 production runtime。

4. **生产构建剥离静态 descriptor 的 `defaultMessage`。** 同时生成真正的 `en-US` source catalog。开发/test 保持当前 descriptor 形状。这个阶段后，中文正常路径就不再携带整套英语字符串。

5. **先拆 `shell` 与 `feature`。** shell 聚合所有 active plugin 的导航/page title/layout/common message；feature 按需加载。

6. **优先拆 Assessment。** 我会先用 `batch / entry / review / record-admin` 四块，不要上来拆十几块。Auth 可以先 `login / account-admin` 两块。小插件先保持一块。

7. **把 surface loader 和 locale loader绑在一起。** 你这一轮已经在做“当前 page code 提前 preload”，正好让它演进成：

```text
current surface known
↓
并行
├─ layout chunk
├─ page chunk
├─ shell catalog（若未加载）
└─ feature catalog
↓
render
```

而不是 page render 后才发现语言资源没到。

8. **错误 registry 跟 feature 走。** Common transport/authentication errors 常驻；`assessment` 那一大堆领域拒绝原因不要在登录页全局注册。

9. **locale load failure 先退 source catalog；双失败才进 bootstrap recovery。** 不再 `activate({})` 然后指望整个应用里的 defaultMessage 救场。

10. **最后重新跑 Lighthouse 决定是否继续细拆。** 不根据“文件看起来大”继续切。

我会给它明确的停止指标：

```text
shell locale: 尽量 < 10–15 KB Brotli

常见 feature locale:
大致 < 10–20 KB Brotli

首次页面：
locale 请求总数最好 1–2 个
不要变成 8–15 个

如果某个 feature < 5 KB：
通常不要再拆
```

不是硬性标准，但作为 chunk 粒度很实用。

---

这样改完以后，中文用户的典型冷启动应该从现在近似：

```text
boot JS
  + 全产品 defaultMessage
  + locale-zh-CN 54.7 KB
  + current page
```

变成：

```text
boot JS（无全产品 fallback 文本）
  + locale-shell-zh-CN
  + current feature locale
  + current page
```

而英文用户则：

```text
boot JS
  + locale-shell-en-US
  + current feature en-US
  + current page
```

两个语言完全对称。

这也是我认为比当前：

```text
en-US = 特殊的 defaultMessage
zh-CN = 真 catalog
```

更干净的模型。

最重要的是，**源码里的 `defaultMessage` 仍然没有失去意义**。它仍然是 authoring source、translator source、开发态 fallback、wire fallback；只是生产正常路径不再为“万一 catalog 坏了”永久携带整套源语言字符串。

对 Qualy 现在这个体量，这比单纯“把 54 KB 拆成几个 JS”更值得做。

我有一个大胆的猜想，我们可否用打包时长换首屏时长，在打包的时候打包出多个语言的JS包，这样每个用户每个语言只需要加载同一个包，换语言才需要全量重载，还是你认为不合适。

这个思路不是异想天开，反而是成熟的生产方案之一。Angular 的生产 i18n 就支持“编译一次，再为每个 locale 生成一个完整的本地化应用变体”，运行时切语言通常就是切到另一个 locale 版本并重新加载。

但对 Qualy，我会做一个关键修正：

**可以做“每种语言一套 build variant”，但绝对不要做“每种语言一个包含整个 Qualy 的大 JS”。**

后者只是把：

```text
入口 JS
+ 54.7 KB zh-CN
+ 页面 chunk
```

变成：

```text
一个更大的 zh-CN.js
```

请求数少了，但首屏字节没少，甚至会把 Formula Editor、审核、后台等本来可以 lazy 的代码一起拖进首屏，得不偿失。

我更推荐的是：

```text
Qualy release
├─ zh-CN variant
│  ├─ entry
│  ├─ shell
│  ├─ MyEntries chunk（已经内联中文）
│  ├─ Review chunk（已经内联中文）
│  └─ Formula chunk（已经内联中文）
│
└─ en-US variant
   ├─ entry
   ├─ shell
   ├─ MyEntries chunk（已经内联英文）
   ├─ Review chunk（已经内联英文）
   └─ Formula chunk（已经内联英文）
```

也就是说：

> **语言在 build 时确定，但页面/feature 的 code splitting 继续保留。**

这其实非常适合 Qualy。

---

### 这样比我们刚才讨论的 runtime lazy catalog 还更干净

假设当前中文用户打开“我的申报”。

现在大概是：

```text
入口代码
+ 全产品 defaultMessage
+ 54.7 KB 全产品 zh-CN
+ MyEntries 页面代码
```

如果改成 locale-specific build：

```text
zh-CN shell
+ zh-CN MyEntries chunk
```

`MyEntries` chunk 里面直接已经是：

```text
我的申报
提交
保存草稿
申诉
……
```

不再需要：

```text
{id: "...", defaultMessage: "..."}
      ↓
运行时查 catalog
```

甚至也不需要：

```ts
compileMessage
```

生产环境运行时编译 ICU。

Lingui 官方本身也是这个方向：production 会剥离 source message 和 message compiler，依赖预编译后的 catalog。

而 Angular 更进一步就是直接做 compile-time localization，把消息替换成本地化内容。

所以这个想法从工程实践上完全站得住。

---

### 对 Qualy 最大的优势：天然按页面获得 i18n code splitting

这比我们人为设计：

```text
assessment-entry locale
assessment-review locale
assessment-admin locale
```

漂亮很多。

因为 Qualy 本来已经有非常明确的动态边界：

```ts
Ui.page({
  component: Ui.react('./client/entry/MyEntriesPage')
})
```

Vite 已经把这些 surface 切 chunk。

如果消息跟代码一起编译，那么：

```text
MyEntriesPage
→ 它真正引用到的中文

ReviewPage
→ 它真正引用到的中文
```

bundler 自己就能通过 import graph 决定哪些文案属于哪个 chunk。

你不需要再维护第二张人工表：

```text
这个 message 属于 entry catalog
那个 message 属于 review catalog
```

这点对 Qualy 很重要。

你现在最大的一个反模式恰恰是：

```ts
import { assessmentMessages as m } from '../i18n.ts'
```

整个 assessment 共用一个巨大的 message object。

如果把 message declaration 拆回 feature 附近：

```text
entry/messages.ts
review/messages.ts
batch/messages.ts
```

它们就自然跟随对应页面 chunk。

---

### 但 Qualy 有一类文案不能这么简单处理：manifest 的 `UiText`

比如：

```ts
Ui.page({
  navigation: {
    label: message(
      'assessment/navigation/batches',
      'Assessment rounds'
    )
  }
})
```

这个东西是服务器根据权限生成 manifest 后发给浏览器的。

浏览器收到：

```json
{
  "kind": "message",
  "id": "assessment/navigation/batches",
  "defaultMessage": "Assessment rounds"
}
```

此时组件代码里不存在一条静态：

```ts
format(m.batches)
```

供 build compiler 替换。

所以 Qualy 即使采用 compile-time locale variant，还是需要一个很小的 **runtime shell dictionary**，专门处理：

- manifest page title；
- navigation labels；
- collection labels；
- permission labels；
- Login driver descriptors；
- 其他服务器下发的 `UiText`。

例如中文 variant 自带：

```ts
const shellMessages = {
  'assessment/navigation/batches': '测评批次',
  'assessment/nav-group/main': '测评',
  'org/navigation/organization': '组织架构',
  ...
}
```

它不需要包含：

```text
提交成功
保存草稿
删除确认
审核意见
公式编译失败
……
```

那些页面内部文案已经跟页面代码走了。

于是架构变成：

```text
                 build-time localized

Component copy ─────────────────────→ page chunks


                 small runtime lookup

Manifest UiText ────────────────────→ shell dictionary
API dynamic UiText ─────────────────→ shell/feature dictionary
```

我认为这比“一个 54 KB 全局 catalog”明显更合理。

---

### API Error 也可以自然解决

现在：

```ts
errorMessages = {
  ...所有插件错误
}
```

也是首屏静态聚合。

locale variant 后，可以把错误 registry 跟 feature code 放一起。

例如：

```text
assessment-entry chunk
├─ entry UI
├─ entry localized messages
└─ entry error translators
```

只有通用的：

```text
AUTH_REQUIRED
SESSION_EXPIRED
ACCESS_DENIED
BAD_REQUEST
transport errors
```

放 shell。

这又能砍掉一截当前 boot graph。

---

### 切换语言必须 reload，我认为可以接受

这是这套方案最大的产品取舍。

现在 Qualy：

```text
中文 → English
```

可以运行时立即 re-render。

locale-specific build 后：

```ts
localStorage.setItem('qualy.locale', 'en-US')
location.reload()
```

即可。

我觉得对 Qualy完全可以接受。

语言切换本身：

- 极低频；
- 通常只在账号菜单/登录页操作；
- 两种语言，不是用户不停切换的主题设置；
- reload 可以彻底保证日期、数字、页面、错误 registry、插件 UI 都在同一个 locale 世界里。

Angular 的 compile-time localization 本身也是这种取舍；其运行时加载翻译的机制也明确说明，已经处理过的内容不会因为后来加载新翻译自动改变，因此动态切语言通常涉及重新加载。

而且从 correctness 上说，我甚至觉得比现在更漂亮：

```text
一个 browser lifecycle
=
一个 locale
=
一个完整一致的 localized application
```

不会出现某个 lazy feature 忘了重新 subscribe locale 的问题。

唯一需要处理的是脏表单。

如果用户已经填写了内容再切语言，不能直接：

```ts
location.reload()
```

把内容抹掉。

Qualy 已经有 leave guard 体系，因此语言切换应该走相同的“将离开当前文档”语义：

> 切换语言需要重新载入页面，未保存的更改将丢失。

有 dirty state 时确认；没有时直接 reload。

---

### 首次访问怎么知道应该加载哪个语言？

这个问题 Qualy 反而已经解决了一半。

你现在 shell boot script 在 React 起来之前就已经计算：

```text
localStorage qualy.locale
        ↓
navigator.languages
        ↓
defaultLocale
```

并写：

```html
<html data-locale="zh-CN">
```

所以同一个 bootstrap script 可以进一步做：

```js
const locale = resolveLocale()

const src = locale === 'zh-CN'
  ? '/assets/e-zh-CN-xxxx.js'
  : '/assets/e-en-US-yyyy.js'

import(src)
```

甚至 HTML 内放一个 build-time generated map：

```html
<script type="application/json" id="qualy-entries">
{
  "zh-CN": "/assets/e-abc.js",
  "en-US": "/assets/e-def.js"
}
</script>
```

boot script：

```text
解析 locale
→ 找 entry
→ modulepreload/import 对应 variant
```

所以不需要服务器根据 `Accept-Language` 决定。

这一点非常适合你，因为：

> 用户在 Qualy 里手动选择的 locale 比 HTTP `Accept-Language` 优先。

服务器第一条 HTTP 请求看不到 `localStorage`，但你现有 bootstrap 看得到。

---

### 不过我不会直接做“两次完整 Vite build”

这里还有一个实现质量问题。

最粗暴的方法：

```bash
vite build --mode zh-CN
vite build --mode en-US
```

当然能跑。

但会：

- 重复 parse/transpile；
- 重复 StyleX；
- 重复 minification；
- sourcemap 两套；
- 大量不含任何文案的 chunk 也可能重复；
- release-store 管理变复杂。

只有 2 种语言，其实也不是不可接受，但既然你说的是：

> 用打包时长换首屏时长

可以先这么做 PoC，测出收益。

正式版本我更希望类似 Angular 的思路：

> **代码编译一次，localization pass 产生 N 个 localized variant。**

Angular 官方也特意说明，它生成多个 locale variant 时不需要为每种语言从头完整编译一遍。

Qualy 可以：

```text
TS / React / StyleX
        ↓
一次 normal build/intermediate graph
        ↓
locale transform
    ┌─────────────┐
    ↓             ↓
 zh-CN          en-US
```

不过这属于第二阶段优化。现在只有两个 locale，先双 build 验证性能价值非常合理。

---

### 还有一个很大的隐藏收益：缓存

现在任何一个中文翻译改动：

```text
locale-zh-CN-OLD.js
→ locale-zh-CN-NEW.js
```

因为所有中文文案全在一个 54.7 KB chunk：

> 改一个“取消”也可能让用户重新下载整个 54.7 KB。

如果 locale variant 跟 feature chunk 走：

```text
review 文案改了
```

只会失效：

```text
zh-CN review chunk
```

登录、组织、我的申报的 chunk 仍然是原 hash，继续 `immutable` 命中。

这一点和 Qualy 当前 release store 的设计非常契合：

```http
Cache-Control: public,max-age=31536000,immutable
```

你已经专门为 content-addressed chunks 建了一整套 retained asset store。

**更细但自然的 feature chunk 会显著提高跨版本缓存复用率。**

---

### 存储成本我完全不担心

两种语言就算让浏览器资产从例如：

```text
20 MB
```

涨到：

```text
30–35 MB
```

对于服务器磁盘和发布系统基本不值一提。

真正值钱的是：

```text
每一个真实用户
每一次 cold start
减少几十到上百 KB
减少一轮 catalog dependency
减少 runtime ICU compile
```

这是非常合理的：

> build/storage cost → user latency

交换。

---

所以我会认真把你这个方案列为**比“runtime 拆 6 个 language chunks”更值得做 PoC 的方案**。

但准确名称不应该是：

> “每种语言一个 JS 包”

而应该是：

> **compile-time localized application variants**

并且保留现有 route/feature code splitting。

最终模型我会选：

```text
                一个 Qualy Release
                       │
          ┌────────────┴────────────┐
          │                         │
      zh-CN variant             en-US variant
          │                         │
     locale entry               locale entry
          │                         │
   ┌──────┼──────┐           ┌──────┼──────┐
 shell   entry  review       shell   entry  review
   │       │      │            │       │      │
 中文     中文    中文         English English English
```

运行时不再有一个 54.7 KB 的“全产品 zh-CN 包”。

语言切换：

```text
保存 locale
→ reload
→ boot script 选择另一个 variant
```

`defaultMessage` 仍保留在源码和 `UiText` wire contract 中，但生产静态业务代码经过 localized build 后不再携带整套 source text。

**如果只有 zh-CN / en-US 两种语言，我现在反而很倾向这个方向。** 如果未来变成 15～30 个 locale，再重新评估 build matrix 和共享 chunk；目前两种语言正是 compile-time locale variant 非常舒服的规模。

行，以上也我只是提出一个简单设想。你再认真思考下本项目怎么做最合适，看看还有没有更好的方案来做，你思考下。以及如果按照这个设想，是否有成形的库来实现这方面，打包的时候怎么打包，以及是否此时代码库的i18n就没必要拆成zh-CN.ts而是可以直接写到i18n条目定义里一起维护了。

我重新按 Qualy 现在的约束想了一遍，我会把上一轮“每个 locale 编一套应用”的方案降级为实验方案，而不是最终架构。

对 Qualy 最合适的路线，我现在会定成：

**保留 Lingui，改成标准的“源码消息 → 构建期提取/编译 → 生产只加载当前 locale 的已编译 catalog”，然后视实测再做 feature 级 catalog splitting。不要做完整的 zh-CN/en-US 应用双份构建，也不要把中英文翻译都直接写进同一个 `i18n.ts` 条目。**

原因主要来自 Qualy 自己的架构，而不是通用偏好。

### 为什么我不再优先推荐“每种语言一套完整 JS”

这个模式本身没问题。Angular 就原生支持 compile-time localized application variants，而且会尽量复用编译结果，而不是简单完整编译 N 次。

但 Qualy 有两个 Angular 普通应用没有的特征。

第一，你有大量动态 `UiText`：

```ts
message(
  'assessment/navigation/batches',
  'Assessment rounds',
)
```

它们通过 manifest、权限、登录方式等服务端贡献流到浏览器。浏览器必须做到：

```text
收到 id
→ 根据当前 locale 查翻译
```

所以即使把组件 JSX 全都 compile-time localize，**运行时 dictionary 仍然消灭不了**。

第二，Qualy 是 open-world plugin build。`Ui.react()`、`Ui.i18n()` 可以来自装配出来的插件，包括将来的 dist-only 第三方插件。让宿主在构建时重新给所有插件生成：

```text
zh-CN component graph
en-US component graph
```

会让 plugin packaging contract 明显复杂化。

再加上：

- 两套 source map；
- 两套绝大多数完全相同的 JS；
- release store 资产数量翻倍；
- 每种 locale 都改变 chunk hash；
- 以后第三、第四语言线性放大；

最后得到的收益，标准 Lingui production pipeline 已经能拿走大部分。

所以 locale variant 可以做 PoC，但不是我现在会提交到主架构里的方案。

---

## 你现在其实只用了 Lingui 的“一半”

这点是整个问题的核心。

当前 Qualy 是：

```ts
setupI18n()

instance.setMessagesCompiler(compileMessage)
```

然后自己维护：

```text
client/i18n.ts
client/locales/zh-CN.ts
```

最后把 raw ICU 发给浏览器现场编译。

但 Lingui 正常的 production workflow 本来就是：

```text
source messages
     ↓
extract
     ↓
catalog
     ↓
compile at build time
     ↓
production JS
```

官方明确说明：development 可以保留 source/default messages 和 message compiler，而 production 会去掉它们，依赖预编译 catalog；当前语言的 catalog 可以动态 import，只下载当前 locale。

而 Lingui macro 的生产转换甚至明确会把：

```ts
{
  id: '...',
  message: 'Source message',
  comment: '...'
}
```

变成：

```ts
{
  id: '...'
}
```

`message`、comment、context 都从 production JS 去掉。

这恰好就是 Qualy 现在想自己解决的问题。

更巧的是，你现在：

```text
Vite 8.2
Lingui 6.6
@vitejs/plugin-react
```

而 Lingui 6 官方已经专门给 Vite 8 / Rolldown 提供了 `@lingui/vite-plugin` + transformer 的方案。

所以我不建议自己发明一套 Angular `$localize`。

---

# 我会怎么重构 Qualy

有一个重要原则：

**把“源码默认文案”、“目标语言翻译”、“wire fallback”三个概念彻底分开。**

现在它们有点缠在一起了。

源码层：

```ts
id: 'assessment/entry/submit'
source message: 'Submit for review'
```

这是开发者 authoring source。

翻译层：

```text
zh-CN
assessment/entry/submit
→ 提交审核
```

这是 localization catalog。

wire 层：

```ts
UiText {
  id,
  defaultMessage
}
```

这是服务端无法决定用户语言时携带的 emergency fallback。

第三个我会完整保留。

也就是说：

```ts
MessageRef {
  kind: 'message'
  id: string
  defaultMessage: string
}
```

继续存在。

但：

```ts
client/i18n.ts
```

里所有静态 UI 文案，不再依赖 `defaultMessage` 常驻 production bundle。

---

我会按下面这个顺序做：

1. 把当前 `fallbackLocale = 'en-US'` 的概念改成 `sourceLocale = 'en-US'`。`defaultMessage` 本身并不意味着英文；只是 Qualy 当前规定 source messages 用 en-US 写。

2. 引入 Lingui 正常的 build pipeline：`@lingui/cli` + `@lingui/vite-plugin`。catalog 在构建时编译，production 删除 `compileMessage`，浏览器不再现场 parse ICU。Lingui 官方的生产模型就是如此。

3. 浏览器静态文案逐步从巨大 `assessmentMessages` / `authMessages` 中移出来，靠近真正使用它的 feature。这里我甚至更想用 Lingui 的 `msg()`/`defineMessage()` macro 并保留 Qualy 的显式 message id，例如：
   ```ts
   const submit = msg({
     id: 'assessment/entry/submit',
     message: 'Submit for review',
   })
   ```
   production 里最终只留下 id。

4. `UiText`、plugin descriptor、permissions、navigation 这些跨边界消息继续用 Qualy 自己的 `message(id, defaultMessage)`。它们不能被粗暴改成只有 id。现有 catalog gate 可以扩展为把这些 descriptor contribution 也纳入 extraction/completeness。

5. 第一版先只做“一 locale 一 compiled catalog”，不要立刻拆。也就是中文仍然可能是一份大约几十 KB 的 catalog，但已经去掉启动 JS 里那批重复 source messages，也去掉 runtime ICU compiler。然后重新测 Lighthouse。

6. 只有如果此时 `zh-CN` catalog 仍然是明显 LCP 成本，再做 `shell + feature` splitting。优先只拆 `auth` 和 `assessment/core` 两个巨型域，而不是全项目机械拆。

7. catalogue load failure 改成：
   ```text
   zh-CN compiled catalog 加载失败
       ↓
   尝试 sourceLocale=en-US compiled catalog
       ↓
   仍失败
       ↓
   bootstrap recovery
   ```
   而不是今天的 `activate({})` 后要求整个 production JS 永久携带所有 defaultMessage。

这一套改动比 full locale variant 的结构风险小很多，却已经能吃掉最主要的冗余。

---

## 那 `zh-CN.ts` 还要不要存在？

这里我的答案比较明确：

**翻译仍然应该和 source message 分开维护。不要改成这样：**

```ts
{
  id: 'assessment/entry/submit',
  defaultMessage: 'Submit for review',
  translations: {
    'zh-CN': '提交审核',
    'en-US': 'Submit for review',
  },
}
```

两种语言时看着非常舒服，但长期并不好。

FormatJS 的生产实践同样明确推荐：source/default message 靠近使用位置，因为这样上下文最完整、随着代码一起生灭；目标语言则属于 catalog。

原因也很现实：

```text
组件逻辑
+
source copy
+
中文
+
以后日文
+
韩文
+
翻译备注
```

全写进 TypeScript，很快会让业务源码变成翻译数据库。

并且会失去：

- 翻译 diff 的独立性；
- TMS 兼容性；
- 翻译人员不碰业务源码；
- 批量检查缺失翻译；
- locale-specific review；
- 将来增加语言时不修改每个业务源文件。

所以应该是：

```text
业务源码：
Source message

翻译资源：
zh-CN translation
```

而不是所有语言共置。

---

## 但是当前巨型 `client/i18n.ts` 我确实会拆掉

这一点和 `zh-CN.ts` 是否独立是两回事。

当前 Assessment：

```ts
import { assessmentMessages as m } from '../i18n.ts'
```

被：

```text
entry/*
review/*
record/*
roster/*
batch/*
items/*
access/*
```

到处引用。

这就导致任何 Assessment 页面都对整个 `assessmentMessages` 对象建立依赖。

这才是很不利于 tree-shaking/code splitting 的结构。

更理想的是：

```text
client/
  entry/
    MyEntriesPage.tsx
    messages.ts

  review/
    ReviewInboxPage.tsx
    messages.ts

  record/
    ...
    messages.ts

  batch/
    ...
    messages.ts
```

甚至更进一步，简单消息直接和使用处 colocate：

```ts
const submit = msg({
  id: 'assessment/entry/submit',
  message: 'Submit for review',
})
```

而不是再维护一个 4000 行的 `i18n.ts`。

**应该拆 source declaration；不是把每种翻译也塞进这些 declaration。**

这两个方向千万别搞反。

---

## `zh-CN.ts` 本身甚至可以不再手写 TS

如果我们这次真的切到 Lingui 标准生产链，我会考虑顺便从：

```text
locales/zh-CN.ts
```

迁成：

```text
locales/zh-CN/messages.po
```

Lingui 官方默认、推荐的 catalog 格式就是 PO，也支持其他格式和自定义 formatter。

例如概念上：

```po
msgid "assessment/entry/submit"
msgstr "提交审核"
```

source message 和 translator comment 也能留在 catalog metadata。

不过这一点不是性能必须项。

如果你很喜欢现在 TS catalog：

```ts
export default {
  'assessment/entry/submit': '提交审核',
} satisfies ...
```

也可以先保留。

我不会为了“标准化”而增加一次大迁移。

真正重要的是：

```text
raw catalog 不再直接发给浏览器
↓
build-time compile
↓
production compiled catalog
```

文件源格式 `.po` / `.ts` 本身不是性能核心。

---

## 是否有比 Lingui 更贴近你最初想法的库？

有一个值得提：**Paraglide JS**。

它是 compiler-based i18n，会把消息编译成 tree-shakable functions。它甚至明确表示在 locale 数量不多时，把多个 locale 跟随“实际使用的消息”tree-shake，可能比整包 lazy locale 更省；lazy locale splitting 反而主要针对大量语言。

它的模型很接近：

```text
MyEntries chunk
├─ 这个页面使用的 message A
│  ├─ zh
│  └─ en
├─ message B
│  ├─ zh
│  └─ en
└─ ...
```

这和你刚才那个设想其实很接近，而且不需要切语言 reload。

如果 Qualy 是一个普通 Vite React 应用，我会认真考虑 Paraglide。

但 Qualy 不是普通应用。

你有：

```text
server → UiText id → browser dynamic lookup

open-world plugins

permission/navigation/login driver descriptors

plugin-owned error translation registry
```

Paraglide 最擅长的是：

```text
源码里静态知道我要 m.someMessage()
```

而 Qualy 很多地方是：

```ts
formatText(serverReturnedUiText)
```

只有运行时才知道 message id。

这种 dynamic lookup 和 per-message tree-shaking 天生有冲突：如果 id 任意动态，bundler 就不能证明哪些 message 永远不用。

最终大概率会变成：

```text
Paraglide 管组件静态文案
+
另一套 dictionary 管 UiText
```

我认为为了省几十 KB 引入两套模型不值得。

所以我不会迁 Paraglide。

---

## 最终我会选的方案

我现在给 Qualy 的架构裁决是：

```text
Authoring
────────────────────────────

React / feature code
    ↓
source message 与使用处共置
显式稳定 Qualy message id

Plugin descriptor / server boundary
    ↓
UiText(id, defaultMessage)


Translation source
────────────────────────────

独立 zh-CN catalog
source locale = en-US


Build
────────────────────────────

Lingui extract / Qualy descriptor collector
        ↓
完整性、namespace、ICU 参数检查
        ↓
Lingui compile
        ↓
production compiled catalogs

source/default text 从静态 browser JS 中剥离
runtime ICU compiler 不进入 production


Runtime
────────────────────────────

bootstrapMessages
        ↓
load current locale compiled catalog
        ↓
activate
        ↓
App

catalog 失败
→ load en-US source catalog
→ 双失败才进入 bootstrap recovery
```

然后第二阶段才是：

```text
global catalog
        ↓ 实测仍偏大
shell + feature catalogs
```

而不是直接做：

```text
zh-CN whole application build
en-US whole application build
```

也不是：

```text
每条 i18n 定义同时放中英文
```

我认为这是目前**性能收益、Qualy 插件架构、可靠性、代码可维护性和成熟工具链之间最好的平衡点**。

尤其值得先做的验证很简单：**把 production source messages strip + catalog 预编译做出来，但暂时不拆那 54.7 KB catalog。** 然后再跑你现有四页面 Lighthouse。很可能仅这一刀就已经让继续做复杂 catalog splitting 的收益变得不值得。

messages.po我同意，既然用Lingui就用完整，不要就用一半弄的四不像。还得麻烦你再认真帮我搜集一下信息，看看Qualy最终应该怎么定整个i18n框架，不用考虑代码工作量，就考虑怎么写最适合Qualy、未来最有发展。以及再考量一下是否要接入Paraglide。注意i18n文件、框架等重写均可，你要考虑哪个方向是最先进、最有先见之明的。

我重新把 Qualy 当前代码、Lingui 6.6、Paraglide/inlang 2.x、Vite 8，以及 Unicode MessageFormat 2 的现状放在一起看了一遍。结论可以定得比前面更明确：

**Qualy 最终应继续选择 Lingui，但要从现在的“只拿 `@lingui/core` 当格式化器”升级为完整的 Lingui 工具链。Paraglide 不作为运行时引入。**

准确地说，最终架构应该是：

> **Lingui 负责应用 i18n；PO 是翻译源文件；Lingui macro + extractor + compiler + Vite plugin 负责构建；Qualy 只保留一层很薄的插件发现、`UiText` 协议和 catalog 按需装配能力。**

这和现在会有很大区别。

### 为什么我最终不选 Paraglide

Paraglide 很先进，它最吸引人的地方确实也是你刚才那个设想：它是 compiler-first，消息被编译成可 tree-shake 的函数，页面没引用的消息就不会进入 bundle。它自己的文档也把这一点作为核心优势。

但它和 Qualy 有一个根本冲突。

Qualy 不只是：

```ts
m.save()
m.delete()
```

这种编译时确定消息。

你还有大量：

```text
服务端/plugin descriptor
        ↓
Manifest / permission / login-driver / UiText
        ↓
浏览器运行时收到一个 message id
        ↓
查询当前语言
```

也就是当前的：

```ts
formatText(text: UiText)
```

这是一个真正的 runtime dynamic lookup。

Paraglide 最强的 tree-shaking 恰恰依赖：

```ts
m.some_message()
```

在构建时能看到具体函数。如果改成动态：

```ts
m[id]()
```

或者自己建：

```ts
const messages = {
  a: m.a,
  b: m.b,
  c: m.c,
  ...
}
```

这一部分消息就重新全部变成 reachable，tree-shaking 的优势会明显下降。

理论上我们可以：

```text
Paraglide
→ 组件内静态文案

另一套 dictionary
→ UiText 动态文案
```

但我非常不建议 Qualy 最终形成两个 i18n runtime。

更关键的是，Paraglide 官方当前仍说明：默认模式是**一个被使用的 message function 内包含所有 locales**；per-locale lazy splitting 目前仍属于 experimental。它认为 locale 少于约 20 个时这样通常更划算。它的 React component interpolation 目前也仍标成不支持。

这对于只有中英两种语言的普通 SPA 很有吸引力，但对 Qualy 这种：

```text
动态 UiText
+ 插件化
+ 第三方 dist-only plugin
+ 未来可能增加语言
+ rich text
```

并不是最佳契合。

而且如果选 Paraglide，你基本也就不再走 Lingui/PO 这条路了。inlang 当前主推自己的 JSON message format，其数据模型和语法受到 MF2 启发，但并不是“已经直接采用 Unicode MF2”。 当前 inlang 官方插件目录里也没有成熟的 Gettext/PO 插件。

所以我不会为了 compiler/tree-shaking 这一个优势，让 Qualy 换到一个对动态 message id 没那么自然的体系。

---

## Lingui 则和 Qualy 的模型天然吻合

Lingui 的正常生产方式其实正是你现在缺的东西：

```text
source message
    ↓
extract
    ↓
.po
    ↓
compile
    ↓
production catalog
```

PO 是 Lingui 默认且推荐的 catalog 格式；PO 只是开发/翻译源文件，**生产环境根本不会解析 PO**，它会被编译成 JS catalog。

更关键的是，Lingui production macro 会把：

```ts
{
  id,
  message,
  comment,
  context,
}
```

变成近似：

```ts
{
  id,
}
```

`message`、comment、context 都不会继续塞进 production JS。

而且 Lingui 官方明确推荐 production：

```text
只 dynamic import 当前 locale catalog
```

source locale 也应该拥有自己的 compiled catalog，因为 production source messages 已经被剥离。

这几乎正中 Qualy 现在的问题。

你现在实际上是自己绕过了 Lingui 的 production pipeline：

```ts
setupI18n()
setMessagesCompiler(compileMessage)
```

然后手工：

```text
i18n.ts
zh-CN.ts
```

把 raw ICU 发到浏览器现场编译。

这才是现在看起来有点“Lingui 但又不像 Lingui”的原因。

---

# 我建议最终把 Qualy 的消息分成三种

这是我认为整个重构中最关键的设计。

| 类型 | 例子 | ID | 来源 |
|---|---|---|---|
| 本地 UI 文案 | 保存、申诉、删除确认 | Lingui generated ID | `t` / `Trans` / `msg` macro |
| 协议文案 | navigation、permission、manifest `UiText` | Qualy stable namespaced ID | `message(id, fallback)` |
| 业务数据 | 组织名、人员名、租户配置值 | 无 i18n ID | `literal(value)` |

也就是说，现在所有东西都必须写：

```ts
assessmentMessages.save
assessmentMessages.delete
assessmentMessages.xxx
```

这种模式应该消失。

普通组件应该变成真正的 Lingui 写法。

例如：

```tsx
import { useLingui } from '@lingui/react/macro'

function EntryActions() {
  const { t } = useLingui()

  return <Button>{t`Save`}</Button>
}
```

或者：

```tsx
<Trans>Submit for review</Trans>
```

需要以后使用的 descriptor：

```ts
const saved = msg`Draft saved`
```

Lingui 自动生成 ID。

这类消息**完全没必要拥有**：

```text
assessment/entry/save
assessment/entry/saved
```

这种人工 key。

人工 semantic key 有一个隐藏缺点：英文 source copy 改了以后，ID 仍然一样，很容易让旧翻译继续存活而没人注意。

generated ID + gettext 的模型反而很合理：

```text
Source message 改变
→ message identity 改变
→ translation 重新进入待确认状态
```

而 `"Save"` 在两个上下文含义不同，可以使用 Lingui `context`。这正是 gettext/msgctxt 和 Lingui context 存在的原因。

---

## 但是 `UiText` 的 ID 不能这么搞

这一类：

```ts
message(
  'assessment/navigation/batches',
  'Assessment rounds'
)
```

必须继续拥有稳定、可序列化、可由服务器发送的 ID。

因为这是一个**协议地址**，不是普通 UI copy。

所以：

```ts
MessageRef {
  kind: 'message'
  id: 'assessment/navigation/batches'
  defaultMessage: 'Assessment rounds'
}
```

继续保留。

这也意味着 Qualy 的：

```text
namespaced message id ownership
```

最终只约束**协议消息**，不再约束所有组件内部文案。

我认为这个边界比现在清晰很多：

```text
Lingui message ID
= localization implementation detail

Qualy UiText ID
= cross-plugin / wire protocol identity
```

不要继续把两者混成一个概念。

---

## 这样还能避开 Lingui PO 的一个现实问题

Lingui 当前对大量 explicit ID 写入 PO 的处理并不算完美。Lingui 自己目前还有一个开放 issue，讨论 explicit IDs 在 PO 中为了兼容 Gettext/TMS 所采用的表示方式比较别扭。

Qualy 现在几千条消息全部都是 explicit semantic ID：

```text
assessment/entry/...
auth/person/...
...
```

如果原样搬过去，就会大量撞上这个问题。

而我上面这套模型中：

```text
90%+ 普通 UI message
→ generated ID / 标准 Lingui PO

少量真正跨 wire 的 message
→ explicit namespaced ID
```

恰好把这个问题压缩到了很小的范围。

这是我觉得比“所有消息继续显式 id”更适合未来的一点。

---

# `client/i18n.ts` 和 `zh-CN.ts` 最终都应该基本消失

尤其是现在 `assessment/core/src/client/i18n.ts` 这种几千行文件。

它让所有这些东西：

```text
entry/*
review/*
record/*
batch/*
items/*
roster/*
```

全部：

```ts
import { assessmentMessages as m } from '../i18n.ts'
```

这是很典型的 anti-code-splitting 结构。

最终应该变成：

```text
entry/MyEntriesPage.tsx
entry/AppealDialog.tsx
review/ReviewInboxPage.tsx
...
```

消息直接和使用代码共置。

如果三四个组件确实共享一组语义消息，再有：

```text
entry/messages.ts
```

而不是：

```text
整个 assessment 一个 messages.ts
```

目标语言则放 PO。

例如：

```text
packages/plugins/assessment/core/
  src/
    client/
      entry/
      review/
      record/
      ...

  locales/
    en-US/
      ...
    zh-CN/
      ...
```

其中：

```text
zh-CN.ts
```

彻底删除。

---

# PO 应该怎么分，我不建议“一整个 Qualy 一个 messages.po”

这里还必须服从 Qualy 的插件架构。

你当前最重要的纪律之一就是：

> composition root 不能枚举可选业务插件。

所以不能在根目录写一个巨大的：

```js
catalogs: [
  assessment,
  auth,
  formula,
  org,
  ...
]
```

那等于又造了一张插件清单。

我认为正确模型应该是：

```text
每个 plugin 自己拥有 localization source

assembly/build collector
    ↓
发现 active plugins
    ↓
发现它们的 catalog
    ↓
生成当前 Qualy build 的 runtime catalog loaders
```

也就是继续利用现在：

```ts
Ui.i18n('./client/i18n')
```

这一条插件发现机制，只是其职责会变化。

它不再导出：

```ts
messages
errorMessages
locales: {
  zh-CN: () => import('./locales/zh-CN.ts')
}
```

而是声明：

```text
这个 plugin 有哪些 compiled catalog groups
这些 group 对应哪些 surface / capability
```

第一方 workspace plugin 在最终 Qualy build 期间由 Lingui/Vite 编译 `.po`。

以后 npm 第三方 plugin 则：

```text
自己 extraction
自己维护 PO
发布 package 时携带 catalog source/manifest

Qualy assembly
→ 编译它的 catalog
```

这样 host 永远不需要知道：

```text
@qualy/plugin-assessment
@foo/plugin-bar
```

具体是谁。

这和 Qualy 现有 open-world architecture 是一致的。

---

# 我还会进一步引入 Catalog Group，但不是一上来几十个

当前最差的是：

```text
所有 active plugin
→ 全量 zh-CN 54.7 KB
→ App 才启动
```

最终 `I18nProvider` 不应该再：

```ts
Promise.all(allPluginCatalogs)
```

它应该支持增量：

```ts
ensureCatalog(group)
```

Lingui 的：

```ts
i18n.load(locale, messages)
```

本来就允许继续 merge message。

所以最终 runtime 应该是：

```text
bootstrap
    ↓
small shell catalog
    ↓
manifest
    ↓
知道当前 layout/page
    ↓
并行：
    page JS
    layout JS
    relevant catalog groups
    ↓
render
```

对于 Assessment，可以自然形成：

```text
assessment-shell
assessment-entry
assessment-review
assessment-admin
assessment-record
```

Auth 可能是：

```text
auth-public
auth-account
auth-admin
```

小插件完全没必要拆，一个 group 即可。

不要按组件拆。

不要按每个 route 拆。

**catalog group 应该对应稳定的 lazy feature boundary。**

这样未来 MyEntries 页面可能只付：

```text
shell 8 KB
+
entry 8 KB
```

而不是全系统 55 KB。

并且你刚做的：

> 当前 page 和 layout 提前 preload

正好可以升级成：

> page + layout + locale group 一起 preload。

---

# bootstrapMessages 也不应该继续成为第二套人工翻译体系

这是前面我们没提到，但如果要“完整 Lingui”，我会顺手解决。

现在：

```ts
bootstrapMessages = {
  'zh-CN': {...},
  'en-US': {...}
}
```

存在的理由完全正确：

> Lingui catalog 都还没加载时，Loading / ReleaseRecovery / fatal boot error 已经要显示文字。

但是翻译源不需要手写两遍。

可以：

```text
bootstrap source messages
        ↓
Lingui extract
        ↓
PO
        ↓ build
抽取 bootstrap/* 那十几条
        ↓
内联到 index boot script
```

最终 HTML 中仍然可能存在：

```js
{
  "zh-CN": {...},
  "en-US": {...}
}
```

但它是**构建产物**。

翻译源仍然只有 PO。

这很重要：

> Qualy 最终应该只有一个 translation source of truth。

---

# 错误体系也应该一起改

现在：

```ts
errorMessages = {
  ...所有插件
}
```

启动时全量静态聚合。

未来：

```text
common transport errors
→ shell

assessment entry errors
→ assessment-entry

review errors
→ assessment-review

formula errors
→ formula
```

`ErrorCode` 本身仍然是 API contract。

它映射成什么人类语言，则属于对应 feature localization。

也就是说：

```text
API error code
= protocol

error message
= localization
```

不要把整个错误文案表变成全局启动依赖。

---

# 切换语言我不建议 reload

你之前提出：

> 每个语言一套 build，切语言 reload。

如果最终采用 Lingui，就没必要承受这个 UX 代价。

Qualy 有大量：

```text
未保存表单
审核意见草稿
公式编辑
申报内容
```

语言切换刷新页面会引入脏状态问题。

更好的模型是 runtime 记录：

```text
currently loaded catalog groups
```

用户从中文切英文时：

```text
先并行下载当前已加载 groups 的 en-US catalog
        ↓
全部成功
        ↓
一次 i18n.activate('en-US')
        ↓
整个 React tree 同帧切换
```

不会出现：

```text
中文 → 一半英文 → 全英文
```

也不会丢表单。

这比完整 locale variant 更适合 Qualy。

---

# catalog 加载失败也不要再 `activate({})`

当前：

```ts
loadCatalogs(locale)
  .catch(() => activate({}))
```

之所以还能显示，是因为所有 production JS 永久携带 `defaultMessage`。

迁到完整 Lingui 后这条路应该消失。

首次启动可以：

```text
zh-CN shell catalog failed
        ↓
load en-US source catalog
        ↓
成功
→ 整个 app 使用 en-US

en-US 也失败
        ↓
bootstrap recovery screen
```

而某个后续 feature catalog 失败时：

```text
retry
↓
仍失败
↓
保持当前页面 boundary 不进入
显示 shell 中已有的“页面资源加载失败”
```

甚至提供：

> 使用 English 继续

然后原子切换整个 active application 到 source locale。

不要让：

```text
一个 dialog 英文
导航中文
表格中文
按钮 raw id
```

这种半失效状态出现。

---

# MessageFormat 2 要不要现在直接上？

这是另一个“先进”问题。

Unicode MessageFormat 2 现在已经是 stable standard，CLDR 47 已宣布 MF2 stable，Unicode 目前把它作为下一代标准，并正在进入 ICU / ECMA-402 生态。

从长期方向看，**MF2 确实是未来。**

但 Lingui 6.6 当前仍然建立在 ICU MessageFormat 1 上。我没有找到其已经正式提供 MF2 production pipeline 的证据。

Paraglide/inlang 虽然数据模型“heavily inspired by MF2”，自己的 message format 也称为受 MF2 启发，但这不是等价于直接使用 Unicode MF2。

因此我不会为了追 MF2 今天自己换 runtime。

我会通过架构来给 MF2 留路：

```text
组件
→ Lingui macros

不要大量手写 ICU1 string

Wire
→ id/default fallback
→ 不承诺 ICU1

Catalog source
→ PO

Browser
→ i18n abstraction
```

以后 Lingui/另一个成熟 compiler 正式支持 MF2 时，主要替换的是：

```text
catalog/compiler layer
```

而不是：

```text
整个 Qualy plugin contract
```

这才叫真正的 future-proof。

---

## 最终我会把 ADR 定成下面十条

1. **Runtime/framework：Lingui 6+。** 使用 `@lingui/core` + `@lingui/react`，不再自行实现半套 Lingui runtime。
2. **Build：完整 Lingui pipeline。** `@lingui/cli` + `@lingui/vite-plugin`；Qualy 当前 Vite 8/Rolldown 正好已有官方集成方式。
3. **Catalog source：PO。** `.po` 是唯一正式翻译源，compiled JS 不进 Git。
4. **Source locale：`en-US`；默认产品 locale：`zh-CN`。** 两个概念严格分开。
5. **普通客户端文案使用 Lingui macro + generated ID。** `t`、`Trans`、`msg`，消息和使用处共置；删除巨型 `assessmentMessages`/`authMessages`。
6. **只有跨 wire/plugin boundary 的文案拥有 Qualy explicit namespaced ID。** `UiText` 和 `literal()` 模型继续保留。
7. **插件自己拥有 catalog；root 不枚举插件。** Qualy build collector 根据 assembly 自动发现、检查并生成 catalog loader。
8. **Catalog 按稳定 feature boundary 增量加载。** shell → 当前 page/layout feature；不再启动时下载全部 active plugins。
9. **切换 locale 原子完成，不 reload。** 先加载当前 active groups 的新语言，再 activate。
10. **MF2 作为明确的未来迁移目标，但今天不自行实现。** 业务代码尽量只使用宏/Intl，不扩散 ICU1 语法。

这是我现在认为对 Qualy 最合适的终局。

Paraglide 的很多思想——**compiler first、tree shaking、messages 靠近使用处**——我反而建议吸收；但不需要因此采用 Paraglide runtime。对 Qualy 来说，**“完整 Lingui + Qualy 的动态协议适配 + feature catalog loading”能保留 Paraglide 最有价值的性能思想，同时避免它与 server-driven `UiText`、插件系统和 PO 工作流之间的结构冲突。**

我先看一下 Qualy 当前 i18n 相关代码的实际形态，再核对 Lingui 和 Paraglide 的最新状况，然后给出判断。我的结论和前面几轮讨论不一样：**Qualy 应该换到 Paraglide，不要升级成完整 Lingui。** 前面否掉 Paraglide 的主要理由是动态 UiText，这次按源码数了一下，这个理由被高估了。

## 改变判断的几个数字

- 客户端静态 descriptor 大约 **4216 条**。
- 走 wire 的动态 `message(id, default)` 大约 **224 条**，分布在 permissions.ts、actions.ts、manifest 贡献里，约占 5%。
- 除了这两类，仓库里还有两套手写的双语系统：`bootstrapMessages`，以及 `auth/server/mail-copy.ts`。后者是服务端邮件文案，用 `Record<'zh-CN' | 'en', ...>` 硬写。
- `defineMessage<Values>()` 靠 phantom type 声明 ICU 参数，再用测试证明字符串和类型一致。这相当于在手工维护一个编译器本该生成的东西。

也就是说，95% 的文案是静态引用，恰好是编译型 i18n 最擅长的场景。动态查询只占 5%，而且范围有界，完全可以单独处理，犯不上为它决定整个框架。

## 为什么 Paraglide 更适合 Qualy

**1. 翻译和用到它的代码在同一个 chunk 里，语言包这个概念就没了。**\
&#x20;Paraglide 把每条消息编译成函数，打包器按 import 图决定它进哪个 chunk。于是前面讨论的难题都自然消失了：

- shell 和 feature 各分哪几组 catalog，不用人工设计，打包器自己算。
- 不再有“所有 catalog 到齐才 activate”这道异步门槛，也没有加载瀑布，不用把 locale 和 page 一起 preload。
- **不再有“语言包加载失败”这种故障。** 翻译和代码原子地一起到，chunk 真失败了，由现有的 asset recovery 接管。

你之前关心的 defaultMessage 语义问题也就不存在了。缺译回退变成编译期行为：某个 locale 缺了翻译，就按 baseLocale 回退，运行时没有任何成本。CI 用 lint 挡住缺译。defaultMessage 原本的职责是“加载失败时别显示空白”，而这个失败路径本身不存在了。

**2. 两种语言正好是它的舒适区。**\
&#x20;每个用到的消息会同时带上中英文两份。和“按组拆、只加载当前语言的 catalog”相比，字节数差不多，但拆分是精确到消息的，不靠人工分组。以后如果真想要你当初设想的“每种语言一套构建”，Paraglide 已经有 `experimentalStaticLocale`，那会是一个编译开关，不需要重做架构。

**3. 三套系统合成一套。**\
&#x20;Paraglide 的消息函数在 Node 里同样能用，写法是 `m.x(inputs, { locale })`。这样 mail-copy、bootstrapMessages（连同维护页）、客户端文案可以共用同一份源。bootstrap 只 import 那十几个函数，靠 tree-shaking 进入 boot script。

**4. 参数类型由消息源自动生成。**\
&#x20;`defineMessage<Values>` 和配套的一致性测试都可以删掉，比现在更严格。

## 动态 UiText 怎么处理

wire 协议保持不变，还是 `{ kind, id, defaultMessage }`。原因有两个：插件版本错位时它需要自描述，服务端的 `plainText` 也要用它。

在构建期，Qualy 的 collector 本来就能枚举所有插件贡献的 message，那就顺手生成一张 **wire 索引**：
```ts
// 生成物，进 shell chunk
export const wire = {
  'assessment/navigation/batches': m.assessment_navigation_batches,
  ...
}

```

这张表只有两百多条，两种语言加起来也就几 KB。它不是第二套 i18n，而是协议表：函数还是同一批，只是给动态子集建了个索引。服务端声明时写 `message(m.xxx)`，由 helper 生成 `{ id, defaultMessage: baseLocale 渲染结果 }`，这样 id 和默认文案不会再手写两遍。

## 插件体系怎么接

要避免每个插件各自编译出一份 runtime、各自持有 locale 状态。我建议这样做：

- 插件把消息当**数据**发布：`messages/zh-CN.json`、`messages/en-US.json`，放在插件自己的 namespace 下。
- **assembly 构建时统一编译**成一个生成包，只有一个 runtime、一个 locale 状态。插件代码从类似 `@qualy/messages/assessment` 的路径 import，由 assembly 解析。
- dist-only 的第三方插件同样只带消息数据加代码，宿主替它编译。

这和 Qualy 现在“assembly 发现插件并生成 virtual module”的纪律是一致的，composition root 依然不需要枚举插件。

错误翻译也要跟着改。现在 `errorMessages` 在启动时全局聚合，改成跟随调用它的 feature 模块。通用的 transport 和认证错误留在 shell。

## 需要正视的代价

- **ICU 迁移**：4216 条里有大量嵌套的 select 加 plural。inlang 有 ICU MessageFormat v1 插件，支持 plural、select、selectordinal、offset 和 `#`，但文档没有明确说支持嵌套。我建议直接迁到 inlang 原生格式，也就是 variants 和 matchers，它的设计参照了 MF2，长期看更贴近标准。迁移时做差分测试：同一组参数下，旧 Lingui 输出和新函数输出必须逐条一致。
- **富文本**：Paraglide 2 已经有 `message.parts()`，但没有官方的 React 渲染器，需要自己写一个很薄的 `<Msg>` 组件。
- **切换语言**：消息函数在调用时读 `getLocale()`，不会主动订阅变化。我建议直接 reload，走现有的 leave guard，这样最正确：Intl 格式器缓存、memo 组件都不会漏更新。这也和将来的 static locale 构建一致。
- **PO**：换到 Paraglide 就不用 PO 了。PO 的价值在 TMS 和专业译员流程上，Qualy 目前两者都没有。而且 Lingui 自己在“显式语义 ID 写进 PO”这件事上也还有未解决的 issue。真需要的话，有第三方的 PO 格式插件。
- **成熟度**：Paraglide 1.x 到 2.x 是一次大迁移，API 有变动的历史。好在消息源是纯数据，编译产物是普通 JS，锁定版本就能控制风险。

## Lingui 在什么情况下仍然更好

语言数上到 10 种以上、有专业译员和 TMS、需要不重新构建就能在运行时覆盖文案（比如各校自定义术语），或者 JSX 富文本非常重。另外，Lingui 6 的发布说明里既没有 MF2 支持，也没有 lazy catalog 相关的新能力，所以“完整 Lingui”最后还是得自己设计 catalog 分组和加载生命周期，这是运行时基础设施，很难写对。Paraglide 需要补的是 assembly 编译、wire 索引和 parts 渲染器，都是构建期、确定性的东西，更容易验证。

## 建议的 PoC 和止损线

1. 拿 `layout-default`、`auth` 加上 `assessment/entry` 这一小片，用 Paraglide 跑通 assembly 编译、wire 索引、`<Msg>` 和 reload 切换。
2. 写一个 ICU 转换脚本，对这一片做差分测试，验证嵌套 select/plural 能被完整转换。
3. 在登录页和“我的申报”页对比 boot graph 的 Brotli 字节数和冷启动 LCP 中位数。
4. 止损条件：如果嵌套 ICU 无法无损转换，或者 parts 渲染撑不住现有的富文本用法，就回退到完整 Lingui 加 shell/feature catalog 的方案。

如果要把这份结论整理成一份 ADR 给 Claude Code 执行，我可以直接写成文档。

Sources:

- [Announcing Lingui 6.0](https://lingui.dev/blog/2026/04/22/announcing-lingui-6.0)
- [Lingui Vite Plugin](https://lingui.dev/ref/vite-plugin)
- [Paraglide JS Compiler Options](https://paraglidejs.com/compiler-options)
- [Paraglide JS CHANGELOG](https://raw.githubusercontent.com/opral/paraglide-js/refs/heads/main/CHANGELOG.md)
- [inlang ICU MessageFormat v1 Plugin](https://inlang.com/m/p7c8m1d2/plugin-inlang-icu-messageformat-1)
- [@globalize-now/paraglidejs-po-format](https://www.npmjs.com/package/@globalize-now/paraglidejs-po-format)



---



上面是一份审计报告。结合Qualy源码认真思考，到底怎么用更合适，你是否同意他的观点。

我这次会改判：**我同意这份审计报告的核心结论——如果不考虑迁移工作量，只考虑 Qualy 的长期架构、性能和未来扩展，Paraglide JS 比“完整 Lingui”更适合作为最终 i18n 方案。**

但我不会原样照这份报告实施。它把方向判断对了，但有几处已经过时或低估了工程约束。尤其是第三方插件的消息编译方式、wire 动态消息的 tree-shaking 边界，以及 ICU/native format 的选择，需要重新定。

我先把结论说清楚：

> **Qualy 最终 i18n：Paraglide JS 2 + inlang project + message-modules production build + Qualy assembly-aware message compiler。**
>
> 普通 UI 文案编译为 tree-shakable message functions；动态 `UiText` 保留 Qualy wire protocol，通过构建生成的有限索引调用同一批 message functions；邮件、bootstrap、浏览器 UI 使用同一消息源。
>
> 不再保留 Lingui runtime、全量 locale catalog、`client/i18n.ts` 巨型 descriptor 表、`defineMessage<Values>()` phantom 类型和浏览器 ICU compiler。

这是我现在会写进 ADR 的最终方向。

---

### 为什么这次我认为审计报告抓到了真正的决定因素

我重新看了现在的代码，尤其是：

```text
packages/web/i18n/src/index.tsx
packages/contracts/i18n/src/index.ts
packages/build/web/src/collect.ts

packages/plugins/base/auth/src/client/i18n.ts
packages/plugins/assessment/core/src/client/i18n.ts
```

当前最大的问题不是 Lingui 本身，也不只是那个 54.7 KB Brotli 的中文 catalog。

而是现在的依赖图实际上长这样：

```text
BatchListPage ──────┐
MyEntriesPage ──────┤
ReviewPage ─────────┤
RecordPage ─────────┤
Admin pages ────────┼──> assessment/core/client/i18n.ts
                    │       ↓
                    │    数千条 MessageDescriptor
                    │    数千个 defaultMessage
                    │
                    └────────────────────────────

virtual:qualy/plugins
    ↓
静态 import 每个 plugin i18n
    ↓
所有 descriptor/error registry 进入启动图

同时：

I18nProvider
    ↓
Promise.all(所有 active plugin 当前 locale)
    ↓
54.7 KB zh-CN 全量 catalog
    ↓
整个 App 才 activate
```

这正好是 Paraglide 的 compiler-first/message-level tree-shaking 最擅长解决的问题。

Paraglide production 默认的 `message-modules` 就是**每条 message 独立模块，以便 bundler tree-shake**；官方明确推荐 development 用 `locale-modules`、production 用 `message-modules`。

所以如果：

```ts
MyEntriesPage
```

只引用 40 条消息，就只有这 40 条消息进入它所在的依赖图。整个 `assessment` 有 2000 条还是 10000 条，理论上都不应该直接影响这个页面。

这比我们人为设计：

```text
assessment-entry catalog
assessment-review catalog
assessment-admin catalog
```

还进一步。

人工 catalog grouping 本质是在近似代码依赖图，而 Paraglide直接让 bundler 使用真实代码依赖图。

这一点让我认为它对 Qualy 很有优势。

---

## 但审计报告有四处我会修正

第一处是富文本。

报告说：

> Paraglide 有 `message.parts()`，但没有官方 React renderer。

这个已经过时了。

当前已经有官方：

```text
@inlang/paraglide-js-react
```

以及：

```tsx
<ParaglideMessage
  message={m.xxx}
  markup={{
    link: ...,
    strong: ...,
  }}
/>
```

而且 message markup renderer 是类型安全的，`message.parts()` 是底层 API。

所以富文本现在已经不构成迁移阻碍。

第二处是 ICU migration 的风险没有报告里那么大。

inlang 今年已经提供正式 ICU MessageFormat v1 storage plugin，官方声称支持：

- `plural`
- `select`
- `selectordinal`
- exact match
- offset
- `#`
- number/date/time formatter

并且称为 full-fidelity mapping 到 inlang data model。

这意味着 Qualy 不需要自己先写一个 ICU parser。

但我仍然支持做 differential test：

```text
old Lingui result
vs
new Paraglide result
```

因为 Qualy 的消息确实有不少复杂 nested select/plural。

第三处，报告说：

> 以后想每 locale 一套 build，有 experimentalStaticLocale。

有这个能力，但**现在不能把它当架构依据**。

官方目前仍明确标记：

```text
experimentalStaticLocale
```

为 experimental；middleware locale splitting 甚至明确说不要依赖它做 production。

所以 Qualy 第一版应该完全按照 Paraglide 当前稳定的：

```text
message-modules
```

模式设计。

以后它稳定了，是额外优化，不是架构前提。

第四处，也是我认为报告最大的遗漏：

> “插件带 JSON，assembly 统一编译”这个方向是对的，但远比报告写得复杂。

因为当前 Paraglide 自己对“多个 namespace / 多个独立 message file → 独立 ES import namespace”的能力仍然有开放 issue。

而 Qualy 恰恰是 open-world plugin system。

所以不能简单搞一个：

```text
messages/en-US.json
messages/zh-CN.json
```

然后认为插件问题解决了。

这一层必须由 Qualy 自己设计。

---

# 我会怎么做 Qualy × Paraglide

这里我认为可以设计得非常漂亮。

最终不是：

```text
plugin 自己编译 Paraglide
```

因为那样会产生：

```text
plugin-auth runtime
plugin-org runtime
plugin-assessment runtime
...
```

多个 Paraglide runtime / locale state。

这不行。

应该是：

```text
                 Qualy assembly

plugin-auth ─────────┐
plugin-org ──────────┤
plugin-assessment ───┤
plugin-formula ──────┤
third-party plugin ──┘
                     │
                     ▼
          assembly message collector
                     │
                     ▼
             one inlang project
                     │
                     ▼
          one Paraglide compilation
                     │
         ┌───────────┴────────────┐
         ▼                        ▼
  one shared runtime        message modules
```

也就是说：

> **plugin 发布消息数据，application assembly 负责编译消息代码。**

这和 Qualy 现在的插件理念其实高度一致。

现在插件已经是：

```ts
Ui.i18n('./client/i18n')
```

未来我甚至会重新定义这个 contribution。

例如概念上：

```ts
I18n.messages('./messages')
```

插件 package：

```text
@qualy/plugin-assessment
├── messages/
│   ├── en-US.json
│   └── zh-CN.json
├── src/
└── package.json
```

第三方插件也是一样。

Qualy build collector 根据 active assembly 找到这些 message source。

composition root 不枚举任何 plugin。

这一点必须守住。

---

# 我甚至会做一个 Qualy 自己的 inlang storage plugin

这是我觉得比报告里的“拼很多 JSON path”更完善的方案。

例如：

```text
@qualy/inlang-assembly-plugin
```

它不是业务 i18n runtime。

它只干一件事：

```text
读取 qualy.yml / assembly resolution
    ↓
找到每个 active plugin 的 message contribution
    ↓
将它们暴露成一个 inlang project message store
```

这样 Paraglide 看见的是：

```text
一个完整 inlang project
```

但实际数据仍然归属：

```text
plugin-auth
plugin-org
plugin-assessment
...
```

这比在根目录手工维护：

```json
"pathPattern": [
  "../../plugins/auth/messages/{locale}.json",
  "../../plugins/org/messages/{locale}.json",
  ...
]
```

强太多。

否则又重新引入了 Qualy 一直在消灭的：

> composition root 手工知道所有业务插件。

---

# 插件代码怎么 import message？

这是整个方案真正需要设计好的 ABI。

我不建议插件源码直接：

```ts
import * as m from '../../../.qualy/paraglide/messages.js'
```

那当然不行。

我会定义一个 Qualy virtual message module。

例如：

```ts
import {
  entrySave,
  entrySubmit,
  entryAppeal,
} from '@qualy/messages/assessment'
```

开发环境和正式 build：

```text
@qualy/messages/assessment
        ↓
Qualy Vite/build plugin
        ↓
re-export Paraglide-generated message functions
```

最终：

```ts
entrySubmit()
```

仍然是普通 Paraglide function。

而且必须是**named static import**。

绝对禁止：

```ts
import * as m from '@qualy/messages'

m[id]()
```

否则 tree-shaking 会被你自己毁掉。

Paraglide 自己对 dynamic message 的建议也是：

```ts
const messages = {
  greeting: m.greeting,
  goodbye: m.goodbye,
}

messages[key]()
```

也就是**先给 bundler 一个有限静态集合**。

这和 Qualy wire index 正好对应。

---

# 这份报告对 UiText 的解决方案我基本同意

这是让我改变意见的关键。

动态消息只有一个有限集合，那么完全没必要让它决定剩下 95% 的架构。

Browser build 可以生成：

```ts
const wireMessages = {
  'assessment/navigation/batches':
    assessment_navigation_batches,

  'org/navigation/tree':
    org_navigation_tree,

  // ...
}
```

于是：

```ts
formatText(text)
```

变成：

```ts
if (text.kind === 'literal') return text.value

const render = wireMessages[text.id]

return render
  ? render()
  : text.defaultMessage
```

注意它仍然只有一个 i18n system。

`wireMessages` 不是另一套 translation table。

它只是：

> **一张 message id → Paraglide function 的有限 dispatch table。**

所有实际翻译仍来自 Paraglide message source。

这个设计我完全认可。

---

## 但这个 wire 集合必须升级成 Qualy 的显式 contract

不能只是“collector 当前碰巧能扫到 224 条”。

Qualy 现在的 `catalogs.test.ts` 已经会遍历：

```text
UiSurfaceDeclarations
PermissionDeclarations
LoginDriverDeclarations
```

找 `UiText`。

未来我会把规则升级成：

> **任何可能跨 server/browser wire 出现的 message id，都必须是 declared wire message。**

然后 CI 保证：

```text
server can emit message
       ⇔
wire registry knows it
       ⇔
message source exists
       ⇔
所有 locale 都有 variant
```

这样以后第三方 plugin 不会偷偷：

```ts
return message('foo/bar', ...)
```

然后 production 才发现 browser 没有 function。

---

# defaultMessage 最终只应该留在 wire protocol

这一点报告也抓得很准。

现在：

```ts
MessageDescriptor {
  id
  defaultMessage
}
```

承担了太多责任。

Paraglide 之后，普通 React copy 根本不需要它：

```ts
m.assessment_entry_submit()
```

参数也由 compiler 自动生成 type。

所以当前：

```ts
defineMessage<{ count: number }>()({
  id,
  defaultMessage:
    '{count, plural,...}'
})
```

这一套确实应该全部消失。

你现在是：

> TypeScript phantom type 声明一遍 ICU 参数，然后测试再 parser 一遍确认它没写错。

这是明显的“compiler 没有替你干 compiler 应该干的事情”。

Paraglide 生成：

```ts
m.foo({ count: number })
```

才是更合理的模型。

但 wire：

```ts
MessageRef {
  id
  defaultMessage
}
```

仍然保留。

这时候它的定义就纯洁很多：

> `defaultMessage` 是跨版本/缺失 message function 时，协议自身携带的可读 fallback。

不再是应用主翻译机制。

---

# `message(id, default)` 也不应该再手写 default 两次

报告提到这一点，我赞成。

现在：

```ts
message(
  'assessment/navigation/batches',
  'Assessment rounds'
)
```

未来应该由 codegen 出来的 wire declaration 提供。

例如概念上：

```ts
import { wire } from '@qualy/messages/assessment/wire'

Ui.page({
  navigation: {
    label: wire.navigationBatches.ref,
  },
})
```

其中构建/插件生成阶段知道：

```text
id
baseLocale text
```

因此 `.ref` 已经是：

```ts
{
  kind: 'message',
  id: 'assessment/navigation/batches',
  defaultMessage: 'Assessment rounds'
}
```

这样：

```text
message id
base language text
translation function
```

不会出现三份人工声明。

---

# Bootstrap 也确实可以统一掉

但我不会让 browser bootstrap 直接 import Paraglide runtime。

更好的方法是：

```text
Paraglide messages
        ↓ build time
选出 bootstrap 使用的十几条
        ↓
render en-US + zh-CN
        ↓
生成小型 inline table
```

最终 HTML 还是：

```js
{
  'zh-CN': {
    loading: '加载中',
    retry: '重试',
  },
  'en-US': {
    loading: 'Loading',
    retry: 'Retry',
  },
}
```

区别是：

> **这个表不再手工维护。**

它是 build artifact。

这样在：

```text
Paraglide runtime 尚未下载
main JS 尚未下载
```

的阶段仍然能够工作。

这是 bootstrap 应该有的可靠性。

---

# 服务端邮件统一到 Paraglide，我也赞成

Paraglide message function官方支持：

```ts
m.foo(inputs, { locale: 'zh-CN' })
```

也就是可以不依赖“当前浏览器 locale”，显式给某个收件人渲染某个 locale。

这非常适合邮件。

现在：

```text
auth/server/mail-copy.ts
```

那套手写：

```ts
Record<'zh-CN' | 'en', ...>
```

就可以彻底删掉。

最终：

```text
Browser
Email
Bootstrap
CLI / export（未来）
```

全部来自同一个 localization source。

这一点是 Paraglide 方案比当前明显优雅的地方。

---

# 那消息源我到底选 ICU1 JSON 还是 inlang native format？

这里我和报告稍微有区别。

**迁移阶段用 ICU1 plugin。最终我倾向使用 inlang native format。**

原因不是因为它“就是 MF2”。

它不是。

当前官方说的是：

> syntax / data model inspired by MessageFormat 2

而不是 Unicode MF2 implementation。

所以不要在 ADR 写：

> “使用 MF2”

这是不准确的。

但作为 Paraglide 原生 source format，它有几个现实优势：

- variables；
- plural；
- arbitrary variants；
- formatter declarations；
- markup；
- generated inputs；
- Paraglide 一等公民。

例如复杂消息不再是：

```text
{why, select,
  phase {
    当前阶段「{phase}」不能
    {acts}
  }
  archived {...}
}
```

而是显式：

```text
declarations
selectors
match
```

从 compiler/data-model 角度更结构化。

而且它现在已经支持 typed markup，这也是 ICU1 storage plugin 不具备的——ICU plugin 当前明确说 tags/markup 当普通文本处理。

所以如果真的是：

> “不用考虑迁移成本，定十年后的理想形态”

我会选 native inlang format。

如果问：

> “明天开始迁，怎么风险最低”

那我会先保留 ICU1 JSON。

两者并不矛盾，因为 inlang storage layer本身就是可替换的。

---

# Locale 切换，我反而同意 Paraglide 的 reload

前几轮我倾向 Lingui 的原地 activate。

现在结合 Qualy 的实际状态，我认为 reload 更正确。

Paraglide 2 默认就是：

```ts
setLocale('en-US')
```

然后完整 document navigation / reload。

这是其明确的架构选择。官方只把：

```ts
reload: false
```

定位成很窄的 fully-client-rendered escape hatch，并明确警告不要把它当普通 reactive locale switch。

Qualy 确实是 SPA。

理论上我们可以做 reactive locale store。

但这样立刻重新出现：

```text
useMemo 有没有 locale dependency？
module-level formatted value 有没有重算？
cache 有没有重新生成？
document title 有没有更新？
非 React browser plugin 有没有更新？
```

这种问题。

语言切换本身是非常低频操作。

所以：

```text
set locale
→ leave guard
→ full reload
```

我认为可以接受。

如果页面 dirty：

> 切换语言需要重新载入页面，未保存的更改将不会保留。

确认后再切。

对于 Qualy 这种有大量复杂长表单的应用，**“不刷新但偶尔出现一小块旧语言”比“明确刷新”更糟糕。**

---

# 两语言同时进 message function，我也不担心

需要准确理解 Paraglide 的 trade-off。

默认 production `message-modules` 下，例如：

```text
entry_save/
├── index.js
├── en-US.js
└── zh-CN.js
```

当前页面引用：

```ts
entry_save()
```

那么这条消息的多个 locale implementation 会进入可达图。

所以它不是：

> 只下载当前语言。

这是 Lingui 的优势。

但它是：

> **只下载当前代码实际使用的消息。**

这是 Paraglide 的优势。

对于 Qualy 当前：

```text
2 locales
4216 total messages
强 code-splitting
大量低频 admin feature
```

我认为第二个优势明显更有价值。

登录页不需要为：

```text
公式编辑
审核工作台
行政认定
组织权限
批次配置
```

的中文或者英文支付任何字节。

这比“当前语言的 4216 条全部下载”更符合实际使用模式。

如果未来变成：

```text
20 locales
```

这个判断可能变化。

Paraglide 自己的 per-locale build 目前还在 experimental。

所以我会给 ADR 留一条：

> 当 supported locales 超过某个数量或 locale bytes 明显成为主要成本时，重新评估 `experimentalStaticLocale` 的成熟度或 runtime architecture。

但现在不要为了假想的 20 种语言牺牲当前两语言应用。

---

# 错误消息这一部分我也同意审计报告

现在：

```text
errorMessages = {
  ...auth
  ...assessment
  ...org
  ...
}
```

全局启动注册，非常不适合 Paraglide。

未来应该让：

```text
entry API module
→ entry error formatter functions

review API module
→ review error formatter functions
```

跟 feature 一起被 import。

真正全局的只有：

```text
AUTH_REQUIRED
SESSION_EXPIRED
ACCESS_DENIED
BAD_REQUEST
transport failure
```

这样 `formatApiError` 可以继续保留 Qualy 领域行为，但不再需要一个全产品 registry。

---

## 所以我对这份审计的最终判定是

核心结论：

**同意。**

甚至我现在会明确选择：

> **Paraglide，而不是 Lingui。**

理由不是“Paraglide比较新”，而是 Qualy 有几个很特殊的事实刚好与它高度吻合：

```text
两种 locale
+
绝大多数消息静态引用
+
非常强的 feature/page code splitting
+
大量低频后台功能
+
Vite/Rolldown
+
TypeScript 重度
+
plugin assembly build
```

这基本就是 compiler-first/tree-shakable i18n 的理想应用。

但我会修改报告里的实施方案：

1. 不自己造 `<Msg>`，现在已有官方 React adapter。
2. 不把 `experimentalStaticLocale` 当设计依据。
3. ICU1 plugin 用来做迁移桥梁；长期 source format 倾向 inlang native，而不是因为它“已经是 MF2”，而是因为它是 Paraglide 最完整的数据模型。
4. 最重要的是增加 **Qualy assembly-aware inlang/message compiler**，不要让每个插件各自跑一套 Paraglide。
5. plugin message import 设计成稳定 virtual ABI；生产必须保持 named static import。
6. wire UiText 变成明确的 finite registry，禁止任意 dynamic `m[id]`。
7. bootstrap 由同一消息源 build-time 导出，不把 runtime 拖进最早启动路径。
8. browser/server/mail 共用一套 message source。

我会把终局画成：

```text
                  plugin message sources
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
     auth                 org             assessment
       │                   │                   │
       └──────── Qualy assembly collector ─────┘
                           │
                           ▼
                     inlang project
                           │
                           ▼
                   Paraglide compiler
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
     message modules    shared runtime   server messages
          │                                  │
          │                              email / export
          │
    Vite/Rolldown
          │
          ├── LoginPage
          │    └── only login messages
          │
          ├── MyEntriesPage
          │    └── only entry messages
          │
          └── ReviewPage
               └── only review messages


wire UiText
    │
    ▼
generated finite dispatch table
    │
    └── references SAME Paraglide message functions
```

这比目前“所有消息先进 `i18n.ts`，所有中文再先进一个 54.7KB catalog”的模型要更符合 Qualy 自己已经形成的插件化和按 surface 分块体系。

如果现在让我做技术裁决，我会停止继续优化现有 Lingui catalog 架构，先做审计报告所说的 Paraglide PoC；不过 PoC 的核心不是只看页面跑分，而是优先证明两个最关键的不变量：**dist-only 第三方插件能否通过 assembly 参与中央编译，以及 wire finite registry 能否在不破坏 tree-shaking 的情况下完整覆盖所有 `UiText`。** 这两个成立，我就会正式选 Paraglide。

先核对对方回复里几条关键的事实声明，再回到源码看几个会影响设计的地方。对方回复的大方向（Paraglide、插件消息集中编译、切语言 reload、bootstrap 和邮件共用一份消息源、错误文案跟着 feature 走）我都同意。但回到源码逐条核对后，我认为它有一个大判断没做到底，还有三处设计会出问题。

## 一、最大的改进点：切语言既然 reload，UiText 就该在服务端渲染

对方和我上一轮都默认一件事：动态 UiText 由浏览器根据 id 查翻译，所以需要一张 wire 分发表，再加一条 CI 契约。前提一变，这件事就不成立了。

**一旦定下“切语言就 reload”，在一个文档的生命周期里语言是常量，它就成了请求的属性。** 这时协议文案最自然的渲染位置是服务端，在生成响应的那一刻渲染，而不是浏览器。

源码里有几处证据支持这么做：

- 服务端本来就需要知道语言。auth 的邮件在 8 个地方用 `mailLocaleOf(request.headers['accept-language'])` 取语言。这其实是个 bug：它读的是浏览器的语言偏好，没读用户在 Qualy 里选的 `qualy.locale`。用户把界面切成英文，收到的邮件可能还是中文。
- audit 数据库里存的是 `actionCode`，`subjectEvents` 在读的时候才从 `voices: Map<code, UiText>` 取文案。也就是说 UiText 本来就是在响应时组装的，没有被持久化。改成响应时直接渲染，没有任何历史数据问题。
- rbac 服务端在用 `plainText(permission.name)` 做搜索。它现在只能搜英文，中文用户搜“测评”是搜不到的。服务端能按请求语言渲染之后，这个问题顺带就修好了。

具体设计：
```text
boot script 解析出 locale（和现在同一条偏好链）
    → 每个 API 请求带上 x-qualy-locale
    → api-kit 在序列化响应时统一把 MessageRef 渲染成字符串
       m.xxx({}, { locale })   显式传入，不用 AsyncLocalStorage
    → 浏览器收到的就是可以直接显示的文本

```

插件仍然不决定语言，决定语言的是框架的响应边界，“plugins never pick the display language”这条原则没有被打破。

这样做之后，下面这些东西都可以删掉：wire 分发表、“所有可能出现在 wire 上的 message 必须登记”的 CI 契约、版本错位时靠 defaultMessage 兜底的逻辑、浏览器端的 `formatText`，以及 `MessageRef.defaultMessage` 这个字段本身。wire 类型可以简化成 `{ id, text }`，id 只留给测试和埋点用。浏览器 i18n 只剩一件事：代码里静态引用的消息函数。

代价要说清楚：凡是含 UiText 的响应都依赖语言，任何 HTTP 缓存或 ETag 都必须把 `x-qualy-locale` 纳入 Vary；前端的查询缓存则因为切语言会 reload，天然就清空了。

## 二、不要写自定义 inlang storage plugin

对方提议写一个 `@qualy/inlang-assembly-plugin`，让它去读 qualy.yml。我认为这是过度设计。collector 现在已经在生成 `virtual:qualy/plugins`，同样可以在构建输出目录里**生成**一份 inlang project settings，把 active 插件的 `messages/{locale}.json` 路径列进 pathPattern。

这份配置是 assembly 的产物，不是手写的，所以不违反“composition root 不枚举插件”的纪律。自定义 storage plugin 则要绑定 inlang SDK 的插件 API，而这个生态的 API 有过大改的历史。能生成配置解决的事，就不要去写插件。

## 三、插件 import ABI 必须在三种场景下都能解析

对方只描述了 assembly 时的情况。实际上 `@qualy/messages/<ns>` 在三个场景里都要能解析：

1. **插件单独开发、测试、typecheck**：这时还没有任何 assembly。plugin-kit 需要提供一个 Vite/Vitest 插件，只编译这个插件自己的消息，并生成 `.d.ts`。
2. **assembly 构建**：集中编译，只有一个 runtime。
3. **第三方插件发布 dist**：这个 specifier 保持 external，dist 里带上消息 JSON，由宿主来解析。

另外还有一个开发环境的性能陷阱。`@qualy/messages/assessment` 如果做成一个 re-export 两千条消息的 barrel，Vite dev 不做 tree-shaking，打开任何一个页面都会发出两千个模块请求。所以开发环境要用 Paraglide 的 `locale-modules`，生产环境用 `message-modules`，这个 ABI 必须在两种输出下都成立。更稳的做法是在 transform 阶段把具名 import 直接改写成指向单条消息模块的路径，完全不经过 barrel。

## 四、最大的风险是 chunk 碎片化，这一点两份报告都没提

`vite.config.ts` 里记着 Qualy 在 chunk 上踩过的坑：

- 打开批次列表一次请求了 61 个文件，其中 22 个小于 2 KB。
- rc.2 和 rc.3 出现过 chunk 互相 import 形成环，导致登录后所有页面都挂掉。
- 为此专门设了一个 entry-aware 的 dust 池，上限 1 KB，并且明确规定不再合并。

`message-modules` 会产生大约 4400 个叶子模块。凡是被两个懒加载页面共用的消息，都会按“被哪些入口引用”被分进各种小池子，很可能把碎片问题重新带回来。好在消息模块只依赖 runtime，runtime 放在 boot 里就不会形成环。需要做的是给消息模块单独配一个 codeSplitting group，同时删掉现有的 `locale-*` group。

**PoC 的第一个指标应该是请求数，其次才是字节数。**

## 五、消息格式：我不同意“长期迁到 inlang 原生格式”

对方选原生格式的主要理由是它支持 typed markup。但我检查了源码：**Qualy 的消息里一个 markup 标签都没有**，也没有用过 `<Trans>`，富文本都是在 JSX 里拼出来的。所以这个理由在 Qualy 身上不成立。

反过来，ICU MessageFormat 1 是可移植的行业标准。现有的 4216 条可以原样保留，以后无论换工具还是迁移到 MF2，都有现成的转换路径。原生格式则是 inlang 独有的，而且嵌套 select/plural 写成 declarations、selectors、match 的 JSON 会冗长很多。

所以我的建议是：**长期就用 ICU1 做存储格式，只迁一次，不存在“先 ICU1 过渡、再迁原生”的第二次迁移。** 迁移时照样做新旧输出的差分测试。哪天真的需要消息内富文本，再对那几条单独处理。

## 六、其他细节

- **getLocale**：在 reload 模型下，浏览器端用自定义 strategy 读 `document.documentElement.dataset.locale`。这个值由 boot script 写入，和 `x-qualy-locale` 同源，所以前后端的语言一定一致。
- **React adapter**：`@inlang/paraglide-js-react` 在 npm 上确实存在，对方纠正得对。但我没能读到它的版本和成熟度（npm 页面返回了 403）。好在 Qualy 目前没有消息内 markup，暂时用不到它，不应该列为依赖。
- **可以整块删掉的东西**：`MessageDescriptor`、`defineMessage<Values>`、`CatalogFor`、`I18nProvider` 的异步 activate 门槛、`loadCatalogs`、手写的 bootstrap 表、`mail-copy.ts`、TS catalog 的完整性测试。完整性检查改为在编译期检查缺译。

## 收敛后的终局
```text
静态文案  → Paraglide 消息函数，随代码 chunk 一起下发（浏览器、bootstrap 生成物）
协议文案  → 同一批函数，由服务端在响应边界按 x-qualy-locale 渲染
邮件      → 同一批函数，按用户在 Qualy 里选的 locale 渲染（顺带修掉 Accept-Language 的 bug）
存储格式  → 每个插件自己的 messages/{locale}.json，ICU1 语法
编译      → assembly 生成 inlang settings，集中编译，只有一个 runtime

```

PoC 需要证明的五件事，按优先级：

1. 登录页和批次列表的**请求数**不比现在多，Brotli 字节数明显下降。
2. dev server 冷启动不会因为消息模块而变慢。
3. 插件在没有 assembly 的情况下能独立 typecheck 和跑测试。
4. api-kit 响应边界的渲染能覆盖 manifest、permission、audit、login driver 四类 UiText。
5. ICU 差分测试全部通过。

这五条都成立，就正式切到 Paraglide。第 1 条不成立的话，先调 chunk 策略；如果调不出来，这就是 Paraglide 在 Qualy 上唯一真正的否决项。

Sources:

- [Paraglide JS Basics](https://paraglidejs.com/basics)
- [@inlang/paraglide-js-react on npm](https://www.npmjs.com/package/@inlang/paraglide-js-react)
- [Paraglide JS Markup](https://paraglidejs.com/markup)

---



许多反驳，你思考下，批判性思维结合源码考虑。

我重新对照了当前远端 `hprogq/qualy` 的实现（GitHub 上我能看到的仍是 `87c6493…`；你本地未推送的提交我看不到），并核对了 Paraglide/inlang 现在的官方行为。我的判断进一步收敛了：

**Paraglide 方向我仍然赞成；这份反驳里的第 2～5 点大体正确，但第 1 点“既然切语言 reload，就应该把 UiText 改成服务端渲染”我不赞成作为 Qualy 的最终架构。**

而且我认为这是整份报告里最需要纠正的地方。

| 观点 | 我的判断 |
|---|---|
| Paraglide 替代 Lingui | **赞成，继续成立** |
| 切语言 reload | **赞成** |
| UiText 改成服务端翻译 | **不赞成作为默认架构** |
| `x-qualy-locale` | **不建议，用 locale cookie 更合适** |
| 不写自定义 inlang storage plugin | **赞成，但不要直接用多个 pathPattern 做长期源文件写回** |
| dev `locale-modules` / prod `message-modules` | **强烈赞成，官方也是这么推荐的** |
| chunk 碎片化是首要 PoC 风险 | **强烈赞成** |
| 长期保留 ICU1 JSON | **赞成，改掉我上一轮建议** |
| React adapter | 当前 Qualy 不需要 |
| bootstrap / mail 共用消息源 | **赞成** |

下面是原因。

## 1. “locale 在 document 生命周期内恒定”并不推出“应该由服务端翻译”

这两件事是正交的。

reload 模型只能证明：

```text
一个 document 生命周期
→ 一个 locale
```

它不能证明：

```text
因此 API 应该从语义数据变成已经本地化的 presentation data
```

Qualy 当前 `UiText` 不是单纯为了支持“无刷新切换语言”才存在的。

`packages/contracts/i18n/src/index.ts` 把它定义为：

```ts
type UiText =
  | {
      kind: 'message'
      id: MessageId
      defaultMessage: string
    }
  | {
      kind: 'literal'
      value: string
    }
```

而且源码注释非常明确：

> server-side plugins transmit semantics; browser chooses display language.

这个边界本身其实很漂亮：

```text
message(...)
= 产品文案，有 localization identity

literal(...)
= 业务数据，不应翻译
```

如果服务器响应边界把二者都压成：

```ts
string
```

你就主动丢掉了这个语义。

这不是一定错误，但我认为仅仅为了消掉两百多条 wire message 的浏览器 dispatch table，不值得把**整个 HTTP API 都变成 locale-dependent representation**。

Paraglide 已经解决了 95% 静态文案的问题以后，剩下的动态 UiText 本来就很小。

---

## 2. 动态 wire registry 实际上没那么糟

最终完全可以是构建生成：

```ts
const wireMessages = {
  'assessment/navigation/batches':
    m.assessment_navigation_batches,

  'org/navigation/organization':
    m.org_navigation_organization,
}
```

然后：

```ts
function formatText(text: UiText) {
  if (text.kind === 'literal') return text.value

  return (
    wireMessages[text.id]?.() ??
    text.defaultMessage
  )
}
```

这里：

```text
wireMessages
```

不是第二套语言系统。

它就是一个：

```text
protocol ID → Paraglide-generated function
```

的 jump table。

真正的翻译源仍然只有：

```text
messages/en-US.json
messages/zh-CN.json
```

而且 wire 集合是有限且 build-time 可证明的。

如果 PoC 测出来这 224 条最后只有比如 5–15 KB Brotli，我完全不会为了删掉它，把 locale 推进整个 API transport layer。

---

## 3. 服务端翻译会引入一个比 wire registry 更大的横切关注点

现在所有 `/api` 响应统一：

```http
Cache-Control: no-store
```

这是 `apps/server/src/response-headers.ts` 明确规定的。

所以报告中：

> “所有 HTTP cache/ETag 必须 Vary: x-qualy-locale”

对**当前 Qualy**其实不是现实问题，因为普通 API 根本不允许缓存，也没有 API ETag。

但真正的问题是：以后每一条返回显示文案的 API 都变成：

```text
resource
+
identity
+
authorization
+
locale
```

共同决定结果。

Manifest、permission、audit、login driver、org usage……都需要 request locale context。

而现在：

```text
locale
```

完全没有进入业务 API 的语义。

我认为后者长期更干净。

---

# 4. 更重要的是：`x-qualy-locale` 本身不是好方案

这个反驳里我最确定会改的一点就是这里。

Qualy 有：

```text
CAS callback
OAuth/OIDC callback
密码重置链接
邮箱验证链接
top-level navigation
```

这些请求不是你的 Effect HTTP client 发出的 fetch。

浏览器不会自动给：

```http
X-Qualy-Locale
```

这种自定义 header。

所以：

```text
每个 API request 加 x-qualy-locale
```

并没有建立一个真正统一的 request locale。

如果我们决定 reload 切语言，我反而建议把当前：

```text
localStorage['qualy.locale']
```

升级为一个普通、非敏感 cookie，例如：

```text
qualy.locale=zh-CN
Path=/
SameSite=Lax
Secure
Max-Age=...
```

Paraglide 本身就把 `cookie` 作为正式 locale strategy，并且允许配置 cookie 名称；官方默认 strategy 也是围绕 cookie/global/base locale 构建的。

这样：

```text
普通 API fetch
CAS callback
GitHub callback
重置密码页面
邮箱验证页面
```

全都自然带同一个 locale。

不需要自定义 header。

---

## 5. 我甚至建议 locale 的 source of truth 从 localStorage 搬到 cookie

现在 Qualy boot 是：

```text
qualy.locale in localStorage
    ↓
navigator.languages
    ↓
zh-CN
```

然后写：

```html
<html lang="..." data-locale="...">
```

这块源码我核对过了：

```text
apps/web/index.html
packages/web/i18n/src/index.tsx
tools/tests/index-html.test.ts
docs/brand.md
```

已经做得很严谨。

Paraglide 重构时可以变成：

```text
qualy.locale cookie
        ↓
navigator.languages
        ↓
zh-CN
```

首次迁移可以兼容旧 localStorage 一次：

```text
cookie 没有
→ 看 legacy localStorage
→ 写 cookie
→ 以后只用 cookie
```

`data-locale` 仍然由 boot script 写。

于是：

```text
document locale
server request locale
mail locale
Paraglide getLocale
```

都从同一个选择派生。

这个比 `x-qualy-locale` 完整得多。

---

# 6. 邮件 locale 的 bug，报告说得对

这个我确认了。

当前 `auth/src/server/index.ts` 里确实多处是：

```ts
mailLocaleOf(request.headers['accept-language'])
```

比如：

```text
createPasswordReset
createSelfEmailVerification
createSelfEmailChange
createSelfReauthenticationCode
管理员触发 verification
地址变更通知
...
```

而 `mail-copy.ts`：

```ts
const first = (acceptLanguage ?? '')
  .split(',')[0]
  ...
```

这和 Qualy 当前保存的：

```text
qualy.locale
```

没有任何联系。

所以确实存在：

```text
Qualy UI = English
Safari Accept-Language = zh-CN
→ mail = 中文
```

这种不一致。

但解决它**不需要把所有 UiText 都服务端翻译**。

只需要统一 `RequestLocale`：

```text
locale cookie
→ Accept-Language
→ default locale
```

邮件调用：

```ts
m.reset_mail(..., { locale })
```

即可。

以后如果用户账户真正增加 persisted locale preference，再让：

```text
user preference
>
request cookie
>
Accept-Language
>
default
```

即可。

---

# 7. 报告拿 RBAC 搜索当作服务端翻译的论据，不准确

这一点我专门重新看了最新源码。

服务端 `listPermissions` 确实还有：

```ts
plainText(definition.name)
  .toLowerCase()
  .includes(search)
```

并且注释明确写：

> server has no reader to choose a language for

但是现在 `RoleEditor` 并没有把输入的搜索词发给服务端。

它取的是完整 catalog：

```ts
query.access.listPermissions.queryOptions({
  query: {
    target: ...
  }
})
```

然后客户端：

```ts
const label = formatText(permission.name)

if (
  needle !== '' &&
  !label.toLowerCase().includes(needle)
) {
  if (!permission.code.toLowerCase().includes(needle))
    continue
}
```

所以当前角色编辑器里：

```text
中文 UI 搜“测评”
```

实际上是按照**翻译后的中文 label**搜索的。

服务端 `plainText()` 搜索可能服务于 API 的其他调用者，但它不是当前 RoleEditor 中文搜索失效的原因。

另外 `authorization.ts` 里的：

```ts
Permission.name = plainText(...)
```

是 permission mirror 持久化的 source-locale 文本。

仅仅把 API response 改成服务端翻译，也不会自动让这个数据库列变成多语言搜索索引。

所以：

> “服务端 UiText 翻译顺带解决 RBAC 中文搜索”

这个论据不成立。

---

# 8. 如果将来真选择 server-rendered UiText，我也不会用 `{id,text}`

这一点再往前推一步。

假设某天真的决定：

```text
browser 不再负责 dynamic localization
```

那么 wire：

```ts
{
  id,
  text
}
```

其实是一个尴尬的中间状态。

如果浏览器根本不再使用 `id`：

```ts
label: string
```

就够了。

而服务器内部仍然保持：

```ts
UiText =
  MessageRef | LiteralText
```

在 BFF projection 时：

```text
UiText
→ string
```

即可。

换句话说：

```text
domain/plugin contribution
= semantic UiText

HTTP presentation DTO
= localized string
```

而不是把 `UiText` 重新定义成 `{id,text}`。

因此即使将来我们接受这条路线，我也会这么做，而不是报告里的 wire shape。

---

# 9. “不要自定义 inlang storage plugin”：方向正确，但实现我会再改一下

这一点我赞成。

不过报告建议：

> assembly 生成 settings，把所有 plugin `messages/{locale}.json` 路径写进 pathPattern。

官方 ICU1 plugin 当前确实支持：

```json
"pathPattern": [
  "./plugin-a/messages/{locale}.json",
  "./plugin-b/messages/{locale}.json"
]
```

但是这里有一个非常重要的 caveat：

> 多 pathPattern 是 **import 时 merge**；export 时会把所有消息写到数组里的每一个 pathPattern。

所以它非常适合：

```text
read-only compile
```

不适合作为：

```text
未来 translator/inlang tooling 修改后
精确写回所属 plugin
```

否则 plugin A/B 的文件会被搞乱。

我认为更稳妥的 Qualy build 是：

```text
plugin-auth/messages/en-US.json
plugin-org/messages/en-US.json
plugin-assessment/messages/en-US.json
         │
         ▼
Qualy collector
  - namespace collision check
  - locale completeness
  - key ownership
         │
         ▼
.qualy/i18n/messages/en-US.json
.qualy/i18n/messages/zh-CN.json
.qualy/i18n/project.inlang/
         │
         ▼
Paraglide compile
```

也就是说：

> **plugin-owned JSON 是 source of truth；assembly 产生一个临时 merged inlang project，仅供 compile。**

不提交。

不写回。

不需要自定义 inlang plugin。

这比 pathPattern array 还干净。

如果以后真接 TMS、需要 round-trip 回每个插件，再设计 ownership-aware storage adapter。现在不要提前造。

---

# 10. 插件 import ABI 的三态问题，我完全同意

这是上一份回复确实没有讲透的。

必须同时成立：

```text
plugin standalone
assembly dev/build
published third-party dist
```

否则 open-world plugin contract 是假的。

而 Paraglide 官方正好明确推荐：

```text
development → locale-modules
production  → message-modules
```

原因也和报告说的一样：dev server 不 bundle，`message-modules` 在大项目会制造很多 HTTP 请求；production 则用 message modules 获取更好的 tree-shaking。

所以 Qualy 的 message ABI 必须在这两种 compiler output 下都稳定。

我倾向：

```ts
import {
  entrySave,
  entrySubmit,
} from '@qualy/messages/assessment'
```

只是**源码 ABI**。

dev/build plugin 把这些 named imports 重写到实际 Paraglide 产物。

这样第三方 dist：

```text
specifier 保持 external
+
package 携带原始 ICU message JSON
```

宿主 assembly 再解析。

而 standalone test/typecheck：

```text
plugin-kit tooling
→ 只编译当前 plugin messages
→ 生成声明
```

这一点应该作为 PoC 的硬门槛。

---

# 11. chunk 碎片化：我认为这是报告里最重要的新提醒

这里我完全同意它，而且从 `apps/web/vite.config.ts` 看，这绝不是理论风险。

你代码里已经留下了非常明确的事故记录：

```text
Batch list:
61 files
22 < 2 KB
合计只有 13 KB
```

然后你试过增大共享池：

```text
4KB
→ boot wave +600ms
```

更严重的是 rc.2 / rc.3：

```text
chunk mutual import
→ production-only TDZ failure

Formula editor 2.7 MB 被折回首屏
```

所以现在才有：

```ts
{
  name: 'shared',
  minShareCount: 2,
  maxModuleSize: 1024,
  entriesAware: true,
  entriesAwareMergeThreshold: 0,
}
```

这个背景下突然引入四千多个 Paraglide message module，确实必须非常谨慎。

---

## 但有一点需要纠正：4400 个 message module ≠ 4400 个 HTTP 请求

`message-modules` 是 compiler output module 数量。

Vite/Rolldown production bundling 之后：

```text
很多 route-local message modules
```

完全可以被吸收到对应 page chunk 里。

真正危险的是：

```text
一条 message
被多个 dynamic entry import
```

这时候它可能成为 shared chunk 的候选。

四千条消息中如果大量共用：

```text
Save
Cancel
Delete
Loading
...
```

就可能产生很多小 shared pools。

所以风险是真实的，但不是：

> “Paraglide 天生发四千请求。”

---

# 12. 我不会简单加一个全局 `messages` codeSplitting group

报告这里说：

> 给消息模块单独配一个 codeSplitting group

这句话如果实现成：

```ts
{
  name: 'messages',
  test: /paraglide\/messages/
}
```

我反而担心重新造出一个：

```text
所有 route 的消息
→ 一个共享 messages chunk
```

然后：

```text
登录页
→ 又下载大量根本用不到的业务消息
```

等于退回今天 54.7 KB catalog 的模型。

我认为更合理的是：

```text
message modules
+
entriesAware
```

按**到达它们的入口集合**聚合。

route-local messages 跟 route 走。

真正多个 entry 共享的微型 message 才进入 entry-aware pool。

甚至对于非常小的 message，最终“复制几百字节到两个页面 chunk”可能比额外制造一次请求更划算——这部分需要看 Rolldown 当前能力和实际 graph，不先假定。

因此 PoC 应该首先拿你已有的：

```text
qualyChunkGraph
```

扩充 i18n 指标。

---

# 13. PoC 第一指标是 request count，我同意

而且我会测得比报告更完整。

核心不应该只看：

```text
Lighthouse Performance
```

而应该同时看：

```text
critical request count
critical transferred Brotli bytes
total route request count
<1 KB / <2 KB chunk count
longest critical request chain
boot JS Brotli
route JS Brotli
LCP
```

然后还必须继续让现有 chunk graph gate 保证：

```text
无 circular chunk graph
Formula/editor 不进入普通首屏
route isolation 没破
```

这比“Paraglide 比 Lingui先进所以迁”重要得多。

---

# 14. ICU1 这一点，我改判支持这份报告

这里它说服我了。

最终我会选：

```text
messages/en-US.json
messages/zh-CN.json
```

内容继续用 ICU MessageFormat 1。

不再计划“最终再迁一次 inlang native format”。

inlang 官方 ICU1 plugin目前明确支持：

```text
plural
select
selectordinal
offset
exact match
#
number/date/time
```

并声称做 full-fidelity mapping 到内部模型。

而 Qualy 现在又没有 message markup。

所以我上一轮用：

> typed markup

作为迁 inlang-native 的主要理由，确实不适用于当前项目。

更关键的是 ICU1 有很强的工具可迁移性。

未来真正要走下一代标准时：

```text
ICU1
→ Unicode MessageFormat 2
```

是一个清晰的标准迁移。

没有必要：

```text
ICU1
→ inlang-specific structured format
→ MF2
```

平白多走一步。

这一点我接受反驳。

---

# 15. 所以我现在会怎样定 Qualy 的最终方案

我的版本会比这份报告保守一处，但其它地方更接近它：

```text
┌─────────────────────────────────────────┐
│ Plugin source                           │
│                                         │
│ messages/en-US.json   ICU1              │
│ messages/zh-CN.json   ICU1              │
│                                         │
│ Browser code: static named imports      │
│ Server contributions: semantic UiText   │
└─────────────────────────────────────────┘
                    │
                    ▼
          Qualy assembly collector
                    │
          validate namespace / locale
                    │
                    ▼
      ephemeral merged inlang project
                    │
                    ▼
            Paraglide compiler
          dev: locale-modules
          prod: message-modules
                    │
        ┌───────────┴─────────────┐
        ▼                         ▼
 browser message funcs       server message funcs
        │                         │
 static page copy              email/export
        │
        └─ generated finite wire index
                    │
                  UiText
```

**唯一与报告核心不同的是：我暂时保留语言无关的 `UiText` wire，而不是把所有 API 变成 server-localized。**

原因很简单：

> 这张有限 wire table 的成本必须先测；在证明它真的是问题之前，不值得为了删除它，把 locale 变成整个 API 的横切语义。

而且它保住了 Qualy 当前一条我认为很有价值的边界：

```text
server/plugin sends semantics
browser decides presentation
```

---

## locale 状态则确实应该改

我会从：

```text
localStorage qualy.locale
```

迁到：

```text
qualy.locale cookie
```

然后：

```text
boot
Paraglide browser
server mail
OAuth/CAS callbacks
future server rendering
```

全部认同一个 preference。

切语言：

```text
set cookie
→ leave guard
→ full reload
```

Paraglide 官方本身也明确指出，client-side routing 下 locale switch 应进行 reload/full navigation；`reload:false` 是需要非常谨慎使用的例外。

---

因此这轮我的裁决是：

**这份反驳比前一份方案又前进了一步，尤其是 ICU1、三态插件 ABI 和 chunk 碎片化三个判断，我赞成。**

但它把“reload ⇒ server-side localization”推得太远了。对 Qualy 来说，当前 `UiText` 是一个有价值的语义协议，不只是运行时切语言的遗留物；动态集合又只有很小一部分。**先用 Paraglide + generated finite wire registry 测实际成本，再决定是否把 wire localization 下沉服务端。** 如果最终这张表只有几 KB，我会永久保留它，而不会让 API 变成 locale-dependent。

先核对这份回复里几条针对源码的事实声明，再算一下 wire 表的实际体积，这样可以直接回答“先测再说”。本地 STATUS.md 里已经有一次 i18n PoC 的实测记录，这正好是需要的数据。下面再把 wire 表的实际体积算出来。我核对了这份回复里涉及源码的几条事实，又把 wire 表的实际体积算了出来。结论是：**它在 UiText 这一点上是对的，我撤回“服务端渲染 UiText”的建议。但它自己给出的邮件方案还有一个真 bug，cookie 方案也有一个容易踩的坑，chunk 部分给的办法也不太成立。**

## 它说对了、我认错的地方

**1. UiText 应该保留语义协议，现在有数据支撑了。**\
&#x20;我用脚本扫描了所有非 client 目录的 `message(id, default)` 调用：去重后是 **184 条**，中文翻译全部齐全。把中英两份按 JSON 做 Brotli q11 压缩，**合计 3.9 KB**。换成编译后的函数形式，估计 5 KB 左右。为了省这几 KB，把语言变成整个 API 都要考虑的横切语义，确实不划算。wire 分发表应该永久保留。

**2. RBAC 搜索那条论据，我说错了。**\
&#x20;`RoleEditor.tsx` 第 403 到 411 行是在客户端对 `formatText(permission.name)` 做搜索，所以中文界面搜“测评”本来就能搜到。服务端第 723 行的注释也写明了：屏幕上的搜索由屏幕自己按显示文字来做。`Permission.name` 是持久化的 source 文本镜像，跟响应时怎么渲染无关。

**3. `/api` 统一 `no-store` 的说法属实。** 见 `response-headers.ts` 第 70 行。我提的“缓存要 Vary”在当前的 Qualy 里并不是一个实际存在的成本。

**4. 用临时合并的 inlang project，而不是 pathPattern 数组。** 我同意。pathPattern 数组在导出时会写回到每一个路径，只能当只读的编译输入用。

## 它说得不对或不完整的地方

**1. 它的邮件修法对管理员触发的邮件是错的。**\
&#x20;`auth/src/server/index.ts` 里的 `iam.setUserPlacement.handler`（注释写的是“administrator did”）同样用的是 `mailLocaleOf(request.headers['accept-language'])`。这里的请求来自管理员，收件人却是另一个人。按它给的 `cookie → Accept-Language → default` 这条链，拿到的依然是**管理员**的语言，不是收件人的。

所以“账户持久化 locale 偏好”不能推到“以后再说”，它是给别人发信时唯一正确的依据。规则应该是：

- **给请求者本人发的信**（重置密码、自助验证、改邮箱）：用请求的 locale。
- **给另一个人发的信**：用收件人账户上记录的 locale。没有记录时，退回产品默认语言，而不是操作者的语言。
- 用户在登录状态下切换语言，同时写入 cookie 和账户偏好。

**2. cookie 方向对，但 boot script 不能把推导出来的语言写进 cookie。**\
&#x20;如果首次访问时 boot 按 `navigator.languages` 推导出语言，再顺手写进 cookie，这个推导值就被固化了，用户以后改了系统语言也不会跟着变。cookie 只能在用户**明确选择**语言时写。没有 cookie 时，浏览器端按 `navigator.languages` 推导，服务端按 `Accept-Language` 推导，两者本来就是同一个来源，结果一致。

另外，它用 CAS 和 OAuth 回调来论证 cookie 比 header 好，这个理由偏弱：这些回调只做重定向，不输出任何本地化文字。cookie 真正的好处更朴素：**任何请求**，包括以后可能出现的服务端错误页，都天然带着同一个偏好，不需要客户端记得去加 header。

**3. “把小消息复制进两个页面 chunk”这个手段不存在。**\
&#x20;为了保证 ESM 模块的单例语义，Rolldown 不会把同一个模块复制到两个 chunk 里，所以这个选项可以不用考虑。

它说“不要给消息单独开一个全局 group”，这一点是对的，但它没有说出真正能控制碎片的手段。现有的 `shared` group（`minShareCount: 2`，`maxModuleSize: 1024`，`entriesAware`，不合并）本来就会接住消息模块。风险在于：每一种不同的“入口集合”都会形成一个池子。Save、Cancel、Delete 这类通用词被很多页面以各不相同的组合引用，池子数量就会膨胀。你在配置注释里已经记录过这个现象：不合并时，一个页面的请求数中位数是多 28 个，而合并时只多 9 个。

真正的控制手段在**写代码的层面**：通用词汇统一放进 core 的 common 消息集，并且由 shell 显式 import，把它们固定在 boot graph 里。只在单个 feature 内使用的消息，才跟着 feature 走。然后在 `qualyChunkGraph` 里加一条检查：被三个以上入口引用的消息模块，如果不在 boot 里就报错。

**4. PoC 的对照基线已经有了，它没有用上。**\
&#x20;你今晚的 STATUS.md 里记录了一次实测：只在构建期把 4193 条静态 `defaultMessage` 抽成空串，首屏 i18n 模块的 Brotli 体积从 **82.8 KB 降到 43.7 KB**，手机 LCP 改善 2 到 377 ms。同一段记录还提到，**语言包和页面代码一起预取没有收益，反而让 React 提交晚了约 300 ms**。

所以 Paraglide 的 PoC 要比的不是现状，而是这个便宜的方案。它需要证明，在首屏 i18n 字节上能明显低于 43.7 KB，而且请求数不增加。至于去掉异步 activate 门槛、合并三套文案系统、参数类型自动生成，这些是结构上的收益，不能拿来抵消性能上的不达标。

## 最终方案，收敛到这一步

- **框架**：Paraglide。开发环境用 `locale-modules`，生产环境用 `message-modules`。消息格式长期保持 ICU1 JSON。
- **消息源**：每个插件自己的 `messages/{locale}.json` 是唯一事实来源。assembly 生成临时合并的 inlang project，只用于编译，不写回。
- **插件 ABI**：源码里写 `@qualy/messages/<ns>` 的具名 import，构建时改写成直接指向单条消息模块的路径。插件单独开发、assembly 构建、第三方 dist 三种场景都要能解析。
- **UiText**：保持语义协议不变。浏览器 shell 里放一张生成出来的 184 条分发表，约 5 KB。
- **语言状态**：cookie 只在用户明确选择时写入；账户上持久化语言偏好，用于给他人发的邮件；切换语言走 leave guard，然后 reload。
- **chunk 控制**：通用词汇固定在 boot 里，feature 消息跟随 feature，`qualyChunkGraph` 增加对应检查。
- **PoC 通过标准**：首屏 i18n Brotli 字节明显低于 43.7 KB，请求数不增加，没有新的 chunk 环。达不到的话，就正式落地“抽掉 defaultMessage 并补一个 en-US 语言包”这个已经测过的方案，Paraglide 暂缓。

---

如何。

这版已经很接近我会落 ADR 的方案了。结合远端 Qualy 源码和你给出的本地 PoC 数据，我会继续选 **Paraglide**，并且同意保留 `UiText`。不过我会再改四处，否则迁完后容易把 i18n 性能问题换成 locale 状态和 chunk 图问题。

先纠正一个源码细节：你这份报告里举的 `setUserPlacement` 例子不对。远端 `packages/plugins/base/auth/src/server/index.ts` 里的 `setUserPlacement` 没有发邮件。真正存在“管理员操作 A、邮件发给 B，却用了 A 的 `Accept-Language`”的至少有两处：`updateUser → tellAddressLeft(...)`，以及 `createUserEmailVerification → requestVerificationFor(...)`。所以你推导出的规则是对的，只是例子写错了。

我赞成增加用户级的持久化语言偏好，而且现在就应该一起做，不应留到以后。这里最好明确区分三个概念：

```text
document locale
= 当前这个页面正在使用什么语言

explicit device preference
= 用户在这个浏览器明确选过什么语言

account preferred locale
= 给这个账号主动发送通知时应该使用什么语言
```

它们通常相同，但语义不同。

我建议 `preferredLocale` 在账户上允许 `null`。只有用户真正点过语言切换才写入，不要第一次访问就把浏览器推导值写进账户。管理员代表别人触发邮件时：

```text
recipient.preferredLocale
?? productDefaultLocale
```

绝对不要回退到管理员自己的 locale。

而用户本人主动触发的密码重置、验证邮件、改邮箱等，应使用**当前 document locale**。这又引出你 cookie 方案剩下的一个小漏洞。

你说：

> 没 cookie 时 browser 用 navigator.languages，server 用 Accept-Language，本来就是同一个来源，结果一致。

通常一致，但不能把这个当契约。浏览器隐私策略、language reduction、代理，以及两边不同的 locale matching 实现，都可能让结果不同。

因此我会采用一个稍微更完整的模型：

```text
持久化：
qualy.locale cookie
只在用户明确选择 locale 时写

Browser boot：
cookie
→ navigator.languages
→ zh-CN

HTML：
<html data-locale="...">

Paraglide browser：
永远从 data-locale 读

普通 API：
不需要 locale

确实需要当前 document locale 的操作：
API client 附带 x-qualy-locale = data-locale

给其他账号发邮件：
忽略 x-qualy-locale
→ recipient.preferredLocale
→ product default
```

也就是说，**cookie 和 `x-qualy-locale` 不是二选一**。

cookie 表达“持久偏好”；header 表达“这个 document 此刻实际是什么语言”。API 不应该因为这个 header 就整体变成 locale-dependent，只让邮件等真正需要 request locale 的代码读取即可。

而且 Qualy 是同源 `/api`，这个自定义 header 不会因为跨域而凭空制造 CORS preflight 问题。

语言切换则：

```text
用户选择 en-US
→ 如果已登录，持久化 preferredLocale
→ 写 cookie
→ leave guard
→ reload
```

甚至可以让一个 viewer-optional 的 locale preference endpoint 同时完成账户持久化和 `Set-Cookie`，避免“DB 写成功、cookie 失败”或反过来的双写漂移。

Paraglide 官方本身也是 document-navigation/reload 模型，`reload:false` 被明确定位为窄用途 escape hatch，而不是普通语言切换机制。

---

### UiText 现在可以正式定为“永久保留”

184 条、两种语言 Brotli q11 合计 **3.9 KB**，这个数据基本结束争论了。

即使编译后变成 5～8 KB，都不值得引入：

```text
API locale context
+ localized response DTO
+ locale-dependent projection
+ server/browser presentation ownership混合
```

来换。

所以保留：

```ts
type UiText =
  | {
      kind: 'message'
      id: MessageId
      defaultMessage: string
    }
  | {
      kind: 'literal'
      value: string
    }
```

我甚至认为 `defaultMessage` 也应该继续留下。

它现在终于会恢复成非常纯粹的角色：

> 协议版本错位 / 缺少对应 message function 时，仍然有可读 fallback。

不再承担整个客户端正常翻译机制。

唯一应该改的是不要继续人工写：

```ts
message(
  'assessment/navigation/batches',
  'Assessment rounds',
)
```

然后 JSON 里又写一份：

```json
{
  "assessment/navigation/batches": "Assessment rounds"
}
```

Paraglide 重构后应该由 message source/codegen 生成 wire declaration，例如概念上：

```ts
wire.assessmentNavigationBatches.ref
```

生成：

```ts
{
  kind: 'message',
  id: 'assessment/navigation/batches',
  defaultMessage: 'Assessment rounds'
}
```

以及浏览器端：

```ts
wire.assessmentNavigationBatches.format
```

两者来自同一个 source entry。

这样 wire registry 虽然存在，但完全没有双重维护。

---

### 临时 merged inlang project，我完全同意

而且你指出的 `pathPattern[]` 坑是实质性的。inlang ICU1 插件官方明确说明：多个 `pathPattern` 在读的时候是 merge，但 export 时会**把全部消息写进每一个 pattern**。所以不能拿它作为 plugin ownership 的长期写回模型。

最终应该是：

```text
plugin-auth/messages/en-US.json
plugin-auth/messages/zh-CN.json

plugin-org/messages/en-US.json
plugin-org/messages/zh-CN.json

plugin-assessment/messages/en-US.json
plugin-assessment/messages/zh-CN.json
             │
             ▼
       Qualy collector
             │
      namespace / collision
      completeness / ICU validation
             │
             ▼
.qualy/i18n-build/
    messages/en-US.json
    messages/zh-CN.json
    project.inlang/
             │
             ▼
       Paraglide compile
```

`.qualy/i18n-build` 完全是 ephemeral。

所以确实：

**不写 `@qualy/inlang-assembly-plugin`。**

以后真有 TMS 需要 round-trip 到插件源文件，再为“写回”单独设计 ownership-aware adapter，不要今天提前绑定 inlang storage plugin API。

---

### 三态 plugin ABI 也应该作为硬性架构要求

这一点这份报告比前面的方案明显更完整。

必须同时支持：

```text
插件 standalone 开发 / test / typecheck
assembly dev/build
发布后的 dist-only third-party plugin
```

官方当前也确实明确推荐：

```text
development → locale-modules
production  → message-modules
```

理由正是 dev server 不 bundle，`message-modules` 会产生大量请求；production 才利用 message-level tree shaking。

因此源码 ABI 可以是：

```ts
import {
  entrySubmit,
  entrySave,
} from '@qualy/messages/assessment'
```

但这个路径最好只是一个 **virtual ABI**，不要真的存在一个两千 export 的 barrel。

dev：

```text
@qualy/messages/assessment
→ plugin-kit 生成的 locale-module facade
```

production：

```text
named import
→ transform
→ 直接改写为具体 Paraglide message module
```

third-party dist：

```text
specifier 保持 external
+ package 带 ICU JSON/message metadata
→ host assembly 重新解析
```

这个设计我赞成。

---

### 但“被三个入口引用就塞进 boot”我不赞成

这里是我对这份报告最大的剩余异议。

它发现了真正的问题：

> Paraglide 可能让 Qualy 再次发生 shared dust explosion。

完全正确。

你的 `vite.config.ts` 已经把事故写得非常清楚：

```text
61 requests
22 个 < 2 KB
总共才 13 KB

4 KB shared threshold
→ boot +600 ms

rc.2 / rc.3
→ chunk ring
→ production TDZ
→ formula editor 2.7 MB 漏进首屏
```

所以 request count 必须是 PoC 第一等指标。

但下面这条：

> “一条消息被三个以上入口引用而没进 boot 就 fail”

我不会做。

原因之一是 Paraglide 官方自己特别提醒：**不要因为两个地方今天恰好都是 `OK` / `Save` 就共享同一个 message identity**；文案上下文可能独立演化。

更重要的是：

```text
使用频率高
≠
属于 application shell
```

比如：

```text
保存
取消
删除
确认
```

可能被 30 个 admin 页面使用，但匿名登录页根本用不到。

为了少几个请求把它们全部压进 boot：

```text
每一个匿名访问
每一个学生首屏
```

都永久支付它们。

这实际上又在慢慢重建一个全局 catalog。

我会采用更明确的规则：

```text
真正属于平台层的 common messages
→ 显式放 @qualy/messages/common
→ 允许形成一个小且有预算的 common shared chunk

业务 message
→ 永远按 feature dependency graph 走

不要因为 entry 数量达到 3 就自动晋升 common
```

然后扩展 `qualyChunkGraph`，不要检查：

```text
message 被几个 entry 使用
```

而检查最终用户真正承担的结果：

```text
first-screen static closure request count
<1 KB chunk 数
<2 KB chunk 数
first-screen compressed bytes
chunk ring
forbidden feature leakage
i18n shared chunk budget
```

这是更稳的 gate。

也就是说：

> **约束产物，不约束一个容易失真的源代码启发式。**

先让现有 `entriesAware shared` 接 Paraglide PoC。只有看到 message modules 确实产生异常 entry-set 池以后，再加 message-specific splitting rule。不要现在猜规则。

---

### 43.7 KB 基线很重要，但验收指标还需要改一下

这份报告这里的方向完全正确：

> Paraglide 不能只和今天 82.8 KB 的坏形态比较。

但我不会要求：

> “Paraglide i18n bytes 必须显著低于 43.7 KB。”

因为 Paraglide 后消息很可能直接被吸进：

```text
LoginPage chunk
MyEntriesPage chunk
shared chunk
```

届时“i18n bytes”本身就不再有稳定定义。

真正应该比的是：

```text
首次页面整个 static closure 的 Brotli bytes
+
首次页面 request count
+
critical request chain
+
LCP/FCP/TBT
```

而且 43.7 KB 的“把 static defaultMessage 置空”实验虽然很有价值，但它还不是一个完整可上线的竞争方案。

真正的 B baseline 应该再补一次：

```text
current architecture
+
生产静态 descriptor 不携带 defaultMessage
+
生成 en-US catalog
+
zh-CN catalog
+
fallback 正确
```

也就是你说的：

> “抽掉 defaultMessage + en-US 包”

把它做成 production-correct 对照组。

然后比较：

| | 当前 | Extraction 方案 | Paraglide |
|---|---:|---:|---:|
| 首屏 closure Brotli | A | B | C |
| 请求数 | A | B | C |
| <2KB 请求 | A | B | C |
| LCP median | A | B | C |
| JS parse/execute | A | B | C |
| dev cold start | A | B | C |
| build time | A | B | C |

我也不会规定 Paraglide 必须“大幅”胜过 B。

如果：

```text
B: 610 KB / 29 requests / LCP 4.00s
Paraglide: 608 KB / 29 requests / LCP 3.98s
```

属于性能基本相同。

此时 Paraglide 带来的：

```text
没有异步 catalog activation gate
自动参数类型
mail / bootstrap / browser 一套 source
删除手写 descriptor compiler
更自然的 code splitting
```

足以成为选择它的理由。

只有出现类似：

```text
B: 610 KB / 29 requests / 4.0s
Paraglide: 655 KB / 42 requests / 4.4s
```

这种**实质性能退化**，才应该暂停 Paraglide。

---

### ICU1 长期保留，我也正式赞成

这一条不用再摇摆了。

inlang 当前 ICU1 插件已经明确支持 plural、select、selectordinal、exact match、offset、`#`、number/date/time，并宣称 full-fidelity mapping。

Qualy 当前又没有 message markup。

所以最终：

```text
messages/en-US.json
messages/zh-CN.json
```

长期就是 ICU1。

不需要：

```text
ICU1
→ inlang native
→ 未来 MF2
```

多做一次生态绑定迁移。

以后 Unicode MF2 工具链真正成熟时，再评估：

```text
ICU1 → MF2
```

即可。

---

所以我现在会把这版方案再收敛成下面这一个版本：

1. **Paraglide 正式作为目标 i18n framework；ICU1 JSON 为长期 source format。**
2. **`UiText` 永久保留语义协议，184 条 wire function 建有限生成索引，`defaultMessage` 只做 wire fallback。**
3. **每个 plugin 自己拥有 message source；assembly 生成临时 merged inlang project，不写自定义 storage plugin。**
4. **dev 用 `locale-modules`，prod 用 `message-modules`；`@qualy/messages/<ns>` 是 virtual import ABI，三种插件场景都必须成立。**
5. **locale：显式选择才持久化 cookie；登录用户同时持久化 nullable `preferredLocale`。给别人发邮件读 recipient preference；本人触发的邮件读当前 document locale。**
6. **切语言 reload，并走 Qualy leave guard。**
7. **不要用“≥3 entry → boot”这种规则；只显式维护真正的 platform common messages，chunk gate 直接约束最终 request graph。**
8. **Paraglide PoC 对比 production-correct extraction baseline，不只对比今天的全量 catalog。**

到这一步，我觉得技术方向已经基本收敛了。现在真正还没有答案的已经不是“Lingui 还是 Paraglide”，而是一个很具体、可实测的问题：

> **Paraglide `message-modules` 经过 Qualy 现有 Rolldown `entriesAware` 策略之后，最终四个代表页面会形成怎样的 production chunk graph。**

这个结果如果健康，我认为就没有继续保留现有 Lingui 架构的充分理由了。

先核对 `setUserPlacement` 这处纠正，再看 UiText 在源码里实际被用在哪些地方，因为第二个问题的答案取决于这一点。我核对过了，结论分两部分。

## 先认错：`setUserPlacement` 那个例子是我看错了

`setUserPlacement` 这个 handler 从第 1014 行开始，里面没有发邮件。我上一轮是用 `sed` 按行号截取片段，把相邻 handler 的 `mailLocaleOf` 调用算到了它头上。真正有问题的是这两处：

- `updateUser`（第 988 行）里的 `tellAddressLeft`，在第 1004 到 1006 行
- `createUserEmailVerification`（第 1052 行），在第 1064 行和第 1072 行

规则本身不受影响：给别人发邮件时，用收件人的语言，不能用操作者的语言。

这份回复里的其他几条修正我都接受：

- 把语言拆成三个概念（当前页面语言、设备上的明确偏好、账户偏好）
- 账户上的 `preferredLocale` 可以为空，只在用户明确选择时写入
- cookie 和 `x-qualy-locale` 分工，而不是二选一
- 放弃我提的“被 3 个以上入口引用就放进 boot”这条源码层面的启发式规则，改为直接约束构建产物
- 性能对比按整个首屏闭包算，对照组是一个生产可用的抽取方案

只补充一个它没覆盖到的场景：用户在 A 设备上选过语言，账户上有了偏好，然后第一次在 B 设备登录。B 设备没有 cookie，要不要用账户偏好来填这个设备的 cookie？我建议要。登录成功后本来就会跳转，可以在登录响应里直接带上 `Set-Cookie`。这一点需要你拍板，不影响其他设计。

## UiText 还有没有存在的意义

**有。而且你说的“直接传递 Paraglide 的值”，在写代码这一层可以做到，在网络传输这一层做不到。UiText 就是这个值传输时的形式。**

### 为什么传不过去

Paraglide 的一条文案不是一个数据值，而是某次构建产出的某个 JS 模块里的一个**函数**。服务端和浏览器之间只能传数据。所以服务端想让浏览器显示一段产品文案，只有三种做法：

1. **传标识**：浏览器用这个标识找到自己那份函数。这就是 UiText 的 message 分支。
2. **传渲染好的文字**：上一轮已经用数据否掉了，184 条、3.9 KB，不值得让所有 API 都依赖语言。
3. **不传文字**：服务端只告诉浏览器“你有权限看这个页面”，文字由浏览器自己决定。

真正值得认真考虑的是第 3 种。我按合约类型逐一看了 UiText 用在哪里：

| 用途 位置 能否改由浏览器按实体 key 查找    |                                    |                                                                                     |
| -------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| 页面和导航的 label、title         | `ui/surfaces.ts`、`declarations.ts` | 大体可以                                                                                |
| 设置项的 label、description     | `settings`                         | 大体可以                                                                                |
| 权限的 name、description、group | `rbac`                             | 不行。未知权限码由服务端现场生成 `literal(code)`（`rbac/assembly/index.ts` 第 89 行），服务端的镜像表和搜索也需要这段文字 |
| 登录方式的 label、hint           | `auth/login.ts`                    | 不行。管理员配置的提供方名称是 literal                                                             |
| 节点用途说明                     | `rbac/node-usage.ts`               | 不行。服务端要根据实际情况决定用哪一条文案                                                               |
| 审计动作的 name、subject         | `audit`                            | 半行半不行。它在服务端组装，并且要和数据库里的动作码对应                                                        |

可以看到，有一部分文字确实可以挪到浏览器侧。但只要还剩下“服务端决定显示哪句”和“可能是产品文案，也可能是业务数据”这两种情况，就需要一个通用的类型来表达\*\*“一段由服务端选定的文字，要么是产品文案，要么是原样的业务数据”\*\*。这正是 UiText 的定义。

如果改成按实体 key 查，就得为每类实体各做一张查找表，而且每张表仍然要处理 literal，结果是把一个通用机制拆成了五六个专用机制。所以我的结论是：UiText 作为传输类型保留，`message | literal` 这个定义本身不需要改。

### 真正该改的是写法，这就是你要的“直接传值”

现在服务端贡献文案是这样写的：
```ts
label: message('rbac/node-usage/grants', 'Role grants in force here')

```

id 和英文原文都是手写的，JSON 里又要再写一遍。改成 Paraglide 之后，每个插件显式声明一个 wire 集合：
```ts
// plugin/src/wire.ts
import { nodeUsageGrants, navBatches } from '@qualy/messages/rbac'
export const wire = defineWire({ nodeUsageGrants, navBatches })

```

服务端贡献文案时，直接传这个值：
```ts
label: wire.nodeUsageGrants

```

整个链路是这样的：

- **写代码时**：传的就是 Paraglide 的值，有类型检查，没有手写的字符串。
- **贡献边界**（现有的 `UiTextSchema` 编码那一步）：由框架把它转换成 `{ kind: 'message', id, defaultMessage }`。id 就是这条消息在合并项目里的 key，`defaultMessage` 是用 source locale 渲染出来的结果，两者都由生成代码提供。
- **浏览器侧**：collector 聚合所有插件的 `wire.ts`，生成 shell 里的分发表，做法和现在生成 `virtual:qualy/plugins` 一样。

这样也不需要再靠扫描源码来确定 wire 集合。贡献字段的类型是一个带品牌的 `WireMessage`，只能从 `defineWire` 得到，漏登记会直接编译失败。上一轮讨论的“有限集合契约”，由此从 CI 检查变成了类型约束。

### 两个细节要定下来

**第一，wire 上的消息不能带参数。** 现有的 `MessageRef` 本来就没有 `values` 字段，184 条全是常量。建议 `defineWire` 在类型上只接受零参数的消息函数，把这条规则固定下来。原因是一旦允许参数，数字和日期怎么格式化就会变成协议的一部分。以后真有需要，再单独设计一个只允许 JSON 原始类型的 `values` 字段。

**第二，`defaultMessage` 要保留，因为它有实际用途。** `web/runtime/src/release.ts` 的设计是：检测到新版本后，旧页面会继续工作，只提示用户一次，不强制刷新。这意味着新版本服务端返回的新 id，确实会到达还没有对应函数的旧 bundle。这种情况下显示 `defaultMessage` 是合理的降级。以前它是手写的，现在由生成代码填充，不会再和 JSON 里的内容不一致。服务端原来用 `plainText` 读它的地方（镜像表、日志），也可以改成 `m.x({}, { locale: sourceLocale })`，两种写法的结果一样。

### 总结

UiText 是“Paraglide 的值”跨越网络时的形式。传过去的是标识，函数在浏览器那一侧早已准备好。你可以在写代码时直接传值，但传输层始终需要一个 id，而 `literal` 分支表达的是另一种语义（原样的业务数据），Paraglide 替代不了它。所以要改的是 UiText 的写法（从手写字符串改成传 wire 值），而不是它的存在。



---



这是回复。你也再思考下，Paraglide本身没有考虑如何跨网络传输的方案吗，你有没有新的奇思妙想。

这版我基本认同，而且我现在对 `UiText` 的定位反而更清晰了：

**它不应该被看成“旧 Lingui 架构留下来的东西”，而应该正式定义成 Qualy 的 Remote Message Reference——Paraglide message 跨进程/跨网络边界后的协议表示。**

Paraglide 本身确实没有提供“把 message function 序列化后发给浏览器”的方案。它的公开抽象基本止于三件事：message key 是跨 locale 的消息身份；编译后生成本地 JS message functions；动态 key 场景需要显式建立有限映射。服务端部分解决的是 request locale、SSR 和显式指定 `{ locale }` 进行格式化，而不是“远程消息引用协议”。

所以 Qualy 自己有 `UiText` 并不是在和 Paraglide 对着干，反而正好补上它没有试图解决的 application protocol 层。

### 我会进一步修改 `defineWire` 的设计

上一份回复里这个写法：

```ts
import { nodeUsageGrants } from '@qualy/messages/rbac'

export const wire = defineWire({
  nodeUsageGrants,
})
```

概念是对的，但有一个隐藏问题：

**不要指望从 Paraglide 生成的函数对象本身反射出 message key 和 source message。**

Paraglide 的公开 API 是：

```ts
m.some_message()
```

以及动态映射：

```ts
const messages = {
  some: m.some_message,
}
```

我没有看到它承诺 message function 自身携带稳定的 `id` / source text 元数据。message key 是编译输入和生成 export 的身份，而不是一个公开的 runtime reflection API。

所以我不会做：

```ts
defineWire(paraglideFunction)
  ↓ runtime introspection
取出 id/defaultMessage
```

这会绑死 Paraglide 的生成实现。

更合理的是让 **Qualy build collector 同时从同一份 message source 生成两套视图**。

比如 source：

```json
{
  "rbac/node-usage/grants": "Role grants in force here"
}
```

构建后生成服务器可用的：

```ts
export const wire = {
  nodeUsageGrants: {
    kind: 'message',
    id: 'rbac/node-usage/grants',
    defaultMessage: 'Role grants in force here',
  },
} as const
```

以及浏览器分发表：

```ts
import * as m from '@qualy/paraglide/messages'

export const wireRenderers = {
  'rbac/node-usage/grants': m['rbac/node-usage/grants'],
} as const
```

于是它们是：

```text
同一个 message source
        │
        ├─ Paraglide message function
        ├─ server WireMessage
        └─ browser wire dispatch
```

没有任何信息人工重复。

我甚至倾向把现在的 `UiText` 在概念上改名为：

```ts
type RemoteText =
  | RemoteMessage
  | LiteralText
```

虽然物理类型名可以暂时不改。

它表达的已经不是“i18n descriptor”，而是：

> 一段跨边界文本的语义：这是一个可本地化产品消息，还是应该原样呈现的业务数据。

这个抽象非常有价值。

---

### 还有一个更激进、但我觉得很适合 Qualy 的做法

可以连显式的 `wire.ts` 注册表都不要，做一个 **compile-time `wire()` macro/transform**。

源码写：

```ts
import * as m from '@qualy/messages/rbac'
import { wire } from '@qualy/i18n-wire'

label: wire(m['rbac/node-usage/grants'])
```

Qualy build plugin 在 AST 阶段看到这个表达式：

```text
wire(
  m['rbac/node-usage/grants']
)
```

就已经知道 key。

同时 collector 有 message source，所以能在构建阶段直接变成：

```ts
label: {
  kind: 'message',
  id: 'rbac/node-usage/grants',
  defaultMessage: 'Role grants in force here',
}
```

并自动记录：

```text
rbac/node-usage/grants
```

需要进入浏览器 wire dispatch table。

也就是说：

```text
代码里出现 wire(m.xxx)
        ↓
自动成为 wire contract
        ↓
自动生成 server ref
        ↓
自动进入 browser dispatcher
```

这比：

```ts
defineWire({
  nodeUsageGrants,
  ...
})
```

还有一个优势：不存在“忘了登记”。

同时类型层可以规定：

```ts
wire()
```

只能接受**零参数 Paraglide message function**。

你现在 184 条 wire 消息本来全部无参数，这正合适。

不过这是 compiler magic，所以我不会一开始就确定采用。PoC 可以同时比较：

```text
显式 generated wire module
vs
wire() build macro
```

我个人略偏向后者，因为 Qualy 本来就已经有大量 assembly/codegen/Vite virtual-module 基础设施，它不是一个普通业务 SPA。

---

### 参数我也赞成第一版彻底禁止

继续保持：

```ts
RemoteMessage = {
  kind: 'message'
  id: WireMessageId
  defaultMessage: string
}
```

而不是：

```ts
{
  id,
  values: {...}
}
```

这是很好的限制。

因为一旦 wire message 携带：

```text
Date
number
plural selector
timezone
currency
```

你立刻要决定：

> value 是业务值还是已经格式化过的 display value？

> 服务端和客户端怎样保证 ICU 输入 schema 一致？

> Date 怎么序列化？

> locale-specific formatting 在哪一层发生？

目前没有任何实际需求，不要提前把这套复杂度引进协议。

以后真出现一个无法回避的例子，再做：

```ts
RemoteMessageV2<K> {
  id: K
  values: WireInputs<K>
  fallback: string
}
```

而且只允许 JSON-safe primitive input。

---

### `defaultMessage` 现在反而非常应该保留

你提出 release skew 这个理由是决定性的。

Qualy 明确允许：

```text
旧 document
继续存在
+
服务端已经是新 release
```

而不是一检测版本变化就强制 reload。

于是完全可能：

```text
Server rc.N+1
→ 返回新 message id

Browser rc.N
→ wireRenderers 没有这个 id
```

这个时候：

```ts
defaultMessage
```

就是一个真正有价值的 protocol-level fallback。

它不再是：

> “因为 catalog 可能加载失败，所以所有正常页面永久携带全部英文。”

而只是：

> “远程 message identity 无法解析时，这条 payload 自己仍然可读。”

语义一下就干净了。

我甚至会考虑把字段以后改名：

```ts
fallback
```

比 `defaultMessage` 更准确。

不过这只是命名，不值得迁移初期一起折腾。

---

## Paraglide 本身有没有更接近这件事的能力？

最接近的是它的 **dynamic messages**。

官方现在就建议：

```ts
const navMessages = {
  home: m.xxx,
  about: m.yyy,
}
```

然后根据 domain key 查这个有限映射，而不是做任意动态 import。

Qualy 的 wire dispatch 本质上就是这个模式：

```text
dynamic menu key
```

扩大成：

```text
server-provided protocol message key
```

所以我甚至会把 ADR 里的描述写成：

> Qualy wire localization is a generated Paraglide dynamic-message map whose keys are part of the application protocol.

而不是说：

> Qualy 自己实现了一套 i18n。

这两个说法的架构含义完全不同。

---

## 还有一个很重要的新信息：先别急着写 import rewrite

我查了 Paraglide 最新 changelog，这里有个和 Qualy 非常相关的变化。

**Paraglide 2.20.0 专门针对 Vite 8 / Rolldown 修了 message barrel tree-shaking。**

它现在给 `messages/` 生成：

```json
{
  "type": "module",
  "sideEffects": false
}
```

目的就是让 Vite 8 / Rolldown 能够：

```text
messages.js barrel
        ↓
每个 entry 只留下它真正使用的 message
```

而不是把整个应用用到的 message union 都塞进一个 shared chunk。官方 changelog甚至明确点名了 Vite 8 / Rolldown。

这非常重要，因为 Qualy 正好就是：

```text
Vite 8
+
Rolldown
```

所以我会修改前面那个设计：

**不要第一天就写“把 `@qualy/messages/<ns>` named import AST rewrite 成单 message module path”的自定义 transform。**

先尝试最简单的：

```ts
import {
  entrySubmit,
  entrySave,
} from '@qualy/messages/assessment'
```

让 Qualy 生成一个 namespace facade/barrel，并保证它：

```text
sideEffects: false
```

然后看 Vite 8 production chunk graph。

Paraglide 现在就是专门为这种情况修过的。

如果 production tree-shaking 已经健康：

> 不要写 transform。

Qualy 已经有够多 build infrastructure 了，能少一层 compiler magic 就少一层。

开发环境仍然使用官方推荐的：

```text
locale-modules
```

避免几千 message module HTTP 请求；生产用：

```text
message-modules
```

获取 tree-shaking。这个依然成立。

---

## 关于 B 设备，我也拍板一下

你的规则我会定成：

```text
当前设备显式 cookie
>
账户 preferredLocale
>
浏览器语言
>
产品默认语言
```

也就是说：

A 设备：

```text
用户明确选择 English
→ A cookie = en-US
→ account.preferredLocale = en-US
```

第一次在 B 登录：

```text
B 没 cookie
+
account.preferredLocale = en-US
        ↓
登录成功响应
Set-Cookie: qualy.locale=en-US
        ↓
redirect/reload
```

我认为应该这样。

这不违反：

> “不要把 navigator 推导值固化进 cookie”

因为这不是浏览器推导值，而是**用户之前明确选择、已经保存到账户的 preference**。

但是如果 B 已经存在：

```text
qualy.locale=zh-CN
```

则 B 的显式 device choice 优先，登录时不要拿 account preference 覆盖掉它。

这样最终语义非常清楚：

```text
account.preferredLocale
= 新设备默认值 / 主动通知默认值

qualy.locale cookie
= 这个设备的 override
```

用户以后在 B 上手动切成中文：

```text
B cookie = zh-CN
+
account.preferredLocale = zh-CN
```

以后 C 设备默认中文，但 A 已经存在的 en-US cookie仍然继续是英文。

这其实是很自然的一套多设备行为。

---

## 我还想到两个方案，但我都不建议做

一个是让 server 直接发：

```text
Paraglide module ID
```

浏览器收到后：

```ts
import(`/messages/${id}/index.js`)
```

这看起来像“真正把 Paraglide 跨网络了”。

但实际上非常差：

```text
每个动态文本可能造成 network waterfall
+
module path 变成 protocol ABI
+
release skew 更难处理
+
安全校验复杂
```

完全不值得。

另一个是把 wire ID 编译成短整数：

```text
rbac/node-usage/grants
→ 37
```

然后客户端：

```ts
wire[37]()
```

能省几个字节。

但是 184 条 wire messages 整张表 Brotli 才 3.9 KB，更何况每个响应不会全发 184 条。

为了这点流量失去：

```text
可调试性
跨版本稳定性
日志可读性
第三方插件 namespace
```

明显不划算。

所以稳定字符串 key 就很好。

---

最终，我会把整个 i18n 的边界定成：

```text
                    ICU1 message source
                           │
                           ▼
                  Paraglide compiler
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
   browser messages   server messages    wire metadata
          │                │                 │
   static UI copy          email         RemoteMessage
          │                                  │
          │                          HTTP / plugin boundary
          │                                  │
          └──────────── browser wire dispatcher
                                     │
                                     ▼
                              Paraglide function
```

这里**翻译系统只有一个：Paraglide**。

`UiText` 不再是翻译系统，它只是：

> **Paraglide message identity 的远程引用格式 + literal escape hatch。**

我认为这是目前最干净的理解。

而且有了“184 条 / 3.9 KB”这个数据以后，我现在已经不再把“UiText 是否应该消失”当成待决问题了。**应该永久保留，但彻底 codegen 化，业务代码不再手写 `id + defaultMessage`。**

你认为Qualy到底是应该使用切换语言强制reload更好，还是和现在一样切换语言原地变化更好，这一定会有取舍。你帮我考虑下怎么做是更好的？你有没有更多的奇思妙想呢，Paraglide没有相关的解决方案和成熟体系吗？你认为是现在这种服务端向前端传递UiText的方式更好，还是服务端将文本渲染成字符串传递给前端的方式更好，因为UiText本质上是Lingui时期的残留，或者说当时选择Lingui也是因为后端可以直接传递一个id而非文本的方法，但是现在切换为Paraglide后也要入乡随俗，每个内容是一个函数所以无法在前后端之间稳定传递。你帮我思考下，权衡下。

我先查两件事：Paraglide 官方对“原地切换语言”的立场，以及浏览器能不能把 reload 做得不那么突兀。另外看一下 Qualy 现在的切换入口和切换逻辑。

**我的结论：选强制 reload。而一旦选了 reload，我改变上一轮的判断：服务端应该在响应边界把文字渲染成字符串，UiText 这个传输类型可以退役。** 这两个决定是绑在一起的：原地切换必须配 UiText，reload 配服务端渲染才是最干净的组合。

### 一、reload 还是原地切换

先说清楚现状。Qualy 现在确实是真正的原地切换：`I18nProvider` 在新语言包加载完成前一直保持旧语言（`activated` 不会被清空），加载完后整棵树原地重新渲染，状态不丢。切换入口只有两个：登录页的 `AuthShell`，和账户抽屉 `DrawerAccount`。

Paraglide 官方的立场很明确：切换语言就是整页导航，不依赖框架的响应式更新。`reload: false` 只是一个“逃生口”，适用于“必须保住无法恢复的内存状态、完全由客户端渲染的界面”，官方明确说它不是普通语言选择器该用的方式。**Paraglide 没有做原地切换的成熟方案，这是它有意的设计取舍，不是还没来得及做。**

| 原地切换reload                                               |                                            |                                              |
| -------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| 未保存的状态                                                   | 保住                                         | 丢失，靠 leave guard 拦截确认                        |
| 正确性                                                      | 依赖每个组件都会重新渲染                               | 天然正确                                         |
| 模块顶层算好的文字、`document.title`、Mantine 日期的 locale、各种 Intl 缓存 | 每一处都要记得跟着更新                                | 不用管                                          |
| 以后引入 React Compiler                                      | 我推断会出问题：`m.x()` 没有响应式依赖，编译器会把结果缓存住，切换后文字不变 | 不受影响                                         |
| 每个 chunk 能否只带一种语言                                        | 不能，两种语言必须一直都在                              | 可以，Paraglide 的 static locale 构建一旦成熟，消息体积直接减半 |
| 服务端渲染文字                                                  | 不可行，切换后所有数据都要重新拉                           | 可行                                           |

决定性的一点是：**切换语言是极低频的操作，而原地切换的复杂度要让每个组件每天都付出。** 大多数人一辈子只切一次，而且多半是在登录页切的，那里本来就没有什么状态可丢。

### 二、让 reload 不那么疼的几个办法

按性价比排序：

1. **让“切换”这件事几乎只发生一次。** 账户上的 `preferredLocale` 在用户登录时就写进这台设备的 cookie，这样用户换一台设备也不用再切。这比任何动画效果都有用。
2. **登录页切换没有代价；在账户抽屉里切换则走 leave guard。** 页面有未保存内容时先弹确认。URL 在 reload 后自然保留，滚动位置可以先存进 sessionStorage，新页面加载后再恢复。
3. **多标签页通知。** `session-recovery.ts` 里已经在用 BroadcastChannel。一个标签页切换了语言，其他标签页不要自动刷新（它们可能有未保存的内容），而是像现在的“Qualy 已更新”那样给一个不打断操作的提示。这期间，各标签页的请求继续带上自己页面当前的语言。
4. **过渡动画可以做，但收益有限。** 浏览器的跨文档 view transition 明确不支持 reload，但用 `location.replace(location.href)` 跳转属于 replace 类型的导航，是支持的（Chrome 和 Edge 126 以上、Safari 18.2 以上，Firefox 不支持）。问题是新页面的第一帧是 boot 加载屏，所以效果只是从旧页面淡入到加载屏。可以留作最后的打磨，先验证再说。
5. **为将来的 static locale 构建预热。** 等以后每种语言各有一套 chunk，可以在用户打开语言菜单时预加载另一种语言的入口，这样 reload 时直接命中缓存。

### 三、UiText 还是服务端渲染成字符串

你的判断是对的，但我想把理由说得更准确一些：问题不在于“Paraglide 的函数没法传输”，而在于**文字应该在哪一端渲染**。

- **原地切换的世界里：** 浏览器必须能在不重新请求的情况下，把服务端给的文字换成另一种语言，所以只能传一个 id，由浏览器去查。UiText 就是为这个场景设计的，它在 Lingui 时代是合理的。
- **reload 的世界里：** 一个页面从加载到关闭只使用一种语言，这时候语言就是请求的一个属性。UiText 唯一不可替代的优势（数据与语言无关，可以原地重新渲染）已经消失，剩下的只有成本。

上一轮我说“保留 UiText，把写法改成传 wire 值”，这个结论我收回。把两边真正需要的配套机制放在一起对比：

**保留 UiText 需要：** 每个插件写一个 `wire.ts`，用 `defineWire` 做类型约束，由 collector 生成 shell 里的分发表，由生成代码填充 `defaultMessage`，处理版本错位时的降级，还要把服务端插件的文案全部编译进浏览器包。

**服务端渲染需要：** 在一个地方做响应边界的渲染，再加上请求携带语言。

服务端渲染还额外带来几个 UiText 做不到的好处：

- **版本错位问题消失。** 服务端永远拥有自己要说的每一句话，旧页面不会再遇到它不认识的 id。
- **可以带参数。** 比如“3 条仍在审核中”这种句子，服务端直接渲染就行，不需要去设计 wire 上怎么传 `values`、数字和日期怎么格式化。
- **插件边界更干净。** 服务端插件的文案只存在于服务端。一个只有服务端代码的第三方插件，不需要为了几个菜单名把消息编译进浏览器包。
- **机器可读性不受影响。** 我看了合约：每个 label 旁边都有一个稳定的 code，比如权限码、动作码、surface key。label 本来就只是用来展示的，程序要识别的话用 code。

我也检查了浏览器端有没有依赖 UiText 的结构：除了 `formatText` 自己，只有几处用 `label.id` 当 React key，而那些都是浏览器本地的 descriptor，不是从 wire 传来的。所以把 wire 上的类型改成 `string`，浏览器端几乎不用改。

#### 具体怎么落地

- **插件内部仍然保留语义类型**，比如 `Text = 消息函数 | literal`。插件贡献的依然是“一句产品文案”或“一段原样的业务数据”，这个语义还在，只是不再原样出现在 wire 上。
- **只在 HTTP 编码的边界渲染一次。** 在 api-kit 层做一个统一的 Schema 变换，用请求上下文里的 `RequestLocale` 渲染，HTTP 合约上的字段类型就是 `string`。
- **三条纪律：**&#x20;
  1. 只在边界渲染。
  2. 渲染好的结果不缓存、不持久化。唯一的例外是显式以 source locale 渲染的镜像数据，比如 `Permission.name`。
  3. 后台任务只存 code，不渲染文字。
- **请求语言从哪里来：** API client 统一给每个请求带上 `x-qualy-locale`，值取自页面上的 `data-locale`。这样多个标签页用不同语言也各自正确。没有这个 header 时，按 cookie、`Accept-Language`、产品默认语言的顺序回退。WebSocket 不能自定义 header，如果以后要通过它传文字，就把语言放在连接 URL 的参数里。
- **API 错误仍然在前端翻译。** 界面需要根据错误码做不同的处理和放置位置，这部分本来就是前端静态引用的消息，正好符合 Paraglide 的用法。
- **邮件的规则不变。** 给本人发的信用当前请求的语言，给其他人发的信用收件人账户上的 `preferredLocale`，没有设置的话用产品默认语言。

这样可以删掉的东西：wire 上的 UiText 类型、`defaultMessage`、`formatText`、分发表的代码生成，以及版本错位时的降级逻辑。

**这个方案什么时候会变成错误的选择：** 哪天你决定要原地切换语言，或者要让 API 响应可以跨语言缓存。所以 ADR 里要把“切换语言等于 reload”写成前提，并注明：这两个决定只能一起改。

Sources:

- [Paraglide JS Basics](https://paraglidejs.com/basics)
- [Cross-document view transitions (Chrome for Developers)](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document)

所以此时你再考虑下，Lingui和Paraglide到底哪个更合适，Paraglide可以带来什么，是否值得为了Paraglide带来的好处切换至Paraglide（之前我们的讨论是值得），你考虑下，客观中立地分析。

这次我先把前几轮认定的“Paraglide 的好处”逐条拆开，区分哪些是 Paraglide 独有的、哪些其实是框架无关的架构决定。再量一个关键数字：两种语言同时打包到底要多花多少字节。

结论先说：**Paraglide 仍然更合适，但优势比前几轮说的小得多。** 前几轮算在 Paraglide 头上的好处，有一大半其实是架构决定，换成完整的 Lingui 也同样能做到。真正属于 Paraglide 独有的优势只有三条，而且其中最大的那条要靠实测才能确认。

### 一、先把框架无关的部分剥离出来

下面这些决定，用完整的 Lingui 同样能做到。它们不应该算作换框架的理由：

- 切换语言用 reload
- 服务端在响应边界把文字渲染成字符串，UiText 退役
- 邮件、bootstrap、浏览器共用一份消息源（Lingui 在服务端建一个 i18n 实例，bootstrap 从编译好的 catalog 里抽取即可）
- 生产包不再携带 defaultMessage、ICU 在构建期编译、浏览器端不再带编译器
- 每个插件自己维护消息源，由 assembly 收集
- 语言 cookie、`preferredLocale`、给收件人发信时用收件人的语言

把这些拿掉之后，两个框架真正的差别就清楚了。

### 二、真正属于 Paraglide 的优势

1. **按 import 图自动精确拆分。** 页面引用了哪几条消息，就只下载哪几条。不需要设计 catalog 怎么分组，不需要“所有 catalog 到齐才能渲染”这道异步门槛，也就不存在“语言包加载失败”这种故障。Lingui 要逼近这个效果，只能人工分组，或者用它还处于实验阶段的按入口抽取。
2. **所有消息的参数类型都由编译器生成，包括延迟使用的那些。** 用 Lingui 的 `t` 宏时，参数本身就是 JS 表达式，天然有类型；但 `msg` 这种延迟 descriptor 到真正格式化的时候，参数就失去类型了。Qualy 的错误注册表和按枚举建的消息映射大量用的正是延迟消息，现在那套 `defineMessage<Values>` phantom type 体系就是为了补这个洞而存在的。
3. **服务端调用更简单。** 直接 `m.x(inputs, { locale })`，不需要为每个请求准备一个 i18n 实例。这条优势比较小。

### 三、真正属于 Lingui 的优势

1. **只下载一种语言。** 我用脚本把全产品 4193 条中英对照消息抽了出来，做 Brotli q11 压缩：

| 形式中文英文中英都带  |         |         |         |
| ----------- | ------- | ------- | ------- |
| 带 id 的 JSON | 54.0 KB | 56.0 KB | 90.9 KB |
| 只有文案值       | 32.4 KB | 35.5 KB | 69.7 KB |

带 id 的中文是 54.0 KB，和生产环境实测的 54.7 KB 基本吻合，说明这个脚本的抽取是可信的。

从“只有文案值”这一行看，同时带两种语言的体积是只带中文的 **2.15 倍**。所以 Paraglide 在字节上要赢，一个页面用到的消息必须少于全产品的大约 45%。任何单个页面都远低于这个比例，所以首屏一定是 Paraglide 赢。但反过来，一个把后台页面全逛一遍的管理员，整个会话累计下载的量会比 Lingui 只拉一次整包还多。

2. **文件少而大，没有碎片化风险。** Qualy 在 chunk 上踩过的坑（请求数膨胀、chunk 之间互相引用形成环）都是 Paraglide 路线才会碰到的。
3. **成熟度。** 在 React 生态里用的人更多，`<Trans>` 富文本、PO 和 TMS 工作流都很成熟，语言数量多了也能扩展。Paraglide 从 1.x 升到 2.x 时 API 有过大改，而它最诱人的 static locale 目前还是实验特性。

### 四、收益大概有多大

你今晚那次 PoC 是一个很好的参照：只是把 defaultMessage 抽掉，首屏 i18n 体积就从 82.8 KB 降到 43.7 KB，手机上的 LCP 改善了 2 到 377 ms。

完整的 Lingui 大约就停在这个水平：全产品的中文 catalog 加上 id 开销，首屏 i18n 约 40 KB。Paraglide 的首屏只包含当前页面用到的消息，我估计是 5 到 15 KB（这是估计，没有实测）。**相比完整 Lingui，Paraglide 大约还能再省 25 到 35 KB，量级和那次 PoC 相当。** 收益是真实的，但属于“再省一截”，不是数量级上的差别。

### 五、客观判断

| 维度更占优的一方         |                             |
| ---------------- | --------------------------- |
| 首屏字节             | Paraglide，约 25 到 35 KB（估计）  |
| 请求数和 chunk 图的健康度 | Lingui（Paraglide 这项未验证，有风险） |
| 整个会话累计下载量        | Lingui                      |
| 失败模式和异步门槛        | Paraglide                   |
| 类型安全             | Paraglide                   |
| 成熟度和生态           | Lingui                      |
| 以后语言数量增多         | Lingui                      |
| 迁移成本             | 两者差不多，都要改写 4216 条消息的所有调用点   |

综合下来，Paraglide 仍然更贴合 Qualy 的实际情况：语言只有两种，页面拆分得很细，大量后台功能访问频率很低。但它的优势是有条件的，**这个条件就是 chunk 图的健康度，这一项到现在还只是推测，没有实测过。** 如果 PoC 显示请求数明显增加，完整 Lingui（一种语言一个编译好的 catalog，加上 reload 和服务端渲染）是一个完全站得住的方案，而不是之前说的“只用了一半的四不像”。

### 六、所以我建议调整一下顺序

1. **先做框架无关的部分**，这些无论最后选哪个框架都不会白做：切换改成 reload、语言 cookie 和 `preferredLocale`、邮件改用收件人语言、服务端在响应边界渲染文字的钩子，以及把巨型 `i18n.ts` 按 feature 拆散。
2. **再做 Paraglide PoC**，只看一件事：四个代表页面在生产构建下的 chunk 图，对照组是“完整 Lingui 加单一 catalog”。
3. **根据结果决定：** 请求数不增加，就切 Paraglide；请求数明显增加且调整不过来，就落地完整 Lingui。

第 1 步里有一件事要避开：不要现在就把 defaultMessage 抽取那次 PoC 正式落地。它是 Lingui 专属的工作，如果最后切到 Paraglide，这部分就白做了。



\---



你再考虑下。

我重新核对了当前 Qualy 远端代码、Lingui 6 的完整生产链，以及 Paraglide 现在的 Vite 8/Rolldown 路线。我的判断比前几轮稳定了：

**最终我仍然会选 Paraglide；语言切换选 full reload；但我不会因此把 API 的 `UiText` 改成服务端渲染字符串。**

这三个决策应该拆开，不应该再互相推导。

### 先说 Lingui vs Paraglide

那份分析有一点非常重要：很多收益确实不是 Paraglide 独有的。Lingui 6 如果按完整方式使用，已经不是现在 Qualy 这种“`setupI18n + compileMessage + 手写 TS catalog`”的半套结构。Lingui 官方生产模式会移除 source/default message 和 runtime compiler，只加载当前 locale 的已编译 catalog；Vite 8/Rolldown 现在也有正式支持。

所以现在真正需要比较的是：

| | 完整 Lingui | Paraglide |
|---|---|---|
| 当前 locale 之外的语言 | 天然不下载 | 默认会随被使用的 message 一起带上 |
| 页面只用 50/4000 条消息 | 如果一个总 catalog，仍下载全部；要人工拆 catalog | bundler 天然只保留引用到的 message |
| 参数类型 | macro 调用不错，lazy descriptor 相对弱 | message function 参数天然生成类型 |
| 首屏 catalog activation | 有 | 没有 |
| catalog 分组 | 需要设计 | 真实 import graph 就是分组 |
| chunk 风险 | 低 | 要验证 |
| 多语言/TMS/PO | 更成熟 | 稍弱 |
| Qualy 当前 2 locale + 大量低频后台页面 | 尚可 | **非常契合** |

而 Qualy 最特殊的地方正是：

```text
4000+ messages
+
很多 lazy page / feature
+
大量普通用户永远不会访问的 admin UI
+
只有 zh-CN / en-US
+
Vite 8 / Rolldown
```

这实际上是 Paraglide 最有优势的一类应用。

官方现在明确把 `message-modules` 定义成 production 方案，让每条 message 成为 tree-shakable ESM；dev 则推荐 `locale-modules`，避免开发服务器产生海量请求。

而且 Paraglide 2.20 专门修了一个与你非常相关的问题：给 message module 输出加 `sideEffects: false`，就是为了让 **Vite 8/Rolldown 能从 `m` barrel 中按 entry 删除没用的 message，而不是让所有页面共同携带整站消息 union**。

所以 chunk 碎片化仍然要实测，但我现在不会因为这个理论风险退回 Lingui。

---

### 更关键的是，你最早那个“大胆设想”现在真的开始成为 Paraglide 官方路线了

这次查最新文档时发现了一个很重要的新变化。

Paraglide 当前已经有：

```ts
experimentalPerLocaleBuild: true
```

而且不是简单地跑两遍脚本。

它在 Vite 8 中为每个 locale 建立**独立的 Rolldown client environment**：

```text
zh-CN
  → 独立 Rolldown graph
  → dist/__paraglide/zh-CN/...

en-US
  → 独立 Rolldown graph
  → dist/__paraglide/en-US/...
```

inactive locale 根本不会进入这个 locale 的 graph，并且两个 locale 之间无法产生 shared chunk。Paraglide 只负责生成 locale-specific source 和 build plan，最终 chunk、hash、CSS、dynamic import 都还是 Vite/Rolldown 原生处理。

这其实就是你几轮前提出的：

> 用构建时间和磁盘空间换客户端性能，每种语言生成一套应用。

而且官方现在真的在做。

目前它仍是 experimental，所以**我不会让 Qualy 第一版生产迁移依赖它**。但这个方向极大增强了我对 Paraglide 长期路线的信心。

如果它稳定下来，Qualy 最终甚至可能获得：

```text
Paraglide message-level code splitting
+
每个 build 只有一个 locale
+
full reload locale switch
+
完全没有运行时 catalog
```

这几乎把 Paraglide 目前最大的短板——“两个语言都进入被引用 message”——也消掉了。

Lingui 很难同时得到这么自然的两种粒度：

```text
按 feature / import graph
+
按 locale
```

而不自己维护 catalog 边界。

---

# 语言切换：我会正式选 reload

这一点我已经不太犹豫了。

Paraglide 官方行为就是：

```ts
setLocale('en-US')
```

更新 locale strategy 后进行 document navigation/reload。

官方对：

```ts
setLocale(locale, { reload: false })
```

的措辞也非常明确：这是给“必须保存不可恢复内存状态的完全客户端 surface”的 escape hatch，**不是普通 locale picker 的推荐方式**。它不会自动更新 React、`<html lang>`、metadata 等状态，需要应用自己建立响应式体系。

Qualy 如果为了保留现在的原地切换而包一层：

```text
Paraglide
+
locale React context
+
locale epoch
+
document synchronization
+
Intl cache invalidation
+
module-level string discipline
```

那其实是在重新造 Paraglide有意不要的 runtime i18n layer。

收益只是：

> 用户一年可能点一次的语言切换没有 reload。

我认为不值。

Qualy 已经有 leave guard，所以 dirty form 时：

```text
切换语言需要重新载入页面
→ 保存 / 放弃 / 取消
```

即可。

URL 不变，reload 后仍回当前页面。滚动恢复、多标签页提示都可以作为后续体验优化，不应该影响架构选择。

所以：

**theme 原地切；locale reload。**

这两个设置没有必要追求相同行为。

---

# 但是 reload 并不意味着应该杀掉 UiText

这里我不同意最后那份分析的核心推导：

> reload → locale 固定 → server 应该直接返回 localized string。

逻辑上并不成立。

reload 只消除了 UiText 的一个好处：

> 不重新请求数据，也能把已有服务端数据重新翻译。

但 `UiText` 还有其他价值，而且你已经测出了它的成本：

```text
184 条 dynamic wire messages
两语言
Brotli q11 ≈ 3.9 KB
```

这已经非常小。

为了省这几 KB，把：

```text
API:
language-independent semantic response
```

改成：

```text
API:
request locale-dependent presentation response
```

我认为不划算。

尤其 Qualy 有明确的：

```ts
message(...)
literal(...)
```

区别：

```text
message
= 产品自身的可翻译文案

literal
= 机构名、角色名、组织名、管理员配置文字等业务数据
```

这是一个很好的协议语义。

它与 Lingui 没有本质关系。

我反而建议迁 Paraglide 时把它重新命名、重新定义：

```ts
type RemoteText =
  | {
      kind: 'message'
      id: RemoteMessageId
      fallback: string
    }
  | {
      kind: 'literal'
      value: string
    }
```

或者物理名字暂时继续叫 `UiText`，ADR 里明确：

> `UiText` is Qualy's remote text protocol, not an i18n-framework descriptor.

这就彻底摆脱 Lingui 遗留意味了。

---

### Paraglide 本身其实认可这种动态消息模式

Paraglide 官方针对 dynamic keys 的建议正是：

```ts
const navMessages = {
  home: m.xxx,
  about: m.yyy,
}

navMessages[key]()
```

也就是先建立一个**有限、静态可分析的 key → message function map**，避免任意动态查找破坏 tree-shaking。

Qualy 的：

```text
server sends id
→ browser finite wire map
→ Paraglide function
```

只不过是把这个模式跨了一个 HTTP boundary。

Paraglide没有定义“remote message protocol”，因为那已经属于应用协议设计，不是通用 i18n library 应该决定的东西。

因此我现在完全不认为：

> “Paraglide message 是函数，所以 UiText 不自然。”

反而应该理解为：

> **Paraglide function 是本地实现；UiText 是这个 message identity 的远程引用。**

就像服务端不可能把一个 JS callback 发过网络，也不会因此认为 RPC method ID 是坏设计。

---

# 服务端什么时候应该直接渲染？

我会划一条非常清楚的边界。

**有一个浏览器/UI renderer 的 HTTP API：继续传 `UiText/RemoteText`。**

比如：

```text
manifest
permission catalog
audit metadata
login method descriptors
node usage
```

**没有后续 renderer 的最终输出渠道：服务端直接渲染。**

比如：

```text
邮件
未来的 localized PDF/export
短信
server-rendered maintenance/error page
```

这时：

```ts
m.mailPasswordReset(inputs, { locale })
```

就是完全正确的。

这比“所有 API 一律服务端字符串”边界更自然：

```text
API carries semantics
final channel carries rendered text
```

---

# 我还会保留 `fallback/defaultMessage`

尤其因为 Qualy 的 release model。

旧页面可以在检测到 server release 改变后继续工作，而不是立刻强制刷新，因此：

```text
browser N
server N+1
```

短暂共存是真实状态。

如果 N+1 server 返回：

```text
new/message/id
```

N browser 的 dispatch table 没有它：

```ts
wire[id]?.() ?? fallback
```

至少仍然能显示人话。

这正是 fallback 该存在的地方。

与现在的：

> “每个静态客户端 message 都携带 defaultMessage，以防整个 catalog 坏掉”

完全是两回事。

所以迁完以后，`defaultMessage` 的职责反而比今天更纯粹。

---

# 最终我会怎么拍板

我的最终架构选择已经可以写成：

```text
i18n framework
    Paraglide JS

message source
    plugin-owned ICU1 JSON

build
    assembly 临时 merge inlang project
    dev → locale-modules
    prod → message-modules

browser static UI
    typed Paraglide message functions
    随真实 import graph tree-shake/code-split

dynamic server-selected UI text
    Qualy RemoteText / UiText
    generated finite Paraglide dispatch map

mail / export / non-browser final output
    server-side Paraglide rendering

locale switch
    full document reload
    leave guard protects dirty state

locale preference
    explicit device cookie
    + nullable account preferredLocale

future
    evaluate Paraglide per-locale Vite builds
```

而不是：

```text
Paraglide
→ 所以一切都必须变成 Paraglide function
→ 所以 server 必须提前翻译 API string
```

后者是把 library abstraction 推过头了。

---

至于“到底值不值得从 Lingui 换过去”，我现在的答案仍然是：

**值得。**

但理由不应该是“Lingui 落后”——完整 Lingui 6 是完全合格而且成熟的方案。

真正的理由是 **Qualy 的页面和插件拆分方式与 Paraglide 的编译模型高度同构**：

```text
Qualy:
页面/feature 本来就是 lazy module graph

Paraglide:
消息本来就是普通 ESM function graph
```

两者合起来以后：

> **代码到了哪里，文案自然就到哪里。**

不再维护第二张“哪个 feature 应该加载哪个 catalog”的图。

这是我认为 Paraglide 对 Qualy 最有价值、也最有长期意义的优势。

唯一还保留否决权的就是你已经识别出的那个问题：**production chunk graph**。但 Paraglide最近已经专门为 Vite 8/Rolldown 修过 barrel tree-shaking，未来还在推进真正的 per-locale Vite environment build，所以这个风险现在比我们前几轮讨论时还低了一些。

如果 PoC 最后证明四个代表页面请求数、首屏闭包和 chunk ring 都健康，我会直接迁 Paraglide，不再继续投入现有 Lingui runtime。

这次我不再在两个方案之间来回摇摆，而是回到 Qualy 的具体情况，把两边的实际得失摆出来，给一个明确的判断。先核对两个会影响判断的事实：manifest 有没有被缓存起来跨越 reload，以及服务端现在因为 UiText 受到了哪些限制。我的结论是：**不保留 UiText，服务端在返回响应前把文字渲染成字符串。** Paraglide 和 reload 这两点我们已经一致了，我只在 UiText 这一件事上说明理由。我会逐条回应对方的论点，并说明我在什么情况下会改判。

## 一、“这三个决定应该拆开”这个前提不成立

对方认为 Paraglide、reload、UiText 三件事互不相关，可以分别决定。但它们之间存在依赖关系：

- **服务端渲染必须以 reload 为前提。** 如果允许原地切换语言，已经拿到手的字符串无法换成另一种语言，只能重新请求所有数据。
- **UiText 两种情况都能工作。** 所以 UiText 真正的价值，是保留“以后改回原地切换”的可能性。

而对方自己看好的 `experimentalPerLocaleBuild` 恰恰会把这个可能性彻底关掉：每种语言都是一套独立的应用，切换语言只能 reload。**也就是说，它期待的那个未来里，UiText 唯一不可替代的价值不存在了。**

## 二、逐条回应对方保留 UiText 的理由

**“只有 3.9 KB，很小。”**\
&#x20;同意，字节从来不是问题。问题在机制：保留 UiText，浏览器端就要有两条出文字的路径，一条是静态 import 的消息函数，另一条是生成出来的分发表加上 fallback。改成服务端渲染后，浏览器只剩一条路，服务端也只有一条路。

**“API 应该传语义，不应该传展示结果。”**\
&#x20;我查了源码：`UiTextSchema` 在 API 合约里只出现在五处：app manifest、ui surfaces、auth api、org api、assessment surfaces。这些接口本身就是在描述界面，返回的是导航、菜单、登录方式、权限列表的显示信息，属于为前端服务的展示型接口，而不是领域 API。语义身份在每个 label 旁边那个稳定的 code 上，比如权限码、动作码、surface key。label 本来就是展示用的。

**“message 和 literal 的区分是很好的协议语义。”**\
&#x20;这个区分我同意保留，但它应该留在服务端内部的类型里。它的作用是回答“这段文字要不要翻译”，渲染完成后这个问题就不存在了，所以没有必要让它出现在网络上。

**“这就像 RPC method ID。”**\
&#x20;RPC 能只传一个 ID，前提是两端的 schema 版本一致。Qualy 的发布模型允许旧页面和新服务端短暂共存，所以才需要 fallback 来补这个洞。对方把 fallback 说成一项能力，我认为它是这个协议在版本错位时的一个症状。服务端渲染根本不会遇到版本错位。

**“Paraglide 官方也推荐动态 key 用有限映射。”**\
&#x20;官方那条建议针对的是同一个应用内部的动态 key，两端必然是同一次构建。跨网络、跨版本是另一回事，它不能用来论证 UiText。

## 三、服务端渲染能做到、UiText 做不到的事

1. **没有版本错位问题。** 服务端永远认识自己要说的每一句话。
2. **可以带参数。** 比如“还有 3 条在审核中”，不需要在 wire 上设计 `values` 字段以及数字、日期怎么格式化。
3. **服务端可以按显示文字来搜索、排序、分页。** 现在做不到，`rbac/server/index.ts` 第 722 到 723 行的注释写得很清楚：服务端“没有读者可以为之选择语言”，所以按显示文字搜索只能交给前端屏幕去做。这也是 RoleEditor 必须把整个权限目录拉下来、在前端过滤的原因。数据量小时没问题，一旦要在服务端分页，这个限制就会卡住。
4. **只有服务端代码的插件不需要进浏览器包。** 第三方插件贡献几个菜单名，也不必把消息编译进前端。

## 四、服务端渲染的代价

- **请求要携带语言。** 这件事本来就要做，因为用户本人触发的邮件需要知道当前语言。做法是：API client 统一带上 `x-qualy-locale`（取自页面上的 `data-locale`）；没有这个 header 时，按 cookie、`Accept-Language`、产品默认语言的顺序回退。WebSocket 和 SSE 不能自定义 header，就在建立连接时把语言放进 URL 参数。
- **响应内容随语言变化。** 我检查过：`/api` 统一是 `no-store`，manifest 也没有被存进 sessionStorage 或 localStorage，所以不存在跨语言复用缓存的问题。
- **要改的地方很集中。** 就是上面那五处合约，外加大约十个返回 label 的 handler。
- **测试里的响应快照会带上语言。** 这是小代价。

## 五、具体怎么设计
```ts
// 服务端内部：保留语义
type Text = MessageFn | { kind: 'literal'; value: string }

// handler 内：显式渲染，语言取自请求上下文里的 RequestLocale 服务
label: yield* render(permission.name)

// HTTP 合约：字段类型就是 string

```

合约字段是 `string`，内部字段是 `Text`，**漏掉渲染这一步会直接编译失败**，不需要额外的 lint 或 CI 检查。

然后定三条纪律：

1. 只在构造响应的时候渲染。
2. 渲染结果不缓存、不持久化。唯一的例外是显式按 source locale 渲染的镜像数据，比如 `Permission.name`。
3. 后台任务只存 code，不渲染文字。

邮件、导出等最终输出渠道也用同一个 `render`，只是语言的来源不同：给本人发的用请求语言，给其他人发的用收件人账户上的偏好。

这样可以删掉的东西：UiText 这个 wire 类型、`defineWire`、分发表的代码生成、`defaultMessage`、版本错位时的降级逻辑，以及浏览器端的 `formatText`。

## 六、什么情况下我会改判，选择保留 UiText

只要满足下面任意一条，UiText 就是更好的选择：

- 你想保留以后改回原地切换语言的可能性，也就是不打算走 per-locale build 那条路。
- 这些接口将来要开放给第三方，并且需要与语言无关的稳定输出。
- 未来要在客户端做跨语言的持久化缓存，比如离线模式。

按目前 Qualy 的方向，这三条都不成立。所以我的判断是：**Paraglide + reload + 服务端在构造响应时渲染文字。** 如果你想把这个决定写进 ADR，建议把“切换语言等于 reload”和“服务端渲染 UiText”写成一对绑定的决定：以后只要推翻其中一个，另一个就必须一起重新评估。



---



你思考下。

这次我会把结论再收紧一些：

**对于 Qualy，我现在倾向正式选 Paraglide；语言切换采用 full reload；而 `UiText` 只保留为服务端内部的“可翻译文本/字面量”语义，退出 HTTP wire，API 对浏览器返回已经按当前 document locale 渲染好的 `string`。**

也就是说，我这次在 `UiText` 这一点上会站到你贴出的这份分析这一边。前面我坚持 wire `UiText`，主要是担心丢掉语义和增加 API locale coupling；重新把 Qualy 的 API 形态、reload 模型、多标签页、Paraglide 本身的设计放在一起之后，我认为这些代价可以控制，而删掉 wire `UiText` 后整体模型确实更统一。

但我会对那份报告再修正几个细节。

---

## 1. reload 应该定下来，不再保留“原地切换”作为同等目标

Paraglide 官方现在的设计非常明确：

```ts
setLocale("en-US")
```

默认会进行 document navigation/reload；`reload: false` 被明确描述成 client-only escape hatch，不是正常 locale picker 应采用的方式，而且不会自动重渲染框架、更新 `<html lang>`、title、metadata 等状态。

这其实和 Qualy 很吻合。

你现在的原地切换之所以正确，是因为自己维护了一套完整响应式机制：

```text
setLocaleState
→ async loadCatalogs
→ i18n.activate
→ activated 改变
→ I18nContext runtime 重建
→ consumers rerender
```

以后换成 Paraglide，如果为了继续保住原地切换，就要重新人为建立一套：

```text
locale epoch/context
module-level formatting discipline
Intl cache invalidation
document.title synchronization
第三方 widget locale synchronization
所有 memo/computed string 的依赖纪律
```

而收益只是“语言选择时不 reload”。

语言切换的发生频率与主题切换完全不是一个级别。为了一个一年可能只发生一次的交互，让整个 UI 生命周期一直承担 reactive-locale correctness，不划算。

所以我会正式冻结：

> **Qualy 的 locale 是 document-scoped immutable state。一个 document 从创建到销毁只有一个 locale。**

Theme 可以 live switch，locale 不需要。

---

## 2. Paraglide 正在朝这个架构继续走，而不是和它逆着走

这也是我最终更偏 Paraglide 的原因。

Paraglide production 默认推荐：

```text
dev  → locale-modules
prod → message-modules
```

production 每条消息成为独立模块，交给 bundler 按真实 import graph tree-shake；开发环境则减少模块数量，避免 dev server 请求爆炸。

而更重要的是，它现在已经提供实验性的 **per-locale Vite 8 build**：

```ts
experimentalPerLocaleBuild: true
```

每个 locale 是独立的 Rolldown client environment，inactive locale 根本不进入那个 build graph；切 locale 仍然要求完整 document navigation。

现在仍是 experimental，当然不能作为 Qualy 首版迁移的前提。

但它说明 Paraglide 的长期方向非常明确：

```text
message-level tree shaking
+
locale-level build isolation
+
full-document locale switch
```

这几乎就是 Qualy 最初提出的“用构建成本换客户端成本”的想法。

---

# 3. 我现在同意：wire `UiText` 可以退役

这里真正让我改判的并不是“reload 以后 UiText 技术上没用了”。

而是重新分类 Qualy 当前使用 `UiText` 的地方之后，发现它跨 HTTP 的用途基本都是 **presentation projection**：

```text
manifest
navigation / surface label
permission label / group / description
login method / field label
audit action display name
org node usage description
settings metadata
```

程序真正识别这些对象都有另外的稳定 identity：

```text
page/surface id
permission code
action code
login driver code
setting id
node usage kind
```

所以：

```json
{
  "code": "assessment.review.process",
  "name": "处理测评审核"
}
```

里面：

```text
code = semantics / machine identity
name = presentation
```

让 `name` 在 BFF/API projection 时成为 localized string，没有破坏领域身份。

这与“把业务语义翻译成字符串然后丢掉 code”是两回事。

---

## 4. `message | literal` 这个区分仍然值得保留——但留在 server/plugin boundary

这是我认为最漂亮的终局。

不要把现在：

```ts
type UiText =
  | {
      kind: 'message'
      id
      defaultMessage
    }
  | {
      kind: 'literal'
      value
    }
```

整个删除。

而是让它不再成为 HTTP contract。

内部可以变成类似：

```ts
type Text =
  | MessageFunctionReference
  | LiteralText
```

插件仍然写：

```ts
navigation: {
  label: m.assessmentRounds
}
```

或者：

```ts
provider: {
  label: literal(adminConfiguredName)
}
```

所以插件层依然能够表达：

> 这是产品 copy，需要 localization。

和：

> 这是机构/用户配置的数据，必须原样显示。

然后 BFF/handler 在最后构造 HTTP DTO 时：

```text
Text
 ↓ render(RequestLocale)
string
```

HTTP schema 就只是：

```ts
label: Schema.String
```

我觉得这个边界比现在更干净：

```text
Plugin/domain composition
        ↓
保持 text semantics

HTTP presentation boundary
        ↓
localized string

Browser
        ↓
直接显示
```

---

# 5. 这不是“所有领域 API 都 locale dependent”

这是前面我反对服务端渲染的最大顾虑，现在我认为可以避免。

不要做一个神奇的：

```text
api-kit 自动递归遍历任何 response
碰见 UiText 都翻译
```

我不建议这种 invisible framework magic。

而是明确：

> **只有 presentation DTO 才允许 `Text -> string` projection。**

例如：

```ts
const permissionDto = (permission, locale) => ({
  code: permission.code,
  name: renderText(permission.name, locale),
  description:
    permission.description === undefined
      ? null
      : renderText(permission.description, locale),
})
```

领域层：

```text
PermissionDefinition.name: Text
```

API：

```text
PermissionDto.name: string
```

这样在类型层就能保证：

```text
domain type
≠
wire type
```

比把两者共用同一个 `UiTextSchema` 更清晰。

---

# 6. `x-qualy-locale` 在这个模型下反而很合理

前面我们讨论过 cookie；我现在认为最终应该同时有：

```text
cookie
= future document 的 preference

x-qualy-locale
= 当前这个 document 实际正在使用的 locale
```

这是非常重要的区别。

假设：

```text
Tab A = zh-CN
Tab B 中用户切成 English
```

B：

```text
写 cookie = en-US
reload
```

A 没有自动刷新，因为它可能有未保存内容。

如果 server 只读 cookie：

```text
A 的 UI 还是中文
但 A 后续 API response 变成英文
```

这才是真 bug。

如果 API client 始终发送：

```http
X-Qualy-Locale: <document.documentElement.dataset.locale>
```

那么：

```text
A document → zh-CN responses
B document → en-US responses
```

直到 A 自己 reload。

这非常适合 document-scoped locale 的设计。

所以 locale resolution 我会正式分成：

```text
创建 document 时：
explicit cookie
→ account preferred locale（登录恢复场景）
→ navigator / Accept-Language
→ product default

document 创建后：
data-locale 固定

document 内 API：
x-qualy-locale = data-locale
```

不是每一个 request 都重新“推断用户想用什么语言”。

---

# 7. 邮件又是另一套 locale source

这里不要复用一条万能 `RequestLocale` 规则。

应该按 recipient 语义决定：

```text
用户给自己触发邮件
→ current document locale

管理员给另一个账号触发邮件
→ recipient.preferredLocale
→ product default

后台主动通知
→ recipient.preferredLocale
→ product default
```

这一点之前已经定得比较清楚。

Paraglide message function 可以显式：

```ts
m.emailChanged(..., { locale })
```

并不需要依赖 global/current browser locale。官方本身支持 per-call locale override。

---

# 8. 服务端渲染确实消掉了一个不太漂亮的跨 release 问题

保留 UiText 时：

```text
server N+1
→ message id "foo/new"

browser N
→ wire table 没有 foo/new
→ fallback
```

我们之前说：

> fallback 是一个很好的 resilience feature。

没错。

但从更高一层看，它确实也是**协议存在双端 message registry**产生的问题。

如果服务端直接：

```text
foo/new
→ "New feature"
```

browser N 只看到：

```json
{
  "code": "foo",
  "label": "New feature"
}
```

就不需要知道 N+1 的 message identity。

对于 Qualy 这种明确允许 old browser / new server 短暂共存的 release architecture，这是实质简化。

当然迁移 `UiText → string` 本身是一次 API schema break，需要正常走 protocol compatibility/version migration；但这是一次性的。迁完以后未来文案变化不再进入 browser/server protocol compatibility surface。

这个长期收益我认为值得。

---

# 9. 服务端带参数也是一个真实优势

这也让我更倾向 server rendering。

今天 wire message 之所以能如此简单，是因为它们恰好都是无参数：

```ts
{id, defaultMessage}
```

但未来很容易出现：

```text
3 个角色正在使用此权限
5 个节点无法删除
最后更新于 2 小时前
```

如果继续 RemoteText，就要逐渐演化成：

```ts
{
  id,
  values: {
    count: 3
  },
  fallback
}
```

然后必须定义：

```text
values 可以有哪些类型？
Date 怎么传？
number 谁 format？
timezone 谁决定？
rich data 怎么办？
```

很快就变成一套远程 MessageFormat RPC。

服务端 render 后：

```json
{
  "label": "3 个角色正在使用此权限"
}
```

到此结束。

对于这些**server-selected display phrases**，我认为服务端本来就是最知道参数的人。

---

# 10. 还有一个重要收益：server-side search/sort/filter

报告这里虽然把 RBAC 当前例子夸大了一点——现在 RoleEditor 确实在客户端搜索——但长期方向是成立的。

目前服务端之所以写：

```ts
plainText(definition.name)
```

就是因为：

> server doesn't know the reader's locale.

如果 request 有一个明确 `RequestLocale`，服务端可以：

```ts
const name = renderText(permission.name, locale)
```

然后按：

```text
code
or localized name
```

过滤。

当然，如果以后权限目录上万条、要做数据库级 locale-aware full-text search，就不是简单在应用内 render 可以解决的问题，需要真正 localized search index。

但至少现在这种几百条 registry：

```text
服务端 filter → paginate
```

成为可能。

这不是决定性理由，但确实属于 server rendering 的顺带收益。

---

# 11. 还有一个非常容易忽略的第三方插件收益

如果 server-only plugin：

```text
贡献一个 audit action
贡献一个 manifest item
贡献一个 permission
```

然后它自己的文案只在服务端存在。

服务端渲染后：

```text
plugin JS/message data
```

根本不用进入 web assembly。

如果保留 RemoteText：

```text
browser 必须认识 plugin 的 message id
```

那么这个插件哪怕没有任何 browser implementation，也得向 browser build贡献一些 localization material。

对 Qualy 的 open-world plugin model 来说：

> **server-only plugin should remain server-only**

这是一个很漂亮的性质。

因此这一点也让我倾向 string-on-wire。

---

# 12. 所以“服务端渲染”不是因为 Paraglide function 不能传网络

这个措辞很重要。

不要在 ADR 里写：

> Paraglide 的函数无法序列化，所以服务端渲染。

那是偶然实现细节。

真正理由应该是：

> **Qualy 将 locale 定义为 document-scoped state；HTTP UI projections 是当前 document 的 presentation data，因此在 projection boundary 完成 localization。领域/plugin 内部仍保留 message/literal 语义。**

这样哪怕 5 年后 Paraglide 消失，架构仍然成立。

---

# 13. 那 Lingui 还有没有理由留下？

有，而且它是一个非常合理的 B 方案。

完整 Lingui 6 现在可以：

```text
source messages
→ extract
→ compile
→ production 去 defaultMessage/compiler
→ dynamic import 当前 locale catalog
```

只下载当前语言。Lingui 官方也明确推荐这么做。

Lingui 的优势：

```text
一个 locale 大 chunk
请求图简单
生态成熟
PO/TMS 很强
很多语言以后扩展更自然
```

如果 Qualy 是：

```text
20 locales
+
用户经常遍历大部分产品
+
页面代码没有特别强的 lazy boundaries
```

我会选 Lingui。

但它不是当前 Qualy。

---

# 14. Paraglide 值不值得迁？我的答案还是“值得”，但不是无条件

真正独属于 Paraglide 的价值，我现在只保留三个：

**第一，消息跟代码拥有相同的 module graph。**

这是最大的价值。

```text
MyEntriesPage
→ MyEntries code
→ MyEntries messages
```

不需要维护：

```text
MyEntriesPage
→ 哪个 catalog group？
```

这一张第二依赖图。

**第二，message function 是真正 typed function。**

```ts
m.foo({ count })
```

参数 schema 来自消息定义，不再需要 Qualy 的：

```ts
defineMessage<Values>()
```

phantom generic + ICU parser test 去证明两边一致。

**第三，没有 catalog activation lifecycle。**

当前：

```text
App
→ wait catalogs
→ activate
→ render
```

消失。

消息就是代码。

chunk 到了，消息就到了。

chunk 没到，整个 feature 都没到，由现有 ReleaseRecovery 处理。

这很符合 Qualy 已经成熟的 asset/release model。

---

# 15. 真正的否决条件只有 chunk graph

这一点报告说得很对。

你自己在 `vite.config.ts` 留下的历史已经足够说明：

```text
61 files
22 × <2KB

shared pool 4KB
→ +600ms boot

rc.2 / rc.3
→ mutual-import ring
→ production TDZ
```

不能为了理论上的 message tree shaking，再制造一次 dust explosion。

所以最后的决定不能靠架构讨论结束。

Paraglide PoC 应该和 **production-correct Lingui baseline** 真正 A/B：

```text
Lingui:
production strip defaults
compiled current-locale catalog

Paraglide:
message-modules
2 locales
current production splitting policy
```

比较：

```text
login
batch list
my entries
org tree
```

重点顺序我会定成：

1. first-screen static closure request count；
2. `<1KB` / `<2KB` chunk count；
3. compressed closure bytes；
4. critical request chain；
5. LCP；
6. TBT；
7. dev startup / HMR；
8. build time。

Paraglide 不需要显著击败 Lingui 才能赢。

例如：

```text
Lingui     27 requests / 610KB / 4.0s
Paraglide  27 requests / 600KB / 4.0s
```

我会选 Paraglide，因为结构收益很大。

但：

```text
Lingui     27 / 610KB / 4.0s
Paraglide  41 / 645KB / 4.4s
```

那就不要硬上。

---

## 我的最终裁决现在是

如果要直接写进 ADR，我会定：

> **Qualy adopts Paraglide JS as its application localization compiler. Locale is immutable for the lifetime of a document and locale changes perform a guarded full-document reload.**
>
> **Product text retains message-vs-literal semantics inside plugin/server composition, but HTTP presentation DTOs carry rendered strings. The current document locale is sent explicitly with API requests; mail and other out-of-band channels resolve locale from the recipient/request semantics appropriate to that channel.**
>
> **Plugin-owned ICU MessageFormat 1 JSON is the localization source of truth. Assembly produces an ephemeral merged inlang project. Development uses locale-modules; production uses message-modules. Experimental per-locale builds are not required for correctness and may be adopted once stable.**

也就是：

```text
                    Plugin
                      │
              Message | Literal
                      │
        ┌─────────────┴─────────────┐
        │                           │
 Browser static code          Server projection
        │                           │
 Paraglide function      render(text, RequestLocale)
        │                           │
 localized string             HTTP string
        │                           │
        └──────────── Browser ──────┘
```

我认为这比“浏览器一部分调用 Paraglide、一部分解析 RemoteText”更加统一，也比“把所有语言能力都塞到 server”更克制。

所以这轮我会**改掉前面坚持 wire `UiText` 的意见**：如果已经确定采用 Paraglide + full reload，并且 Qualy 没有离线/跨语言客户端缓存、公共 language-neutral API 这些需求，那么 **UiText 应退回 server/plugin 内部抽象，HTTP wire 上直接用 string，是更合适的终局。**

这次我不再在两个方案之间来回摇摆，而是回到 Qualy 的具体情况，把两边的实际得失摆出来，给一个明确的判断。先核对两个会影响判断的事实：manifest 有没有被缓存起来跨越 reload，以及服务端现在因为 UiText 受到了哪些限制。我的结论是：**不保留 UiText，服务端在返回响应前把文字渲染成字符串。** Paraglide 和 reload 这两点我们已经一致了，我只在 UiText 这一件事上说明理由。我会逐条回应对方的论点，并说明我在什么情况下会改判。

## 一、“这三个决定应该拆开”这个前提不成立

对方认为 Paraglide、reload、UiText 三件事互不相关，可以分别决定。但它们之间存在依赖关系：

- **服务端渲染必须以 reload 为前提。** 如果允许原地切换语言，已经拿到手的字符串无法换成另一种语言，只能重新请求所有数据。
- **UiText 两种情况都能工作。** 所以 UiText 真正的价值，是保留“以后改回原地切换”的可能性。

而对方自己看好的 `experimentalPerLocaleBuild` 恰恰会把这个可能性彻底关掉：每种语言都是一套独立的应用，切换语言只能 reload。**也就是说，它期待的那个未来里，UiText 唯一不可替代的价值不存在了。**

## 二、逐条回应对方保留 UiText 的理由

**“只有 3.9 KB，很小。”**\
&#x20;同意，字节从来不是问题。问题在机制：保留 UiText，浏览器端就要有两条出文字的路径，一条是静态 import 的消息函数，另一条是生成出来的分发表加上 fallback。改成服务端渲染后，浏览器只剩一条路，服务端也只有一条路。

**“API 应该传语义，不应该传展示结果。”**\
&#x20;我查了源码：`UiTextSchema` 在 API 合约里只出现在五处：app manifest、ui surfaces、auth api、org api、assessment surfaces。这些接口本身就是在描述界面，返回的是导航、菜单、登录方式、权限列表的显示信息，属于为前端服务的展示型接口，而不是领域 API。语义身份在每个 label 旁边那个稳定的 code 上，比如权限码、动作码、surface key。label 本来就是展示用的。

**“message 和 literal 的区分是很好的协议语义。”**\
&#x20;这个区分我同意保留，但它应该留在服务端内部的类型里。它的作用是回答“这段文字要不要翻译”，渲染完成后这个问题就不存在了，所以没有必要让它出现在网络上。

**“这就像 RPC method ID。”**\
&#x20;RPC 能只传一个 ID，前提是两端的 schema 版本一致。Qualy 的发布模型允许旧页面和新服务端短暂共存，所以才需要 fallback 来补这个洞。对方把 fallback 说成一项能力，我认为它是这个协议在版本错位时的一个症状。服务端渲染根本不会遇到版本错位。

**“Paraglide 官方也推荐动态 key 用有限映射。”**\
&#x20;官方那条建议针对的是同一个应用内部的动态 key，两端必然是同一次构建。跨网络、跨版本是另一回事，它不能用来论证 UiText。

## 三、服务端渲染能做到、UiText 做不到的事

1. **没有版本错位问题。** 服务端永远认识自己要说的每一句话。
2. **可以带参数。** 比如“还有 3 条在审核中”，不需要在 wire 上设计 `values` 字段以及数字、日期怎么格式化。
3. **服务端可以按显示文字来搜索、排序、分页。** 现在做不到，`rbac/server/index.ts` 第 722 到 723 行的注释写得很清楚：服务端“没有读者可以为之选择语言”，所以按显示文字搜索只能交给前端屏幕去做。这也是 RoleEditor 必须把整个权限目录拉下来、在前端过滤的原因。数据量小时没问题，一旦要在服务端分页，这个限制就会卡住。
4. **只有服务端代码的插件不需要进浏览器包。** 第三方插件贡献几个菜单名，也不必把消息编译进前端。

## 四、服务端渲染的代价

- **请求要携带语言。** 这件事本来就要做，因为用户本人触发的邮件需要知道当前语言。做法是：API client 统一带上 `x-qualy-locale`（取自页面上的 `data-locale`）；没有这个 header 时，按 cookie、`Accept-Language`、产品默认语言的顺序回退。WebSocket 和 SSE 不能自定义 header，就在建立连接时把语言放进 URL 参数。
- **响应内容随语言变化。** 我检查过：`/api` 统一是 `no-store`，manifest 也没有被存进 sessionStorage 或 localStorage，所以不存在跨语言复用缓存的问题。
- **要改的地方很集中。** 就是上面那五处合约，外加大约十个返回 label 的 handler。
- **测试里的响应快照会带上语言。** 这是小代价。

## 五、具体怎么设计
```ts
// 服务端内部：保留语义
type Text = MessageFn | { kind: 'literal'; value: string }

// handler 内：显式渲染，语言取自请求上下文里的 RequestLocale 服务
label: yield* render(permission.name)

// HTTP 合约：字段类型就是 string

```

合约字段是 `string`，内部字段是 `Text`，**漏掉渲染这一步会直接编译失败**，不需要额外的 lint 或 CI 检查。

然后定三条纪律：

1. 只在构造响应的时候渲染。
2. 渲染结果不缓存、不持久化。唯一的例外是显式按 source locale 渲染的镜像数据，比如 `Permission.name`。
3. 后台任务只存 code，不渲染文字。

邮件、导出等最终输出渠道也用同一个 `render`，只是语言的来源不同：给本人发的用请求语言，给其他人发的用收件人账户上的偏好。

这样可以删掉的东西：UiText 这个 wire 类型、`defineWire`、分发表的代码生成、`defaultMessage`、版本错位时的降级逻辑，以及浏览器端的 `formatText`。

## 六、什么情况下我会改判，选择保留 UiText

只要满足下面任意一条，UiText 就是更好的选择：

- 你想保留以后改回原地切换语言的可能性，也就是不打算走 per-locale build 那条路。
- 这些接口将来要开放给第三方，并且需要与语言无关的稳定输出。
- 未来要在客户端做跨语言的持久化缓存，比如离线模式。

按目前 Qualy 的方向，这三条都不成立。所以我的判断是：**Paraglide + reload + 服务端在构造响应时渲染文字。** 如果你想把这个决定写进 ADR，建议把“切换语言等于 reload”和“服务端渲染 UiText”写成一对绑定的决定：以后只要推翻其中一个，另一个就必须一起重新评估。



我去看一下术语库现在是怎么实现的，它和消息身份、渲染时机都直接相关。看完术语库的实现，有两个结论。**第一，它证明上一轮的判断是对的，而且比我当时设想的更好**：租户自定义用语已经用另一种方式解决了，不需要找回消息 key。**第二，它要求 `Text` 的签名改一下**：渲染时只知道语言还不够，还要知道是哪个租户。

## 一、术语库的设计恰好说明不需要消息身份

`settings-contract` 开头的注释写得很明确：这套机制**故意不提供**“覆盖任意 i18n 文案”的能力。租户能改的只是插件声明过的业务词，比如“学工号”；这些词作为 ICU 占位符的**值**注入到文案里：
```ts
// assessment 的消息
defaultMessage: 'Name or {businessNo}'
// 页面上
format(m.recordSearchList, { businessNo: useTerm(authTerms.businessNumber) })

```

上一轮我说“如果以后要让学校自定义用语，就得在运行时知道消息 key”。这个前提不成立：Qualy 已经选了一条更干净的路，**租户覆盖的是值，不是文案**。所以消息身份在运行时仍然不需要，这一点就此定下。

## 二、`Text` 的签名要从“只要语言”扩展成“要一个渲染上下文”

术语的值取决于租户，所以渲染一段文字需要两样东西：语言，以及这个租户的术语。改成：
```ts
interface RenderContext {
  readonly locale: Locale
  readonly term: (definition: TermDefinition) => string
}
type Text = (ctx: RenderContext) => string

```

术语本身也是一个 `Text`，并且可以作为消息参数传进去，渲染时先把参数里嵌套的 `Text` 解析掉：
```ts
term(authTerms.businessNumber)
text(m.recordSearchList, { businessNo: term(authTerms.businessNumber) })

```

服务端每个请求构造一次上下文：语言取自 `x-qualy-locale`，术语取自当前用户所属租户的 `TenantSettings.resolveTerm`，在同一个请求内缓存。邮件则用收件人的语言和收件人所属的租户。

这样 `assessment/core/src/server/index.ts` 第 3434 到 3438 行那段逻辑（有 settings 服务就查租户术语，没有就退回 `defaults['zh-CN']`，还要手动做一次 `localeOf`）就可以收成一句 `render(term(authTerms.businessNumber), ctx)`。测试环境里没有 settings 服务时，只需给一个 `term()` 直接返回默认值的上下文。

## 三、术语的默认值是第四份手写的翻译源，应该并进 Paraglide

现在是这样写的：
```ts
defaults: { 'zh-CN': '学工号', 'en-US': 'Student or staff ID' }

```

这份翻译游离在消息体系之外，缺译检查覆盖不到它，将来加第三种语言时也最容易漏。应该改成 auth 插件消息 JSON 里的一条普通消息，由术语定义引用它：
```ts
defineTerm({
  id: 'auth/business-number',
  default: m.termBusinessNumber,
  label: text(m.termBusinessNumberLabel),
  ...
})

```

`effectiveText` 的逻辑变成：该语言下租户有覆盖值就用覆盖值，没有就渲染默认消息。`normalizeOverride` 里“和默认值相同就不存”的规则照样成立：以后某个版本改了默认词，所有没有自定义过的租户会自动跟着变。

## 四、前端：术语跟着 manifest 一起下发

`client/terms.ts` 的注释说：terminology 的响应带上了所有语言，“切换语言时可以用同一份答案重新渲染”。这是为原地切换设计的。它还有一个代价：`useTerm` 在请求返回之前先显示插件默认的词，所以页面会先显示“学工号”，稍后才变成租户自定义的词。

换成 reload 模型之后：

- **页面用到的术语：** 由服务端按当前页面语言算出生效值，作为一个小 map 附在 manifest 响应里。manifest 在首屏渲染前就到了，所以不会再先闪一下默认词，也少了一次请求。`useTerm` 改为从 manifest 的 context 里读取。租户数量少、术语也少，这个 map 很小。
- **管理员编辑术语的页面：** 保留独立接口，返回各语言的原始覆盖值，因为编辑时需要同时看到所有语言。保存后刷新一次 manifest 即可。
- **前端组件：** 仍然显式传参，写成 `m.recordSearchList({ businessNo: useTerm(authTerms.businessNumber) })`。Paraglide 生成的参数类型会强制要求传 `businessNo`，不需要额外校验。

我不建议做“看到 `{businessNo}` 这个占位符名就自动填入租户术语”这种隐式规则。显式传参虽然多写一点，但类型可检查、调用处一眼能看出来。

## 五、一个需要写进规范的限制

术语是以值的形式替换进句子的，所以句子的语法不会随着术语变化。中文基本不受影响；英文里冠词、复数会出问题，比如 a 和 an 取决于后面词的发音，而这个词是租户填的。规范里应该写清楚：**术语只能出现在不受词形变化影响的位置**，典型的是标签和“姓名或{术语}”这种并列结构。需要复杂句式的地方，应该改写句子，而不是让术语去适配语法。

## 最终模型

- **插件内部：** `Text = (ctx: RenderContext) => string`，只有 `text()`、`term()`、`literal()` 三种构造方式。
- **所有产品文案，包括术语的默认值：** 都来自 Paraglide 消息，只有一份翻译源。
- **租户能改的：** 只有显式声明的术语，存储的是覆盖值。
- **网络上：** 只传渲染好的字符串，术语的生效值随 manifest 一起下发。



---



你再考虑下怎么实现吧，要结合Qualy实际，不要再把Lingui当年留下的遗留内容，比如defaultMessage带到Paraglide的体系里了。

这次我建议不要再做“UiText 的 Paraglide 版”。既然已经确定 **Paraglide + document-scoped locale + 切换语言 full reload + presentation API 服务端渲染**，就应该按这套前提重新设计，而不是把 Lingui 时代的 `MessageDescriptor / defaultMessage / UiText wire / formatText` 换个名字继续留下。

我会把终局定成：

```text
                    每个插件的 ICU1 JSON
                           │
                    assembly merge
                           │
                     Paraglide compile
                           │
              ┌────────────┴────────────┐
              │                         │
       Browser static UI          Server product text
              │                         │
         m.xxx(...)               text(m.xxx, ...)
              │                         │
              │                 render(ctx)
              │                         │
              │                    HTTP string
              └──────────────┬──────────┘
                             │
                           Browser
```

网络上不再存在 message id，也不存在 `defaultMessage`。message key 是 Paraglide/inlang 的编译期身份，不是 Qualy 的 API 协议。

Paraglide 当前 production 本来就推荐 `message-modules`，dev 推荐 `locale-modules`；message 函数也支持显式 `{ locale }` 渲染，所以这套模型是顺着 Paraglide 本身的设计走，而不是再包一层 Lingui 风格 runtime。

不过你贴出的方案里，我会改两个关键点。

### 第一，`Text = (ctx) => string` 还不够

这是我看完当前术语实现后最想纠正的地方。

现在：

```ts
TenantSettings.resolveTerm(...)
```

返回的是 `Effect.Effect<string>`，因为背后可能查数据库。也就是说：

```ts
interface RenderContext {
  locale: Locale
  term(def): string
}
```

并不能天然成立，除非你在创建 `RenderContext` 时先把整个租户术语表查完。

我不建议让一个普通 `Text` 闭包暗中进行异步工作，也不建议每渲染一句话查一次 DB。

对 Qualy 更合适的是做一个很小的 **server-only render plan**，注意它已经不是 `UiText`：

```ts
type Text =
  | MessageText
  | TermText
  | LiteralText
```

概念上：

```ts
text(m.record_search_list, {
  businessNo: term(authTerms.businessNumber),
})

term(authTerms.businessNumber)

literal(provider.displayName)
```

这里 `MessageText` 持有的是**真正的 Paraglide message function** 和参数，不存：

```text
id
defaultMessage
fallback
```

`TermText` 持有 `TermRef`，`LiteralText` 持有值。

然后只有：

```ts
renderText(text, context): Effect<string>
```

负责递归解析。

这样术语作为 message 参数也很自然：

```ts
text(m.record_search_list, {
  businessNo: term(authTerms.businessNumber),
})
```

renderer 先解析 `term(...)`，再：

```ts
m.record_search_list(
  { businessNo: "学工号" },
  { locale: "zh-CN" },
)
```

这比把 `Text` 直接定义成任意函数更好，因为：

- 能明确知道依赖了 term；
- 可以统一缓存 term 查询；
- 测试时能检查组成结构；
- 不会允许插件随便塞一个未知函数进去；
- 将来扩展 date/number 等 renderer 也有明确位置；
- 最重要的是，里面没有 Lingui 的 descriptor 概念。

我会把它做成 server-only 包，例如：

```text
@qualy/text/server
```

而不是 `@qualy/i18n-contract`。

浏览器完全不知道 `Text` 是什么。

---

### 第二，术语定义必须拆成“引用”和“声明”

当前这里：

```ts
@qualy/auth-contract/terms
```

直接定义：

```ts
defineTerm({
  id,
  label: UiText,
  description: UiText,
  defaults: {
    'zh-CN': ...,
    'en-US': ...
  }
})
```

这在新架构里不应该原样迁。

原因不仅是 `defaults` 重复维护。更重要的是，这个模块现在会被大量客户端代码直接 import：

```ts
useTerm(authTerms.businessNumber)
```

如果未来 `authTerms.businessNumber` 本身携带：

```ts
default: text(m.auth_term_business_number)
```

那你就有机会把 server message/rendering dependency 顺着这个 shared contract 拖进 browser graph。

所以应该拆开：

```ts
// @qualy/auth-contract/terms
export const authTerms = {
  businessNumber: termRef('auth/business-number'),
}
```

它只有身份。

然后 Auth 插件的声明侧：

```ts
defineTerm({
  ref: authTerms.businessNumber,
  category: authTermCategories.identity,

  default: text(m.auth_term_business_number),

  label: text(m.auth_term_business_number_label),

  description: text(
    m.auth_term_business_number_description,
  ),

  order: 10,
})
```

这样：

```text
TermRef
= 跨插件稳定业务身份

TermDefinition
= server/assembly declaration

Paraglide message function
= localization implementation
```

三层不再互相污染。

这也是我认为这次重构应该顺手修掉的 Qualy 现有结构问题。

---

## `defaults: {'zh-CN': ..., 'en-US': ...}` 应该彻底删除

这一点我完全同意你贴的报告。

最终消息源：

```json
// auth/messages/zh-CN.json
{
  "auth_term_business_number": "学工号",
  "auth_term_business_number_label": "人员编号"
}
```

```json
// auth/messages/en-US.json
{
  "auth_term_business_number": "Student or staff ID",
  "auth_term_business_number_label": "Person identifier"
}
```

`TermDefinition`：

```ts
default: text(m.auth_term_business_number)
```

足够了。

管理员打开术语设置页，需要同时看到两种语言的默认值时，由服务器临时：

```ts
for (const locale of supportedLocales) {
  defaults[locale] =
    yield* renderText(term.default, contextFor(locale))
}
```

返回：

```json
{
  "defaults": {
    "zh-CN": "学工号",
    "en-US": "Student or staff ID"
  }
}
```

注意这里 `defaults` 只是 **admin DTO 的派生结果**，不是 source of truth。

`normalizeOverride()` 也不应该再依赖 `definition.defaults`。写入术语时，用同一个 Paraglide default renderer 算出该 locale 的默认值：

```text
用户输入 == 当前默认翻译
→ 不存 override
```

因此以后：

```text
Student or staff ID
→ Person ID
```

更新的是消息 JSON，没有 override 的租户自然跟着新版本走。

这比现在的设计更正确。

---

## 术语的完整性检查也要重新归位

现在 `compileSettingCatalog()` 有：

```ts
for (const locale of supportedLocales) {
  if (!setting.defaults[locale]) fail
}
```

因为当前翻译源在 `defaults`。

新架构里这个检查应该拆成两部分。

Paraglide/inlang build 负责：

```text
这个 message 是否存在
每种支持语言是否存在 variant
ICU 能否编译
参数是否一致
```

Qualy assembly gate 负责领域约束：

```text
把 term.default 对每个 supported locale 渲染一遍
→ 非空
→ 长度 <= maxLength
```

因此不会因为删掉 `defaults` 而降低约束，只是把职责放回正确的位置。

ICU1 插件本身现在支持 plural/select/selectordinal/offset/formatter 等，并能映射到 inlang 数据模型，所以继续用 ICU1 JSON 是合理的。

---

# 关于“术语跟 manifest 一起下发”：方向对，但不要让 ui-registry 直接依赖 settings

这是你贴出的方案里另一个需要结合 Qualy 插件架构处理的地方。

当前 `useTerm()` 的确存在：

```text
页面先 render
→ 用插件默认词
→ getTerminology 完成
→ 变成租户词
```

现在 `businessNumber` 被几十个页面使用，所以这是一个真实的 presentation flash。

reload 模型之后，把**当前 document 的 effective terms** 在首次 route render 前提供下来，我赞成。

但不能直接让：

```text
plugin-ui-registry
→ import plugin-settings
```

这违反 Qualy 现在很重要的 platform/plugin 依赖纪律。

我会新增一个很窄的 document-context extension。

概念上：

```ts
const terminologyContext =
  defineDocumentContext<Record<TermId, string>>(
    'settings/terms'
  )
```

Settings 插件提供：

```ts
provideDocumentContext(
  terminologyContext,
  request => effectiveTerms(
    request.tenantId,
    request.locale,
  )
)
```

然后 `/app/manifest` 可以多：

```json
{
  "viewer": "authenticated",
  "pages": [...],
  "context": {
    "settings/terms": {
      "auth/business-number": "学工号"
    }
  }
}
```

Browser：

```ts
useTerm(authTerms.businessNumber)
```

最终仅仅是：

```ts
documentTerms[term.id]
```

没有请求，没有 fallback，没有语言逻辑，也没有 Paraglide调用。

这非常符合新的原则：

> **Browser static product copy → Paraglide。
> Server/tenant-selected presentation data → HTTP string。**

而且 manifest 本来就在 route render 前必须到达，所以没有新增 RTT。

我会严格限制 `DocumentContext`：

```text
只放 document 生命周期内稳定、
小体积、
由服务端决定、
首屏/多个 feature 广泛使用的数据。
```

不要让它变成随手往 manifest 里塞东西的垃圾桶，并在 `qualyChunkGraph` 类似的质量检查里给 manifest context 设体积预算。

---

## 管理术语页面仍然是另一回事

普通页面只需要：

```text
当前 locale 的 effective value
```

管理员术语编辑页需要：

```text
每种 locale 的 default
+
每种 locale 的 override
+
version
```

所以保留专门：

```text
GET /settings/terminology
PUT /settings/terminology/:...
```

完全合理。

它返回的是管理数据，而不是 document context。

保存后：

```text
PUT success
→ invalidate/refetch app manifest/document context
```

在当前页面如果要立即显示刚改的术语，也可以更新 manifest-query cache；不需要为了这件事引入 reactive locale。

---

# Browser 侧应该变得非常薄

迁移完以后，当前整个：

```text
I18nProvider
setupI18n()
compileMessage
loadCatalogs()
activated
format()
formatText()
LocalizedText
ErrorMessageMap
```

基本全部消失。

普通组件：

```ts
import * as m from '@qualy/messages/assessment'

<Button>
  {m.entry_submit()}
</Button>
```

带参数：

```ts
m.record_search_list({
  businessNo: useTerm(authTerms.businessNumber),
})
```

日期/列表等：

```ts
new Intl.DateTimeFormat(locale, ...)
new Intl.ListFormat(locale, ...)
```

仍然存在，但 locale 是 document 常量。

可以保留一个很小的：

```ts
useLocale(): SupportedLocale
```

但它不再是 i18n provider。

它只是：

```ts
getLocale()
```

或者直接读取 Paraglide runtime。

Paraglide 现在允许自定义 client strategy，所以可以让它直接以 Qualy 首帧已经确定的：

```html
<html data-locale="zh-CN">
```

作为 document 内唯一 locale source。官方支持自定义 client/server locale strategy，也明确建议 locale 变更继续走 document navigation，而不是重新造 reactive locale switching。

这一点很适合 Qualy。

---

# Locale 生命周期我建议这样定死

我会定义两个阶段。

创建 document：

```text
设备显式 cookie
→ 登录恢复时的 account preferredLocale
→ navigator.languages
→ zh-CN
```

boot script 得到结果后：

```html
<html lang="..." data-locale="...">
```

之后这个 document 的 locale **永远不变**。

API client 发送：

```http
X-Qualy-Locale: <data-locale>
```

server presentation projection 使用它。

切换：

```text
用户选择 locale
→ persist account preferredLocale（若登录）
→ persist explicit device cookie
→ leave guard
→ full-document reload
```

不调用 React state 去原地更新语言。

Paraglide custom strategy / `setLocale()` 可以用于这个流程，但我不会为了“完全遵循库”把 Qualy 已有的 leave guard、账户偏好保存等塞进一个黑盒 strategy。Paraglide负责 message locale；Qualy 的 `changeLocale()` 负责产品级切换事务。

---

# API 的 `Text` 不要自动递归渲染

这一点我会特别强调。

不要做：

```text
api-kit 看见 response 里有 Text
→ 自动遍历
→ 偷偷翻译
```

这会把 locale 重新变成隐式魔法。

应该让 internal model 和 DTO 类型不同：

```ts
interface PermissionDefinition {
  code: string
  name: Text
  description?: Text
}
```

HTTP：

```ts
interface PermissionDto {
  code: string
  name: string
  description: string | null
}
```

handler projection：

```ts
return {
  code: definition.code,
  name: yield* renderer.render(definition.name),
  description:
    definition.description === undefined
      ? null
      : yield* renderer.render(definition.description),
}
```

这样忘记 render：

```ts
name: definition.name
```

直接 TypeScript 报错。

这比做一个“聪明”的 Schema transformer 好得多。

---

# 一个 Qualy 当前源码里必须一起拆的雷

现在 `assessment/core/src/client/items/editor/ItemEditor.tsx` 会直接 import：

```text
../../../surfaces.ts
```

而 `surfaces.ts` 同时又是 UI declaration 的所在位置。

如果未来 `surfaces.ts` 里的导航/title 开始直接持有：

```ts
text(m.xxx)
```

那么 browser component 就可能沿着这个 shared module 把 server-side text machinery 拉进浏览器 graph。

所以迁移时必须顺手把这种混合模块拆掉：

```text
src/shared/...
    真正 browser/server 都要的常量

src/plugin/surfaces.ts
    Ui.page / navigation / Text declarations

src/client/...
    Browser components
```

客户端禁止 import：

```text
@qualy/text/server
plugin descriptor declaration modules
server Paraglide projection helpers
```

这个边界应该加进 `plugin-isolation.test.ts`。

这件事比“到底把 messages 文件放哪”还重要，否则 Paraglide 理论上的 tree-shaking 很容易被 Qualy 自己的 shared imports 破坏。

---

# Bootstrap 也不要保留 `bootstrapMessages`

最终仍然需要：

```text
JS 还没起来时
watchdog / asset failure
```

能够说话。

但 source 不再是：

```ts
bootstrapMessages = {
  zh-CN: ...,
  en-US: ...
}
```

而是普通 Paraglide消息。

build 阶段：

```text
读取那几条 bootstrap message
→ 分别用 zh-CN / en-US 渲染
→ 注入现有 #qualy-boot-copy JSON
```

最终 HTML 的形态可以完全不变。

只是：

```text
bootstrapMessages
```

这个手写翻译源消失。

这是非常典型的“编译产物允许重复，source of truth 不允许重复”。

---

# Mail 也不需要第二套抽象

当前 `mail-copy.ts` 整块删掉。

例如：

```ts
m.email_address_changed(
  { ... },
  { locale: recipientLocale },
)
```

如果邮件里要出现租户术语，则走同一个 server `renderText()`：

```ts
yield* renderText(
  text(m.xxx, {
    businessNo: term(authTerms.businessNumber),
  }),
  mailContext,
)
```

这样 Browser、HTTP projection、mail、export 都使用同一批 message source，但渲染点各自合理。

---

# Error 也不要保留 Lingui 式 `ErrorMessageMap`

API error：

```text
code/tag = protocol
message = browser presentation
```

各 feature 直接定义：

```ts
const errorText = {
  USER_NOT_FOUND: m.error_user_not_found,
  ...
}
```

只要这个 feature code 被加载，相应 error functions 就跟着它进入 chunk。

公共 transport/authentication error 放 platform common module。

`formatError()` 可以继续存在，但应该只是：

```text
error code → Paraglide function
```

不再是：

```text
MessageDescriptor → Lingui formatter
```

---

## 我会按这个顺序实施

1. **建立 Paraglide assembly pipeline。** 每插件 `messages/zh-CN.json` / `en-US.json`，ICU1；assembly merge 到临时 inlang project；dev `locale-modules`、prod `message-modules`。Paraglide官方当前就是这样建议生产/开发拆分的。
2. **建立稳定的 `@qualy/messages/<namespace>` import ABI。** standalone plugin、assembly、dist-only plugin 三态全部先跑通；先依赖 Vite 8/Rolldown tree-shaking，不提前写 AST import rewrite。
3. **重做 browser i18n。** 页面改直接 message function；删除 `I18nProvider/loadCatalogs/compileMessage/MessageDescriptor/defineMessage/CatalogFor`。
4. **建立 server-only `Text` render plan。** 只有 `text(paraglideFn, inputs)`、`term(ref)`、`literal(value)` 三种构造；HTTP DTO 一律 `string`。
5. **重做 terminology。** `TermRef` 留在 contract；TermDefinition 移到声明侧；`defaults` 删除，default/label/description 全引用 Paraglide message；admin DTO 动态生成各 locale defaults。
6. **把 effective term map 放进 document context。** 由 settings plugin 通过通用 extension provider 注入 app manifest，普通 `useTerm()` 变成同步 map lookup；删除普通页面的 terminology query 和默认词闪烁。
7. **统一 locale lifecycle。** document locale immutable；explicit cookie + nullable account preference；API header；切换经 leave guard full reload。Paraglide支持自定义 locale strategy，因此不需要为了 Qualy 的 header/document 模型 fork runtime。
8. **最后迁 bootstrap/mail/errors，并删除旧 i18n contract。** 然后跑你已有的 production-correct Lingui/extraction baseline 与 Paraglide chunk A/B。

有一个细节我会明确写进 ADR：**Paraglide 的 `baseLocale` 不要再承担 Qualy 产品默认语言的双重语义。** 现在既然没有 `defaultMessage` 了，所有 locale 都要求完整；Qualy 自己继续有 `defaultDocumentLocale = 'zh-CN'`。Paraglide `baseLocale` 只是编译/translation fallback 配置，不应该偷偷成为浏览器 locale 选择器。这样以后即使改变翻译工作流，也不会改变用户看到的默认语言。

最终我认为最值得追求的状态不是“把 Lingui 换成 Paraglide”，而是：

```text
Browser:
  Paraglide functions + Intl + effective tenant terms

Server/plugin declarations:
  Paraglide functions wrapped as Text render plans

HTTP:
  plain presentation strings

Localization source:
  ICU1 JSON only

No:
  defaultMessage
  runtime catalog
  browser ICU compiler
  UiText wire
  message dispatch table
  duplicate bootstrap copy
  duplicate mail copy
  per-locale term defaults in TS
```

这才是真正完成迁移，而不是把原来的 i18n 体系换一层名字。

这版方案整体方向我同意。有几处需要对照源码核实，另外 ICU1 的类型生成能力会直接影响格式怎么选，所以我先查这几点。这版方案整体可以作为 ADR 的底稿。下面按“核实过的”“需要修正的”“遗漏的”三类说，最后回答格式选择。

## 一、核实过、成立的地方

- **`ItemEditor.tsx` 第 26 行确实从 `../../../surfaces.ts` 引入了 `calculatorAuthoringOptions`。** 这是个真实的隐患：`surfaces.ts` 以后会持有服务端 `Text`，前端组件一引入它，就可能把服务端代码拖进浏览器包。按方案拆开，并加进 `tools/tests/plugin-isolation.test.ts`，我同意。
- **术语拆成 `TermRef`（只有身份）和 `TermDefinition`（声明侧）是对的。** 前端大量组件在 import `authTerms`，身份和声明必须分开。
- **先依赖 Rolldown 的 tree-shaking，不写 import 改写，我接受，这是我之前想多了。** 开发环境用 `locale-modules`，每种语言只有几个文件，不存在请求爆炸；生产环境的 `message-modules` 标了 `sideEffects: false`，namespace import 可以正常 tree-shake。
- **`baseLocale` 和产品默认语言分开，也同意。** 我再补一条：缺译必须让构建失败，而不是静默回退到 baseLocale。否则缺了一条中文翻译，中文用户会直接看到英文，而且没有任何人发现。

## 二、需要修正的：`Text` 的渲染不需要做成异步

方案反对“先把整个租户术语表查出来”，理由是不想每句话都查一次数据库。但这和它自己的另一个设计是矛盾的：document context 本来就要为每个 manifest 算出**整张**生效术语表。而且目前全系统只有 1 个 `defineTerm`。

更简单的做法：每个请求把术语表查一次并在请求内缓存，渲染保持为同步的纯函数：
```ts
render(text: Text, ctx: { locale; terms: ReadonlyMap<TermId, string> }): string

```

ADT（`message | term | literal` 三种构造）我同意保留，它确实能限制构造方式，也方便检查。但 `renderText(): Effect<string>` 会让每个 projection 都得 `yield*`，却换不来任何实际好处。

## 三、方案漏掉的四件事

**1. Paraglide 的“参数类型”比我们之前说的弱，这一条要修正我自己前几轮的说法。**\
&#x20;Paraglide 为消息输入生成的类型是 `NonNullable<unknown>`：它只检查参数有没有传，不检查类型。select 分支的值也不会生成联合类型，官方 issue #538 明确说暂不在计划范围内。而 Qualy 现在的 `defineMessage<{ count: number }>` 是既检查 key 又检查值类型的。所以直接换过去，类型检查反而会**变弱**。

补救办法：Qualy 本来就要做 assembly 编译，可以顺手从 ICU 源生成一层更严格的类型包装，也就是 `@qualy/messages/<ns>` 的 `.d.ts`：

- `plural` 参数生成 `number`
- `select` 参数生成分支 key 的联合类型
- `date` / `number` 格式化参数生成对应的类型

ICU1 有独立于 inlang 的标准解析器（比如 `@formatjs/icu-messageformat-parser`），做这件事很直接。**这一点也是下面我选 ICU1 的主要理由之一。**

**2. 服务端不允许使用隐式语言。**\
&#x20;给服务端那份编译产物配一个自定义 strategy：任何没有显式传 `locale` 就调用消息函数的代码，直接抛错。方案里有“不要自动递归渲染”，但没有堵住“在服务端直接调用 `m.x()`”这条路。

**3. 插件不能 import 别的插件的消息。**\
&#x20;比如 assessment 如果去 import `@qualy/messages/auth`，就等于又在插件之间建了一条耦合。跨插件共用的词应该走术语，或者走合约包里的共享消息。这条规则也加进 `plugin-isolation.test.ts`。

**4. 迁移时要做差分测试。**\
&#x20;把 4193 条消息，分别用旧的 Lingui 渲染和新的 Paraglide 渲染，在同一组样例参数下逐条比对，两种语言都要覆盖。ICU1 插件对嵌套 select/plural 的支持，官方文档没有明确写，这个只能靠测试兜底。

## 四、格式：继续用 ICU1 JSON

候选有四种：

| 格式 评价         |                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------- |
| **ICU1 JSON** | **选这个**                                                                                             |
| inlang 原生格式   | Paraglide 官方推荐新项目使用，功能最完整（主要多了 markup）。但 Qualy 没有消息内的 markup；参数类型同样是 unknown；格式是 inlang 独有的，别的工具读不了 |
| PO            | 优势在译员和翻译平台的工作流，Qualy 目前两者都没有；它也不描述参数类型；Paraglide 只有第三方插件支持                                          |
| MF2           | 我没找到 Paraglide 的 MF2 存储插件，现在上等于自己写                                                                  |

选 ICU1 的理由：

1. 现有 4216 条消息原样保留，迁移时只改调用方式，不改文案本身。
2. 它是行业标准，有独立于 inlang 的解析器，所以 Qualy 可以在它上面做自己的类型生成和检查，不依赖 Paraglide 以后会不会做这个功能。
3. 以后迁 MF2，ICU1 是最常见的起点，不需要中间多绕一步 inlang 格式。

要接受的风险：ICU1 插件不是 Paraglide 的主推格式，功能更新可能慢一些。好在存储层是可替换的，真到必要时，可以用插件把 ICU1 一次性转成原生格式。另外，Qualy 现有的 `selectKey`（把 kebab-case 转成 camelCase 以满足 ICU 分支命名限制）继续保留。

Sources:

- [Typesafe match types, paraglide-js issue #538](https://github.com/opral/paraglide-js/issues/538)
- [Paraglide JS file formats](https://paraglidejs.com/file-formats)
- [inlang ICU MessageFormat v1 plugin](https://inlang.com/m/p7c8m1d2/plugin-inlang-icu-messageformat-1)

---

这四个究竟选哪个更好。

四个里，我现在会明确选：

**ICU MessageFormat 1 JSON。**

不是把它当“过渡格式”，而是作为 Qualy 在 Paraglide 架构下的正式长期消息源。`inlang native` 不作为第二阶段迁移目标，PO 不引入，MF2 暂时只作为未来标准化观察项。

有一个最新事实要先纠正：你贴的报告里关于 Paraglide 类型安全的描述已经部分过时。Paraglide **2.10 已经实现了 match literal 的联合类型推导**，issue #538 也因此关闭。现在类似 `type=empty | invalid | secure` 的 selector，传入不存在的值会直接报类型错误，而不再全是 `NonNullable<unknown>`。

所以“为了 select 联合类型必须自己再写一套 ICU 类型生成器”，已经不是成立的主要理由了。但这不代表所有参数都已经有精确领域类型：普通变量、number/date/plural formatter 的输入类型仍不应假定 Paraglide 能完全替代 Qualy 当前 `defineMessage<{ count: number }>` 的约束。这个问题应该单独补，而不是因此改变存储格式。

| 格式 | 对 Qualy 的判断 | 主要原因 |
|---|---|---|
| **ICU1 JSON** | **选** | 标准、可移植、现有 4000+ 消息迁移最自然、复杂 select/plural 完整、独立工具链可解析 |
| inlang native | 不选 | Paraglide/inlang 一等公民，但专有格式；复杂消息更冗长；目前 Qualy 用不到它最大的 markup 优势 |
| PO | 不选 | 很适合专业译员/TMS/Gettext 工作流，但不是 Qualy 当前的问题，而且和 Paraglide 的编译模型没有特别好的额外收益 |
| MF2 | **未来观察** | 标准方向很好，但目前 Paraglide/inlang 没有成熟官方 MF2 storage plugin；现在用等于自己承担 parser/storage/compiler integration |

### 为什么 ICU1 现在比以前更稳

inlang 的 ICU1 插件已经不是一个勉强兼容的第三方桥接层了。官方现在明确支持 `select`、`plural`、`selectordinal`、exact match、offset、`#` 以及 number/date/time 等 formatter，并声称保持语义完整地映射到 inlang 数据模型。

我还专门核了当前 inlang 仓库里的测试：已经存在 **deeply nested `select + plural + selectordinal` 的 round-trip 测试**。所以之前“官方文档没说 nested，可能不支持”的风险判断现在也可以明显下调。

这对 Qualy 很关键，因为你不是只有：

```json
{
  "save": "Save"
}
```

而是已经有不少复杂 ICU。

因此迁移时仍然应该跑：

```text
Lingui old renderer
vs
Paraglide + ICU1
```

的逐消息差分测试，但这更像迁移验证，不再是“怀疑 ICU plugin 基本能力不足”。

---

### 为什么不选 inlang native

如果今天从零开始做一个纯 Paraglide 项目，我会认真考虑 native format，因为 Paraglide 文档确实把它定位成新项目和完整 inlang feature support 的优先选择。

但 Qualy 不是 greenfield i18n。

你已经有几千条 ICU 消息，而且没有 message markup。

native format 对复杂 plural/select 会变成类似：

```json
{
  "declarations": [
    "input count",
    "local countPlural = count: plural"
  ],
  "selectors": ["countPlural"],
  "match": {
    "countPlural=one": "...",
    "countPlural=other": "..."
  }
}
```

ICU1 则是：

```json
{
  "items": "{count, plural, one {# item} other {# items}}"
}
```

对于 Qualy 目前的开发者维护模式，后者明显更紧凑，也更容易复制、review、diff。

而 inlang native 当前最大的附加优势之一是完整的 markup model；Paraglide 的 markup 文档也明确以 native inlang format 为主要语法。

但 Qualy 当前根本没有消息内 markup。为了一个没有需求的能力，把 4000 多条已经成熟的 ICU 消息改成 inlang 特有表示，我认为是错误的优化。

更关键的是 vendor portability：

```text
ICU1
→ Lingui
→ FormatJS
→ messageformat
→ inlang/Paraglide
→ 未来 MF2 conversion tooling
```

都比较自然。

而：

```text
inlang native
```

基本就是主动把 source format 与 inlang 数据模型绑定。

既然运行时已经选 Paraglide，就没必要连**源数据格式**也一起绑定。

---

### PO 更不适合现在的 Qualy

PO 的强项不是应用运行性能，而是：

```text
translator workflow
comments/context
Gettext ecosystem
TMS
```

如果以后 Qualy 有几十名翻译人员、Weblate/Crowdin 流程，PO 会重新进入候选。

但现在只有中英、主要由开发者维护，而且 Paraglide本身是 compiler-first + JSON/inlang project 工作流。

为了“成熟”而引入 PO，只是多一层 representation。

而且 PO 对你现在最关心的：

```text
plural 参数是什么类型
select 有哪些合法值
```

并不会天然提供更强的 TypeScript 类型信息。

所以我不会选。

---

### MF2 是长期最值得关注的，但不是今天该用的

如果只问“未来标准方向”，我其实最看好 **Unicode MessageFormat 2**。

inlang 自己的数据模型都明确说是 heavily inspired by MF2。

但要区分：

```text
MF2-inspired
≠
MF2 storage/runtime implementation
```

我检查了当前 inlang 官方插件目录，没有成熟官方 MF2 storage plugin；有 ICU1、inlang native、i18next、XLIFF 等。

所以今天直接选 MF2，就意味着 Qualy 自己承担：

```text
MF2 parser
→ inlang model adapter
→ export/roundtrip
→ lint
→ editor integration
→ migration tooling
```

这和我们选择 Paraglide“减少自建 i18n 基础设施”的初衷正相反。

我的 ADR 会写成：

> ICU MessageFormat 1 JSON is the canonical localization source format. Re-evaluate direct ICU1 → Unicode MessageFormat 2 migration when Paraglide/inlang provides a stable, first-class MF2 storage pipeline.

注意是：

```text
ICU1 → MF2
```

而不是：

```text
ICU1 → inlang native → MF2
```

避免无意义的二次迁移。

---

## 类型安全这里我会稍微修改你贴出的方案

不要马上生成一整套替代 Paraglide `.d.ts` 的东西。

因为 Paraglide 2.10 已经解决了 literal match union：

```ts
m.auth_password_error({
  type: 'typo'
})
```

现在会报错。

我建议 Qualy 自己只补 **Paraglide 目前仍然缺失的那部分类型语义**。

例如：

```text
{count, plural,...}
→ count 必须是 number

{price, number,...}
→ price 必须是 number

{when, date,...}
→ when 必须符合 Qualy 规定的 date representation
```

甚至第一版先做 build gate，而不是 wrapper：

```text
解析 ICU1
↓
找出 formatter/selector 对变量的约束
↓
检查所有 locale 的同 key 参数 contract 一致
↓
生成 metadata / TS type tests
```

这里还有个细节：**不要优先用 `@formatjs/icu-messageformat-parser`。**

inlang 官方 ICU1 plugin 当前实际用的是：

```text
@messageformat/parser
```



如果 Qualy 自己再用另一个 ICU parser，会产生很讨厌的“双 parser 语义”：

```text
Qualy type checker 说合法
inlang importer 说非法
```

或者反过来。

最理想的是直接使用 **inlang import 后的 normalized model** 做类型分析；次选是和 ICU plugin 使用同一个 parser。

这样只有一个 grammar truth。

---

## 最终我会这么定

消息文件：

```text
plugin/
  messages/
    en-US.json
    zh-CN.json
```

内容：

```json
{
  "record_search_list": "Name or {businessNo}",
  "items_selected": "{count, plural, one {# item selected} other {# items selected}}"
}
```

然后：

```text
ICU1 JSON
     ↓
Qualy assembly merge
     ↓
@inlang/plugin-icu1
     ↓
inlang normalized model
     ├─ completeness / parameter-contract gate
     └─ Paraglide compiler
             ↓
        typed ESM functions
```

并且强制：

```text
zh-CN 和 en-US 每个 key 都必须存在
```

**不要依赖 `baseLocale` 在生产里静默补缺译。**

`baseLocale` 可以是 inlang/Paraglide 编译模型需要的概念，但 Qualy 自己的 build gate 应该保证：

```text
missing variant = build failure
```

而不是：

```text
中文漏翻
→ 悄悄显示 English
```

所以四个里面，我的排序是：

**ICU1 JSON > inlang native > PO；MF2 不参与今天的生产选择，但它是未来最值得重新评估的替代标准。**

对 Qualy 来说，ICU1 并不是“保守方案”。它反而是现在最少生态绑定、迁移风险最低、复杂表达能力足够，同时又能完整吃到 Paraglide compiler/tree-shaking 优势的方案。

对方这次引用了几条新事实，其中一条和我上一轮查到的正好相反（issue #538 的状态）。我先核实这几条。这次的结论我同意：**ICU1 JSON，排序是 ICU1 > inlang 原生格式 > PO，MF2 作为未来观察项。** 对方的几条新事实我都核实过了，一条是我上一轮说错了，另一条比它自己说的还更有利。但它对“类型安全已经解决”的判断有一个关键漏洞。

## 一、先认错：#538 的问题已经解决了

Paraglide 的 CHANGELOG 确认，**2.10.0 版本加入了 match variant 的字面量联合类型**：传入一个不存在的分支值会直接报类型错误。2.15.3 又修了数字输入的推断。上一轮我拿到的是 issue 页面的旧讨论，把它说成“不在计划内”，这是错的。

## 二、比对方说的更有利的一点：解析器完全一致

`@inlang/plugin-icu1` 1.1.0 唯一的运行时依赖是 `@messageformat/parser ^5.1.1`，这一点对方说对了。我又查了 Qualy 自己的 lockfile：现在用的 `@lingui/message-utils@6.6.0` 依赖的也是 **`@messageformat/parser@5.1.1`**。

也就是说，Qualy 现有的 4216 条消息，**本来就是用同一个解析器的同一个版本在解析**。转义规则、撇号的处理、嵌套写法这些最容易在换解析器时出问题的地方，迁移前后是同一套语法定义。这是选 ICU1 最硬的一条理由，比“可移植”“紧凑”都更实在。

所以我撤回上一轮“用 `@formatjs/icu-messageformat-parser` 做类型检查”的建议。Qualy 自己做的类型检查，要么直接读 inlang 导入后的规范化模型，要么用同一个 `@messageformat/parser`。

## 三、对方判断的漏洞：2.10 的联合类型，很可能对 ICU1 来源的消息不起作用

**ICU1 的语法规定，select 和 plural 必须带 `other` 分支。** 我统计了一下，Qualy 现在有 38 处 select，每一处都带 `other`。

`other` 导入到 inlang 模型后，就是一个“兜底”分支，意思是任何值都接受。在这种情况下，Paraglide 没法生成严格的联合类型。CHANGELOG 里那个会报错的例子（`auth_password_error({ type: 'typo' })`），前提是这条消息没有兜底分支。而这恰恰是 inlang 原生格式能写、ICU1 写不出来的。

这一点是我根据语法推断的，还没有实测。PoC 里拿一条 Qualy 的 select 消息编译一次，看生成的 `.d.ts` 就能确认。

即使推断成立，它也不会改变格式的选择。原因是：

- **select 的严格性本来就不该来自消息文本。** Qualy 的 `other` 大多是真正的兜底，比如 `accessInvalid` 里的“其他原因”那一支。合法值的约束应该来自调用处的领域类型，也就是先用枚举类型约束，再经过 `selectKey` 转换后传进来。
- **Qualy 自己的类型检查只需要补三件事：** 参数有没有传齐、plural 和 number 格式化的参数必须是 `number`、date 格式化的参数必须是 Qualy 约定的日期类型。这和对方最后的结论一致：做构建期的检查，不要生成一整套替代 Paraglide 的 `.d.ts`。

## 四、其他几条

- **ICU1 插件本身还很年轻（1.1.0）。** 对方说官方仓库里有深度嵌套的往返测试，我这边访问不了 GitHub API，没能核实。不过解析器和 Qualy 现在用的完全一致，风险已经下降了很多。**逐消息的差分测试还是要作为迁移的硬性关卡**：新旧两套在同一组样例参数下，两种语言都要逐条比对。
- **缺译即构建失败，不靠 `baseLocale` 静默回退。** 双方已经一致。
- **排在第二、第三的 inlang 原生格式和 PO，谁先谁后没有实际意义**，因为都不会用。真正需要写进 ADR 的只有：选 ICU1；什么情况下重新评估（Paraglide 或 inlang 有了官方稳定的 MF2 存储插件）；以及重新评估时直接从 ICU1 迁到 MF2，不经过 inlang 原生格式这个中间步骤。

Sources:

- [Paraglide JS CHANGELOG](https://raw.githubusercontent.com/opral/paraglide-js/refs/heads/main/CHANGELOG.md)
- [@inlang/plugin-icu1 package.json (unpkg)](https://unpkg.com/@inlang/plugin-icu1/package.json)
- [inlang ICU MessageFormat v1 plugin](https://inlang.com/m/p7c8m1d2/plugin-inlang-icu-messageformat-1)

---

怎么样。可以最终定下来了吗。

可以最终定下来了。我认为现在剩下的已经不是“格式选择”，而是实现细节和 PoC 验收。

四种格式里，Qualy 应正式采用 **ICU MessageFormat 1 JSON**，不是过渡方案。未来只有在 Paraglide/inlang 出现成熟的一等 MF2 storage pipeline 时，再直接评估 ICU1 → MF2；不经过 inlang native，也不引入 PO。

不过你贴的这版里还有一个地方我会在写 ADR 前修正，否则会悄悄丢掉 Qualy 现在已有的一部分类型安全。

Paraglide 2.10 确实已经支持 literal match 的联合类型，但它当前编译器源码里有一个很明确的规则：

```ts
if (info.hasCatchAll) return "NonNullable<unknown>"
```

而 ICU `select` 的 `other` 导入后正属于 catch-all 语义。所以你的推断是对的：**对于带 `other` 的 ICU select，不能指望 Paraglide 给出闭合的 literal union。** 另外 2.15.3 修的是“数值 literal match 的类型推导”，例如 `input=1` 同时接受数字和对应字符串形式，并不等于 `plural` / `number formatter` 的输入从此自动变成 `number`。Paraglide 内部对于一般 input 仍然存在 `NonNullable<unknown>`。

因此我不同意报告中的这一小句：

> “做构建期检查，不要生成一整套替代 Paraglide 的 `.d.ts`。”

前半句对，后半句需要改成：

> **不要重写 Paraglide 的生成类型体系，但 Qualy 自己的 `@qualy/messages/<namespace>` ABI 应该生成一层更窄的 typed facade。**

因为“构建时检查 ICU 文件”只能证明：

```text
count 在消息里被 plural 使用
```

它不能阻止业务代码写：

```ts
m.itemsSelected({ count: "abc" })
```

如果底层 Paraglide 参数还是 `unknown`，`tsc` 不会替你挡住。

而 Qualy 现在 `defineMessage<{ count: number }>` 是能挡住的。迁 Paraglide 后不应该倒退。

最合适的做法恰好利用我们已经决定要有的：

```ts
@qualy/messages/assessment
@qualy/messages/auth
```

这层 ABI。

assembly 根据 ICU source / inlang normalized model 自动生成：

```ts
export const itemsSelected:
  (
    inputs: { count: number },
    options?: MessageOptions
  ) => LocalizedString
  = paraglide.items_selected
```

编译后的 JS 基本就是：

```js
export const itemsSelected = paraglide.items_selected
```

没有新的 formatter，没有 runtime wrapper，没有第二套 i18n。

它只是把 Paraglide过宽的：

```ts
{ count: NonNullable<unknown> }
```

在 Qualy 公共 API 上收窄成：

```ts
{ count: number }
```

因此：

```text
ICU source
   │
   ├── inlang → Paraglide runtime implementation
   │
   └── Qualy contract inference → typed facade
```

两者共享一个消息事实来源。

### 类型规则我会定得很克制

不要试图从自然语言消息推导业务领域类型，只推导 ICU 本身真正表达出来的约束：

- `plural` / `selectordinal` operand → `number`
- `number` formatter → `number`
- `date` / `time` → Qualy 统一规定的 `DateInput`，具体是 `Date`、timestamp 还是 ISO value 另行冻结
- 普通 interpolation → 不凭空猜成某个领域类型
- `select` → 不因为出现几个 branch 就假装这是领域 enum；有 `other` 时它语义上本来就是开放集合

例如：

```text
{status, select,
  pending {...}
  approved {...}
  other {...}
}
```

translation 的真正 contract 是：

> status 是可选择的值，并且未知值有合法 fallback。

它并没有声明：

```ts
status: "pending" | "approved"
```

所以不要让 i18n 文件反过来定义领域模型。

如果业务实际有：

```ts
type Status =
  | 'pending-review'
  | 'approved'
  | ...
```

那么应该由领域类型保证：

```ts
m.status({
  status: selectKey(status),
})
```

而不是靠翻译字符串里的 branch 恰好列出了几个值来定义业务合法集合。

这比你现在的 `defineMessage<{ status: ... }>` 从长期架构上反而更合理：**领域类型归领域，消息格式类型归消息 compiler。**

---

### ICU1 现在还有一个非常强的事实支持

你查到迁移前后的 parser 实际都是：

```text
@messageformat/parser 5.1.1
```

这一点非常关键。

意味着这次不是：

```text
Lingui ICU dialect
→ 另一套 ICU parser
→ 希望行为一样
```

而更接近：

```text
同一套 ICU grammar/parser
→ 不同的 compilation backend
```

迁移风险因此低很多。

另外我也核到了 inlang 当前仓库已经有：

> `roundtrip: deeply nested select + plural + selectordinal`

这样的正式测试。

所以 complex nested ICU 已经不是纯靠文档猜测的能力。迁移仍然必须做差分测试，但原因应该是**验证 Qualy 自己的 4000+ 条真实数据**，而不是因为 ICU plugin 没有嵌套能力证据。

---

## 最终 ADR 我会把消息格式部分写成这样

**Canonical localization source**

```text
<plugin>/
  messages/
    en-US.json
    zh-CN.json
```

使用 ICU MessageFormat 1。

**Build pipeline**

```text
plugin-owned ICU1 JSON
        ↓
assembly collector
        ↓
namespace / collision validation
        ↓
ephemeral merged inlang project
        ↓
@inlang/plugin-icu1
        ↓
inlang normalized message model
      ↙                         ↘
Qualy input-contract          Paraglide compiler
validation / facade            dev: locale-modules
generation                     prod: message-modules
      ↓                         ↓
@qualy/messages/<ns>         implementation
```

我会优先从 **inlang normalized model** 推导 Qualy facade 类型，而不是重新解析原始 ICU。因为这样：

> Qualy看到的 message contract = Paraglide真正拿去编译的 message contract。

如果 normalized model 缺少某些推导需要的信息，再退回到同版本 `@messageformat/parser`；不要引入 FormatJS 的第二 parser。

然后设置几个不可妥协的 build gate：

1. 所有 supported locale 必须具有相同 message key，缺译直接失败，禁止靠 `baseLocale` 静默补。
2. 同一 message 在所有 locale 中必须具有兼容的 input names 和 formatter contract。
3. ICU parse / inlang import 必须成功。
4. `plural`、`number`、date/time 等参数生成严格 facade 类型。
5. 插件只能 import 自己 namespace 的消息；真正 platform-common 的消息另有显式 contract。
6. 第一轮迁移对全部现有消息做旧 Lingui ↔ 新 Paraglide 差分测试。

最后一条迁移完成后不需要永久每次 CI 都跑两套 renderer，因为届时 Lingui 应彻底删除。保留一份 migration fixture/golden 即可。

---

## 四个方案就不用再讨论了

现在的决策树已经足够清楚：

**ICU1 JSON**：采用。满足 Qualy 已有复杂消息，源文件紧凑，和当前 grammar parser 一致，独立于 Paraglide，可直接进入未来 MF2 迁移路径。

**inlang native**：不采用。除非未来 Qualy 大量使用只有它才能良好表达的能力，而 ICU1 明显成为限制；当前没有这种需求。

**PO**：不采用。以后如果专业翻译/TMS 成为主要工作流，可以重新考虑“翻译交换格式”，但甚至到那时 PO 也未必需要成为代码仓库的 canonical source。

**MF2**：现在不采用。等 inlang/Paraglide 给出稳定的一等存储、编译和 round-trip 支持后，直接从 ICU1 重新评估。

另外，考虑 `@inlang/plugin-icu1` 目前还比较年轻，我会把它和 Paraglide都**精确 pin 版本**，升级作为单独改动完成，并跑 ICU round-trip + Qualy message contract + representative rendering tests，而不是让 semver 范围静默改变整个消息编译器。

所以，可以结束“到底用哪种格式”的讨论了。现在真正还需要 PoC 验证的只剩两类实现问题：**Paraglide `message-modules` 在 Qualy 的 Rolldown chunk graph 上是否健康，以及 `Text/term/document-context` 那套 server projection 如何落成而不破坏插件隔离。** 这两项即使失败，也不会改变 ICU1 作为 canonical message source 的选择。

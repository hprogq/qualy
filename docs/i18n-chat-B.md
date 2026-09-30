你阅读Qualy代码帮我思考下吧。确实Gzip过了之后54kb。
alt-svc
h3=":443"; ma=2592000
cache-control
public,max-age=31536000,immutable
content-encoding
br
content-length
54703
content-type
text/javascript
date
Wed, 30 Sep 2026 11:48:36 GMT
etag
W/"54703-1790754546584"
last-modified
Wed, 30 Sep 2026 07:49:06 GMT
referrer-policy
strict-origin-when-cross-origin
strict-transport-security
max-age=31536000; includeSubDomains
vary
Accept-Encoding
via
1.1 Caddy
x-content-type-options
nosniff
还有就是好像响应头里没说明gzip，是否要加。





显示更多

 






思考了 3m 54s



我重新按 Qualy 当前的 i18n、Vite 分块、release-store 和静态资源服务器走了一遍。这里有两个结论比较明确：
一，54,703 字节不是 gzip，是 Brotli 后的大小。二，54.7 KB 这个中文语言包本身不算失控，但它位于首屏硬依赖上，再叠加约 94 KB 的英文 defaultMessage，这套结构值得优化。
先说响应头。你现在拿到的是：
Content-Encoding: br
Content-Length: 54703
Vary: Accept-Encoding

所以浏览器实际收到的是 54,703 bytes 的 Brotli 数据。而且 Qualy 不是动态临时压缩：release-store.ts 在构建时就同时生成：
xxx.js.br   Brotli quality 11
xxx.js.gz   gzip level 9

plugin-web 的 sirv 又明确配置了：
brotli: true,
gzip: true,

因此当前链路实际上是：
Chrome:
Accept-Encoding: gzip, deflate, br, ...
        ↓
Qualy 发现 .br
        ↓
Content-Encoding: br
Content-Length: 54703

这完全正确。
不要再加 Content-Encoding: gzip
那反而是协议错误。
Content-Encoding 的含义不是：
“服务器支持哪些压缩算法”

而是：
“这一次响应体实际用了什么编码”

你这次发的是 Brotli 字节，所以：
Content-Encoding: br

只能这样写。
如果写：
Content-Encoding: gzip

浏览器会把 Brotli 数据当 gzip 解，直接失败。
如果写：
Content-Encoding: br, gzip

意思是“这个 payload 被连续编码了两层”，也不是你的情况。
服务器是否支持 gzip 不需要响应头主动声明。客户端通过请求：
Accept-Encoding: gzip

来协商。
你现在的：
Vary: Accept-Encoding

也正是正确的缓存语义。
事实上 Qualy 当前已经有 gzip fallback，只是 Chrome 明明支持压缩率更好的 Brotli，自然没有理由给它 gzip。
你可以自己验证：
curl -I \
  -H 'Accept-Encoding: gzip' \
  'https://qualy.hprogq.com/assets/xxx.js'

应该得到：
Content-Encoding: gzip

而：
curl -I \
  -H 'Accept-Encoding: br' \
  ...

就是：
Content-Encoding: br

我甚至建议把 production smoke 顺手补完整。你现在 smoke-production.ts 已经明确断言：
Accept-Encoding: br
→ Content-Encoding === 'br'

既然构建系统刻意维护 .br 和 .gz 两份 twin，可以再补两条很便宜的断言：
Accept-Encoding: gzip → gzip
Accept-Encoding: identity → 无 Content-Encoding

不是高优先级，但可以把这套契约彻底钉死。
再说 54.7 KB 到底大不大
这里要结合 Qualy 的架构来看，不能单看数字。
现在 vite.config.ts 已经专门做了一件事：
name: (id) => {
  const locale = /...locales|catalogs.../.exec(id)
  return `locale-${locale}`
}

也就是说所有插件的：
auth zh-CN
rbac zh-CN
org zh-CN
assessment zh-CN
formula zh-CN
...

最后被 Vite 合成一个 locale-zh-CN chunk。
这是合理的。
因为 I18nProvider 当前启动逻辑是：
await Promise.all(
  commonCatalog,
  ...所有插件当前 locale 的 catalog
)

i18n.load(...)
i18n.activate(...)

setActivated(...)

在 activated 之前：
if (activated === undefined) return fallback

所以当前语言包本来就是应用首次呈现的硬依赖。
既然所有插件 locale 启动时都得拿，与其发 8～10 个小请求，不如像现在这样合成一个 54 KB 请求。这一层我反而不建议拆回去。
而且它还有两个优点：
- Cache-Control: public,max-age=31536000,immutable
- 文件名是 content hash
只要中文 catalog 内容没变，下一个 Qualy release 仍然可以继续命中同一份资产；并不是每次发布都必然重新下 54 KB。
所以：
单看 54.7 KB Brotli，我不会为了把它压成 40 KB 去大改架构。

而且你已经是 Brotli quality 11，再从压缩参数上榨基本没什么意思。
真正值得注意的是当前 i18n 的重复负担。
Qualy 的源码定义是：
{
  id: 'assessment/entry/submit',
  defaultMessage: 'Submit for review'
}

中文 catalog 又有：
{
  'assessment/entry/submit': '提交审核'
}

而 PluginCatalogs 当前甚至明确设计成：
interface PluginCatalogs {
  namespace: string
  messages: readonly MessageDescriptor[]
  locales: ...
}

definePluginMessages() 又会生成：
catalogs: {
  namespace,
  messages: Object.values(declared),
  locales
}

更关键的是，构建生成的 virtual:qualy/plugins 会静态 import 每一个插件的 catalogs 和 errorMessages：
import { catalogs as authCatalogs } from '.../auth/i18n'
import { catalogs as assessmentCatalogs } from '.../assessment/i18n'
...

这意味着所有插件的 i18n.ts 在启动图中都是有意义的模块，而不只是当前页面才动态加载。
所以 Claude 测出来：
English defaultMessage 首屏约 94 KB gzip

是非常符合这套代码结构的。
对于中文用户，当前逻辑大体相当于：
启动 JS 内：
约 94 KB English defaultMessage

+

locale-zh-CN：
54.7 KB Brotli 中文

————————————

一百多 KB 的双语文案

这才是我认为需要处理的地方。
我不会优化“中文 54 KB”，我会优化“英文 + 中文同时进入首屏”
这两件事区别很大。
现在的 fallbackLocale = 'en-US' 设计是：
English 不需要 catalog，因为 English 就放在每个 descriptor 的 defaultMessage 里。

这个设计最开始很方便：
format({
  id: descriptor.id,
  message: descriptor.defaultMessage
})

中文 catalog 加载失败时还能自然退回英文。
但项目已经增长到现在这个量级以后，它的成本变成了：
所有用户都付 English 的字节；中文用户再额外付中文的字节。

所以我认为现在已经到了值得反过来的规模。
目标架构应该是：
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

中文用户：
JS + 54KB zh-CN

英文用户：
JS + en-US catalog

而不是中文用户：
JS(内含全部 English) + zh-CN

但不要改 UiText 的服务端协议
这里我会特别小心。
你现在跨服务端边界的：
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

我认为这个仍然可以保留。
因为这个 defaultMessage 是服务端针对实际出现的一条业务文本发送的 fallback，不是把整个产品的英文 catalog 一次性塞进 JS。
比如 manifest 返回：
{
  "kind": "message",
  "id": "assessment/navigation/batches",
  "defaultMessage": "Assessments"
}

这种几十字节的 fallback 非常合理，还能保持插件协议自描述。
真正需要消除的是：
browser bundle 里静态携带的全部 client/i18n.ts defaultMessage。

两者不要混为一谈。
我认为最合适的优化路径是做 build-time extraction，而不是手拆全部插件
不建议让 Claude 去干这种事：
assessment/
  entry-messages.ts
  review-messages.ts
  batch-messages.ts
  admin-messages.ts
  ...

那会把当前还算清楚的 i18n 架构弄碎，而且新增页面很容易重新退化。
也不建议按页面拆 zh-CN。54 KB 一个 locale chunk 本身很合理。
我会要求 Claude 做一个很窄的 PoC：
1. Source authoring 完全不变，开发者仍然写：
{
  id,
  defaultMessage
}

2. build 阶段从所有 descriptor 自动生成：
locale-en-US

3. production browser output 中，能静态消除的 descriptor defaultMessage 不再进入启动 graph。
4. I18nProvider 对 en-US 和 zh-CN 使用相同逻辑：
resolve locale
→ preload one locale chunk
→ load
→ activate

5. 如果非英文 catalog 真正加载失败，再 fallback：
zh-CN load failed
→ dynamic load en-US
→ activate en-US

这样仍然保留现在的 resilience，只是失败路径才付 English 的下载成本。
6. bootstrapMessages 不动。
你当前：
bootstrapMessages

那些“加载中 / 重试 / 页面资源加载失败 / Qualy 已更新”本来就是特意为 catalog 到达前存在的小表，几十条文字而已。这个设计很好，不应该为了统一把它重新拖进完整 catalog。
还有一个非常值得先做的小改动
在正式做 build transform 之前，我会先检查：
PluginCatalogs.messages

到底有没有必要存在于浏览器运行时。
现在它的注释自己就已经说明：
// every message the plugin declares,
// so completeness can be checked

它主要服务于：
- collector 的 namespace / duplicate 检查；
- catalogs.test.ts 的 completeness；
- build-time validation。
而实际浏览器 loadCatalogs() 根本没用：
plugin.messages

它只用：
plugin.locales

所以从职责上看，当前：
PluginCatalogs

其实混了两种东西：
Build metadata
+ Runtime locale loaders

这值得拆开。
例如概念上：
interface PluginCatalogDeclaration {
  namespace
  messages
  locales
}

interface RuntimeCatalogs {
  namespace
  locales
}

build collector 可以继续检查完整 declaration。
浏览器 virtual module 只发：
namespace + locale loaders

不过注意：单改这个未必能直接省掉全部 94 KB。
因为同一个 i18n.ts 还导出了：
errorMessages
messages
catalogs

而 aggregate 又必须 import errorMessages。
因此 bundler 可能仍然需要执行整个 definePluginMessages(...)，那些字符串仍然留下。
所以要通过 bundle analyzer / output grep 实测，不要凭架构猜。
我建议直接给 Claude 一个明确的实验目标
不是让它“优化语言包”，而是：
保持所有源码 i18n authoring、UiText wire contract、catalog completeness gate、英文 fallback 行为不退化，尝试将生产首屏中的静态 English defaultMessage 移出启动 JS，生成 en-US catalog。不得按页面手拆 message 文件。先做 PoC，不提交大规模重构。分别测 login / batches / entries / org-tree 的 cold mobile Lighthouse，报告 boot graph Brotli bytes、locale bytes、LCP phase breakdown。若首屏 Brotli 总量减少不足 50 KB 或 LCP 中位数无稳定改善，则撤销 PoC。

这个停止条件很重要。
因为虽然理论上能省约 94 KB，但真实构建中这些字符串可能和当前 chunk 的其它代码共同压缩，实际新增成本未必正好 94 KB。
还有一点：你说“54 KB gzip”需要纠正到报告里。
从你贴出的生产响应：
content-encoding: br
content-length: 54703

准确说法应该是：
locale-zh-CN 的生产 Brotli transfer size 为 54.7 KB。

而不是 gzip。
而且这是 Brotli quality 11 压完以后的结果，已经相当接近当前内容形态的压缩极限。因此如果要继续降，应该删掉/延后不需要的内容，而不是继续折腾压缩参数。
所以最终我的判断是：
响应头完全正常，不要加 gzip。54.7 KB Brotli 的中文 catalog 单独看可以接受，但 Qualy 当前“English defaultMessage 常驻启动 JS + 中文 catalog”存在结构性重复，现在已经值得做一次 build-time extraction PoC。优先消灭重复英文，不要拆碎 54 KB 中文包。





    







那你帮我想想语言包还可以怎么优化，要把语言包拆成多个文件吗，用到的时候再加载而不是全量下载





 






思考了 1m 36s



可以拆，但我不建议把现在这个 54.7 KB 的 locale-zh-CN 直接按“每个插件一个文件”拆开然后全部 Promise.all。那样很可能更差。
我重新按 Qualy 当前实现看了一遍，真正的问题是这三层叠在一起：
所有插件的 client/i18n.ts
        ↓
virtual:qualy/plugins 静态聚合所有 catalogs / errorMessages
        ↓
I18nProvider 启动时 loadCatalogs(locale, 所有插件)
        ↓
所有 locale loader 都完成以后才 activated
        ↓
应用才能正式渲染

而 Vite 现在又刻意把所有 zh-CN.ts：
locales/zh-CN.ts
catalogs/zh-CN.ts

合并成一个 locale-zh-CN chunk。这个设计其实是之前一个正确优化：避免启动时 8 个甚至更多小语言文件请求。
所以现在的 54.7 KB 并不是“一个文件太大”的简单问题，而是：
所有页面，无论登录页、组织树还是申报页，都必须等待整个产品的中文文案。

这才值得解决。
我建议分两阶段，不要直接大拆
第一阶段优先级最高的仍然是前面说的：
把 English defaultMessage 从生产启动 JS 里抽成 en-US catalog。
因为现在中文用户实际上付的是：
约 94 KB English defaultMessage
+
54.7 KB Brotli zh-CN

先把重复英语移走，理论收益比把 54.7 KB 拆成几个文件还大，而且架构更干净。
做完这一步以后，再看剩下的 locale-zh-CN 多大。如果还是 50 KB 左右，我认为值得做 lazy catalog。
真要拆，我会做“shell + feature catalogs”，而不是“一个插件一个包”
Qualy 有一个特殊问题：很多文字并不属于当前页面本身。
比如页面真正打开之前就已经需要：
- 顶部/侧边导航名称；
- page title；
- layout 文案；
- 登录方式名称；
- Session Recovery；
- 通用错误；
- manifest 中携带的 UiText。
所以不能简单说：
进入 Assessment 页面才加载 assessment 中文包。

因为 Assessment 可能已经在左侧导航里出现了。如果中文翻译没加载，用户会先看到英文 Assessments，随后再变成“测评”，这就是明显的 i18n flash。
因此我认为最合理的是两级语言包。
第一层是很小的 shell catalog，首屏必须加载：
locale-zh-CN-shell
├─ common
├─ layout
├─ navigation labels
├─ page titles
├─ Session / release / load failures
├─ 当前登录入口需要的名称
└─ 其他会在 surface 挂载前出现的文字

理想目标我会控制在大约 5–15 KB Brotli。
第二层才是页面功能 catalog：
locale-zh-CN-org
locale-zh-CN-entry
locale-zh-CN-review
locale-zh-CN-assessment-admin
locale-zh-CN-formula
...

进入对应功能才加载。
这样登录页就不会为了：
“认定调整说明”“申诉”“公式测试”“批量认定”“目录导入”

这些根本看不到的文字支付网络成本。
尤其是 assessment/core，它最值得拆
你现在 packages/plugins/assessment/core/src/client/i18n.ts 是明显的超大聚合模块。
里面同时存在：
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

而对应的 zh-CN.ts 也是一整张巨大表。
这比“有 10 个插件”更值得关注。
比如普通学生进入“我的申报”，实际需要的大致是：
assessment/navigation/*
assessment/entry/*
assessment/progress/*
少量 batch/*
少量 common status

他完全不需要：
review/*
staff/*
record/*
admin/*
items editor/*

所以即便你做到“每插件 lazy”，学生打开一个 assessment 页面以后仍然会把整个 assessment core catalog 拉下来，收益有限。
因此如果第二阶段真正要做，我会按稳定业务域粗分，而不是按源码文件随便拆：
assessment-shell
assessment-entry
assessment-review
assessment-admin
assessment-record

Formula 本来就是单独 plugin，可以自己一个 lazy catalog。
Org / RBAC / Audit / Settings 可以根据实测决定合并成一个 admin catalog，别拆得过细。
不建议拆成几十个文件
例如这种我不建议：
entry-list.zh-CN.js
entry-detail.zh-CN.js
entry-history.zh-CN.js
entry-upload.zh-CN.js
entry-appeal.zh-CN.js
...

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
1 × 54 KB
↓
18 × 2–5 KB

而是类似：
shell       8 KB
entry      10 KB
review     12 KB
admin      11 KB
org/admin   8 KB
formula     6 KB

一个用户首屏一般只拿：
shell + 当前 feature

也就是 15–20 KB 左右，而不是 54 KB。
页面代码和语言包应该一起 preload
这里可以很好地接你这一轮刚做的：
冷启动时当前页面代码和布局一起预取。

现在已经存在：
manifest 到达
↓
知道当前 layout / page
↓
提前 preload 对应代码
↓
React render

以后应该变成：
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

这样不会出现：
页面 JS 到了
↓
开始 render
↓
才发现中文包没到
↓
再次等待

也不会出现英文闪一下再变中文。
这一点非常适合 Qualy 当前架构。
但是当前 I18nProvider 必须改
现在它的模型是：
loadCatalogs(locale, catalogs)
  .then(activate)

而 loadCatalogs() 会把所有 plugin catalogs：
Promise.all(...)

全部加载。
如果做 lazy catalog，这个模型要变成：
I18nRuntime
├─ activate locale
├─ loadCatalog(namespace/group)
├─ ensureCatalogs(groups[])
└─ 已加载 catalog 可增量 merge

Lingui 本身支持向已经激活的 locale 增量 load() message，不需要每次重建整个 i18n instance。
概念上：
await i18nRuntime.ensure([
  'shell',
  'assessment-entry',
])

之后：
i18n.load('zh-CN', newMessages)

即可。
这才是真 lazy i18n，而不是把同样的 Promise.all 换成多个 HTTP 文件。
还要把 errorMessages 一起处理
这是很容易遗漏的一块。
当前 virtual:qualy/plugins 不光静态 import：
catalogs

还静态 import：
errorMessages

而 errorMessages 本身又携带：
{
  message: {
    id,
    defaultMessage
  },
  values: ...
}

所以即便你把 zh-CN.ts 拆漂亮了，如果所有 feature 的 error registry 仍然首屏静态 import，大量 English defaultMessage 还是会留在 boot graph。
最终应该让：
feature page code
feature error registry
feature locale catalog

形成同一个 lazy feature boundary。
比如进入审核页时才注册：
assessment-review errors
assessment-review translations
assessment-review code

通用：
AUTH_REQUIRED
SESSION_EXPIRED
ACCESS_DENIED
BAD_REQUEST

继续留在 shell/global 层即可。
我甚至会利用现在的 surface/plugin collector 自动生成这些关系
不要在 apps/web 手写：
if (page === xxx) load('assessment-entry')

这违反你现在很重要的 open-world/plugin discipline。
更合适的是让 plugin 自己声明：
surface:
  assessment.entry
  → catalog group assessment-entry

然后 collectWebPlugins() 在生成：
pageComponents
layoutComponents
loginComponents

的同时再生成：
pageCatalogs
layoutCatalogs
loginCatalogs

例如概念上：
export const pageCatalogs = {
  'assessment/entry': () => import('...locale/entry/zh-CN'),
}

当然具体 API 不一定长这样，但归属应该来自 plugin contribution，而不是 composition root 知道每个业务插件。
我会怎么决定值不值得
我建议不要一下让 Claude 重构完，而是让它做三个 PoC 对比：
方案	目的
当前	54.7 KB 全量 zh-CN
A：只抽 English defaultMessage	看重复英文消除后的收益
B：English 抽离 + shell/feature lazy catalog	看真正按需语言包收益


然后对四个页面测：
登录
批次列表
我的申报
组织树

记录：
首屏 Brotli bytes
locale bytes
关键请求数量
LCP median
FCP
TBT
首次导航到未加载 feature 的耗时
二次访问 cache 后耗时

我给一个很明确的门槛：
如果 lazy catalog 能让常见手机首屏再减少 30–50 KB Brotli 以上，并稳定降低 LCP 约 200 ms+，值得正式做。
如果最后只是：
54 KB → 43 KB
LCP 4.2s → 4.1s

不值得为此引入复杂的 catalog lifecycle。
所以我的建议不是简单的“拆”或“不拆”。
应该拆，但顺序是：
1. 先把静态 English defaultMessage 从生产 boot graph 抽成 en-US catalog；
2. 保留一个小型 shell 中文包；
3. 把真正的大业务文案按 4–6 个稳定 feature group lazy load；
4. 当前页面的 catalog 与页面 JS 同时 preload；
5. error registry 也跟 feature lazy，而不是继续全局静态 import；
6. 不按每个组件、每个页面拆几十个小 chunk。
对 Qualy 当前规模，我认为这比继续让所有页面都硬等一个 54.7 KB Brotli 全产品中文包更合理。登录页尤其没必要为整个综测系统的审核、公式、组织管理文案买单。





    







defaultMessage不一定是英语啊，虽说本项目确实是这样做的。defaultMessage的作用就是在语言包加载失败的情况下不要显示为空白或者i18n的id，所以你还是得想想，或者是考虑换一下整个项目的i18n构造之类。你看看怎么合适。







 






思考了 2m 18s



你这个纠正是对的。把 defaultMessage 直接等同于 “English catalog” 在语义上不够干净。它真正应该表达的是：
当正常翻译机制不可用时，这条消息至少还能显示什么。

本项目恰好统一用英文写 defaultMessage，这是 Qualy 的 authoring convention，不应该反过来成为 MessageDescriptor 这个抽象的语义。
我重新结合 Qualy 现在的实现想了一遍。我认为不要简单做“把英文抽成语言包”，也不用换 i18n 库；应该改的是 Qualy 自己现在的 i18n 装配模型。当前真正的问题是 defaultMessage、catalog completeness、错误翻译注册、locale loader 四件事被绑在了一个 definePluginMessages() 产物里，又被 virtual:qualy/plugins 全局静态导入。
现在实际上是：
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

这里最不合理的其实不是 defaultMessage，而是：
构建期元数据和浏览器运行时数据没有分离。
我会把 Qualy 的 i18n 重构成“Message Group / Catalog Group”模型，但保留 defaultMessage。
源代码里开发者仍然写：
const submit = {
  id: 'assessment/entry/submit',
  defaultMessage: 'Submit for review',
}

这很好，不需要改变。
defaultMessage 继续承担：
- 开发环境 fallback；
- catalog 加载失败后的兜底；
- 测试和诊断；
- 服务端 UiText 的 self-describing fallback；
- 插件没有翻译时至少有可读内容。
不要删。
真正要变的是它什么时候进入浏览器。
第一层：不要再全局 import 所有插件的 MessageDescriptor
这一步我认为比拆 zh-CN 更应该先做。
现在 virtual:qualy/plugins 会生成：
import { catalogs as authCatalogs } from 'auth/i18n'
import { errorMessages as authErrors } from 'auth/i18n'

import { catalogs as assessmentCatalogs } from 'assessment/i18n'
import { errorMessages as assessmentErrors } from 'assessment/i18n'

// ...

这等于告诉 bundler：
所有 i18n 模块都是启动依赖。

于是 assessment 的：
申诉
复核
重新认定
公式计算
行政认定
审核路线
...

对应的英文 defaultMessage，即使登录页永远用不到，也必须进 boot graph。
这个应该先解除。
第二层：把现在的 PluginCatalogs 拆成“声明”和“运行时”
目前：
interface PluginCatalogs {
  namespace: string
  messages: readonly MessageDescriptor[]
  locales: ...
}

这个接口实际上混了两种用途。
messages 是：
build/test time metadata

用于：
- namespace 检查；
- duplicate message id；
- catalog completeness；
- orphan translation 检查。
而 locales 才是：
browser runtime

所以应该概念上拆成：
interface MessageDeclaration {
  namespace: string
  messages: readonly MessageDescriptor[]
  locales: ...
}

interface RuntimeCatalogGroup {
  load(locale): Promise<MessageCatalog>
}

collector 在构建阶段读取完整 MessageDeclaration 做现在所有严格检查。
但生成给浏览器的 virtual module 不再带 messages。
也就是说：
messages/defaultMessage
不是为了 catalog completeness
被迫留在浏览器启动图里。

这一刀即使暂时不做 lazy locale，也可能已经能砍掉一部分 boot graph。
第三层才是你问的：语言包要不要拆
要。
但我现在会比上一条更明确：
不是“插件一个语言包”，而是“shell + feature group”。
Qualy 比较适合：
core/shell
auth
org
assessment-entry
assessment-review
assessment-admin
assessment-record
formula

大约 6～10 个组就够了，不要几十个。
例如 assessment/core 当前那个 i18n.ts 非常大，我看里面同时塞着：
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

学生进入“我的申报”完全没必要加载：
review/*
record/*
staff/*
items editor/*
administrative/*

所以这一块确实应该切。
但 defaultMessage 应该跟 feature 一起 lazy，而不是全局消失
这是我现在认为最稳妥的第一版。
例如：
用户进入“我的申报”
        ↓
同时 preload
        ↓
assessment-entry 页面代码
assessment-entry messages/defaultMessage
assessment-entry zh-CN catalog

也就是：
Promise.all([
  loadPage(),
  loadMessageGroup('assessment-entry'),
  loadLocaleGroup('zh-CN', 'assessment-entry'),
])

假设中文语言包成功：
显示中文

假设：
locale-zh-CN-assessment-entry.js

因为发布错位、网络异常、缓存损坏之类加载失败：
assessment-entry 页面 JS
本身已经带 defaultMessage
        ↓
仍然可以显示 fallback

这就完整保留了你说的 defaultMessage 价值。
而且它解决了现在最大的浪费：
不是登录页携带整个 Qualy 的 defaultMessage

而是：

登录页
→ auth 的 defaultMessage

我的申报
→ assessment-entry 的 defaultMessage

审核工作台
→ assessment-review 的 defaultMessage

中文用户仍然会在当前 feature里同时付：
fallback text + Chinese text

但不会再为整个产品同时付两份语言。
这已经是一个相当大的结构改善，而且不用搞复杂编译器。
shell 需要单独处理
这里不能天真地完全按页面 lazy。
因为用户还没打开页面之前，已经要显示：
导航栏
页面名称
布局
用户菜单
Session Recovery
加载失败
Release Recovery
通用按钮

这些应该属于：
core/shell

并始终加载。
你现在 bootstrapMessages 其实已经是这个思想的更早一层：
catalog 尚未存在
↓
仍然需要：
加载中
重试
页面加载失败
Qualy 已更新
...

这个不要动。
最终实际上有三层：
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

这套结构和 Qualy 很匹配。
错误翻译也必须跟着 feature 拆
这一点非常关键，否则你拆了 zh-CN，94KB defaultMessage 还是下不去多少。
现在每个插件：
errorMessages

也被全局聚合：
export const errorMessages = {
  ...authErrorMessages,
  ...assessmentErrorMessages,
  ...
}

而每一个错误注册又带：
message: {
  id,
  defaultMessage
}

所以 Assessment 几十种拒绝原因全都可能进入登录页启动图。
未来应该变成：
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

进入 feature 时注册：
i18n.registerGroup(group)

加载过之后可以留在内存里，不需要卸载。
是否应该进一步做到“正常情况下连当前 feature 的 defaultMessage 都不下载”？
技术上可以，而且这是第二阶段可以考虑的。
也就是 source 仍然写：
{
  id,
  defaultMessage
}

但 production build 时做 extraction：
source
        ↓
build compiler

runtime JS:
id

zh-CN catalog:
中文

fallback catalog:
defaultMessage

正常中文用户：
page JS + zh-CN

不会下载 fallback。
只有语言包加载失败：
zh-CN chunk failed
        ↓
load fallback catalog
        ↓
仍然有可读页面

这个理论上是最省流量的模型。
但这里会带来真正的 build compiler。
你必须保证：
defaultMessage extraction
message id
ICU placeholders
error registry
catalog completeness
open-world plugins
source maps
development behavior

全都不漂移。
所以我现在不建议第一步就做这个。
先做 feature lazy，实际看数据。
假如从：
boot graph:
676 KB Brotli
locale:
54.7 KB
default messages:
约 94 KB

变成：
登录页：
shell + auth catalog ≈ 10 KB
shell + auth fallback ≈ 10~20 KB

LCP 已经明显下降，那完全没必要再造 extraction compiler。
我也不建议换 i18next / FormatJS
你现在已经用了 Lingui 的：
setupI18n()
compileMessage()

Lingui 本身完全支持：
后续继续 i18n.load(locale, moreMessages)

也就是说增量 catalog 不需要换引擎。
Qualy 自己已经建立了很多很有价值的东西：
UiText
MessageDescriptor
namespace ownership
plugin catalogs
error translation typing
catalog completeness gate
server/browser language boundary

现在换 i18next 之类并不会解决：
“为什么所有插件 catalog 都在首屏？”

因为这是你的composition model造成的，不是 Lingui 造成的。
换库反而要重写大量已经正确的边界。
所以我的选择是：
保留 Lingui，重构 Qualy 的 i18n composition。

还有一个语义我会顺便修
当前代码里：
export const fallbackLocale = 'en-US'

然后注释是：
// defaultMessage is the english fallback

你刚才指出的问题就在这里。
我建议至少把概念改成：
export const sourceLocale = 'en-US'

或者：
export const authoringLocale = 'en-US'

表达的是：
Qualy 当前约定所有源码 defaultMessage 使用 en-US 编写。

而不是：
defaultMessage 的定义就是 English。

defaultMessage 仍然只是 fallback text。
这样以后契约语义会清楚很多：
MessageDescriptor.defaultMessage
= emergency fallback

authoringLocale
= 本项目约定 fallback 文本当前使用哪种语言

SupportedLocale
= 用户可以选择的语言

Catalog
= 某 locale 的正式翻译

四件事不再混为一谈。
我最终会把 Qualy 目标架构定成这样：
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

然后如果实际测出来仍然值得继续：
Phase 2

feature defaultMessage
      ↓ build extraction
fallback catalog
      ↓
只在 locale load failure 时请求

这才是我认为既尊重 defaultMessage 的真正用途，又适合 Qualy 当前插件架构和性能需求的方案。
所以我会修正上一轮建议：不要以“把 defaultMessage 变成 en-US 语言包”为核心。先把“全产品 i18n 全局静态装配”改成“shell + feature 增量装配”；defaultMessage 保留，并跟实际 feature 一起 lazy。之后如果数据证明还值得，再做 fallback extraction。


你再认真阅读下Qualy源码，根据其他生产项目的实践，考虑下对于Qualy来说怎么做是最合适的。

思考了 5m 8s
我重新按 Qualy 当前的 i18n 链路完整看了一遍，包括 App.tsx、packages/web/i18n、i18n-contract、collect.ts、surface registry、route builder、各插件的 client/i18n.ts，尤其是 assessment/core 现在大量页面共同引用一个 assessmentMessages 的方式。结合 Lingui、FormatJS 这类生产工具的标准做法，我会把之前的建议再收敛一下。

结论是：

Qualy 不适合继续维持“全产品一个 locale chunk + 全产品 defaultMessage 常驻首屏”的结构，但也不适合简单地把 54.7 KB 拆成十几个语言包。最合适的是：保留 Lingui，改成“构建期提取/预编译 + source locale + shell catalog + 按 feature lazy catalog”，同时把 defaultMessage 从生产静态 JS 中移出，但保留它作为源码 authoring 和 wire fallback。

这其实正是 Lingui 自己生产构建的方向：开发时保留 source/default message，生产时移除它们和运行时 message compiler，真正依赖编译好的 catalog；source locale 本身也作为一个 catalog 动态加载。Lingui 官方也明确建议动态加载当前语言的 catalog。
 FormatJS 也专门提供 removeDefaultMessage，说明“源码保留 defaultMessage，但生产 bundle 不必永久携带它”是很成熟的模式。

Qualy 现在真正的问题
现在并不是单纯 zh-CN 的 54.7 KB 太大。

App.tsx 是：

<I18nProvider
  catalogs={catalogs}
  errorMessages={errorMessages}
  fallback={<LoadingScreen />}
>
  ...
</I18nProvider>

而 loadCatalogs() 是：

const sources = [
  commonCatalogs,
  ...plugins.map(plugin => plugin.locales)
]

await Promise.all(...)

也就是：

所有 active plugin 的当前语言 catalog 不到齐，整个应用就不激活。

与此同时，collect.ts 生成的 virtual:qualy/plugins 又是静态：

import { catalogs as authCatalogs } from '.../auth/i18n'
import { errorMessages as authErrors } from '.../auth/i18n'

import { catalogs as assessmentCatalogs } from '.../assessment/i18n'
import { errorMessages as assessmentErrors } from '.../assessment/i18n'

所以两头都全局化了：

JS 侧：
所有插件的 MessageDescriptor/defaultMessage
所有插件的 errorMessages

locale 侧：
所有插件的 zh-CN
这才导致中文用户首屏同时承担那批英文 fallback 和 54.7 KB Brotli 中文。

而且还有第三个问题：当前：

instance.setMessagesCompiler(compileMessage)

意味着你把 raw ICU strings 发给浏览器，再让浏览器编译。

生产项目一般会把 ICU 编译放在 build 阶段。Lingui 自己的生产模式就是这么干的，可以让生产 bundle 不再承担 source messages 和 compiler。

所以这次最好别只围着“54 KB 怎么拆”打补丁，而是把 i18n 的生产模型理顺。

我认为 Qualy 最终应该有三层语言资源
第一层保持你现在已经做得很好的 bootstrapMessages。

Layer 0 — bootstrap

加载中
页面加载失败
刷新
Qualy 已更新
release skew
maintenance
...
这些在 React/i18n runtime 都还没起来的时候就必须显示，因此应该继续内联。不要动。

第二层是 shell catalog。

它应该包含真正“应用壳启动就必须知道”的内容，例如：

common/*
layout/*
导航组
页面导航名称
document title
Session Recovery
通用错误/空态
用户菜单少量通用文字
这个 catalog 应该在进入正式应用之前加载。

但这里有个 Qualy 特有的细节：你的导航和 page title 是 manifest 里的 UiText，来自各业务插件 descriptor，所以 shell catalog 不是单纯 @qualy/web-i18n 自己的 common 文案。

构建器应该把所有 active plugin 中会出现在 manifest/shell 上的 message id提取出来，合并成类似：

locale-shell-zh-CN.js
locale-shell-en-US.js
我预计这一块不会很大，理想是几 KB 到十来 KB Brotli。

第三层才是 feature catalog。

例如：

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
不需要每个页面一个，更不要每个组件一个。

assessment/core 是必须真正拆的地方
这一点我现在比之前更确定。

因为我查了引用关系，assessment/core 大量模块都是：

import { assessmentMessages as m } from '../i18n.ts'

包括：

entry/*
review/*
record/*
batch/*
roster/*
items/*
access/*
各种 page
这意味着即使你把 zh-CN.ts 网络上拆成多个 chunk，但源码里的：

assessmentMessages = {
  几百甚至上千条 descriptor
}

仍然是一个共同依赖。

Rollup 很容易把这个 i18n.ts 变成所有 assessment 页面共同依赖的大 shared chunk。

所以：

仅拆 translation file，而不拆 message declaration，本质上只解决一半。

对 Assessment，我会实际拆源码：

client/i18n/
  shell.ts
  batch.ts
  entry.ts
  review.ts
  record.ts
  admin.ts
然后：

// entry/*
import { entryMessages as m } from '../i18n/entry.ts'

而不是所有东西都继续 import 巨大的：

assessmentMessages

这样才会形成真正的：

MyEntries page
→ entry JS
→ entry fallback descriptors（开发态/需要时）
→ entry locale

Review page
→ review JS
→ review locale
Formula 可以先不细拆，除非测出来它也很大。Org 本身规模较小，也没必要为了架构洁癖拆成五份。

defaultMessage 怎么处理，我现在建议这样定
你前一条指出得对：

defaultMessage !== English catalog
这个类型层面的语义应该保持。

但对 Qualy 本身，应该明确增加：

sourceLocale = 'en-US'

而不是继续叫：

fallbackLocale = 'en-US'

二者区别是：

defaultMessage
= 每条消息源码里提供的可读 fallback

sourceLocale
= Qualy 约定这些 defaultMessage 当前使用的语言
Qualy 当前 source locale 就是 en-US。

这也是成熟 i18n 系统通常要求的。FormatJS 明确要求 defaultLocale 与 defaultMessage 所使用的 locale 一致，否则连消息内部的日期、数字格式都可能出现混合语言。

因此源码仍然写：

{
  id: 'assessment/entry/submit',
  defaultMessage: 'Submit for review'
}

开发环境也继续享受：

没 catalog
→ defaultMessage
但是 production build 不应该把这些字符串全部永久塞进 JS。

生产环境的 fallback 不应该靠“永远携带全套 defaultMessage”
这是我这次最重要的判断。

现在你的设计是：

zh-CN chunk 加载失败
↓
activate({})
↓
每一个 descriptor 自带 defaultMessage
↓
全站还能显示英文
它确实很鲁棒。

但代价是：

每一次正常访问，都为一个极低概率故障永久下载几十 KB fallback。

大型生产项目通常不是这么换可靠性的。

更合理的是：

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
Lingui 本身的生产方式就是 source locale 也进入 catalog，因为生产构建会移除 source/default message。

这对 Qualy尤其合理，因为你已经有：

hashed immutable asset；
old-release asset retention；
release skew detection；
asset load recovery；
boot watchdog；
bootstrapMessages。
如果：

当前 locale catalog 失败
+
source locale catalog 也失败
那已经不是“一条翻译缺失”了，而是静态资源交付发生故障。

这时候继续拼命让业务页面半残运行，反而不如明确进入资源恢复 UI。

因此没必要用 94 KB 常驻数据为这种情况兜底。

但 UiText.defaultMessage 不要删
这里必须和静态前端 descriptor 区分。

你现在服务端可以发：

{
  kind: 'message',
  id: 'assessment/navigation/batches',
  defaultMessage: 'Assessment rounds'
}

这个 wire contract 我认为非常好。

继续保留：

MessageRef {
  id
  defaultMessage
}

因为它有几个价值：

server/plugin contribution 是 self-describing 的；
客户端 catalog 暂时没有这个 ID 时仍能显示；
plugin/version skew 下不至于显示 raw id；
服务端日志、mirror、非浏览器环境可以用 plainText()。
这些 payload 只包含实际返回的几个 message，不是把全站消息塞进网络。

所以最终可以出现两个稍微不同的概念：

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

这是合理的，不需要强行把三个生命周期压成一个物理结构。

我不会换掉 Lingui
认真看完后，这一点我也比较确定。

你现在的问题不是 Lingui 能力不够，而是实际上只用了它：

setupI18n
i18n.load
i18n._
compileMessage
但没有采用它生产优化的那一半：

extract
compile
strip source messages
dynamic compiled catalogs
换 i18next / React Intl 不能自动解决：

virtual:qualy/plugins 全局静态 import i18n
和：

assessmentMessages 一个大对象被全 assessment 共享
这两个才是根因。

相反，Lingui 官方 production macro 本身就会把 message、comment 等非运行时数据移掉，只留下 message id。

所以最好是：

保留 Lingui core，引入 Qualy 自己的 build-time i18n compiler。

不一定非要采用 .po。

我反而建议暂时继续用 TS catalog
你当前：

locales/zh-CN.ts

有很不错的工程属性：

正常 TypeScript；
现有 tests 可以 import；
completeness/orphan gate 很严；
ICU argument mismatch 有测试；
plugin namespace 有门禁；
不需要再引入翻译平台文件格式。
目前只有中英文两种语言，也没有专业 TMS 流程。

所以没必要为了“生产项目都用 PO”就迁 .po。

可以让构建插件读取现有 TS catalog，然后：

raw ICU TS
      ↓ build
compileMessageOrThrow
      ↓
compiled catalog JS chunk
生产浏览器只拿 compiled messages。

这样可以顺便去掉：

@lingui/message-utils/compileMessage

这一整段浏览器运行时编译路径。

如果未来接 Crowdin/Lokalise/Transifex，再考虑 PO interchange；你的 contract 注释本来也已经为此留了口。

对 Qualy，我会具体这样落地
如果让我给 Claude Code 一个最终实施顺序，我会定成：

先改概念，不改 UI 行为。 fallbackLocale → sourceLocale；源码 defaultMessage 保留；wire MessageRef.defaultMessage 保留。

引入 build-time catalog compilation。 继续以 TS catalog 为 authoring source，但 production 输出 Lingui compiled catalog，不再在浏览器 setMessagesCompiler(compileMessage)。先量一次因此减少的 boot JS 和 TBT。

把 build-time declaration 与 runtime catalog 分离。 当前 PluginCatalogs.messages 主要是 build/test metadata，不应该因为 completeness gate 就被带进 production runtime。

生产构建剥离静态 descriptor 的 defaultMessage。 同时生成真正的 en-US source catalog。开发/test 保持当前 descriptor 形状。这个阶段后，中文正常路径就不再携带整套英语字符串。

先拆 shell 与 feature。 shell 聚合所有 active plugin 的导航/page title/layout/common message；feature 按需加载。

优先拆 Assessment。 我会先用 batch / entry / review / record-admin 四块，不要上来拆十几块。Auth 可以先 login / account-admin 两块。小插件先保持一块。

把 surface loader 和 locale loader绑在一起。 你这一轮已经在做“当前 page code 提前 preload”，正好让它演进成：

current surface known
↓
并行
├─ layout chunk
├─ page chunk
├─ shell catalog（若未加载）
└─ feature catalog
↓
render
而不是 page render 后才发现语言资源没到。

错误 registry 跟 feature 走。 Common transport/authentication errors 常驻；assessment 那一大堆领域拒绝原因不要在登录页全局注册。

locale load failure 先退 source catalog；双失败才进 bootstrap recovery。 不再 activate({}) 然后指望整个应用里的 defaultMessage 救场。

最后重新跑 Lighthouse 决定是否继续细拆。 不根据“文件看起来大”继续切。

我会给它明确的停止指标：

shell locale: 尽量 < 10–15 KB Brotli

常见 feature locale:
大致 < 10–20 KB Brotli

首次页面：
locale 请求总数最好 1–2 个
不要变成 8–15 个

如果某个 feature < 5 KB：
通常不要再拆
不是硬性标准，但作为 chunk 粒度很实用。

这样改完以后，中文用户的典型冷启动应该从现在近似：

boot JS
  + 全产品 defaultMessage
  + locale-zh-CN 54.7 KB
  + current page
变成：

boot JS（无全产品 fallback 文本）
  + locale-shell-zh-CN
  + current feature locale
  + current page
而英文用户则：

boot JS
  + locale-shell-en-US
  + current feature en-US
  + current page
两个语言完全对称。

这也是我认为比当前：

en-US = 特殊的 defaultMessage
zh-CN = 真 catalog
更干净的模型。

最重要的是，源码里的 defaultMessage 仍然没有失去意义。它仍然是 authoring source、translator source、开发态 fallback、wire fallback；只是生产正常路径不再为“万一 catalog 坏了”永久携带整套源语言字符串。

对 Qualy 现在这个体量，这比单纯“把 54 KB 拆成几个 JS”更值得做。

我有一个大胆的猜想，我们可否用打包时长换首屏时长，在打包的时候打包出多个语言的JS包，这样每个用户每个语言只需要加载同一个包，换语言才需要全量重载，还是你认为不合适。

思考了 1m 6s
这个思路不是异想天开，反而是成熟的生产方案之一。Angular 的生产 i18n 就支持“编译一次，再为每个 locale 生成一个完整的本地化应用变体”，运行时切语言通常就是切到另一个 locale 版本并重新加载。

但对 Qualy，我会做一个关键修正：

可以做“每种语言一套 build variant”，但绝对不要做“每种语言一个包含整个 Qualy 的大 JS”。

后者只是把：

入口 JS
+ 54.7 KB zh-CN
+ 页面 chunk
变成：

一个更大的 zh-CN.js
请求数少了，但首屏字节没少，甚至会把 Formula Editor、审核、后台等本来可以 lazy 的代码一起拖进首屏，得不偿失。

我更推荐的是：

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
也就是说：

语言在 build 时确定，但页面/feature 的 code splitting 继续保留。

这其实非常适合 Qualy。

这样比我们刚才讨论的 runtime lazy catalog 还更干净
假设当前中文用户打开“我的申报”。

现在大概是：

入口代码
+ 全产品 defaultMessage
+ 54.7 KB 全产品 zh-CN
+ MyEntries 页面代码
如果改成 locale-specific build：

zh-CN shell
+ zh-CN MyEntries chunk
MyEntries chunk 里面直接已经是：

我的申报
提交
保存草稿
申诉
……
不再需要：

{id: "...", defaultMessage: "..."}
      ↓
运行时查 catalog
甚至也不需要：

compileMessage

生产环境运行时编译 ICU。

Lingui 官方本身也是这个方向：production 会剥离 source message 和 message compiler，依赖预编译后的 catalog。

而 Angular 更进一步就是直接做 compile-time localization，把消息替换成本地化内容。

所以这个想法从工程实践上完全站得住。

对 Qualy 最大的优势：天然按页面获得 i18n code splitting
这比我们人为设计：

assessment-entry locale
assessment-review locale
assessment-admin locale
漂亮很多。

因为 Qualy 本来已经有非常明确的动态边界：

Ui.page({
  component: Ui.react('./client/entry/MyEntriesPage')
})

Vite 已经把这些 surface 切 chunk。

如果消息跟代码一起编译，那么：

MyEntriesPage
→ 它真正引用到的中文

ReviewPage
→ 它真正引用到的中文
bundler 自己就能通过 import graph 决定哪些文案属于哪个 chunk。

你不需要再维护第二张人工表：

这个 message 属于 entry catalog
那个 message 属于 review catalog
这点对 Qualy 很重要。

你现在最大的一个反模式恰恰是：

import { assessmentMessages as m } from '../i18n.ts'

整个 assessment 共用一个巨大的 message object。

如果把 message declaration 拆回 feature 附近：

entry/messages.ts
review/messages.ts
batch/messages.ts
它们就自然跟随对应页面 chunk。

但 Qualy 有一类文案不能这么简单处理：manifest 的 UiText
比如：

Ui.page({
  navigation: {
    label: message(
      'assessment/navigation/batches',
      'Assessment rounds'
    )
  }
})

这个东西是服务器根据权限生成 manifest 后发给浏览器的。

浏览器收到：

{
  "kind": "message",
  "id": "assessment/navigation/batches",
  "defaultMessage": "Assessment rounds"
}

此时组件代码里不存在一条静态：

format(m.batches)

供 build compiler 替换。

所以 Qualy 即使采用 compile-time locale variant，还是需要一个很小的 runtime shell dictionary，专门处理：

manifest page title；
navigation labels；
collection labels；
permission labels；
Login driver descriptors；
其他服务器下发的 UiText。
例如中文 variant 自带：

const shellMessages = {
  'assessment/navigation/batches': '测评批次',
  'assessment/nav-group/main': '测评',
  'org/navigation/organization': '组织架构',
  ...
}

它不需要包含：

提交成功
保存草稿
删除确认
审核意见
公式编译失败
……
那些页面内部文案已经跟页面代码走了。

于是架构变成：

                 build-time localized

Component copy ─────────────────────→ page chunks


                 small runtime lookup

Manifest UiText ────────────────────→ shell dictionary
API dynamic UiText ─────────────────→ shell/feature dictionary
我认为这比“一个 54 KB 全局 catalog”明显更合理。

API Error 也可以自然解决
现在：

errorMessages = {
  ...所有插件错误
}

也是首屏静态聚合。

locale variant 后，可以把错误 registry 跟 feature code 放一起。

例如：

assessment-entry chunk
├─ entry UI
├─ entry localized messages
└─ entry error translators
只有通用的：

AUTH_REQUIRED
SESSION_EXPIRED
ACCESS_DENIED
BAD_REQUEST
transport errors
放 shell。

这又能砍掉一截当前 boot graph。

切换语言必须 reload，我认为可以接受
这是这套方案最大的产品取舍。

现在 Qualy：

中文 → English
可以运行时立即 re-render。

locale-specific build 后：

localStorage.setItem('qualy.locale', 'en-US')
location.reload()

即可。

我觉得对 Qualy完全可以接受。

语言切换本身：

极低频；
通常只在账号菜单/登录页操作；
两种语言，不是用户不停切换的主题设置；
reload 可以彻底保证日期、数字、页面、错误 registry、插件 UI 都在同一个 locale 世界里。
Angular 的 compile-time localization 本身也是这种取舍；其运行时加载翻译的机制也明确说明，已经处理过的内容不会因为后来加载新翻译自动改变，因此动态切语言通常涉及重新加载。

而且从 correctness 上说，我甚至觉得比现在更漂亮：

一个 browser lifecycle
=
一个 locale
=
一个完整一致的 localized application
不会出现某个 lazy feature 忘了重新 subscribe locale 的问题。

唯一需要处理的是脏表单。

如果用户已经填写了内容再切语言，不能直接：

location.reload()

把内容抹掉。

Qualy 已经有 leave guard 体系，因此语言切换应该走相同的“将离开当前文档”语义：

切换语言需要重新载入页面，未保存的更改将丢失。

有 dirty state 时确认；没有时直接 reload。

首次访问怎么知道应该加载哪个语言？
这个问题 Qualy 反而已经解决了一半。

你现在 shell boot script 在 React 起来之前就已经计算：

localStorage qualy.locale
        ↓
navigator.languages
        ↓
defaultLocale
并写：

<html data-locale="zh-CN">

所以同一个 bootstrap script 可以进一步做：

const locale = resolveLocale()

const src = locale === 'zh-CN'
  ? '/assets/e-zh-CN-xxxx.js'
  : '/assets/e-en-US-yyyy.js'

import(src)

甚至 HTML 内放一个 build-time generated map：

<script type="application/json" id="qualy-entries">
{
  "zh-CN": "/assets/e-abc.js",
  "en-US": "/assets/e-def.js"
}
</script>

boot script：

解析 locale
→ 找 entry
→ modulepreload/import 对应 variant
所以不需要服务器根据 Accept-Language 决定。

这一点非常适合你，因为：

用户在 Qualy 里手动选择的 locale 比 HTTP Accept-Language 优先。

服务器第一条 HTTP 请求看不到 localStorage，但你现有 bootstrap 看得到。

不过我不会直接做“两次完整 Vite build”
这里还有一个实现质量问题。

最粗暴的方法：

vite build --mode zh-CN
vite build --mode en-US

当然能跑。

但会：

重复 parse/transpile；
重复 StyleX；
重复 minification；
sourcemap 两套；
大量不含任何文案的 chunk 也可能重复；
release-store 管理变复杂。
只有 2 种语言，其实也不是不可接受，但既然你说的是：

用打包时长换首屏时长

可以先这么做 PoC，测出收益。

正式版本我更希望类似 Angular 的思路：

代码编译一次，localization pass 产生 N 个 localized variant。

Angular 官方也特意说明，它生成多个 locale variant 时不需要为每种语言从头完整编译一遍。

Qualy 可以：

TS / React / StyleX
        ↓
一次 normal build/intermediate graph
        ↓
locale transform
    ┌─────────────┐
    ↓             ↓
 zh-CN          en-US
不过这属于第二阶段优化。现在只有两个 locale，先双 build 验证性能价值非常合理。

还有一个很大的隐藏收益：缓存
现在任何一个中文翻译改动：

locale-zh-CN-OLD.js
→ locale-zh-CN-NEW.js
因为所有中文文案全在一个 54.7 KB chunk：

改一个“取消”也可能让用户重新下载整个 54.7 KB。

如果 locale variant 跟 feature chunk 走：

review 文案改了
只会失效：

zh-CN review chunk
登录、组织、我的申报的 chunk 仍然是原 hash，继续 immutable 命中。

这一点和 Qualy 当前 release store 的设计非常契合：

Cache-Control: public,max-age=31536000,immutable
你已经专门为 content-addressed chunks 建了一整套 retained asset store。

更细但自然的 feature chunk 会显著提高跨版本缓存复用率。

存储成本我完全不担心
两种语言就算让浏览器资产从例如：

20 MB
涨到：

30–35 MB
对于服务器磁盘和发布系统基本不值一提。

真正值钱的是：

每一个真实用户
每一次 cold start
减少几十到上百 KB
减少一轮 catalog dependency
减少 runtime ICU compile
这是非常合理的：

build/storage cost → user latency

交换。

所以我会认真把你这个方案列为比“runtime 拆 6 个 language chunks”更值得做 PoC 的方案。

但准确名称不应该是：

“每种语言一个 JS 包”

而应该是：

compile-time localized application variants

并且保留现有 route/feature code splitting。

最终模型我会选：

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
运行时不再有一个 54.7 KB 的“全产品 zh-CN 包”。

语言切换：

保存 locale
→ reload
→ boot script 选择另一个 variant
defaultMessage 仍保留在源码和 UiText wire contract 中，但生产静态业务代码经过 localized build 后不再携带整套 source text。

如果只有 zh-CN / en-US 两种语言，我现在反而很倾向这个方向。 如果未来变成 15～30 个 locale，再重新评估 build matrix 和共享 chunk；目前两种语言正是 compile-time locale variant 非常舒服的规模。


行，以上也我只是提出一个简单设想。你再认真思考下本项目怎么做最合适，看看还有没有更好的方案来做，你思考下。以及如果按照这个设想，是否有成形的库来实现这方面，打包的时候怎么打包，以及是否此时代码库的i18n就没必要拆成zh-CN.ts而是可以直接写到i18n条目定义里一起维护了。

思考了 7m 35s
我重新按 Qualy 现在的约束想了一遍，我会把上一轮“每个 locale 编一套应用”的方案降级为实验方案，而不是最终架构。

对 Qualy 最合适的路线，我现在会定成：

保留 Lingui，改成标准的“源码消息 → 构建期提取/编译 → 生产只加载当前 locale 的已编译 catalog”，然后视实测再做 feature 级 catalog splitting。不要做完整的 zh-CN/en-US 应用双份构建，也不要把中英文翻译都直接写进同一个 i18n.ts 条目。

原因主要来自 Qualy 自己的架构，而不是通用偏好。

为什么我不再优先推荐“每种语言一套完整 JS”
这个模式本身没问题。Angular 就原生支持 compile-time localized application variants，而且会尽量复用编译结果，而不是简单完整编译 N 次。

但 Qualy 有两个 Angular 普通应用没有的特征。

第一，你有大量动态 UiText：

message(
  'assessment/navigation/batches',
  'Assessment rounds',
)

它们通过 manifest、权限、登录方式等服务端贡献流到浏览器。浏览器必须做到：

收到 id
→ 根据当前 locale 查翻译
所以即使把组件 JSX 全都 compile-time localize，运行时 dictionary 仍然消灭不了。

第二，Qualy 是 open-world plugin build。Ui.react()、Ui.i18n() 可以来自装配出来的插件，包括将来的 dist-only 第三方插件。让宿主在构建时重新给所有插件生成：

zh-CN component graph
en-US component graph
会让 plugin packaging contract 明显复杂化。

再加上：

两套 source map；
两套绝大多数完全相同的 JS；
release store 资产数量翻倍；
每种 locale 都改变 chunk hash；
以后第三、第四语言线性放大；
最后得到的收益，标准 Lingui production pipeline 已经能拿走大部分。

所以 locale variant 可以做 PoC，但不是我现在会提交到主架构里的方案。

你现在其实只用了 Lingui 的“一半”
这点是整个问题的核心。

当前 Qualy 是：

setupI18n()

instance.setMessagesCompiler(compileMessage)

然后自己维护：

client/i18n.ts
client/locales/zh-CN.ts
最后把 raw ICU 发给浏览器现场编译。

但 Lingui 正常的 production workflow 本来就是：

source messages
     ↓
extract
     ↓
catalog
     ↓
compile at build time
     ↓
production JS
官方明确说明：development 可以保留 source/default messages 和 message compiler，而 production 会去掉它们，依赖预编译 catalog；当前语言的 catalog 可以动态 import，只下载当前 locale。

而 Lingui macro 的生产转换甚至明确会把：

{
  id: '...',
  message: 'Source message',
  comment: '...'
}

变成：

{
  id: '...'
}

message、comment、context 都从 production JS 去掉。

这恰好就是 Qualy 现在想自己解决的问题。

更巧的是，你现在：

Vite 8.2
Lingui 6.6
@vitejs/plugin-react
而 Lingui 6 官方已经专门给 Vite 8 / Rolldown 提供了 @lingui/vite-plugin + transformer 的方案。

所以我不建议自己发明一套 Angular $localize。

我会怎么重构 Qualy
有一个重要原则：

把“源码默认文案”、“目标语言翻译”、“wire fallback”三个概念彻底分开。

现在它们有点缠在一起了。

源码层：

id: 'assessment/entry/submit'
source message: 'Submit for review'

这是开发者 authoring source。

翻译层：

zh-CN
assessment/entry/submit
→ 提交审核
这是 localization catalog。

wire 层：

UiText {
  id,
  defaultMessage
}

这是服务端无法决定用户语言时携带的 emergency fallback。

第三个我会完整保留。

也就是说：

MessageRef {
  kind: 'message'
  id: string
  defaultMessage: string
}

继续存在。

但：

client/i18n.ts

里所有静态 UI 文案，不再依赖 defaultMessage 常驻 production bundle。

我会按下面这个顺序做：

把当前 fallbackLocale = 'en-US' 的概念改成 sourceLocale = 'en-US'。defaultMessage 本身并不意味着英文；只是 Qualy 当前规定 source messages 用 en-US 写。

引入 Lingui 正常的 build pipeline：@lingui/cli + @lingui/vite-plugin。catalog 在构建时编译，production 删除 compileMessage，浏览器不再现场 parse ICU。Lingui 官方的生产模型就是如此。

浏览器静态文案逐步从巨大 assessmentMessages / authMessages 中移出来，靠近真正使用它的 feature。这里我甚至更想用 Lingui 的 msg()/defineMessage() macro 并保留 Qualy 的显式 message id，例如：

const submit = msg({
  id: 'assessment/entry/submit',
  message: 'Submit for review',
})

production 里最终只留下 id。

UiText、plugin descriptor、permissions、navigation 这些跨边界消息继续用 Qualy 自己的 message(id, defaultMessage)。它们不能被粗暴改成只有 id。现有 catalog gate 可以扩展为把这些 descriptor contribution 也纳入 extraction/completeness。

第一版先只做“一 locale 一 compiled catalog”，不要立刻拆。也就是中文仍然可能是一份大约几十 KB 的 catalog，但已经去掉启动 JS 里那批重复 source messages，也去掉 runtime ICU compiler。然后重新测 Lighthouse。

只有如果此时 zh-CN catalog 仍然是明显 LCP 成本，再做 shell + feature splitting。优先只拆 auth 和 assessment/core 两个巨型域，而不是全项目机械拆。

catalogue load failure 改成：

zh-CN compiled catalog 加载失败
    ↓
尝试 sourceLocale=en-US compiled catalog
    ↓
仍失败
    ↓
bootstrap recovery
而不是今天的 activate({}) 后要求整个 production JS 永久携带所有 defaultMessage。

这一套改动比 full locale variant 的结构风险小很多，却已经能吃掉最主要的冗余。

那 zh-CN.ts 还要不要存在？
这里我的答案比较明确：

翻译仍然应该和 source message 分开维护。不要改成这样：

{
  id: 'assessment/entry/submit',
  defaultMessage: 'Submit for review',
  translations: {
    'zh-CN': '提交审核',
    'en-US': 'Submit for review',
  },
}

两种语言时看着非常舒服，但长期并不好。

FormatJS 的生产实践同样明确推荐：source/default message 靠近使用位置，因为这样上下文最完整、随着代码一起生灭；目标语言则属于 catalog。

原因也很现实：

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
全写进 TypeScript，很快会让业务源码变成翻译数据库。

并且会失去：

翻译 diff 的独立性；
TMS 兼容性；
翻译人员不碰业务源码；
批量检查缺失翻译；
locale-specific review；
将来增加语言时不修改每个业务源文件。
所以应该是：

业务源码：
Source message

翻译资源：
zh-CN translation
而不是所有语言共置。

但是当前巨型 client/i18n.ts 我确实会拆掉
这一点和 zh-CN.ts 是否独立是两回事。

当前 Assessment：

import { assessmentMessages as m } from '../i18n.ts'

被：

entry/*
review/*
record/*
roster/*
batch/*
items/*
access/*
到处引用。

这就导致任何 Assessment 页面都对整个 assessmentMessages 对象建立依赖。

这才是很不利于 tree-shaking/code splitting 的结构。

更理想的是：

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
甚至更进一步，简单消息直接和使用处 colocate：

const submit = msg({
  id: 'assessment/entry/submit',
  message: 'Submit for review',
})

而不是再维护一个 4000 行的 i18n.ts。

应该拆 source declaration；不是把每种翻译也塞进这些 declaration。

这两个方向千万别搞反。

zh-CN.ts 本身甚至可以不再手写 TS
如果我们这次真的切到 Lingui 标准生产链，我会考虑顺便从：

locales/zh-CN.ts
迁成：

locales/zh-CN/messages.po
Lingui 官方默认、推荐的 catalog 格式就是 PO，也支持其他格式和自定义 formatter。

例如概念上：

msgid "assessment/entry/submit"
msgstr "提交审核"
source message 和 translator comment 也能留在 catalog metadata。

不过这一点不是性能必须项。

如果你很喜欢现在 TS catalog：

export default {
  'assessment/entry/submit': '提交审核',
} satisfies ...

也可以先保留。

我不会为了“标准化”而增加一次大迁移。

真正重要的是：

raw catalog 不再直接发给浏览器
↓
build-time compile
↓
production compiled catalog
文件源格式 .po / .ts 本身不是性能核心。

是否有比 Lingui 更贴近你最初想法的库？
有一个值得提：Paraglide JS。

它是 compiler-based i18n，会把消息编译成 tree-shakable functions。它甚至明确表示在 locale 数量不多时，把多个 locale 跟随“实际使用的消息”tree-shake，可能比整包 lazy locale 更省；lazy locale splitting 反而主要针对大量语言。

它的模型很接近：

MyEntries chunk
├─ 这个页面使用的 message A
│  ├─ zh
│  └─ en
├─ message B
│  ├─ zh
│  └─ en
└─ ...
这和你刚才那个设想其实很接近，而且不需要切语言 reload。

如果 Qualy 是一个普通 Vite React 应用，我会认真考虑 Paraglide。

但 Qualy 不是普通应用。

你有：

server → UiText id → browser dynamic lookup

open-world plugins

permission/navigation/login driver descriptors

plugin-owned error translation registry
Paraglide 最擅长的是：

源码里静态知道我要 m.someMessage()
而 Qualy 很多地方是：

formatText(serverReturnedUiText)

只有运行时才知道 message id。

这种 dynamic lookup 和 per-message tree-shaking 天生有冲突：如果 id 任意动态，bundler 就不能证明哪些 message 永远不用。

最终大概率会变成：

Paraglide 管组件静态文案
+
另一套 dictionary 管 UiText
我认为为了省几十 KB 引入两套模型不值得。

所以我不会迁 Paraglide。

最终我会选的方案
我现在给 Qualy 的架构裁决是：

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
然后第二阶段才是：

global catalog
        ↓ 实测仍偏大
shell + feature catalogs
而不是直接做：

zh-CN whole application build
en-US whole application build
也不是：

每条 i18n 定义同时放中英文
我认为这是目前性能收益、Qualy 插件架构、可靠性、代码可维护性和成熟工具链之间最好的平衡点。

尤其值得先做的验证很简单：把 production source messages strip + catalog 预编译做出来，但暂时不拆那 54.7 KB catalog。 然后再跑你现有四页面 Lighthouse。很可能仅这一刀就已经让继续做复杂 catalog splitting 的收益变得不值得。

messages.po我同意，既然用Lingui就用完整，不要就用一半弄的四不像。还得麻烦你再认真帮我搜集一下信息，看看Qualy最终应该怎么定整个i18n框架，不用考虑代码工作量，就考虑怎么写最适合Qualy、未来最有发展。以及再考量一下是否要接入Paraglide。注意i18n文件、框架等重写均可，你要考虑哪个方向是最先进、最有先见之明的。

思考了 12m 9s
我重新把 Qualy 当前代码、Lingui 6.6、Paraglide/inlang 2.x、Vite 8，以及 Unicode MessageFormat 2 的现状放在一起看了一遍。结论可以定得比前面更明确：

Qualy 最终应继续选择 Lingui，但要从现在的“只拿 @lingui/core 当格式化器”升级为完整的 Lingui 工具链。Paraglide 不作为运行时引入。

准确地说，最终架构应该是：

Lingui 负责应用 i18n；PO 是翻译源文件；Lingui macro + extractor + compiler + Vite plugin 负责构建；Qualy 只保留一层很薄的插件发现、UiText 协议和 catalog 按需装配能力。

这和现在会有很大区别。

为什么我最终不选 Paraglide
Paraglide 很先进，它最吸引人的地方确实也是你刚才那个设想：它是 compiler-first，消息被编译成可 tree-shake 的函数，页面没引用的消息就不会进入 bundle。它自己的文档也把这一点作为核心优势。

但它和 Qualy 有一个根本冲突。

Qualy 不只是：

m.save()
m.delete()

这种编译时确定消息。

你还有大量：

服务端/plugin descriptor
        ↓
Manifest / permission / login-driver / UiText
        ↓
浏览器运行时收到一个 message id
        ↓
查询当前语言
也就是当前的：

formatText(text: UiText)

这是一个真正的 runtime dynamic lookup。

Paraglide 最强的 tree-shaking 恰恰依赖：

m.some_message()

在构建时能看到具体函数。如果改成动态：

m[id]()

或者自己建：

const messages = {
  a: m.a,
  b: m.b,
  c: m.c,
  ...
}

这一部分消息就重新全部变成 reachable，tree-shaking 的优势会明显下降。

理论上我们可以：

Paraglide
→ 组件内静态文案

另一套 dictionary
→ UiText 动态文案
但我非常不建议 Qualy 最终形成两个 i18n runtime。

更关键的是，Paraglide 官方当前仍说明：默认模式是一个被使用的 message function 内包含所有 locales；per-locale lazy splitting 目前仍属于 experimental。它认为 locale 少于约 20 个时这样通常更划算。它的 React component interpolation 目前也仍标成不支持。

这对于只有中英两种语言的普通 SPA 很有吸引力，但对 Qualy 这种：

动态 UiText
+ 插件化
+ 第三方 dist-only plugin
+ 未来可能增加语言
+ rich text
并不是最佳契合。

而且如果选 Paraglide，你基本也就不再走 Lingui/PO 这条路了。inlang 当前主推自己的 JSON message format，其数据模型和语法受到 MF2 启发，但并不是“已经直接采用 Unicode MF2”。
 当前 inlang 官方插件目录里也没有成熟的 Gettext/PO 插件。

所以我不会为了 compiler/tree-shaking 这一个优势，让 Qualy 换到一个对动态 message id 没那么自然的体系。

Lingui 则和 Qualy 的模型天然吻合
Lingui 的正常生产方式其实正是你现在缺的东西：

source message
    ↓
extract
    ↓
.po
    ↓
compile
    ↓
production catalog
PO 是 Lingui 默认且推荐的 catalog 格式；PO 只是开发/翻译源文件，生产环境根本不会解析 PO，它会被编译成 JS catalog。

更关键的是，Lingui production macro 会把：

{
  id,
  message,
  comment,
  context,
}

变成近似：

{
  id,
}

message、comment、context 都不会继续塞进 production JS。

而且 Lingui 官方明确推荐 production：

只 dynamic import 当前 locale catalog
source locale 也应该拥有自己的 compiled catalog，因为 production source messages 已经被剥离。

这几乎正中 Qualy 现在的问题。

你现在实际上是自己绕过了 Lingui 的 production pipeline：

setupI18n()
setMessagesCompiler(compileMessage)

然后手工：

i18n.ts
zh-CN.ts
把 raw ICU 发到浏览器现场编译。

这才是现在看起来有点“Lingui 但又不像 Lingui”的原因。

我建议最终把 Qualy 的消息分成三种
这是我认为整个重构中最关键的设计。

类型	例子	ID	来源
本地 UI 文案	保存、申诉、删除确认	Lingui generated ID	t / Trans / msg macro
协议文案	navigation、permission、manifest UiText	Qualy stable namespaced ID	message(id, fallback)
业务数据	组织名、人员名、租户配置值	无 i18n ID	literal(value)
也就是说，现在所有东西都必须写：

assessmentMessages.save
assessmentMessages.delete
assessmentMessages.xxx

这种模式应该消失。

普通组件应该变成真正的 Lingui 写法。

例如：

import { useLingui } from '@lingui/react/macro'

function EntryActions() {
  const { t } = useLingui()

  return <Button>{t`Save`}</Button>
}

或者：

<Trans>Submit for review</Trans>

需要以后使用的 descriptor：

const saved = msg`Draft saved`

Lingui 自动生成 ID。

这类消息完全没必要拥有：

assessment/entry/save
assessment/entry/saved
这种人工 key。

人工 semantic key 有一个隐藏缺点：英文 source copy 改了以后，ID 仍然一样，很容易让旧翻译继续存活而没人注意。

generated ID + gettext 的模型反而很合理：

Source message 改变
→ message identity 改变
→ translation 重新进入待确认状态
而 "Save" 在两个上下文含义不同，可以使用 Lingui context。这正是 gettext/msgctxt 和 Lingui context 存在的原因。

但是 UiText 的 ID 不能这么搞
这一类：

message(
  'assessment/navigation/batches',
  'Assessment rounds'
)

必须继续拥有稳定、可序列化、可由服务器发送的 ID。

因为这是一个协议地址，不是普通 UI copy。

所以：

MessageRef {
  kind: 'message'
  id: 'assessment/navigation/batches'
  defaultMessage: 'Assessment rounds'
}

继续保留。

这也意味着 Qualy 的：

namespaced message id ownership
最终只约束协议消息，不再约束所有组件内部文案。

我认为这个边界比现在清晰很多：

Lingui message ID
= localization implementation detail

Qualy UiText ID
= cross-plugin / wire protocol identity
不要继续把两者混成一个概念。

这样还能避开 Lingui PO 的一个现实问题
Lingui 当前对大量 explicit ID 写入 PO 的处理并不算完美。Lingui 自己目前还有一个开放 issue，讨论 explicit IDs 在 PO 中为了兼容 Gettext/TMS 所采用的表示方式比较别扭。

Qualy 现在几千条消息全部都是 explicit semantic ID：

assessment/entry/...
auth/person/...
...
如果原样搬过去，就会大量撞上这个问题。

而我上面这套模型中：

90%+ 普通 UI message
→ generated ID / 标准 Lingui PO

少量真正跨 wire 的 message
→ explicit namespaced ID
恰好把这个问题压缩到了很小的范围。

这是我觉得比“所有消息继续显式 id”更适合未来的一点。

client/i18n.ts 和 zh-CN.ts 最终都应该基本消失
尤其是现在 assessment/core/src/client/i18n.ts 这种几千行文件。

它让所有这些东西：

entry/*
review/*
record/*
batch/*
items/*
roster/*
全部：

import { assessmentMessages as m } from '../i18n.ts'
这是很典型的 anti-code-splitting 结构。

最终应该变成：

entry/MyEntriesPage.tsx
entry/AppealDialog.tsx
review/ReviewInboxPage.tsx
...
消息直接和使用代码共置。

如果三四个组件确实共享一组语义消息，再有：

entry/messages.ts
而不是：

整个 assessment 一个 messages.ts
目标语言则放 PO。

例如：

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
其中：

zh-CN.ts
彻底删除。

PO 应该怎么分，我不建议“一整个 Qualy 一个 messages.po”
这里还必须服从 Qualy 的插件架构。

你当前最重要的纪律之一就是：

composition root 不能枚举可选业务插件。

所以不能在根目录写一个巨大的：

catalogs: [
  assessment,
  auth,
  formula,
  org,
  ...
]

那等于又造了一张插件清单。

我认为正确模型应该是：

每个 plugin 自己拥有 localization source

assembly/build collector
    ↓
发现 active plugins
    ↓
发现它们的 catalog
    ↓
生成当前 Qualy build 的 runtime catalog loaders
也就是继续利用现在：

Ui.i18n('./client/i18n')

这一条插件发现机制，只是其职责会变化。

它不再导出：

messages
errorMessages
locales: {
  zh-CN: () => import('./locales/zh-CN.ts')
}

而是声明：

这个 plugin 有哪些 compiled catalog groups
这些 group 对应哪些 surface / capability
第一方 workspace plugin 在最终 Qualy build 期间由 Lingui/Vite 编译 .po。

以后 npm 第三方 plugin 则：

自己 extraction
自己维护 PO
发布 package 时携带 catalog source/manifest

Qualy assembly
→ 编译它的 catalog
这样 host 永远不需要知道：

@qualy/plugin-assessment
@foo/plugin-bar
具体是谁。

这和 Qualy 现有 open-world architecture 是一致的。

我还会进一步引入 Catalog Group，但不是一上来几十个
当前最差的是：

所有 active plugin
→ 全量 zh-CN 54.7 KB
→ App 才启动
最终 I18nProvider 不应该再：

Promise.all(allPluginCatalogs)

它应该支持增量：

ensureCatalog(group)
Lingui 的：

i18n.load(locale, messages)
本来就允许继续 merge message。

所以最终 runtime 应该是：

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
对于 Assessment，可以自然形成：

assessment-shell
assessment-entry
assessment-review
assessment-admin
assessment-record
Auth 可能是：

auth-public
auth-account
auth-admin
小插件完全没必要拆，一个 group 即可。

不要按组件拆。

不要按每个 route 拆。

catalog group 应该对应稳定的 lazy feature boundary。

这样未来 MyEntries 页面可能只付：

shell 8 KB
+
entry 8 KB
而不是全系统 55 KB。

并且你刚做的：

当前 page 和 layout 提前 preload

正好可以升级成：

page + layout + locale group 一起 preload。

bootstrapMessages 也不应该继续成为第二套人工翻译体系
这是前面我们没提到，但如果要“完整 Lingui”，我会顺手解决。

现在：

bootstrapMessages = {
  'zh-CN': {...},
  'en-US': {...}
}

存在的理由完全正确：

Lingui catalog 都还没加载时，Loading / ReleaseRecovery / fatal boot error 已经要显示文字。

但是翻译源不需要手写两遍。

可以：

bootstrap source messages
        ↓
Lingui extract
        ↓
PO
        ↓ build
抽取 bootstrap/* 那十几条
        ↓
内联到 index boot script
最终 HTML 中仍然可能存在：

{
  "zh-CN": {...},
  "en-US": {...}
}

但它是构建产物。

翻译源仍然只有 PO。

这很重要：

Qualy 最终应该只有一个 translation source of truth。

错误体系也应该一起改
现在：

errorMessages = {
  ...所有插件
}

启动时全量静态聚合。

未来：

common transport errors
→ shell

assessment entry errors
→ assessment-entry

review errors
→ assessment-review

formula errors
→ formula
ErrorCode 本身仍然是 API contract。

它映射成什么人类语言，则属于对应 feature localization。

也就是说：

API error code
= protocol

error message
= localization
不要把整个错误文案表变成全局启动依赖。

切换语言我不建议 reload
你之前提出：

每个语言一套 build，切语言 reload。

如果最终采用 Lingui，就没必要承受这个 UX 代价。

Qualy 有大量：

未保存表单
审核意见草稿
公式编辑
申报内容
语言切换刷新页面会引入脏状态问题。

更好的模型是 runtime 记录：

currently loaded catalog groups
用户从中文切英文时：

先并行下载当前已加载 groups 的 en-US catalog
        ↓
全部成功
        ↓
一次 i18n.activate('en-US')
        ↓
整个 React tree 同帧切换
不会出现：

中文 → 一半英文 → 全英文
也不会丢表单。

这比完整 locale variant 更适合 Qualy。

catalog 加载失败也不要再 activate({})
当前：

loadCatalogs(locale)
  .catch(() => activate({}))

之所以还能显示，是因为所有 production JS 永久携带 defaultMessage。

迁到完整 Lingui 后这条路应该消失。

首次启动可以：

zh-CN shell catalog failed
        ↓
load en-US source catalog
        ↓
成功
→ 整个 app 使用 en-US

en-US 也失败
        ↓
bootstrap recovery screen
而某个后续 feature catalog 失败时：

retry
↓
仍失败
↓
保持当前页面 boundary 不进入
显示 shell 中已有的“页面资源加载失败”
甚至提供：

使用 English 继续

然后原子切换整个 active application 到 source locale。

不要让：

一个 dialog 英文
导航中文
表格中文
按钮 raw id
这种半失效状态出现。

MessageFormat 2 要不要现在直接上？
这是另一个“先进”问题。

Unicode MessageFormat 2 现在已经是 stable standard，CLDR 47 已宣布 MF2 stable，Unicode 目前把它作为下一代标准，并正在进入 ICU / ECMA-402 生态。

从长期方向看，MF2 确实是未来。

但 Lingui 6.6 当前仍然建立在 ICU MessageFormat 1 上。我没有找到其已经正式提供 MF2 production pipeline 的证据。

Paraglide/inlang 虽然数据模型“heavily inspired by MF2”，自己的 message format 也称为受 MF2 启发，但这不是等价于直接使用 Unicode MF2。

因此我不会为了追 MF2 今天自己换 runtime。

我会通过架构来给 MF2 留路：

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
以后 Lingui/另一个成熟 compiler 正式支持 MF2 时，主要替换的是：

catalog/compiler layer
而不是：

整个 Qualy plugin contract
这才叫真正的 future-proof。

最终我会把 ADR 定成下面十条
Runtime/framework：Lingui 6+。 使用 @lingui/core + @lingui/react，不再自行实现半套 Lingui runtime。
Build：完整 Lingui pipeline。 @lingui/cli + @lingui/vite-plugin；Qualy 当前 Vite 8/Rolldown 正好已有官方集成方式。
Catalog source：PO。 .po 是唯一正式翻译源，compiled JS 不进 Git。
Source locale：en-US；默认产品 locale：zh-CN。 两个概念严格分开。
普通客户端文案使用 Lingui macro + generated ID。 t、Trans、msg，消息和使用处共置；删除巨型 assessmentMessages/authMessages。
只有跨 wire/plugin boundary 的文案拥有 Qualy explicit namespaced ID。 UiText 和 literal() 模型继续保留。
插件自己拥有 catalog；root 不枚举插件。 Qualy build collector 根据 assembly 自动发现、检查并生成 catalog loader。
Catalog 按稳定 feature boundary 增量加载。 shell → 当前 page/layout feature；不再启动时下载全部 active plugins。
切换 locale 原子完成，不 reload。 先加载当前 active groups 的新语言，再 activate。
MF2 作为明确的未来迁移目标，但今天不自行实现。 业务代码尽量只使用宏/Intl，不扩散 ICU1 语法。
这是我现在认为对 Qualy 最合适的终局。

Paraglide 的很多思想——compiler first、tree shaking、messages 靠近使用处——我反而建议吸收；但不需要因此采用 Paraglide runtime。对 Qualy 来说，“完整 Lingui + Qualy 的动态协议适配 + feature catalog loading”能保留 Paraglide 最有价值的性能思想，同时避免它与 server-driven UiText、插件系统和 PO 工作流之间的结构冲突。

---

以上是针对Qualy的i18n应该怎么优化的讨论。你可以考虑一下本项目应该怎么做最合适，它上面的讨论你可以选择性接受或不接受，项目也可以大改，不需要非要兼容当前写法或模式。考虑用Lingui还是Paraglide最合适。
Comparing Lingui and Paraglide for i18n architecture.
Comparing Lingui and Paraglide for i18n architecture.
我先看一下 Qualy 当前 i18n 相关代码的实际形态，再核对 Lingui 和 Paraglide 的最新状况，然后给出判断。

Read 4 pages, searched the web, ran a command on your computer
我的结论和前面几轮讨论不一样：Qualy 应该换到 Paraglide，不要升级成完整 Lingui。 前面否掉 Paraglide 的主要理由是动态 UiText，这次按源码数了一下，这个理由被高估了。

改变判断的几个数字
客户端静态 descriptor 大约 4216 条。
走 wire 的动态 message(id, default) 大约 224 条，分布在 permissions.ts、actions.ts、manifest 贡献里，约占 5%。
除了这两类，仓库里还有两套手写的双语系统：bootstrapMessages，以及 auth/server/mail-copy.ts。后者是服务端邮件文案，用 Record<'zh-CN' | 'en', ...> 硬写。
defineMessage<Values>() 靠 phantom type 声明 ICU 参数，再用测试证明字符串和类型一致。这相当于在手工维护一个编译器本该生成的东西。
也就是说，95% 的文案是静态引用，恰好是编译型 i18n 最擅长的场景。动态查询只占 5%，而且范围有界，完全可以单独处理，犯不上为它决定整个框架。

为什么 Paraglide 更适合 Qualy
1. 翻译和用到它的代码在同一个 chunk 里，语言包这个概念就没了。
Paraglide 把每条消息编译成函数，打包器按 import 图决定它进哪个 chunk。于是前面讨论的难题都自然消失了：

shell 和 feature 各分哪几组 catalog，不用人工设计，打包器自己算。
不再有“所有 catalog 到齐才 activate”这道异步门槛，也没有加载瀑布，不用把 locale 和 page 一起 preload。
不再有“语言包加载失败”这种故障。 翻译和代码原子地一起到，chunk 真失败了，由现有的 asset recovery 接管。
你之前关心的 defaultMessage 语义问题也就不存在了。缺译回退变成编译期行为：某个 locale 缺了翻译，就按 baseLocale 回退，运行时没有任何成本。CI 用 lint 挡住缺译。defaultMessage 原本的职责是“加载失败时别显示空白”，而这个失败路径本身不存在了。

2. 两种语言正好是它的舒适区。
每个用到的消息会同时带上中英文两份。和“按组拆、只加载当前语言的 catalog”相比，字节数差不多，但拆分是精确到消息的，不靠人工分组。以后如果真想要你当初设想的“每种语言一套构建”，Paraglide 已经有 experimentalStaticLocale，那会是一个编译开关，不需要重做架构。

3. 三套系统合成一套。
Paraglide 的消息函数在 Node 里同样能用，写法是 m.x(inputs, { locale })。这样 mail-copy、bootstrapMessages（连同维护页）、客户端文案可以共用同一份源。bootstrap 只 import 那十几个函数，靠 tree-shaking 进入 boot script。

4. 参数类型由消息源自动生成。
defineMessage<Values> 和配套的一致性测试都可以删掉，比现在更严格。

动态 UiText 怎么处理
wire 协议保持不变，还是 { kind, id, defaultMessage }。原因有两个：插件版本错位时它需要自描述，服务端的 plainText 也要用它。

在构建期，Qualy 的 collector 本来就能枚举所有插件贡献的 message，那就顺手生成一张 wire 索引：

ts
// 生成物，进 shell chunk
export const wire = {
  'assessment/navigation/batches': m.assessment_navigation_batches,
  ...
}
这张表只有两百多条，两种语言加起来也就几 KB。它不是第二套 i18n，而是协议表：函数还是同一批，只是给动态子集建了个索引。服务端声明时写 message(m.xxx)，由 helper 生成 { id, defaultMessage: baseLocale 渲染结果 }，这样 id 和默认文案不会再手写两遍。

插件体系怎么接
要避免每个插件各自编译出一份 runtime、各自持有 locale 状态。我建议这样做：

插件把消息当数据发布：messages/zh-CN.json、messages/en-US.json，放在插件自己的 namespace 下。
assembly 构建时统一编译成一个生成包，只有一个 runtime、一个 locale 状态。插件代码从类似 @qualy/messages/assessment 的路径 import，由 assembly 解析。
dist-only 的第三方插件同样只带消息数据加代码，宿主替它编译。
这和 Qualy 现在“assembly 发现插件并生成 virtual module”的纪律是一致的，composition root 依然不需要枚举插件。

错误翻译也要跟着改。现在 errorMessages 在启动时全局聚合，改成跟随调用它的 feature 模块。通用的 transport 和认证错误留在 shell。

需要正视的代价
ICU 迁移：4216 条里有大量嵌套的 select 加 plural。inlang 有 ICU MessageFormat v1 插件，支持 plural、select、selectordinal、offset 和 #，但文档没有明确说支持嵌套。我建议直接迁到 inlang 原生格式，也就是 variants 和 matchers，它的设计参照了 MF2，长期看更贴近标准。迁移时做差分测试：同一组参数下，旧 Lingui 输出和新函数输出必须逐条一致。
富文本：Paraglide 2 已经有 message.parts()，但没有官方的 React 渲染器，需要自己写一个很薄的 <Msg> 组件。
切换语言：消息函数在调用时读 getLocale()，不会主动订阅变化。我建议直接 reload，走现有的 leave guard，这样最正确：Intl 格式器缓存、memo 组件都不会漏更新。这也和将来的 static locale 构建一致。
PO：换到 Paraglide 就不用 PO 了。PO 的价值在 TMS 和专业译员流程上，Qualy 目前两者都没有。而且 Lingui 自己在“显式语义 ID 写进 PO”这件事上也还有未解决的 issue。真需要的话，有第三方的 PO 格式插件。
成熟度：Paraglide 1.x 到 2.x 是一次大迁移，API 有变动的历史。好在消息源是纯数据，编译产物是普通 JS，锁定版本就能控制风险。
Lingui 在什么情况下仍然更好
语言数上到 10 种以上、有专业译员和 TMS、需要不重新构建就能在运行时覆盖文案（比如各校自定义术语），或者 JSX 富文本非常重。另外，Lingui 6 的发布说明里既没有 MF2 支持，也没有 lazy catalog 相关的新能力，所以“完整 Lingui”最后还是得自己设计 catalog 分组和加载生命周期，这是运行时基础设施，很难写对。Paraglide 需要补的是 assembly 编译、wire 索引和 parts 渲染器，都是构建期、确定性的东西，更容易验证。

建议的 PoC 和止损线
拿 layout-default、auth 加上 assessment/entry 这一小片，用 Paraglide 跑通 assembly 编译、wire 索引、<Msg> 和 reload 切换。
写一个 ICU 转换脚本，对这一片做差分测试，验证嵌套 select/plural 能被完整转换。
在登录页和“我的申报”页对比 boot graph 的 Brotli 字节数和冷启动 LCP 中位数。
止损条件：如果嵌套 ICU 无法无损转换，或者 parts 渲染撑不住现有的富文本用法，就回退到完整 Lingui 加 shell/feature catalog 的方案。
如果要把这份结论整理成一份 ADR 给 Claude Code 执行，我可以直接写成文档。

Sources:

Announcing Lingui 6.0
Lingui Vite Plugin
Paraglide JS Compiler Options
Paraglide JS CHANGELOG
inlang ICU MessageFormat v1 Plugin
@globalize-now/paraglidejs-po-format
Resolving conflicting reports about the issue's status.
Resolving conflicting reports about the issue's status.
对方这次引用了几条新事实，其中一条和我上一轮查到的正好相反（issue #538 的状态）。我先核实这几条。

Read 3 pages, searched the web, ran a command on your computer
这次的结论我同意：ICU1 JSON，排序是 ICU1 > inlang 原生格式 > PO，MF2 作为未来观察项。 对方的几条新事实我都核实过了，一条是我上一轮说错了，另一条比它自己说的还更有利。但它对“类型安全已经解决”的判断有一个关键漏洞。

一、先认错：#538 的问题已经解决了
Paraglide 的 CHANGELOG 确认，2.10.0 版本加入了 match variant 的字面量联合类型：传入一个不存在的分支值会直接报类型错误。2.15.3 又修了数字输入的推断。上一轮我拿到的是 issue 页面的旧讨论，把它说成“不在计划内”，这是错的。

二、比对方说的更有利的一点：解析器完全一致
@inlang/plugin-icu1 1.1.0 唯一的运行时依赖是 @messageformat/parser ^5.1.1，这一点对方说对了。我又查了 Qualy 自己的 lockfile：现在用的 @lingui/message-utils@6.6.0 依赖的也是 @messageformat/parser@5.1.1。

也就是说，Qualy 现有的 4216 条消息，本来就是用同一个解析器的同一个版本在解析。转义规则、撇号的处理、嵌套写法这些最容易在换解析器时出问题的地方，迁移前后是同一套语法定义。这是选 ICU1 最硬的一条理由，比“可移植”“紧凑”都更实在。

所以我撤回上一轮“用 @formatjs/icu-messageformat-parser 做类型检查”的建议。Qualy 自己做的类型检查，要么直接读 inlang 导入后的规范化模型，要么用同一个 @messageformat/parser。

三、对方判断的漏洞：2.10 的联合类型，很可能对 ICU1 来源的消息不起作用
ICU1 的语法规定，select 和 plural 必须带 other 分支。 我统计了一下，Qualy 现在有 38 处 select，每一处都带 other。

other 导入到 inlang 模型后，就是一个“兜底”分支，意思是任何值都接受。在这种情况下，Paraglide 没法生成严格的联合类型。CHANGELOG 里那个会报错的例子（auth_password_error({ type: 'typo' })），前提是这条消息没有兜底分支。而这恰恰是 inlang 原生格式能写、ICU1 写不出来的。

这一点是我根据语法推断的，还没有实测。PoC 里拿一条 Qualy 的 select 消息编译一次，看生成的 .d.ts 就能确认。

即使推断成立，它也不会改变格式的选择。原因是：

select 的严格性本来就不该来自消息文本。 Qualy 的 other 大多是真正的兜底，比如 accessInvalid 里的“其他原因”那一支。合法值的约束应该来自调用处的领域类型，也就是先用枚举类型约束，再经过 selectKey 转换后传进来。
Qualy 自己的类型检查只需要补三件事： 参数有没有传齐、plural 和 number 格式化的参数必须是 number、date 格式化的参数必须是 Qualy 约定的日期类型。这和对方最后的结论一致：做构建期的检查，不要生成一整套替代 Paraglide 的 .d.ts。
四、其他几条
ICU1 插件本身还很年轻（1.1.0）。 对方说官方仓库里有深度嵌套的往返测试，我这边访问不了 GitHub API，没能核实。不过解析器和 Qualy 现在用的完全一致，风险已经下降了很多。逐消息的差分测试还是要作为迁移的硬性关卡：新旧两套在同一组样例参数下，两种语言都要逐条比对。
缺译即构建失败，不靠 baseLocale 静默回退。 双方已经一致。
排在第二、第三的 inlang 原生格式和 PO，谁先谁后没有实际意义，因为都不会用。真正需要写进 ADR 的只有：选 ICU1；什么情况下重新评估（Paraglide 或 inlang 有了官方稳定的 MF2 存储插件）；以及重新评估时直接从 ICU1 迁到 MF2，不经过 inlang 原生格式这个中间步骤。
Sources:

Paraglide JS CHANGELOG
@inlang/plugin-icu1 package.json (unpkg)
inlang ICU MessageFormat v1 plugin
可以最终定下来了。我认为现在剩下的已经不是“格式选择”，而是实现细节和 PoC 验收。

四种格式里，Qualy 应正式采用 **ICU MessageFormat 1 JSON**，不是过渡方案。未来只有在 Paraglide/inlang 出现成熟的一等 MF2 storage pipeline 时，再直接评估 ICU1 → MF2；不经过 inlang native，也不引入 PO。

不过你贴的这版里还有一个地方我会在写 ADR 前修正，否则会悄悄丢掉 Qualy 现在已有的一部分类型安全。

Paraglide 2.10 确实已经支持 literal match 的联合类型，但它当前编译器源码里有一个很明确的规则：

if (info.hasCatchAll) return "NonNullable<unknown>"
而 ICU select 的 other 导入后正属于 catch-all 语义。所以你的推断是对的：**对于带 other 的 ICU select，不能指望 Paraglide 给出闭合的 literal union。** 另外 2.15.3 修的是“数值 literal match 的类型推导”，例如 input=1 同时接受数字和对应字符串形式，并不等于 plural / number formatter 的输入从此自动变成 number。Paraglide 内部对于一般 input 仍然存在 NonNullable<unknown>。

因此我不同意报告中的这一小句：

“做构建期检查，不要生成一整套替代 Paraglide 的 .d.ts。”

前半句对，后半句需要改成：

**不要重写 Paraglide 的生成类型体系，但 Qualy 自己的 @qualy/messages/<namespace> ABI 应该生成一层更窄的 typed facade。**

因为“构建时检查 ICU 文件”只能证明：

count 在消息里被 plural 使用
它不能阻止业务代码写：

m.itemsSelected({ count: "abc" })
如果底层 Paraglide 参数还是 unknown，tsc 不会替你挡住。

而 Qualy 现在 defineMessage<{ count: number }> 是能挡住的。迁 Paraglide 后不应该倒退。

最合适的做法恰好利用我们已经决定要有的：

@qualy/messages/assessment
@qualy/messages/auth
这层 ABI。

assembly 根据 ICU source / inlang normalized model 自动生成：

export const itemsSelected:
  (
    inputs: { count: number },
    options?: MessageOptions
  ) => LocalizedString
  = paraglide.items_selected
编译后的 JS 基本就是：

export const itemsSelected = paraglide.items_selected
没有新的 formatter，没有 runtime wrapper，没有第二套 i18n。

它只是把 Paraglide过宽的：

{ count: NonNullable<unknown> }
在 Qualy 公共 API 上收窄成：

{ count: number }
因此：

ICU source
   │
   ├── inlang → Paraglide runtime implementation
   │
   └── Qualy contract inference → typed facade
两者共享一个消息事实来源。

### 类型规则我会定得很克制

不要试图从自然语言消息推导业务领域类型，只推导 ICU 本身真正表达出来的约束：

plural / selectordinal operand → number
number formatter → number
date / time → Qualy 统一规定的 DateInput，具体是 Date、timestamp 还是 ISO value 另行冻结
普通 interpolation → 不凭空猜成某个领域类型
select → 不因为出现几个 branch 就假装这是领域 enum；有 other 时它语义上本来就是开放集合
例如：

{status, select,
  pending {...}
  approved {...}
  other {...}
}
translation 的真正 contract 是：

status 是可选择的值，并且未知值有合法 fallback。

它并没有声明：

status: "pending" | "approved"
所以不要让 i18n 文件反过来定义领域模型。

如果业务实际有：

type Status =
  | 'pending-review'
  | 'approved'
  | ...
那么应该由领域类型保证：

m.status({
  status: selectKey(status),
})
而不是靠翻译字符串里的 branch 恰好列出了几个值来定义业务合法集合。

这比你现在的 defineMessage<{ status: ... }> 从长期架构上反而更合理：**领域类型归领域，消息格式类型归消息 compiler。**

---

### ICU1 现在还有一个非常强的事实支持

你查到迁移前后的 parser 实际都是：

@messageformat/parser 5.1.1
这一点非常关键。

意味着这次不是：

Lingui ICU dialect
→ 另一套 ICU parser
→ 希望行为一样
而更接近：

同一套 ICU grammar/parser
→ 不同的 compilation backend
迁移风险因此低很多。

另外我也核到了 inlang 当前仓库已经有：

roundtrip: deeply nested select + plural + selectordinal

这样的正式测试。

所以 complex nested ICU 已经不是纯靠文档猜测的能力。迁移仍然必须做差分测试，但原因应该是**验证 Qualy 自己的 4000+ 条真实数据**，而不是因为 ICU plugin 没有嵌套能力证据。

---

## 最终 ADR 我会把消息格式部分写成这样

**Canonical localization source**

<plugin>/
  messages/
    en-US.json
    zh-CN.json
使用 ICU MessageFormat 1。

**Build pipeline**

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
我会优先从 **inlang normalized model** 推导 Qualy facade 类型，而不是重新解析原始 ICU。因为这样：

Qualy看到的 message contract = Paraglide真正拿去编译的 message contract。

如果 normalized model 缺少某些推导需要的信息，再退回到同版本 @messageformat/parser；不要引入 FormatJS 的第二 parser。

然后设置几个不可妥协的 build gate：

所有 supported locale 必须具有相同 message key，缺译直接失败，禁止靠 baseLocale 静默补。
同一 message 在所有 locale 中必须具有兼容的 input names 和 formatter contract。
ICU parse / inlang import 必须成功。
plural、number、date/time 等参数生成严格 facade 类型。
插件只能 import 自己 namespace 的消息；真正 platform-common 的消息另有显式 contract。
第一轮迁移对全部现有消息做旧 Lingui ↔ 新 Paraglide 差分测试。
最后一条迁移完成后不需要永久每次 CI 都跑两套 renderer，因为届时 Lingui 应彻底删除。保留一份 migration fixture/golden 即可。

---

## 四个方案就不用再讨论了

现在的决策树已经足够清楚：

**ICU1 JSON**：采用。满足 Qualy 已有复杂消息，源文件紧凑，和当前 grammar parser 一致，独立于 Paraglide，可直接进入未来 MF2 迁移路径。

**inlang native**：不采用。除非未来 Qualy 大量使用只有它才能良好表达的能力，而 ICU1 明显成为限制；当前没有这种需求。

**PO**：不采用。以后如果专业翻译/TMS 成为主要工作流，可以重新考虑“翻译交换格式”，但甚至到那时 PO 也未必需要成为代码仓库的 canonical source。

**MF2**：现在不采用。等 inlang/Paraglide 给出稳定的一等存储、编译和 round-trip 支持后，直接从 ICU1 重新评估。

另外，考虑 @inlang/plugin-icu1 目前还比较年轻，我会把它和 Paraglide都**精确 pin 版本**，升级作为单独改动完成，并跑 ICU round-trip + Qualy message contract + representative rendering tests，而不是让 semver 范围静默改变整个消息编译器。

所以，可以结束“到底用哪种格式”的讨论了。现在真正还需要 PoC 验证的只剩两类实现问题：**Paraglide message-modules 在 Qualy 的 Rolldown chunk graph 上是否健康，以及 Text/term/document-context 那套 server projection 如何落成而不破坏插件隔离。** 这两项即使失败，也不会改变 ICU1 作为 canonical message source 的选择。

---

到这步了，你觉得我们还有什么可以讨论的吗，还是我可以把上面的内容总结下发给Claude Code来编码实现了？你帮我总结下我们上面的所有讨论？

梳理待用户决策的遗留事项。
有两件事需要你先拍板，除此之外已经可以交给 Claude Code 了。我先看一下仓库里文档的放法，把总结写成一份 Claude Code 能直接读的交接文档。

Used Computer, ran a command on your computer
可以交给 Claude Code 了。我把整轮讨论整理成了一份 ADR，放在你仓库的 docs/adr/0011-i18n-paraglide.md，格式沿用现有 0010 那份。文件已经在你电脑上，没有提交。

对方最后提出的 typed facade，我同意，已经写进第 5 条。 只在构建期检查 ICU 文件，挡不住业务代码写出 m.itemsSelected({ count: 'abc' })。所以这一层类型必须生成出来，否则会比现在的 defineMessage<Values> 更弱。

ADR 的内容：

背景：现状问题，包括你测过的 54.7 KB、82.8 → 43.7 KB 的 PoC、中英合计是单语 2.15 倍、184 条 wire 消息合计 3.9 KB、新旧两套使用同一个 @messageformat/parser@5.1.1，以及邮件语言的 bug。
13 条决定：Paraglide 加 ICU1 JSON、构建流水线、@qualy/messages 导入方式与 typed facade、页面语言固定不变与切换走 reload、UiText 退役改用服务端 Text、邮件语言、术语库改造、bootstrap、插件隔离、chunk 策略。
被否决的方案及理由：专门写给 Claude Code 看，避免它把讨论过的方案重新翻出来。
分阶段实施：阶段 0 与框架无关，可以直接做。阶段 1 是 PoC，有明确的验收指标；不通过就改为落地完整 Lingui。之后是全量迁移和收尾。
还剩两件事需要你拍板，都写在 ADR 末尾：

用户在新设备登录时，如果账户上已经有语言偏好，是否把它写进这台设备的 cookie？我建议写入。
日期、时间类参数统一用什么类型传入：Date、时间戳，还是 ISO 字符串？
另外有一点建议：不要让 Claude Code 一口气做完全部阶段。 阶段 1 的 PoC 结果决定了是否真的切换到 Paraglide，最好让它先汇报数据，你看过再继续。交接时可以这样说：

阅读 docs/adr/0011-i18n-paraglide.md，先完成阶段 0，然后做阶段 1 的 PoC，按文中的验收指标汇报四个页面的对比数据后停下，等我决定是否进入阶段 2。
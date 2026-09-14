# aegis-web-sdk 实查记录(RUM Phase 0)

日期:2026-09-14。对应 docs/rum.md 的 Phase 0。

**版本:`aegis-web-sdk@1.41.15`**(npm `latest`,与 docs/rum.md §4 记的候选版本一致)。

本文只记录**实际验证过**的事实,依据顺序按 docs/rum.md §38:先 pin 版本的包内类型定义与
产物源码,再腾讯云文档,再实测。凡本文没记的,就是 Phase 0 没验证过,不得当作已知。

## 怎么验的

PoC 不进仓库,建在会话临时目录里,构成:

- 一个最小 Vite 8.2.0 + React 19.2.8 应用(与仓库 catalog 同版本),`build.sourcemap: 'hidden'`,
  其中复刻了 `PluginComponentBoundary` 的 catch → 上报路径,Aegis 经 `await import()` 懒加载;
- 一个本地 HTTP 靶场:一端按 `packages/plugins/infra/web/src/server/shell-policy.ts` 的固定
  指令逐字发同一份 CSP(enforce,不是 report-only),另一端假扮上报域名,记录每一条 outbound
  请求的 URL、header 与 body(gzip 会解开);
- Playwright 1.62.1 驱动 Chromium 与 WebKit,页面里挂 `securitypolicyviolation` 监听。

导航地址带两枚哨兵:`?student=QUALY_PRIVATE_SENTINEL_QUERY&batchId=0199f03e-1111-7abc-8def-000000000001`,
`document.referrer` 另带一枚。验收标准是这些串在 outbound 数据里出现 0 次。

## 包本身

- `main` 是 `lib/aegis.min`(UMD),**没有 ESM 产物、没有 `exports` 字段、没有 `module` 字段**;
  `types` 指向 `lib/packages/web-sdk/src/index.d.ts`,类型齐全。
- **没有任何 install script**,不触发 pnpm 的 ignored builds 审批。
- 唯一运行时依赖 `web-vitals@^4.2.4`(会被打进 chunk)。license MIT。
- Vite 8 打出来 Aegis 独占一个 lazy chunk:**128.19 kB,gzip 41.42 kB**。懒加载是成立的,
  provider 不激活时这个 chunk 不会被请求。
- `Config` 接口末尾是 `[key: string]: any`,**拼错的配置键 TypeScript 不会报**。这条决定了
  Phase 1 的 provider 必须自己收口配置对象,不能指望类型守。

## 与 docs/rum.md 不一致的地方(以本文为准)

| docs/rum.md 的说法                              | 实查结果                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `repeat` 默认 5                                 | 默认 **60**                                                                    |
| `hostUrl` 需显式配国内域名                      | 默认已经是 `https://rumt-zh.com`                                               |
| `beforeRequest` 是上报前的最后一道,可改可拦     | `beforeRequest` 收到的是 `{logs, logType}`,**改不到 URL**;真正的 wire 级钩子叫 `onBeforeRequest`(见下) |
| §39 建议配置                                    | 少了 `gzip`,而 gzip 默认开且默认起 Worker,直接撞 CSP(见下)                  |

实测到的默认值(从产物里 `this.config = {...}` 读出):`delay: 1000`、`onError: true`、
`repeat: 60`、`random: 1`、`aid: true`、`device: true`、`pagePerformance: true`、
`webVitals: true`、`speedSample: true`、`onClose: true`、`reportLoadPackageSpeed: true`、
`hostUrl: 'https://rumt-zh.com'`、`env: 'production'`、`reportImmediately: true`、`gzip: true`。
其中 `onClose` 与 `reportLoadPackageSpeed` 文档没提。

## 四个钩子的真实契约(读产物源码 + 实测确认)

### `beforeReport(log)`

调用点做的事:先把 ext1/ext2/ext3 截到 1024 字符、ext4..ext10 转成字符串,然后
`logs.filter(log => beforeReport(log) !== false)`。

- 返回 `false` 丢弃该条,返回其他值保留;
- **传进来的是原对象,就地改动会落到线上**(已实测:改写 `log.originFrom` 后,POST body 里是改后的值);
- 整段外面包着 `try {} catch {}`,钩子抛异常 → 这一批日志整体不发。对隐私是 fail-closed,
  对可观测性是静默丢日志,所以 Phase 1 的钩子里不允许出现可能抛的代码。

### `beforeReportSpeed(log)`

`logs.filter(log => beforeReportSpeed(log) !== false)`,没有就近 try/catch。
`SpeedLog` 带 `url / method / type / status / isErr / duration / payload / from` 等结构化字段,
**不需要解析字符串**就能判断 4xx/5xx。`payload` 在钩子跑完后被 `delete`,与文档一致:可用于本地判断,不会上报。

### `beforeRequest({logs, logType})`

**逐条调用**,不是每次请求调用一次。语义(逐字读自产物):

- 返回 `false` → 丢弃该条;一批全被丢弃则整个请求不发;
- 返回 `{logs, logType}` 且 `logType` 与传入相同 → 用返回的 `logs` 替换;
- 返回其他值 → 保留原值;
- **抛异常被就近 catch,保留原值**。

实测到的 `logType` 取值:`whiteList`、`log`、`pv`、`performance`。

### `onBeforeRequest(options, aegis)`

文档没写、类型里也只有 `[key: string]: any` 兜着,但产物里确实读它,而且**它才是 wire 级钩子**:
拿到的是 `SendOption`(`url`、`data`、`method`、`sendBeacon`),

- 返回 falsy → 整个请求不发(控制台 `Sending request blocked`);
- 可以就地改写 `options.url`。

这是唯一能改到**请求 URL**的地方。docs/rum.md §17 描述的能力属于它,不属于 `beforeRequest`。

## CSP

仓库固定策略的相关三行:`script-src 'self' '<inline boot hash>'`、`connect-src 'self'`、
`worker-src 'self'`。

### 不需要放宽 script-src

用仓库 `tools/quality/check-csp-build.ts` 的同一条谓词(三种拼法、排除方法定义与空程序探针)
扫 Vite 打出来的 aegis chunk:**PASS,没有从字符串造代码**。§37 的拒绝条件不触发。

### 上报只走 connect-src

传输只有两条路:`navigator.sendBeacon` 与 `XMLHttpRequest`,两者都归 `connect-src` 管。
产物里那处 `new Image` 属于截屏模块的资源预载(blankScreen 关掉后不会跑),不是上报信标。

反证也做了:不把上报域名加进 `connect-src` 时,**0 条数据发出**,浏览器报 8 条
`connect-src` violation(另有 1 条 `worker-src` 来自本次的独立探针,不是 SDK 发的)。
所以 provider 不激活、CSP 不加 endpoint 时,腾讯一个字节都收不到。

实测 provider 激活后会连的路径,比文档多:除 `POST /collect` 外还有
`GET /collect/whitelist`、`GET /rateConfig`(2 次)、`GET /collect/pv`、`GET /speed/performance`、
`POST /speed/webvitals`。**一次页面加载 8 到 9 个请求**,全部同一 host,`connect-src` 一条就够。

### gzip 的 Worker 会撞 worker-src(必须关)

`gzip` 默认 `{enable: true, threshold: 1024, useWorker: true, workerThreshold: 4096}`。
超过 4096 字节的 POST 会走 Worker 压缩,而 Worker 是
`new Worker(URL.createObjectURL(blob))` 造的 —— blob URL 在 `worker-src 'self'` 下不被允许。

单独探过这一步:`new Worker(blobURL)` **构造函数不抛**(失败是异步的,SDK 靠 `worker.onerror`
兜底),但浏览器照样报一条 `worker-src <- blob` 的 violation,Chromium 与 WebKit 都报。
也就是说 SDK 的 try/catch 兜得住功能,兜不住 `check-csp-enforce` 的 0 violation 断言。

**结论:Phase 1 必须显式写 `gzip: { useWorker: false }`。** 不要为此往 `worker-src` 加 `blob:` ——
那会为一个压缩优化放宽整个壳的策略,与 DoD「CSP 只增加 https://rumt-zh.com」直接冲突。
关掉 Worker 后,同样的用例 **0 条 CSP violation**。

(本地靶场上 gzip 始终没有真正触发,`isGzipReportEnabled` 还要看 whitelist 接口下发的
`use_gzip`,假服务器给不出真实响应。所以「Worker 一定会被走到」这件事没有正面实测,
只证明了「一旦走到就会 violation」。按最坏情况关掉即可,不必再查。)

## 隐私:默认配置直接违反仓库禁令,必须三层一起上

**默认配置下哨兵出现 17 次和 8 次。** 三个泄漏源:

1. **`originFrom` 挂在每一条日志上**,值是原始 `location.href`,query 与 UUID 原样带走。
   全局 `urlHandler` 只管 `from`,**管不到 `originFrom`**。
2. **`referer` bean**:构造时读 `document.referrer` 写进 bean,之后**每一个请求的 URL 都带它**。
   配置里没有开关。
3. **PV 请求**:`GET /collect/pv?originFrom=<raw location.href>`,PV 的 URL 由 `getOriginFrom()`
   直接拼,不经过任何日志级钩子。

三层修完之后哨兵 **0 次**,Chromium 与 WebKit 一致:

```ts
beforeReport(log)        // 就地改写 log.originFrom,并把 msg 里的 query 去掉
beforeRequest(entry)     // entry.logType === 'pv' 时返回 false
aegis.extendBean('referer', '')   // 构造完立刻覆盖
```

只做 wire 级 `onBeforeRequest` 改 URL **不够**:日志体里的 `originFrom` 还在,实测仍有 7 次命中。
所以 docs/rum.md §17 的分层防线是对的,但**决定性的一层是 `beforeReport`**,不是最后那层。

其他隐私面实测:

- `aid: false` 下每个请求的 `aid=` 为空;**没有写 localStorage、没有写 cookie**,
  只有 `sessionStorage.__MONITOR_SESSION_V1__` 一个会话级随机 id。
- `uin` 会被 SDK 自己从 `document.cookie` 里刮:`/\buin=\D+(\d*)/` 与 `/\bilive_uin=\D*(\d+)/`。
  Qualy 的会话 cookie 叫 `qualy_session` / `__Host-qualy_session` 且是 httpOnly,两条正则都不匹配、
  JS 也读不到,实测 `uin=` 全程为空。这是个**结构性安全,不是配置出来的安全**:
  以后新增任何 JS 可读且名字以 `uin` 结尾(前面是非单词字符)的 cookie 都会破坏它,Phase 1 应有断言守。
- 资源加载失败的 msg 形如 `script load fail: <完整 URL>`,Qualy 的产物是哈希名没问题,但带 query 的
  URL 会原样带走。
- SDK 会把 payload 里的字面量 `eval` 替换成 `evaI`,错误信息里含这个词时线上看到的是改过的。

## 错误覆盖面(实测 7 类全中)

一次页面加载里,`beforeReport` 收到的 `level`:

| level | 事件                       | 用例                             |
| ----- | -------------------------- | -------------------------------- |
| 4     | ERROR                      | 未捕获同步异常                   |
| 8     | PROMISE_ERROR              | 未处理 rejection(另带 `errorMsg`)|
| 32    | SCRIPT_ERROR               | `<script>` 404                   |
| 128   | CSS_ERROR                  | `<link rel=stylesheet>` 404      |
| 64    | IMAGE_ERROR                | `<img>` 404                      |
| 4     | ERROR(主动上报)           | ErrorBoundary catch 后 `aegis.error({msg, ext1..3})` |
| 4     | ERROR                      | 超长 message                     |

`IMAGE_ERROR` 默认是会上报的,docs/rum.md §13 想要的「默认过滤」得自己在 `beforeReport` 里做。

## Ajax 错误:`reportApiSpeed: false` 时压根不产生

这是 docs/rum.md §14 与开放问题 3 的直接答案。用例里打了 `/api/ok`(200)、`/api/404`、
`/api/500`、连接被断开的 `/api/abort`,fetch 与 XHR 各一遍:

**`beforeReport` 一条 `AJAX_ERROR`(level 16)都没有收到。**

所以 Phase 1 保持 `reportApiSpeed: false` 就不存在 typed 4xx 污染问题,不需要在第一阶段写任何
Ajax 过滤逻辑。等 Phase 3 真开 API speed 时,`beforeReportSpeed` 拿到的是结构化的
`status` / `url` / `isErr`,可以做严格 allowlist,**不需要解析字符串**——§34 的禁令不会被迫触碰。

## React 19 不会重复上报

ErrorBoundary 捕获后手动上报一次,`window.onerror` **没有**再收到同一个错误:一次页面加载里
level 4 恰好 3 条(未捕获、边界、超长),没有重复。开放问题 6 的答案是生产构建下不重复。
Phase 1 的 dedup(WeakSet + 短 TTL fingerprint)按 docs/rum.md §20 仍值得做,但它防的是
将来可能出现的路径,不是现在已经存在的重复。

## 懒加载不影响 page performance 与 Web Vitals

provider 在 `fetch(config)` 之后才 `import()` Aegis,页面性能与 Web Vitals 仍然上报成功:
`GET /speed/performance`(带 `firstScreenTiming`)与 `POST /speed/webvitals` 各一条。
开放问题 2 在 PoC 规模上是通过的。**但这只证明了「能采到」,没有证明「采得准」**:
真实应用的首屏比 PoC 长得多,延迟初始化对 LCP/FCP 的偏差要等真接上去再看。
按 docs/rum.md §23,如果届时不可靠,先上错误监控、性能指标延后。

Web Vitals 是在页面进入 hidden 时用 `sendBeacon` 发的,数据在 URL query 里,body 是
`[object Object]`(SDK 把对象直接交给 sendBeacon),不是缺陷,只是别照 body 去解析。

## SourceMap:本地链路完整,腾讯侧未验

`build.sourcemap: 'hidden'` 实测:产物 `.js` 里**没有** `sourceMappingURL` 注释,`.map` 照常生成。

拿实测抓到的压缩堆栈首帧 `assets/index-<hash>.js:9:38826`,用 Node 内置 `module.SourceMap`
还原,得到 `src/main.tsx 40:26`,而 `main.tsx:40` 正是那行 `throw new Error(...)`。
**逐行精确,包括列号。**

`.map` 里带 `sourcesContent`(完整源码)与 `node_modules` 路径,印证 docs/rum.md §50 把它当私有
调试产物的判断。`map.file` 是 basename(`index-<hash>.js`),而错误堆栈里的文件是完整 URL。

Phase 2 的腾讯侧上传与控制台还原**没有验证**,需要真实项目,见下。

## Release id 与 Aegis version

`RELEASE_ID_PATTERN` 是 `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`,字符集是腾讯文档所记
`[0-9a-zA-Z.,:_-]` 的子集,**只有长度可能超**(128 对 60)。当前实际 release id 形如
`local-20260914T123712Z-633d6de6`,31 字符,能直接原样用。

SDK 产物里**没有**对 `version` 做长度或字符校验,60 的上限是平台侧约束,超了会被截断还是拒绝,
只能对真实项目验。`rumVersionForRelease` 仍按 docs/rum.md §12 实现(≤60 原样,否则 `q-<digest>`),
浏览器与 uploader 共用同一实现。

## 打包与类型:default 比运行时多一层(Phase 1 补记)

产物是 UMD,wrapper 写的是 `module.exports = t()`,`t()` 返回的就是 Aegis 类本身,
**整包 0 个 `__esModule`**。而包里唯一那份 d.ts 写的是 `export default Aegis`。

于是类型和运行时差了一层 `default`:

```ts
// 运行时(Vite/rollup interop):module.default 就是类
// 类型:module.default 被读成整个模块命名空间,没有构造签名
const Aegis = loaded.default as unknown as (typeof import('aegis-web-sdk'))['default']
```

仓库里 `@stylexjs/unplugin` 踩过同一个坑(见 apps/web/vite.config.ts 顶部注释),处理方式一致:
就地 cast 并写清楚为什么。不要为此改 tsconfig 的 interop 选项——那会影响所有包。

`import('aegis-web-sdk')` 打出来是独立 chunk(生产构建实测 128 KB / gzip 41 KB),
入口只在动态 `import()` 里出现它的文件名,与旁边的 `cos-js-sdk-v5` 同型。

## 被拒时先读 `rum-error` 响应头(Phase 1 真机实测)

真机第一次打向 `rumt-zh.com` 时一条也没进去,而响应体只有 `403 forbidden` 五个字,
whitelist 则回 `{"retcode":0,"result":{"is_in_white_list":false,"rate":0,"shutdown":true}}`——
**这段是拒绝态的答复,不是项目状态**,任何 id(包括空 id)都拿到同一段,据此判断不了任何事。

真正的诊断在**响应头** `rum-error` 里,它带业务错误码:

| 码       | 含义                                                      |
| -------- | --------------------------------------------------------- |
| `111`    | `id(...) in referer(...)/origin(...) is not allowed to report from this origin`——来源域名不在该应用的白名单里 |
| `41`     | `project(...) is not exist`——id 不存在                    |
| `12`     | `failed to match any pattern`——路径/方法不对(例如 GET /collect) |

`41` 与 `111` 的区别正好可以用来判断「id 对不对」与「域名允不允许」,不必去控制台猜。

来源允许之后,同一个 whitelist 接口改回 `{"retcode":0,"result":{"is_in_white_list":false,"rate":1,"use_gzip":0}}`,
数据端点返回 `204`。

**白名单按 origin 精确匹配,端口算在内**:实测 `http://localhost:5173` 通过,而同一台机器上的
`http://localhost:3199` 与 `http://127.0.0.1:3199` 都被 `111` 拒绝。上线前必须把真实部署域名加进去。

## 一个 403 会直接销毁 SDK 实例

产物里对这个字符串有专门处理(`FORBIDDEN_RESPONSE_DATA`):

```js
if ((''+response).indexOf('403 forbidden') > -1) { isErr = true; core.destroy() }
```

所以**第一条被拒的请求就会把 Aegis 实例销毁**,之后整页不再尝试任何上报。排查时看到「只发了一轮就没了」
是这个原因,不是采样、不是限流。

## 平台可以在运行时把采样率改成 0(Phase 1 真机实测)

第一次真的把上报打向 `rumt-zh.com` 时,一条日志都没出去,而客户端一切正常(0 条 CSP violation,
页面无任何异常)。链条从产物里读出来,是闭合的:

```text
GET /collect/whitelist
  → {"retcode":0,"result":{"is_in_white_list":false,"rate":0,"shutdown":true}}
        ↓  retcode===0 时:config.random = result.rate
sendPipeline 第一节:Math.random() < config.random
        ↓  random 为 0 时恒为 false
isHidden = true,整页此后不再发送任何东西
```

所以 **`random` / `sampleRate` 是一个上限,不是保证**:whitelist 接口返回的 `rate` 会直接覆盖
我们配置的值,平台可以随时把它压到 0。运维上要知道「配置了全量」不等于「全量到达」。

(第一次实测拿到 `rate: 0` 是因为来源被拒,见上一节;来源允许后是 `rate: 1`。机制照样成立,
只是当时那次的原因不是采样策略。)

这也顺带验证了一条设计要求:上报端完全不工作时,应用毫发无损——0 条 CSP violation,页面无任何异常。

## Phase 1 据此应写的配置

在 docs/rum.md §39 基础上的修订:

```ts
new Aegis({
  id, hostUrl: 'https://rumt-zh.com',
  version: rumVersionForRelease(webRelease.releaseId),
  env, random: config.sampleRate,
  repeat: 5,              // 默认是 60,要压噪必须显式写
  aid: false,
  spa: false,
  onError: true,
  pagePerformance: { urlHandler: observedPageUrl },  // 零参函数,返回值替换 from
  webVitals: true,
  reportApiSpeed: false,
  reportAssetSpeed: false,
  blankScreen: false, consoleLog: false, clickElementLog: false, websocketHack: false,
  lagMonitor: { enabled: false },
  gzip: { useWorker: false },        // 新增:否则撞 worker-src
  api: { apiDetail: false, reportRequest: false, reqHeaders: [] },
  urlHandler: observedPageUrl,       // 全局,管每条日志的 from
  beforeReport,                      // 改写 originFrom、去 msg 里的 query、丢弃 IMAGE_ERROR
  beforeRequest,                     // logType === 'pv' 返回 false
})
// 构造之后立刻:
aegis.extendBean('referer', '')
```

一共有三个同名的 `urlHandler`,签名不同,读产物确认过:

| 位置                       | 签名                    | 管什么                                   |
| -------------------------- | ----------------------- | ---------------------------------------- |
| 顶层 `urlHandler`          | `() => string`          | 每条日志的 `from`,返回假值回退原始 URL   |
| `pagePerformance.urlHandler` | `() => string`        | 页面性能日志的页面地址                   |
| `reportApiSpeed.urlHandler`  | `(url, payload) => string` | API 测速的 URL,Phase 3 才用          |

前两个都是**零参**的,必须从当前 observed page 读,不能指望入参。三个都**管不到 `originFrom`**。

## Phase 0 Gate 判定

docs/rum.md §42 的三条否决条件:

- **CSP 不兼容** → 不成立。script-src 不用动,上报只要 connect-src 一个 host,
  唯一的坑(gzip Worker)有配置解。
- **隐私 hooks 无法稳定过滤** → 不成立。三层组合把哨兵打到 0,Chromium 与 WebKit 一致,
  且 hook 语义是从 pin 版本产物里逐字读出来的,不是猜的。
- **SourceMap 无法可靠恢复** → 本地链路已证明逐行精确;腾讯侧待验。

**结论:不触发 Gate,可以进 Phase 1。** 不需要回头重新比较 Sentry/ARMS。

## 还没答、且只能对真实腾讯项目答的问题

以下五条不进 Phase 1 的前置条件,但 Phase 2 之前必须有答案:

1. 测试用 RUM application 的 browser reporting id 与 numeric SourceMap ProjectID(需要账号)。
2. 腾讯 SourceMap 的 `FileName` 对 Vite 的 `assets/foo-HASH.js.map`,匹配的是 basename 还是相对
   asset path(docs/rum.md 开放问题 5)。
3. `version` 超过 60 字符时平台是截断还是拒绝。
4. `aid: false` 对控制台错误聚合与性能页面的实际影响(开放问题 4)。
5. 真实 whitelist 接口下发的 `use_gzip`,以及真实 endpoint 下 gzip 路径的行为。

升级 SDK 时按本文的同一组用例重跑:包形态、四个钩子的契约、CSP 三项、哨兵 0 命中、
level 覆盖面、Ajax 静默、sourcemap 还原。

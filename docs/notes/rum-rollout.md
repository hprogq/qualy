# RUM 上线手册(docs/rum.md Phase 4)

日期:2026-09-15。对应 docs/rum.md §42 的 Phase 4。

Phase 0–3 结束后,**代码侧已经没有待办**。剩下的全是控制台配置、部署密钥与真实环境验收,
这份文件是那部分的执行顺序。凡是仓库能自动判定的,都已经做成命令或门禁;做不到的,
下面写清楚为什么以及该看什么。

## 顺序不能换,原因是一个静默失败

平台**按 origin 精确匹配**(端口算在内)决定允不允许上报。被拒的浏览器拿到 `403 forbidden`,
而 SDK 对这个字符串有专门处理:

```js
if (('' + response).indexOf('403 forbidden') > -1) {
  isErr = true
  core.destroy()
}
```

**第一条被拒的请求就会销毁 Aegis 实例**,整页此后不再尝试任何上报。产品这边看不出任何异常——
没有报错、没有 CSP violation、没有失败的请求。最早的迹象是「事后发现一段时间没有任何数据」。

所以:**先把来源加进白名单,再部署**。顺序反了不会报错,只会安静地什么都收不到。

## 步骤

### 1. 建项目,拿两个 id

腾讯云 RUM 控制台。两个 id 不是一回事,不要互相代入:

| 值                                   | 给谁     | 进哪里                                            |
| ------------------------------------ | -------- | ------------------------------------------------- |
| browser reporting id(形如 `pGUV...`) | 浏览器   | `QUALY_RUM_TENCENT_ID`,部署环境变量               |
| numeric SourceMap ProjectID          | uploader | `QUALY_TENCENT_RUM_PROJECT_ID`,**只进 CI secret** |

另外 uploader 需要 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`。这三个
**永远不进** qualy.yml、qualy.lock.json、`.env.example` 的真实值、应用进程、浏览器、日志。
应用进程只拿 reporting id。

### 2. 先配来源白名单,然后验证它

把 staging 的**完整 origin**(协议 + 主机 + 端口)加进该 RUM 应用的来源列表
(控制台:前端性能监控 > 应用管理 > 应用设置;官方说明「如果应用不需要校验,域名可以填 `*`」——
本产品不要这么填,那等于谁都能往这个项目里灌数据),然后:

```bash
QUALY_RUM_TENCENT_ID=<reporting id> \
QUALY_RUM_TENCENT_ENV=pre \
pnpm qualy rum preflight https://staging.example.edu.cn
```

它问的是 SDK 起来时问的同一个接口,不需要任何密钥。可能的回答:

```text
rum: https://... may report to <id> as pre          ← 可以部署了
no project has that reporting id (code:41)          ← id 写错了
that origin is not on the project allow list (111)  ← 白名单没配好或 origin 不完全一致
the platform is returning a sample rate of 0        ← 平台把采样压到 0,现在部署也收不到
```

最后一条值得单独说:**`sampleRate` 是上限不是保证**。whitelist 接口返回的 `rate` 会直接覆盖
配置值,平台可以随时把它压到 0。「配了全量」不等于「全量到达」。

> 这个命令只证明「此刻这个 id 接受这个 origin」。它不替代看控制台,也不对部署本身作任何承诺。

### 3. 构建 release,上传同一 release 的 SourceMap,再部署

```bash
QUALY_RELEASE_ID=<release> pnpm build
QUALY_TENCENT_RUM_PROJECT_ID=... TENCENTCLOUD_SECRET_ID=... TENCENTCLOUD_SECRET_KEY=... \
  pnpm qualy rum sourcemaps
# 然后部署这次构建的产物
```

version **不是参数**:uploader 从构建自己的 `.qualy-web-build.json` 读 releaseId,再过
`rumVersionForRelease`——浏览器盖的版本号和 map 归档的版本号出自同一个函数,想漂都漂不了。

上传失败**不应该**阻止部署(docs/rum.md §30):控制台不是本产品的可用性依赖。但执行上传的人
要看见失败,所以命令自己 exit 非零。

`client-dist` 里 `.map` 数量必须是 0,`check-staged-web` 已经是 load-bearing 门禁。

### 4. staging 验收(这才是 Phase 3 遗留三条的归宿)

部署后按顺序做,每条都要在控制台看到结果:

1. **SourceMap 还原**:人为抛一个可辨识的异常
   (`throw new Error('qualy-rum-probe-<releaseId>')`),确认控制台把压缩堆栈还原到真实 `.tsx`
   文件与行号。本地链路 Phase 0 已逐行验证过,腾讯侧只有真项目能验。
2. **5xx 与网络失败**:制造一条,确认进了错误面板,并且 `msg` 里带
   `res header x-qualy-request-id: <uuid>`。
3. **4xx 不进错误面板**:制造一条 403,确认它**只**出现在 API 面板,不产生 error issue。
4. **duration 对照**:同一条 API,比较浏览器侧 duration 与服务端 access log 的 duration。
   **验收标准不是「两个数字相等」**——官方明说前端只是把耗时记下来、不对这个耗时负责,
   差异的正常来源包括网络层耗时、地域与设备、DNS 首次解析、以及平均值被少数异常值拉偏
   (看中位数而不是平均值)。所以这一条的判据是:**浏览器侧 ≥ 服务端侧,且差值能被解释**;
   如果浏览器侧反而更小,那才是要查的。
5. **requestId 链路**:拿第 2 条里的 requestId → CLS 日志 → `trace_id` → APM。

**一条预期内的缺口,不要当成故障**:SDK 是在问过服务端配置之后才懒加载的,而官方说明
「初始化 Aegis 的时候这个接口已经发出去了」就监控不到。所以**冷启动期间的那几条请求
(session、manifest)大概率没有测速数据**。这是 docs/rum.md §23 那个取舍的已知代价——
不为了早几十毫秒把 vendor 放进 boot graph。首屏性能同理:官方建议尽早初始化,
Phase 0 实测懒加载下 page performance 与 Web Vitals 仍能采到,但「采得准」要在这一步看。

> **一个安静的前提**:`x-qualy-request-id` 能被浏览器读到,靠的是前后端**同源**。
> 官方那份「支持获取请求头和返回头」的文档要求跨域时加 `Access-Control-Expose-Headers`,
> 否则 `getResponseHeader()` 取不到值。当前 Qualy 是同源,所以不需要;但**哪天把前端拆到
> 另一个域,requestId 会从报告里安静地消失**,没有任何报错。docs/rum.md §31 记了这个条件。
>
> 顺带:官方那份文档的 `resHeaders` 示例同时开了 `apiDetail: true` 与 `reportRequest: true`,
> 这两条是本产品的直接否决项。读产物确认过,`resHeaders` 那段是**无条件**拼进 `msg` 的,
> 不依赖那两个开关——官方之所以全开,是因为它想让 header 出现在**每一条**请求上,
> 而本产品只要失败与慢请求时有。

### 5. 线上隐私 wire audit

Phase 1/3 的自动测试证明的是**本产品这一侧的变换**;这一步证明**腾讯实际收到了什么**。

准备可搜索的哨兵数据:

```text
name      = QUALY_PRIVATE_SENTINEL_NAME
studentNo = 999999999999
query     = QUALY_PRIVATE_SENTINEL_QUERY
```

带着它们走一遍真实页面,然后在控制台与实际 outbound payload 里搜索这三串,
**必须 0 命中**。同时确认:URL 已掩码(无 UUID、无 query)、无 referrer、
无 request/response body、除 `x-qualy-request-id` 外无其他 header。

### 6. 告警与费用,然后 soak 24–72h

初期只设少量信号(docs/rum.md §45):JS/Promise 错误数或错误率突增;新 release 的
error regression 人工观察。不要一开始就对每个 4xx、每个资源错误、每次慢请求设告警——
先跑出 baseline 再冻阈值。

费用:国内 RUM 每主账号每天共享 50 万条免费额度,超出按量。当前流量规模下
`sampleRate = 1` 是合理起点——降采样会同时丢掉真正的异常,先靠**关掉用不上的能力**控流量。

### 7. 切 production

staging soak 没问题后:production 域名进白名单 → `QUALY_RUM_TENCENT_ENV=production` →
上传 production release 的 SourceMap → 开正式告警。

qualy.yml 里 provider 的 `enabled` 由部署决定;仓库默认保持 `false`。

## 一个留到 staging 再定的口径:429

当前:`SpeedLog.isErr` 只标 5xx 与网络失败,所以 **429 在 API 面板里算成功**;
而 error 面板**保留** 429(它是运维事实,不是本产品作答)。

**官方文档已经答了机制那一半**:`retCodeHandler` 返回的两个值分工明确——

> `isErr` 用来计算接口返回值的成功率,`code` 用来统计接口的返回码占比。当该函数返回 `isErr`
> 为 `true` 的时候,这个接口的信息会同时上报到历史日志里面的「接口返回码异常」。

所以不再是「不知道控制台怎么呈现」:`isErr` **就是**成功率的输入,而 `code`(本产品写的是
HTTP status)会进返回码占比。剩下的是产品判断——**429 该不该算进接口成功率**。

留到 staging 看真实面板再定。要改就是一行:

```ts
isErr: status === 429 || status >= 500
```

这是 rollout 裁决,不是 Phase 3 的缺陷。

## 仓库这边不需要再改的

- 普通 CI 永不依赖腾讯凭据或腾讯网络(docs/rum.md §46),这一点不变;
- `.map` 不进 release store,已有门禁;
- CSP 只增加 `https://rumt-zh.com` 一个 host,开 API 测速不增加端点;
- 上线前若要 release pipeline 自动化第 3 步,可以加一条 workflow——本文只写命令,
  没有预设部署系统。

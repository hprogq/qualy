# 认证安全备忘

## 载体选型(2026-08-02 定案)

Cookie + 不透明 session token(库存 sha256),不用 JWT/localStorage:

- 单进程同源部署(vite middleware 与 API 共端口),无跨域需求,JWT 的无状态优势用不上;
- 「logout/禁用即失效」是验收硬指标,纯 JWT 结构性做不到(黑名单=变相服务端状态);
- localStorage 可被任意 XSS 脚本读走,HttpOnly Cookie 免疫此类窃取;
- CSRF:见下节「请求来源校验」——SameSite=Lax 只区分站点,不区分同站兄弟子域,
  那一格由 Fetch Metadata 守卫显式补上;不加 token、不签名、不装 CORS。

## 请求来源校验(2026-09-13 定案)

跨站 CSRF 已被三层彼此独立的机制挡住:

1. `qualy_session` 是 HttpOnly + SameSite=Lax + Path=/(生产 Secure),跨站的 POST/PUT/PATCH/DELETE 不带 Cookie;
2. 全部写操作走非安全方法,71 个 GET 都是读,登出是 `DELETE /auth/session`;`tools/tests/effect-api-parity.test.ts` 断言 OpenAPI 里没有任何 GET 声明 requestBody;
3. HttpApi 的 `decodePayload` 按 Content-Type 选解码器,JSON 端点收到表单编码直接 415;服务端没装 `HttpMiddleware.cors`,跨域 fetch 的 `application/json` 过不了预检。公式编辑器的 WebSocket 握手校验 `Origin` 与公开 host;本地存储 `PUT /api/storage/local/uploads/:reservationId` 认 reservation 不认 session。

**唯一的缺口是同站不同源**:SameSite 不区分 `qualy-dev.hprogq.com` 与 `rec.hprogq.com`,也不区分将来学校域名下的任何兄弟子域,兄弟子域发出的请求带着 Cookie。这一格现在只靠「JSON + 无 CORS + 无副作用 GET」挡着,任何一条将来松动(multipart 端点、有副作用的 GET、某天加上的 CORS)就漏。

**守卫**(`@qualy/api-kit/origin` 的 `requestOriginGuard`,serve 中间件链最内层,`apps/server/src/serve-middleware.ts`):

1. `GET` / `HEAD` / `OPTIONS` 放行。
2. 否则读 `sec-fetch-site`:`same-origin` / `none` 放行;`same-site`、`cross-site` 与其他任何值拒绝——`same-site` 必须拒,那正是兄弟子域。
3. 没有 `sec-fetch-site`(Safari ≤ 16.3、非浏览器客户端)读 `origin`:有则解析,协议必须 http/https 且 host 等于公开 host,否则拒绝;没有 `origin` 放行——curl、CLI、node 测试、undici 走这里,它们没有受害者的 Cookie,不构成 CSRF。

拒绝 = 403,响应体经 `RequestOriginRefused` schema 编码(`{"_tag":"REQUEST_ORIGIN_REFUSED","message":"…"}`),与 HttpApi 编出的错误同形,不进路由、不碰数据库;日志一条 Warn,只含 method / path / secFetchSite / origin / host。公开 host 与 `clientAddressOf` 同一哲学(`publicHostOf`):对端是受信任代理才读 `x-forwarded-host`(第一段),否则用 `Host`;它同时挂在 `RequestContext.publicHost` 上,公式 WebSocket 握手的同源判定读的就是它,判定函数 `originMatchesHost` 只有一份。无状态,前端零改动;浏览器发出的请求天然 `same-origin`。

**明确不做及理由**:

- RSA / HMAC 签名请求头:签名解决的是篡改与重放,不是浏览器自动附带凭据;密钥若在前端 JS 里,能跑 XSS 的人一样能签。
- HTML 级 / 双提交 CSRF token:服务端渲染表单的方案,本项目是 SPA + JSON;双提交在兄弟子域场景下反而更弱,兄弟子域能给父域种 Cookie。
- CORS 中间件:现在没有跨域需求,`HttpMiddleware.cors` 装上就是打开一个面。
- `__Host-` Cookie 前缀:同日落地,见「Cookie 名」——不是两套 security 声明,而是去掉 security、按配置的名字读。

**auth-cas / auth-oidc 落地时的硬要求**:回调必须用绑定 Cookie 的 `state` 防登录 CSRF(攻击者把自己的回调 URL 交给受害者打开,受害者会登进攻击者的账号);`state` 随机、单次、与发起登录的浏览器绑定。

## Session

- 原始 token = 32 字节 CSPRNG(base64url 43 字符),仅存在于 Cookie;
- 库存 sha256(token) hex 64 位(sessions.token_hash char(64) unique);
- Cookie:HttpOnly + SameSite=Lax + Path=/,无 Domain;生产(`secureCookies`,即 `NODE_ENV === 'production'`)加 Secure 且名字带 `__Host-` 前缀——见下节「Cookie 名」;
- TTL 默认 7 天(sessionTtlSeconds),Cookie maxAge 与之对齐;
- last_used_at 节流 900s(touchIntervalSeconds)才写;
- 校验链:session 存在 → 未过期(过期即删行,回 SESSION_EXPIRED)→ user.enabled
  → user_type.enabled → tenant.enabled 且未过 expires_at;
- allowLocalLogin 只在登录入口检查,不参与已有 session 校验(撤销手段=禁用 user/type/tenant)。

## Cookie 名(2026-09-13 定案)

| 项         | `secureCookies = true`(生产)                                                                                              | `secureCookies = false`(开发、测试) |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 名字       | `__Host-qualy_session`                                                                                                    | `qualy_session`                     |
| 属性       | `HttpOnly; Secure; SameSite=Lax; Path=/`,无 Domain                                                                        | `HttpOnly; SameSite=Lax; Path=/`    |
| 服务端读取 | 只读 `__Host-qualy_session`;请求里的 `qualy_session` 一律忽略                                                             | 只读 `qualy_session`                |
| 登录成功   | 设新 Cookie,**并附带一次** `qualy_session=; Max-Age=0; Path=/` 清旧名(改名后的一次性卫生;父域投掷的清不掉也无妨,不再读它) | 设 Cookie                           |
| 登出、无效 | 清 `__Host-qualy_session`                                                                                                 | 清 `qualy_session`                  |

威胁:SameSite 只区分站不区分源。兄弟子域(`rec.hprogq.com` 对 `qualy-dev.hprogq.com`,学校域名下任何一个被 XSS 的系统对生产 Qualy)可以给父域种一个名叫 `qualy_session` 的 Cookie,浏览器会随请求一起发给 Qualy:塞进攻击者自己的合法 session 就是登录 CSRF 的 Cookie 版(受害者把材料提交进攻击者账号);塞一个垃圾值则服务端清 Cookie 只能清自己 host 的那个,该用户永久打不开 Qualy。`__Host-` 的浏览器语义正是堵这两条:必须 Secure、Path=/、无 Domain,任何子域都无法为父域创建同名 Cookie。

**一个进程永远只认一个名字,而且不能靠两套 `security` 声明做到**(已核对 rc.111 源码,别再提议):`HttpApiBuilder.makeSecurityMiddleware` 对 `security` 记录里的每一项按声明顺序 `decode` 再调该项的 middleware,成功即返回、失败才试下一项(`HttpApiBuilder.ts:873-`);`securityDecode` 对 cookie 型 apiKey 缺 Cookie **不失败**,给出空凭据(`:492-505`)。于是同时声明两个名字,生产里被投掷的旧名仍会在某一轮被读到;而 `Viewer` 永不失败,第一项拿到空凭据就以匿名成功返回,第二项永远不会被尝试。再加上 `HttpApiSecurity.apiKey` 的 key 是静态的,而 `session-contract.ts` 被每个插件的 `api.ts` 引入、进浏览器包,名字不能在契约模块里按环境算。所以 `Authenticated` / `Viewer` 现在**不带 `security` 声明**(`provides` 与 `error` 不变;builder 对无 security 的 middleware 直接把 service 当 `(handler, options) => Effect` 调用,`HttpApiBuilder.ts:860-863`),名字由 `AuthConfig.sessionCookieName`(`sessionCookieNameFor(secureCookies)`,`server/session-cookie.ts`)决定,layer 里用 `request.cookies[name]` 按名读取,写入经同一模块的 `setSessionCookie` / `clearSessionCookie`(`HttpEffect.appendPreResponseHandler` + `HttpServerResponse.setCookie`)。`request.cookies` 对同名多值取**第一个**出现的(`Cookies.ts:946`,`Object.hasOwn`),浏览器按路径长度再按创建时间排序,只可能影响开发态的裸名。

代价:OpenAPI 文档里不再有 cookie 安全方案(浏览器客户端不依赖它,Cookie 由浏览器自动携带;`effect-api-parity` 比较的是同一份运行时聚合,自然通过)。

发版注意:升级当天所有已登录用户会被登出一次(Cookie 改名);生产必须是 HTTPS(`__Host-` 要求 Secure,http 下浏览器直接丢弃,登录会「无声失败」);反向代理终结 TLS 后以 http 转给后端时,`secureCookies` 仍按 `NODE_ENV` 判定,与代理协议无关。以生产入口跑的工具(`tools/quality/formula-production-smoke.ts`、`tools/benchmarks/support/dataset.ts` 与基准驱动、`tools/brand/record.ts`)不假定自己打的是哪个入口:从登录响应的 Set-Cookie 里取服务端实际设置的名字(`sessionCookieNames` 二选一),之后连自己种进库的 session 也按这个名字回发。录制工具不能用 Playwright `addCookies` 种 `__Host-` Cookie(协议要求给出 domain,前缀禁止),只能让浏览器自己在本源页面上调登录接口、由服务端 Set-Cookie 落盘;Chromium 把回环地址视为安全上下文,`http://127.0.0.1` 上照样保留 Secure Cookie。校验时用不带 URL 的 `context.cookies()`:带 URL 的过滤只豁免 `localhost` 主机名,会把 127.0.0.1 上的 Secure Cookie 滤掉。

## 响应头(2026-09-13 定案)

应用此前不设任何安全头(开发代理加的 `Vary: Origin` / `connection: close` 生产没有)。补的东西分三个面,各自的落点不同,因为写响应的人不同:

**1. `/api` 与 `/health` 的 Effect 响应**——`apps/server/src/response-headers.ts`,serve 链里紧挨来源校验外侧(`serveMiddleware` = requestContext → accessLog → httpMetrics → routeSpanNames → **responseHeaders** → originGuard),所以 403 拒绝也带这些头。按「尚无时设」补四个头(`Headers.has` 查已有再 `setHeaders`,rc.111 的 `setHeader` 是覆盖语义,`HttpServerResponse.ts:525-544`):

| 头                             | 值                                | 备注                                                                                |
| ------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| `Cache-Control`                | `no-store`                        | 已有的不覆盖;`text/event-stream` 改 `no-cache`(`no-store` 会让部分浏览器不肯挂住流) |
| `X-Content-Type-Options`       | `nosniff`                         | 附件下载已自带,不重复                                                               |
| `Cross-Origin-Resource-Policy` | `same-origin`                     | no-cors 嵌入也读不到                                                                |
| `Referrer-Policy`              | `strict-origin-when-cross-origin` |                                                                                     |

排除:`upgrade: websocket` 的请求与 101 响应不碰(公式 LSP 的握手响应就是升级本身)。**只限这两个前缀**:壳与哈希资源由 sirv 经 `fromConnect` 直接写 Node 响应,Effect 侧拿到的是一个空 200,改它的头到不了浏览器;前缀限定让两边永不相遇。

**2. HTML 壳与静态资源**——`packages/plugins/infra/web/src/server/index.ts` 的 sirv `setHeaders`,唯一能给这些字节设头的地方。所有响应 `X-Content-Type-Options: nosniff` + `Referrer-Policy: strict-origin-when-cross-origin`;壳(`.html` 或无扩展名路径)另加 `X-Frame-Options: DENY`(点击劫持)与 `Cross-Origin-Opener-Policy: same-origin`(仓库里没有 `window.open`,隔离零成本),`Cache-Control: no-cache` 保留;哈希资源保留 `immutable`,不加文档类头。开发态 Vite 不设这些头。

**3. 边缘(反向代理)**——不是应用代码,参考配置在 `ops/reverse-proxy/`(`Caddyfile` 优先,`nginx.conf` 同义):终结 TLS;`Strict-Transport-Security: max-age=31536000; includeSubDomains`(不加 `preload`,那是整个可注册域的单向门);原样转发 `Host` 并写 `X-Forwarded-For/Proto/Host`,应用侧 `QUALY_TRUSTED_PROXIES` 填代理地址——来源校验与客户端地址都只信受信任代理发来的这几个头;`/api` 下 WebSocket 升级放行;SSE 禁用响应缓冲(nginx `proxy_buffering off`,Caddy `flush_interval -1`);上游 keep-alive 打开。

不加:`X-XSS-Protection`(已废弃且曾引入漏洞)、`Expect-CT`、HPKP、`Permissions-Policy`(暂无需要)。生产 smoke(`tools/quality/smoke-production.ts`)断言壳带 DENY / same-origin / nosniff / referrer、`/api/app/manifest` 为 `no-store` + nosniff、哈希资源仍 `immutable` 且无 `X-Frame-Options`。

### Content-Security-Policy(2026-09-13,先 Report-Only)

壳响应(仅壳,哈希资源不带)多两个头:`Content-Security-Policy-Report-Only: <策略>` 与 `Reporting-Endpoints: csp="/csp-reports"`。`QUALY_CSP_MODE=enforce` 时头名换成 `Content-Security-Policy`,其余不变——**切换是部署设置,不改代码**;缺省 `report`。开发态(Vite)不设:HMR 与运行时样式注入和 CSP 天然冲突,CSP 是生产壳的控制。

策略(无人贡献时的全文):

```text
default-src 'self'; script-src 'self' 'sha256-pKAg+of2SxxrkLJX27pRnCgcyN5Ud1dmuOwx7/FCaS4='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; worker-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-to csp; report-uri /csp-reports
```

逐条理由:

- `script-src` 不放 `'unsafe-inline'`。壳唯一的内联脚本是 `index.html` 里的 boot 脚本(首帧前跑的主题判定 + 20 秒后应用仍未接管时给出刷新链接的 watchdog),用其**精确字节**的 sha256(base64)放行。hash 是 `packages/plugins/infra/web/src/server/shell-policy.ts` 里的常量而不是启动时对产物现算——脚本一改,hash 必须跟着改,这是有意的:改壳脚本就是改策略。`tools/tests/index-html.test.ts` 守「常量 = 当前 `apps/web/index.html` 内联脚本的 digest」,client-dist 存在时再守「产物脚本字节 = 源文件」。2026-09-13 实查:Vite 对非 module 内联脚本原样保留,产物与源文件逐字节相同,所以对源文件算。
- `style-src 'self' 'unsafe-inline'`,**不加 hash**:Monaco 运行时向页面注入 `<style>`,两个内联 `<style>` 也靠它;CSP3 规定 style-src 里一旦出现 hash/nonce,`'unsafe-inline'` 被忽略,Monaco 会被拦。
- `img-src` 的 `data:` / `blob:`:react-photo-view 与附件预览用到;Report-Only 阶段验证后可收紧。
- `frame-src 'self' blob:`:规格写的是 `'self'`,实查 `DocumentLightbox` 是把附件字节经 API 取回、自己定类型做成 Blob 再 `<iframe src={blob:…}>`,blob: URL 不在 `'self'` 之内,少了它第一个预览就会报违例(强制时被拦)。
- `worker-src 'self'`:Monaco 的 `?worker` 在生产构建里是独立文件。
- `connect-src 'self'` 按 CSP3 同时覆盖同源 `ws(s):`;公式 LSP 的 WebSocket 是否被 Safari 正确归入 `'self'`,看 Report-Only 期间的报告。
- `media-src 'self'` 是固定行里多出来的一条:`default-src` 本已覆盖,写出来是让贡献有地方追加。
- `frame-ancestors` 在 Report-Only 下被浏览器忽略,第一步的 `X-Frame-Options: DENY` 顶着;切强制时它生效。
- 不放 `report-sample`:报告可能带页面内容,日志不收。

**贡献契约**(`@qualy/api-kit/shell-policy`):`connect-src` 必须含 COS 直传域名,它来自 storage-cos 的配置(`region`、`bucket`),所以策略是插件贡献、web 插件拼装的。可贡献的指令只有 `connect-src` / `img-src` / `frame-src` / `worker-src` / `font-src` / `media-src`;`script-src` / `style-src` / `base-uri` / `object-src` / `form-action` / `frame-ancestors` / `default-src` 归壳,贡献即拒。来源语法只认 `'self'`、`data:`、`blob:`、`https://host[:port]`、`ws(s)://host[:port]`(不认通配、路径、明文 http、`'none'`)。贡献方在自己 layer 构建期 `ShellPolicy.register({ owner, 'connect-src': [...] })`;storage-cos 读到 `CosStorageConfig` 后注册 `https://<bucket>.cos.<region>.myqcloud.com`(`cosOrigin`)。

**注册表放在宿主基座而不是 web 插件**,这是对规格的一处偏离,理由是装配器的两条规则(`packages/core/plugin-kit/src/assemble.ts:138-146, 165-175`):对没有 provider 的扩展点贡献是 boot 硬失败;`Plugin.layer` 按描述器顺序叠放、只看得见前面插件导出的服务。两条都意味着「web 插件拥有注册表」要求 storage-cos `dependsOn` web——headless 部署一停用 web,storage-cos 就装不起来,而且方向反了(基础设施插件依赖壳)。`Readiness` / `Assembled` 早已是同一形状:宿主在所有插件之下提供注册表(`apps/server/src/runtime.ts` 与 `@qualy/api-kit/headless` 两个档位都提供),插件只管 register,web 插件负责解释。契约没放 `@qualy/ui-contract`:它是进浏览器包的组合原语、零 effect 依赖,一个服务端注册表 tag 不属于它;也没新建 contracts 包:tag 的 provider 就是宿主基座,与 `Assembled` 同一个家。storage-cos 因此多一条对 `@qualy/api-kit` 的依赖,与 plugin-storage 相同。

**冻结**:web 插件在 Assembled 屏障处(boot hook `web/shell-policy`)把注册项拼成一个字符串,**只算一次**;未知指令、非法来源在这里硬失败,错误信息点名贡献方;之后的注册不再计入;壳路由在屏障之后构建、直接读冻结值。

**报告端点** `POST /csp-reports`(web 插件 raw route,`/api` 之外,无鉴权,不进 OpenAPI 也不在 frozen-routes——那张表只冻结 OpenAPI 面):接受 `application/csp-report`(`{"csp-report":{…}}`)与 `application/reports+json`(数组,只取 `type: csp-violation`),其他 Content-Type 415;体上限 64 KiB(声明的 `content-length` 超限或实读超限)413;JSON 解析失败 204 不 500(浏览器噪声通道);正常 204。日志每条一行 Warn,来源 `@qualy/plugin-web`,只取 `document-uri` / `effective-directive`(缺则 `violated-directive`)/ `blocked-uri` / `source-file` / `line-number` / `disposition`,每字段截 512 字符,**不记 `script-sample`**;按 `(effective-directive, blocked-uri, source-file)` 每分钟去重:一分钟内同键只记第一条,后续计数,下一分钟的第一条带上 `suppressed`。来源校验沿用现有守卫:浏览器发报告是 `same-origin`(或无 Sec-Fetch 但 Origin 同源)放行,`cross-site` 403。注意 CSP3 规定同时出现 `report-to` 与 `report-uri` 时浏览器忽略 `report-uri`,走 Reporting API——Chromium 会攒批延迟投递(约一分钟),生产没问题,测试因此用只含 `report-uri` 的头。

**切到强制的条件**:Report-Only 至少跑两周,期间日志里没有来自真实用户路径的违例(测试页面除外),再把 `QUALY_CSP_MODE` 切到 `enforce`;切换不改代码。

## 密码

- Argon2id,参数显式固定:memoryCost 64 MiB、timeCost 3、parallelism 4
  (argon2 包默认值,显式写死防止上游默认漂移);
- 本机耗时实测见下;最小长度 12(创建/重置路径,登录输入不做策略校验以免泄露策略);
- 登录失败统一 INVALID_CREDENTIALS;未知用户走固定 dummy hash 校验拉平时序;
- 密码、Cookie、raw token 禁止进入日志/错误详情/STATUS/迁移。

## 登录邮箱(2026-09-22 定案,取代「登录名」)

- 本地入口按**用户自己的邮箱**找人(`users.email`,规范化为 trim + 小写,`normalizeEmail` 一份实现);绑定表里不存第二份。
- 登录载荷 `{ email, password }`,只做形状校验(邮箱 1–320、密码 1–128);未知邮箱、没有密码、密码错误一律 `INVALID_CREDENTIALS`,
  每条未命中都跑一次 dummy 校验。旧的「用户名」模型整体删除,不保留兼容回退。

## Argon2id 本机耗时

见 STATUS 会话 3 验收摘录(目标机 = 开发机 Apple Silicon;部署机变更时重测)。

## Provider 模型(2026-08-02 定案,2026-09-22 修订)

两层结构:**协议族 = 驱动插件,登录方式实例 = auth_providers 行**。驱动证明「是谁」,基座负责「创建 Qualy Session」。

- 驱动三个正交声明(`@qualy/auth-contract/login`):
  - `provisioning`:`system-singleton`(平台为每个租户供给一扇、固定地址,租户只能改名、启停、受众、排序,不能新增或删除——local)
    或 `tenant-managed`(租户自行新增,带 `entrance` 字段声明——CAS/OIDC/GitHub 之后都是这种)。
  - `resolution`:`user-field`(按用户自己的字段找人:local 按 email,CAS 按 businessNo)或 `binding-subject`(按用户自己绑定的外部账号的稳定 id)。
  - `binding`:`managed`(管理员可代设的凭据,只存摘要,仅用于 `user-field`)、`self`(只能本人经驱动流程绑定,仅用于 `binding-subject`)或缺省(什么都不存)。
  矛盾组合在注册时拒绝(`driverContradiction`)。旧的 `derived` 取消:它描述的是「怎么找人」而不是「怎么绑定」。
- 驱动不直接查 `users` / `user_auth_bindings`:基座提供 `findUserByField` / `findBindingForUser` / `findBindingBySubject`(只看存活行,受众在基座判定),
  `completeLogin` 是唯一的 Session 写入者,并把入口与绑定记在 `sessions.auth_provider_id / auth_binding_id` 上。
- 同租户可配多个同类型的 tenant-managed 实例;每租户恰好一扇 `is_system` 的 local 入口(`uq_auth_providers_tenant_system_type`)。
- 公开 URL 用 code 不用数据库 ID:`/auth/<type>/<code>/<operation>`;GET /auth/login-methods 只返回「enabled 且驱动已装配」的入口,
  不泄 config/内部 ID。
- `auth_providers.deleted_at` 是墓碑(`chk_auth_providers_deleted_is_disabled`),code 只在存活行中唯一,删除后可复用。
- provider 禁用只拦新登录,已有 session 不受影响(撤销手段 = 禁用 user/type/tenant,或删除入口)。

## 绑定(2026-09-21 定,2026-09-22 改为 user_auth_bindings)

`user_identities` 更名 `user_auth_bindings`,`identifier` → `subject`(可空),新增 `display_label`:

| 入口 | 找人方式 | 绑定里存什么 |
| --- | --- | --- |
| local(邮箱密码) | `users.email` | `subject = null`,`credential_hash` = argon2 摘要 |
| CAS(之后) | `users.business_no` | 无绑定 |
| GitHub / OIDC(之后) | 绑定的 `subject`(外部稳定 id) | `subject`,`display_label` 只供展示 |

- 写入只有一处:`PUT|DELETE /iam/users/{userId}/auth-bindings/{providerId}`。PUT 只收 `{ secret }`,只对 `managed` 驱动;该人缺驱动按其找人的字段时
  `AUTH_BINDING_USER_FIELD_MISSING { field }`(没有邮箱就设不了密码)。授权、系统账户保护、受众检查、「摘要在事务外算、锁内复核」同前。
- 改写与撤销都结束该用户全部会话;撤销置 `revoked_at`,不删行。改动某人的邮箱时,若其在「按 email 找人」的入口上有存活凭据,同样结束全部会话。
- 审计:`auth.identity.bind` / `auth.identity.revoke` 保留原 code(历史),details 升 version 2(`bindingId`);`auth.user.delete` version 2(`revokedBindings`)。
- 读取:`GET /iam/users/{userId}/entrances` 每行带 `resolution`、`binding`、`bound`;页面据此渲染,不按类型名分支。
  **不从绑定数推导「能否登录」**:按学工号对应的入口根本不存绑定,用户列表与详情因此不再显示账号数。

## 入口密钥与 Provider 生命周期(2026-09-23 定案)

- **密钥归 `@qualy/plugin-secrets`**,不进 `auth_providers.config`:表 `secrets(tenant_id, owner_kind, owner_id, key)` 存 AES-256-GCM 密文
  (12 字节 nonce、16 字节 tag、AAD = `qualy-secret\0v1\0<tenant>\0<ownerKind>\0<ownerId>\0<key>`,`key_version = 1`),
  所以一行密文被挪到别的所有者或别的键上就解不开。接口只经 `Redacted` 交换明文;`seal`/`open` 给「交给别人保管的一次性载荷」用(Phase E 的 auth flow)。
- **主密钥 `QUALY_SECRETS_MASTER_KEY`**:恰好 32 字节的 base64(`openssl rand -base64 32`)。**生产缺失或格式错即拒启**
  (`QUALY_SECRETS_MASTER_KEY must be base64-encoded 32 bytes`),开发回退到源码里写死的 development key 并告警——它保护不了任何东西,
  所以生产显式写这把 key 也拒启。不接受任意口令再哈希:那看起来配好了,强度却是口令的。
- **就绪判定只有一份**(`providerReadiness`):驱动已装配 + 每个 `required` 的非密钥字段有值 + 每个 `required` 的密钥已存。
  详情页、启用、匿名 `login-methods`、`resolveProvider`、恢复通道全部读它。不变量 **enabled ⇒ ready**:会让在用入口变得未就绪的写(清空必填框、清除必填密钥)一律拒绝,
  要改先停用。
- **生命周期**:`POST /auth/providers { type, code, name }` 建一个停用的空壳 → `PATCH` 分多次补齐(缺省保持、显式空串清除;密钥缺省或空串保持,
  非空替换;`DELETE /auth/providers/{id}/secrets/{key}` 是唯一的清除动作)→ 就绪后才能 `PUT .../status` 启用 →
  `DELETE /auth/providers/{id}?version=` 删除(系统入口 `AUTH_PROVIDER_IS_SYSTEM`;删除置墓碑、撤销存活绑定、删该入口的会话、销毁其密钥、审计 `auth.provider.delete`、复核恢复通道)。
- **身份命名空间锁**:驱动用 `identityNamespaceKeys` 点名「说明这些账号属于谁」的配置键(CAS 的服务器地址、OIDC 的 issuer)。
  只要该入口有过任何绑定(含已撤销),这些键不可再改(`AUTH_PROVIDER_IDENTITY_NAMESPACE_IN_USE`)——已存的 subject 会开始指向别家的账号。
- **密钥永不回显**:`GET /auth/providers/{id}` 只说某个密钥「已存/未存」,成功响应与审计 details 里不得出现
  `clientSecret|refreshToken|accessToken|password` 这类字段名,由 `tools/tests/secret-disclosure.test.ts` 守。

## 租户寻址、公开地址与一次性 flow(2026-09-23 定案)

- **匿名租户是解析器**(`AnonymousTenantResolver`):登录页列哪些入口、一个 provider code 指向哪一行、一次证明说的是谁,都问它。
  当前实现是单租户(`QUALY_DEFAULT_TENANT`,停用或过期即 `TenantUnavailable`);将来按域名区分租户时只换这一层,驱动与 sign-in 都不碰租户概念。
  按域名的实现读请求上下文里**已解析**的 host,不读原始 Host 头——代理层没算进去之前,Host 不是证据。
- **公开地址也是解析器**(`PublicOriginResolver`,`QUALY_PUBLIC_URL`):**必须是纯 origin**(绝对 http(s),无路径/查询/片段/凭据;生产必须 https),
  格式错即拒启。开发缺省 `http://localhost:5173`(浏览器就是从那儿来的),生产不设就是「没有」。**回调地址绝不从请求推导**:
  代理后面请求说什么都行,据此拼出的 callback 是攻击者能指向别处的 callback。
- **Cookie 仍是 host-only**(`__Host-` 前缀),永不设父域 Domain;公开 Auth URL 第一版保持不带租户段。
- **驱动声明 `callback`** 即表示「会把人送走、还要送回来」:该类型的入口未配置公开地址时 readiness 不通过(`{kind:'public-origin'}`),
  因而不能启用;生产启动时若发现这样的入口在用,拒启并点名(开发告警)。`GET /auth/providers/{id}` 的 `callbackUrl` 就是拼好的绝对地址,给管理员填到对方系统里。
- **一次性 flow**(`auth_flows`):32 字节随机 state 只存 sha256;10 分钟有效;purpose = `login | bind`,bind 必须钉住发起时的用户与会话
  (`chk_auth_flows_bind`,会话被删即级联删 flow)。`consumeFlow` 在**一个事务内**条件消费(`consumed_at is null and expires_at > now()`),
  然后校验同一入口、bind 校验会话仍存活;**规则内的拒绝提交「已烧毁」**并返回 `AuthFlowRejected { reason }`
  (`unknown | expired | consumed | provider-mismatch | session-mismatch`),只有缺陷整体回滚。
  payload(verifier、nonce)经 secrets 的 `seal/open` 封装,AAD 固定为该 flow 自己的身份,挪到另一条 flow 上就打不开。
  入口删除把未消费的 flow 标记为已消费;人被删除时其会话消失,挂在会话上的 flow 随之级联删除。
  返回路径只接受本应用内的路径(`safeReturnPath`),绝对 URL、协议相对 URL 一律丢弃。

## 恢复通道(2026-09-22 定案)

- 每个租户的系统账户(`system-account` 类型)永远保有平台 local 入口上的一条可用登录:有邮箱、有存活密码凭据,入口在用且受众接纳系统类型
  (`recoveryChannelIntact`,auth 内唯一实现)。
- Provider 停用 / 改受众在写后同事务复核,不满足即 `RECOVERY_CHANNEL_REQUIRED`;系统账户的绑定撤销、邮箱修改、停用、删除本就 `SYSTEM_ACCOUNT_PROTECTED`。
- rbac 的 `LAST_ADMINISTRATOR` 只数「有效授予 + 用户启用 + 类型启用」的持有人,不再推断能否登录(那取决于各驱动)。
- **部署顺序 migrate → seed → boot**:绑定迁移后,旧的系统账户还没有邮箱;`pnpm seed` 以 `QUALY_ADMIN_EMAIL` 补上(已有不同邮箱视为漂移报错)。
  auth 在 Assembled 屏障注册启动检查:任一存活租户恢复通道不完整,生产拒启并点名租户与要跑的命令,开发只告警。
- 系统账户的管理员授予目前可被撤销(rbac 对它没有特殊保护);恢复通道只保证能登录,是否再保护其权限待裁决。

## 用户删除是终态；邮箱归 User（2026-09-22）

- **删除不可恢复**。`users.deleted_at` 只是墓碑：授予、批次记录、审计事件按 id 引用它，所以行保留；除此之外的一切读取
  （名册、详情、选择器、写入守卫、`UserProvisioning.byBusinessNo`）都当它不存在，一律 `USER_NOT_FOUND`。恢复接口、
  `auth.user.restore` 权限（迁移删除目录与角色勾选）、`USER_NOT_DISABLED` / `USER_DELETED` 均已移除；
  `auth.user.restore` 审计动作保留声明、列入 `audit-actions` 门禁的 `RETIRED`，旧事件仍有名字。
- **业务编号与邮箱只在存活用户中唯一**（`uq_users_tenant_business_no` 保名改谓词，`uq_users_tenant_email_live`），
  删除即释放。同一个人被删除后重新导入就是新的 `user_id`：旧综测、旧授权、旧审计仍指向旧行，历史永远按 id 引用，
  不经编号或邮箱反查人。
- **删除入口** `DELETE /iam/users/{userId}?version=`：在该人节点同时持有 `auth.user.manage` 与 `auth.user.delete`，
  正常或停用状态都可直接删（不再强制先停用）；一个锁定事务内撤销授予、撤销身份、结束会话、置 `deleted_at` 与
  `enabled = false`、写 `auth.user.delete`，最后按提交后的状态复核「至少一个管理员」，不满足则整体回滚。系统账户不可删。
  目录导入的撤销走同一套（`retireUsers`）。
- **邮箱是 User 的属性**，不是某个登录方式的标识：通知收件、邮箱密码登录的登录名、(之后的)找回渠道都引用
  `users.email`，不存第二份。入库统一 trim + 小写（`@qualy/auth-contract/email` 的 `normalizeEmail`，契约层与服务层共用，
  库上有 `chk_users_email_normalized`）。`email_verified_at` 表示「本人证明过能收到」，任何改动都清空它；原样重述不算改动。
  系统账户的邮箱只由 seed 设定，API 修改一律 `SYSTEM_ACCOUNT_PROTECTED`。
- 界面不再显示「账号数」：有的登录方式根本不保存绑定（按学工号对应），绑定数推不出「能不能登录」。详情改显示
  「最近登录」（取 `sign_in_events` 最近一次成功，任何登录方式都会写）。

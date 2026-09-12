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
- `__Host-` Cookie 前缀(待办):想做过,但 `HttpApiSecurity.apiKey` 的 key 是静态的,而 `qualy-dev.hprogq.com` 走 http,`__Host-` 在那里被浏览器拒绝,要做就得按 `secureCookies` 切两套 security 声明;按「复杂度必须由已发生的问题证明」只记录不做。

**auth-cas / auth-oidc 落地时的硬要求**:回调必须用绑定 Cookie 的 `state` 防登录 CSRF(攻击者把自己的回调 URL 交给受害者打开,受害者会登进攻击者的账号);`state` 随机、单次、与发起登录的浏览器绑定。

## Session

- 原始 token = 32 字节 CSPRNG(base64url 43 字符),仅存在于 Cookie;
- 库存 sha256(token) hex 64 位(sessions.token_hash char(64) unique);
- Cookie:HttpOnly + SameSite=Lax + Path=/,production 加 Secure(config secureCookies=auto);
- TTL 默认 7 天(sessionTtlSeconds),Cookie maxAge 与之对齐;
- last_used_at 节流 900s(touchIntervalSeconds)才写;
- 校验链:session 存在 → 未过期(过期即删行,回 SESSION_EXPIRED)→ user.enabled
  → user_type.enabled → tenant.enabled 且未过 expires_at;
- allowLocalLogin 只在登录入口检查,不参与已有 session 校验(撤销手段=禁用 user/type/tenant)。

## 密码

- Argon2id,参数显式固定:memoryCost 64 MiB、timeCost 3、parallelism 4
  (argon2 包默认值,显式写死防止上游默认漂移);
- 本机耗时实测见下;最小长度 12(创建/重置路径,登录输入不做策略校验以免泄露策略);
- 登录失败统一 INVALID_CREDENTIALS;未知用户走固定 dummy hash 校验拉平时序;
- 密码、Cookie、raw token 禁止进入日志/错误详情/STATUS/迁移。

## 登录名

- 不区分大小写 ASCII:trim + lowercase,`^[a-z0-9][a-z0-9._-]*$`,长度 2-64,存规范化值。

## Argon2id 本机耗时

见 STATUS 会话 3 验收摘录(目标机 = 开发机 Apple Silicon;部署机变更时重测)。

## Provider 模型(2026-08-02 会话 3.5 定案)

两层结构:**协议族 = 驱动插件,登录方式实例 = auth_providers 行**。

- @qualy/plugin-auth = 基座 Service:session/cookie/principal enricher、me/logout/methods、
  provider type registry、resolveProvider/findIdentity/completeLogin;驱动证明"用户是谁",
  基座负责"创建 Qualy Session"。
- @qualy/plugin-auth-local = local 协议驱动(Argon2id、identifier 规范化、时序拉平),
  未来 auth-cas/auth-oidc 同型。
- 同租户可配多个同类型实例(如三个 CAS 各自地址),identity 唯一域是
  (tenant, provider, identifier),同一用户可绑多个 provider。
- 公开 URL 用 code 不用数据库 ID:`/auth/<provider-type>/<provider-code>/<operation>`
  (code/type 有路由安全 check 约束);不建 contract 路径自动前缀机制,路径在各契约显式声明。
- GET /auth/methods 只返回「数据库 enabled 且驱动插件 active」的方式(驱动停用 fail closed,
  行与绑定保留),输出仅 code/type/name/interaction,禁止泄 config/内部 ID。
- 入口页 /login 按 methods 渲染:credentials → /login/<type>?provider=<code>,
  redirect → /api/auth/<type>/<code>/start。
- P1 边界:auth-local 是默认装配的 bootstrap provider(seed 依赖它建管理员),
  不承诺 CAS-only 空库自举;registerProviderType 暂不带 configSchema(首个用 config 的
  驱动 = CAS 落地时再加);「按 provider 实例限制用户类型」等出现真实需求再建关联表。
- provider 禁用只拦新登录,已有 session 不受影响(session 撤销手段 = 禁用 user/type/tenant)。

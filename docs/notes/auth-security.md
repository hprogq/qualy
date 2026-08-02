# 认证安全备忘

## 载体选型(2026-08-02 定案)

Cookie + 不透明 session token(库存 sha256),不用 JWT/localStorage:

- 单进程同源部署(vite middleware 与 API 共端口),无跨域需求,JWT 的无状态优势用不上;
- 「logout/禁用即失效」是验收硬指标,纯 JWT 结构性做不到(黑名单=变相服务端状态);
- localStorage 可被任意 XSS 脚本读走,HttpOnly Cookie 免疫此类窃取;
- SameSite=Lax 在同源部署下覆盖 CSRF 主面(跨站 POST 不带 Cookie);P1 不加 CSRF token,
  若未来放开 SameSite 或出现第三方嵌入场景再评。

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

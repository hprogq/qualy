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

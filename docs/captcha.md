# Qualy CAPTCHA / 认证风控改造最终设计

> **实施状态（2026-09-24）**：Phase A–G 全部完成。ALTCHA 为默认 provider 并已启用，登录页与找回密码页都能处理 428；
> Turnstile 已实现、默认停用。详见 STATUS.md 与 docs/notes/auth-security.md、docs/notes/altcha.md。
> 与本文的偏离：identifier 风险按 **attempt** 计（review 结论，堵住阈值边界并发 TOCTOU），不是按 credential failure 计；
> `LoginSessions` 契约不引用 captcha 包，`admitAttempt` 返回 `{ kind: 'admitted' | 'challenge' }`，由驱动答 428；
> §36 的固定 `counter = 7500` 改为每题 `randomInt(5000, 10000)`（固定 counter 会让 deterministic 模式一次派生即解）；
> 通用 gate 的失败区分 `restart` / `refresh`；ShellPolicy 的 `script-src` 只接受 `https://host[:port]`（独立 validator）。

## 1. 本轮目标与核心安全模型

当前 `packages/plugins/base/auth/src/server/limiter.ts` 中：

```ts
signInByAddress: {
  scope: 'sign-in:address',
  limit: 30,
  windowSeconds: 300,
}

signInByIdentifier: {
  scope: 'sign-in:identifier',
  limit: 10,
  windowSeconds: 900,
}
```

`sign-in.ts -> admitAttempt()` 在查用户与 Argon2 之前同时消费：

```text
provider + clientIp
provider + identifier
```

这导致匿名攻击者只需要知道某个邮箱，就能通过全局 identifier hard limit 让真正用户进入 429。

本轮要彻底改变这个模型。

最终原则：

```text
登录账号风险
→ 可以要求 CAPTCHA
→ 不能因为匿名攻击者的行为按 identifier 锁登录

来源流量
→ 可以有 hard limit
→ 但它只是资源保护熔断器
→ 不能把 IP 当成“一个人”

校园 NAT
→ IP 很可能代表几十、几百甚至更多用户
→ 因此 IP hard limit 必须足够宽松
→ 更低阈值的异常流量应优先升级 CAPTCHA，而不是 429

忘记密码
→ 与登录不同
→ 可以对 identifier 的“发邮件副作用”做 hard quota
→ 因为旧 reset link 不再被新请求作废

CAPTCHA
→ 是附加风控，不是认证因子
→ provider 服务端不可用时 fail-open
→ hard resource limit 仍然存在
```

最重要的不变量改成：

> **任何匿名攻击者都不能仅通过制造某个 identifier 的失败登录记录，使该 identifier 无法凭正确密码登录。**

但这条不变量**不适用于密码重置邮件数量**。Recovery mail 是一个有真实外部副作用的资源，可以对单邮箱限额。

---

# 2. 能力命名：使用 `captcha`

最终不要叫 `security-challenge`。

新增三个插件：

```text
@qualy/plugin-captcha
@qualy/plugin-captcha-altcha
@qualy/plugin-captcha-turnstile
```

理由是 `security-challenge` 范围过大，MFA、WebAuthn、邮件确认、step-up authentication 都可以叫 security challenge。

ALTCHA 官方本身也将其描述为 CAPTCHA / CAPTCHA alternative；它虽然并不证明“这是人”，但工程领域里仍然属于 CAPTCHA 能力。

第一版：

```text
ALTCHA
→ 默认

Turnstile
→ 可选
→ 默认 disabled
```

Cloudflare 当前明确写明 Turnstile 不支持中国大陆，因此不能作为 Qualy 国内默认实现。

---

# 3. CAPTCHA capability 必须是完全通用的

`@qualy/plugin-captcha` 不能知道：

```text
auth/login
auth/password-reset
assessment/...
```

这些属于调用者。

不要：

```ts
type CaptchaPurpose = 'auth-login' | 'password-reset'
```

也不要现在做 `CaptchaPurposeDeclarations` 注册表。

使用 branded namespaced string：

```ts
export type CaptchaPurpose = string & Brand.Brand<'CaptchaPurpose'>
```

格式建议：

```text
<owner>/<purpose>
```

例如：

```text
auth/login
auth/password-reset

assessment/entry-submit
assessment/review-submit

directory/import
```

约束：

```text
^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)+$
```

并设置合理长度上限，例如 127。

由各业务插件自己声明常量：

```ts
export const LOGIN_CAPTCHA = captchaPurpose('auth/login')

export const PASSWORD_RESET_CAPTCHA = captchaPurpose('auth/password-reset')
```

将来 Assessment 直接：

```ts
const ENTRY_SUBMIT_CAPTCHA = captchaPurpose('assessment/entry-submit')
```

不需要修改 `plugin-captcha`。

注册表只有未来出现这种真实需求后再做：

```text
后台查看所有 CAPTCHA 用途
按用途启停
按用途配置 provider
按用途显示运营名称
```

当前不需要。

---

# 4. Purpose 是安全域的一部分

CAPTCHA capability 自己计算业务绑定 hash。

不要让 concrete provider 接触：

```text
email
userId
businessNo
password
```

调用方只给：

```ts
interface CaptchaBindingInput {
  readonly tenantId: string
  readonly purpose: CaptchaPurpose
  readonly bindingKey: string
}
```

CAPTCHA capability 内：

```ts
const bindingHash =
  yield * secrets.fingerprint(`captcha/binding/v1/${tenantId}/${purpose}`, bindingKey)
```

这里同时包含：

```text
tenantId
purpose
bindingKey
```

因此以下 proof 天然不可互用：

```text
tenant A / auth/login / ada@example.com

tenant B / auth/login / ada@example.com

tenant A / assessment/entry-submit / ada@example.com
```

`bindingKey` 的具体含义由调用插件决定。

Auth login：

```text
providerId + NUL + normalizedIdentifier
```

Password reset：

```text
normalizedIdentifier
```

Assessment 将来可以：

```text
batchId + NUL + userId
```

---

# 5. 请求 IP 永远由 CAPTCHA capability 自己读取

不要：

```ts
captcha.verify({
  clientIp: callerProvidedIp,
})
```

CAPTCHA service 内部自己读取：

```ts
currentRequestContext
```

得到：

```text
clientIp
publicHost
```

当前 `RequestContext` 已经按 `QUALY_TRUSTED_PROXIES` 处理代理链，并且明确不信任任意客户端提供的 `X-Forwarded-For`。

CAPTCHA 继续沿用这一个事实源。

业务插件不能自己重新解析：

```text
X-Forwarded-For
CF-Connecting-IP
```

---

# 6. Provider 架构直接复刻 RUM 模型

参考当前：

```text
packages/plugins/infra/rum/src/plugin.ts
packages/plugins/infra/rum/src/server/registry.ts
packages/plugins/infra/rum-tencent/
```

`captcha/plugin.ts`：

```ts
interface CaptchaProviderDeclaration {
  readonly code: string
}

CaptchaProviderDeclarations

Captcha.provider({ code })

Captcha.owner
```

装配规则：

```text
0 provider
→ 合法
→ 启动 Warning
→ CAPTCHA risk 触发时 fail-open

1 provider
→ 正常

2+ provider
→ assembly 阶段硬失败
→ 点名两个插件
```

例如：

```text
@qualy/plugin-captcha-altcha
@qualy/plugin-captcha-turnstile
```

同时 active 必须拒绝。

默认 `qualy.yml`：

```yaml
'@qualy/plugin-captcha': {}

'@qualy/plugin-captcha-altcha': {}

'@qualy/plugin-captcha-turnstile':
  enabled: false
```

---

# 7. Server provider contract

建议：

```ts
export interface CaptchaProviderContext {
  readonly tenantId: string
  readonly purpose: CaptchaPurpose
  readonly bindingHash: string
  readonly clientIp: string | undefined
  readonly publicHost: string | undefined
}

export interface CaptchaProvider {
  readonly code: string

  readonly issue: (
    context: CaptchaProviderContext,
  ) => Effect.Effect<Record<string, unknown>, CaptchaUnavailable>

  readonly verify: (
    context: CaptchaProviderContext,
    response: string,
  ) => Effect.Effect<'verified' | 'rejected', CaptchaUnavailable>
}
```

这里必须区分：

```text
rejected
```

和：

```text
unavailable
```

`rejected`：

```text
无效 proof
过期
重放
错误 binding
错误 purpose
Turnstile success=false
```

不能 fail-open。

`unavailable`：

```text
Cloudflare Siteverify timeout
Cloudflare 5xx
provider 明确不可用
```

可以 fail-open。

程序 bug：

```text
unexpected exception
invariant broken
invalid internal config
```

不要一律 catch 成 unavailable。

该 die 就 die。

---

# 8. 对调用方暴露更高层的 `Captcha.guard()`

不建议让每个业务插件自己重复：

```text
issue
verify
fail-open
fresh challenge
```

由能力层统一。

例如：

```ts
export interface CaptchaProof {
  readonly provider: string
  readonly response: string
}

export type CaptchaGuardResult =
  | {
      readonly kind: 'passed'
      readonly via: 'verified' | 'bypassed'
    }
  | {
      readonly kind: 'required'
      readonly prompt: CaptchaPrompt
    }

export interface CaptchaPrompt {
  readonly provider: string
  readonly challenge: Record<string, unknown>
}
```

服务：

```ts
Captcha.guard({
  tenantId,
  purpose,
  bindingKey,
  proof?,
})
```

语义：

### 没 proof

provider 存在且成功 issue：

```text
required(prompt)
```

没有 provider：

```text
passed(via=bypassed)
+ Warning/Metric
```

provider issue 明确 unavailable：

```text
passed(via=bypassed)
+ Error/Metric
```

### 有 proof

provider code 不匹配当前 provider：

```text
重新 issue 当前 provider
→ required
```

proof verified：

```text
passed(via=verified)
```

proof rejected：

```text
重新 issue fresh challenge
→ required
```

provider verify unavailable：

```text
passed(via=bypassed)
```

这样所有调用插件共享同样的安全策略。

---

# 9. 不新增 CAPTCHA HTTP API

不要：

```text
GET /captcha/challenge
POST /captcha/verify
```

整个 challenge 生命周期嵌入已有业务请求。

Login：

```text
POST /auth/local/:providerCode/login
```

服务器判断需要 CAPTCHA 后：

```json
{
  "_tag": "CAPTCHA_REQUIRED",
  "provider": "altcha",
  "challenge": {}
}
```

浏览器解题后仍调用原 endpoint：

```json
{
  "email": "...",
  "password": "...",
  "captcha": {
    "provider": "altcha",
    "response": "..."
  }
}
```

这样 challenge 的签发天然建立在：

```text
真正的业务请求
+
真正的 limiter 决策
```

之上。

ALTCHA widget 本身支持直接传 challenge data，并不要求 challenge 必须来自一个独立 URL。

因此：

```text
frozen-routes.ts
```

本轮理论上无需增加 route。

---

# 10. CAPTCHA_REQUIRED 使用 428

新增公共 wire error：

```ts
export class CaptchaRequired extends Schema.TaggedError<CaptchaRequired>()(
  'CAPTCHA_REQUIRED',
  {
    provider: Schema.String,
    challenge: Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  },
  {
    httpApiStatus: 428,
    identifier: 'CaptchaRequired',
  },
) {}
```

这里明确采用：

```text
428 Precondition Required
```

作为 Qualy 的产品协议语义：

> 请求本身可以继续，但必须先满足 CAPTCHA 前置条件。

它与：

```text
429 Too Many Requests
```

必须完全区分。

428：

```text
现在完成 CAPTCHA 就能继续
```

429：

```text
当前必须等待 Retry-After
```

同步更新：

```text
tools/tests/error-codes.test.ts
错误翻译 catalog
OpenAPI parity
```

---

# 11. CAPTCHA proof 大小限制

公共请求：

```ts
captcha?: {
  provider: string
  response: string
}
```

`response` 不能无限大。

建议 generic cap：

```text
16 KiB
```

具体 provider 再做更严格限制。

Turnstile token 官方最大 2048 字符。

所以 Turnstile provider 收到：

```text
response.length > 2048
```

直接 `rejected`，不要向 Cloudflare请求。

---

# 12. Limiter 重新拆成 Hard Limit 与 Risk

不要给现有：

```ts
LimitRule
```

简单加：

```ts
challengeAt
```

因为以后很容易重新写成：

```text
identifier:
challengeAt = 5
limit = 30
```

然后重新出现账号级 hard lock。

类型上分开：

```ts
export interface HardLimitRule {
  readonly scope: string
  readonly limit: number
  readonly windowSeconds: number
}

export interface RiskRule {
  readonly scope: string

  /**
   * first N observations do not require a challenge;
   * the next request does.
   */
  readonly challengeAfter: number

  readonly windowSeconds: number
}
```

两个类型承担不同语义：

```text
HardLimitRule
→ 可能返回 429

RiskRule
→ 永远只回答“是否需要 CAPTCHA”
→ 永远不能直接返回 429
```

---

# 13. 底层继续复用 `auth_rate_limit_buckets`

不用再建 risk bucket 表。

现有：

```text
auth_rate_limit_buckets
tenant_id
scope
key_hash
window_started_at
attempts
updated_at
```

已经适合。

扩展 limiter API：

```ts
consumeHard(...)

consumeAllHard(...)

riskRequired(...)

observeRisk(...)

clearRisk(...)
```

其中：

### `consumeHard`

保持现有原子 upsert 语义：

```text
前 N 次允许
第 N+1 次 429
```

### `riskRequired`

只读取。

不能增加计数。

窗口过期：

```text
false
```

### `observeRisk`

增加一次 risk observation。

固定窗口过期则从 1 重新开始。

### `clearRisk`

删除当前 key bucket。

---

# 14. 地址键：IPv4 按 /32、IPv6 按 /64；不做 identifier + 网段

> 2026-09-25 修订（用户裁决 #14，上线前审查后）：原文「不要新增 IP parser」只针对 identifier + 网段的组合键，本节按裁决改写；「含 identifier 的 hard-limit key 一律禁止」不变。

整个「identifier + 网段」的设计仍然删除。

不要：

```text
identifier + /24
identifier + /64
```

原因是校园 NAT。

真实场景可能是：

```text
一栋楼
一个宿舍区
甚至全校

→ 共用一个或少量公网 IP
```

`email + /24` 的 hard limit 仍然允许同校园攻击者锁受害者账号。

所以登录里：

> **任何包含 identifier 的 hard-limit key 一律禁止。**

地址本身的键则要规范化：IPv6 一台机器通常拿到整个 /64，按完整地址计数，攻击者在 /64 内轮换地址就能绕过一切按地址的风险与熔断。因此：

```text
request address
→ auth network key（auth 内的 networkKeyOf）
   IPv4：单个地址（/32）
   IPv6：所在 /64
→ limiter
```

- 登录、找回、SSO flowStart 的按地址 hard fuse 与 risk rule 都用这个 network key。
- 规范化属于 auth / api-kit 的地址处理，captcha capability 不认识 IPv4、IPv6，只接受「是否需要挑战」这个结论。
- 下文仍写作 exact IP 的地方，一律读作 network key。

入口级风险规则（同一裁决）：

```text
同一登录入口范围内的无效凭据失败（查无此人、没有密码、密码不对）
在固定窗口内达到高阈值（300 次 / 10 分钟）
→ 本窗口剩余时间对该入口所有人要求验证码（只升级验证码，不直接拒绝）
→ 下一窗口重新开始
```

窗口是固定的：持续攻击不会把解除时间一直往后推，避免把正常用户长期困在验证码里（CAPTCHA DoS）。

---

# 15. IP 也不能再被当成“攻击者身份”

即使：

```text
exact IP
```

也可能是校园出口 NAT。

所以 IP hard limit 的定位必须从：

> 防撞库

改成：

> **极端资源保护熔断器。**

它不是认证安全边界。

因此应当同时存在：

```text
较低阈值的 IP risk
→ CAPTCHA

很高阈值的 exact-IP hard fuse
→ 429
```

这样校园 NAT 高峰：

```text
很多人共用 IP
→ 可能整体进入 silent CAPTCHA
→ 但不会很快整体 429
```

而攻击者：

```text
同一 IP 大量轮换邮箱
→ 很快进入 PoW
→ 之后每次 Argon2 前必须先付计算成本
```

这比只把 hard limit 从 30 调成 60 更合理。

---

# 16. Local login 最终 limiter

第一版建议定义：

```ts
signInByAddressRisk
signInByAddressHard
signInCredentialByIdentifierRisk
```

建议初始语义：

### A. exact-IP request risk

例如：

```text
前 20 次 / 5min
→ 正常

后续
→ CAPTCHA
```

这里只升级 CAPTCHA。

### B. exact-IP hard fuse

例如初始：

```text
300 / 5min
→ 之后 429
```

这是**资源熔断值，不是安全参数**。

最终数字必须结合：

```text
Argon2 benchmark
校园 NAT 预估峰值
实际 telemetry
```

再冻结。

不要把 300 当成密码学常数。

### C. identifier credential-failure risk

```text
5 次失败 / 15min
→ 下一次密码尝试需要 CAPTCHA
```

永远没有：

```text
identifier hard limit
```

---

# 17. 为什么 IP risk 很重要

如果校园 NAT 导致 hard threshold 必须非常宽：

```text
300 / 5min
```

而完全没有 IP challenge：

攻击者可以轮换：

```text
a@example.com
b@example.com
c@example.com
...
```

每个 identifier 都没达到 failure risk，却可以让 Qualy不断跑 timing Argon2。

因此 IP request risk：

```text
20 / 5min
→ ALTCHA
```

可以在不 hard-lock NAT 用户的情况下保护 Argon2。

共享出口上的正常用户最多承担一次静默 PoW。

这是比 `/24 hard limit` 更适合校园环境的模型。

---

# 18. `clientIp === undefined` 的处理

不要把：

```text
'unknown'
```

当作一个真实来源身份来理解。

但仍然必须防止地址解析失败后无限跑 Argon2。

建议：

```text
clientIp === undefined
→ 从第一笔开始视作 address risk elevated
→ 有 CAPTCHA provider 时要求 CAPTCHA
```

同时保留一个单独的高阈值全局 fallback hard bucket：

```text
sign-in:unknown-address
```

作为最后 CPU fuse。

并打：

```text
metric / warning
```

因为正常生产环境大量 `clientIp=undefined` 本身就说明：

```text
proxy 配置
forwarded chain
部署网络
```

存在异常。

不要静默把所有未知地址长期塞进普通 exact-IP 阈值里。

测试必须覆盖这一点。

---

# 19. SSO flowStart 的 NAT 问题也顺便处理

当前：

```text
flowStartByAddress
30 / 5min
```

对校园 NAT 同样偏低。

CAS / OIDC / GitHub 不需要 CAPTCHA，因为 Qualy 不验证它们的 credential。

但这个 IP limit 只是：

```text
防止无限写 AuthFlow
```

数据库操作远比 Argon2 便宜。

因此同批应重新提高这个资源 fuse，例如：

```text
300 / 5min
```

实际数字以 DB 容量为依据。

不要让：

```text
30 个校园用户 5 分钟内点统一认证
```

就把同一出口的第 31 个学生拦掉。

---

# 20. Login handler 最终顺序

当前 `packages/plugins/base/auth-local/src/index.ts` 的 handler 改成以下严格顺序。

### Step 1：resolve provider

保持：

```ts
sessions.resolveProvider(...)
```

### Step 2：normalize identifier

保持现有策略：

```ts
const email = normalizeEmail(payload.email)

const identifier = email ?? payload.email.trim().toLowerCase()
```

不存在账号与非法邮箱必须走相同 risk path。

### Step 3：consume exact-IP hard fuse

在任何用户查询与 Argon2 之前：

```text
consumeHard(signInByAddressHard)
```

超限：

```text
429 TOO_MANY_ATTEMPTS
```

### Step 4：计算 challenge requirement

两种 risk 取 OR：

```text
addressRisk
||
identifierCredentialRisk
```

其中：

```text
addressRisk
= 本次请求按 IP request risk 观察后的状态

identifierCredentialRisk
= 之前的 credential failures 是否已达到阈值
```

### Step 5：需要 challenge 时调用 Captcha.guard()

无 proof：

```text
issued
→ CAPTCHA_REQUIRED 428

no provider
→ fail-open

provider unavailable
→ fail-open
```

proof rejected：

```text
fresh CAPTCHA_REQUIRED
```

proof verified：

```text
继续
```

### Step 6：查用户 / binding

保持当前逻辑。

### Step 7：Argon2 / timing equalizer

保持当前 enumeration protection。

---

# 21. 什么算 credential failure

以下全部增加：

```text
signInCredentialByIdentifierRisk
```

### 用户不存在

```text
user-not-found
```

### 用户存在，但没有 managed password binding

```text
binding-not-found
```

### binding 存在但密码错

```text
invalid-credentials
```

三种路径必须一致。

原因是否则 CAPTCHA 状态本身就会泄漏：

```text
邮箱是否存在
```

---

# 22. 凭据正确以后什么时候清 risk

这个顺序必须写死：

```text
verifyPassword(...) === true
↓
clearCredentialFailures(identifier)
↓
completeLogin(...)
```

不能：

```text
completeLogin()
↓
如果 success 才 clear
```

因为：

```text
用户 disabled
用户类型 disabled
tenant disabled
```

时：

```text
密码本身仍然是正确的
```

`completeLogin()` 会因为 account state 返回 undefined，但这不是 credential attack。

因此：

> **clear risk 必须发生在 credential verified 之后、`completeLogin()` 之前。**

这条写测试固定。

---

# 23. CAPTCHA 不计作登录失败

发生：

```text
CAPTCHA_REQUIRED
```

时尚未判断密码。

所以不要：

```text
SignInEvent {
  outcome: failure,
  reason: captcha-required
}
```

这不是“登录失败”。

CAPTCHA 使用自己的 telemetry。

真正密码错误后，再沿用当前：

```text
SignInEvent
```

逻辑。

---

# 24. CAPTCHA proof 只保护一笔 credential attempt

绝不设计：

```text
captcha_pass cookie
```

也不要：

```text
CAPTCHA solved
→ 清 credential risk
```

正确流程：

```text
已有 5 次密码失败
↓
CAPTCHA
↓
允许跑一次 password verification
↓
密码又错
↓
proof 已消耗
risk 仍然 >= 5
↓
下一次重新 CAPTCHA
```

只有：

```text
password verified
```

才清 risk。

---

# 25. Password reset 与 login 是不同模型

Reset 不能直接套：

> identifier 永远不能 hard limit

因为这里限制的是：

```text
发送外部邮件
```

而不是：

```text
是否允许正确密码登录
```

攻击者持续 reset 会造成：

```text
邮件骚扰
SMTP reputation 损伤
发送额度消耗
```

因此 reset 可以保留：

```text
per-identifier mail quota
```

但必须放在 CAPTCHA gate 后。

---

# 26. Password reset 最终 limiter

建议分成：

```text
resetByAddressRisk
resetByAddressHard

resetByIdentifierRisk
resetMailByIdentifierHard
```

### identifier risk

第一笔 reset 正常。

之后：

```text
第 2 次起
→ CAPTCHA
```

即：

```text
challengeAfter = 1
```

### identifier mail hard quota

```text
3 次 / 1h
```

前三次允许真正进入 reset flow。

第 4 次：

```text
429
```

但这个 hard counter必须：

> **在 CAPTCHA 成功以后才消费。**

否则攻击者根本不用做 PoW：

```text
直接 POST 4 次
→ 把 victim quota 用完
```

那又失去 CAPTCHA 意义。

---

# 27. Reset 的严格执行顺序

请求：

```text
POST /auth/password-resets
```

顺序：

### 1. normalize email

无论存在不存在一致。

### 2. exact IP hard fuse

极端流量才 429。

### 3. address risk + identifier risk

判断 CAPTCHA。

### 4. CAPTCHA gate

如果需要：

```text
无 proof
→ 428

invalid proof
→ 428 fresh challenge

verified
→ 继续

provider unavailable
→ fail-open
```

### 5. consume `resetMailByIdentifierHard`

现在才计：

```text
邮箱过去一小时已经接受了几次 reset 请求
```

第 4 次：

```text
429
```

### 6. observe identifier reset risk

这一次已经通过 admission，计入下一次判断。

### 7. 才去查是否存在真实账号

无论：

```text
存在
不存在
未验证邮箱
没有 local password
```

前面的 limiter/CAPTCHA 路径必须完全一样。

这样继续保持 account enumeration resistance。

---

# 28. Password reset 链接 DoS 必须一起修

当前 `email-flows.ts`：

```ts
issueChallenge(...)
```

会先：

```ts
retireChallenges(tenantId, userId, [purpose])
```

这对：

```text
verify
change
```

合理。

但对：

```text
reset
```

存在 DoS：

```text
受害者收到 reset A

攻击者再点 reset

→ A 立即失效
```

攻击者可以不停请求，使用户手里的邮件永远过期。

最终改成：

```text
verify
→ 新 challenge 替换旧

change
→ 新 challenge 替换旧

reset
→ 不 retire 之前的 reset challenge
```

允许同一个用户存在少量并行有效 reset link。

---

# 29. Password reset 成功后统一作废其他链接

任意 reset link 真正成功修改密码后：

```text
retireChallenges(
  tenantId,
  userId,
  ['reset']
)
```

一次性消费所有剩余 reset link。

因为 `redeemReset()` 当前已经在 tenant lock 中执行，所以并发 redemption 会被序列化。

结果：

```text
A / B / C 都有效

A 先成功改密
↓
B / C 全失效
```

这样既避免匿名请求使旧邮件失效，又保证改密之后旧链接不会继续工作。

---

# 30. Reset 为什么允许 identifier 429

假设 attacker 已经为受害者触发三次 reset：

```text
邮件 A
邮件 B
邮件 C
```

由于新设计不再让后发 request 作废前面的链接：

```text
A/B/C 都有效
```

第 4 次被 429，并不会让受害者失去恢复能力。

反而能阻止：

```text
无限邮件轰炸
SMTP 信誉损害
```

所以这是与 login identifier hard lock 本质不同的一种 quota。

在代码和文档里要明确写出来，避免未来有人认为两者矛盾。

---

# 31. `Secrets` 不新增 ALTCHA 环境变量

不要：

```text
QUALY_CAPTCHA_ALTCHA_SECRET
```

现有部署已经有：

```text
QUALY_SECRETS_MASTER_KEY
```

应该从它域分离生成 ALTCHA 两把 HMAC secret。

但不要简单增加：

```ts
Secrets.deriveKey(info: string)
```

让调用方直接控制 HKDF info。

因为当前内部已经有：

```ts
FINGERPRINT_INFO = 'qualy/secrets/fingerprint/v1'
```

直接暴露任意 HKDF namespace 会破坏 Secrets 对 fingerprint key 的封装。

---

# 32. 给 Secrets 增加安全的 `deriveSecret(domain)`

推荐接口：

```ts
readonly deriveSecret: (
  domain: string
) => Effect.Effect<
  Redacted.Redacted<string>
>
```

内部固定自己的根域：

```text
qualy/secrets/derived/v1
```

例如先：

```ts
const DERIVED_SECRET_INFO = 'qualy/secrets/derived/v1'
```

得到：

```text
derivedSecretRoot
```

再：

```text
HMAC(
  derivedSecretRoot,
  domain
)
```

或者：

```text
HKDF(
  master,
  info =
    "qualy/secrets/derived/v1\0" + domain
)
```

关键是不允许调用者逃出：

```text
qualy/secrets/derived/v1
```

这个命名空间。

这样：

```text
fingerprint key
encryption key
derived secrets
```

三个域彼此独立。

返回：

```text
Redacted<string>
```

不要返回裸 `Buffer` 让日志更容易误打印。

---

# 33. ALTCHA 两把 HMAC secret

provider 启动时：

```ts
const challengeSecret = yield * secrets.deriveSecret('captcha/altcha/challenge/v1')

const keySecret = yield * secrets.deriveSecret('captcha/altcha/key/v1')
```

分别给：

```text
hmacSignatureSecret
hmacKeySignatureSecret
```

因此：

```text
不新增 env
不新增部署步骤
不新增 key rotation 系统
```

主密钥变化自然意味着所有旧 ALTCHA challenge 失效，这也是合理行为。

---

# 34. ALTCHA 使用 v2 API，不允许 v1

安装：

```text
altcha-lib
altcha
```

必须使用：

```ts
import { createChallenge, verifySolution } from 'altcha-lib'
```

禁止：

```ts
from 'altcha-lib/v1'
```

当前默认 import path 就是 v2；v1 被保留在专门的 `/v1` compatibility path。

---

# 35. ALTCHA v2 参数

当前 v2 的核心参数是：

```text
algorithm
cost
counter
keyPrefixLength
expiresAt
data
hmacSignatureSecret
hmacKeySignatureSecret
```

不是旧 v1：

```text
maxNumber
number
```

也不要在 Qualy config 里造：

```text
counterMin
counterMax
```

然后假装它们是 altcha-lib 的 v2 API。

官方当前 PBKDF2 推荐基线大致是：

```text
PBKDF2/SHA-256
cost 5000
deterministic counter 5000~10000
```

---

# 36. 第一版 ALTCHA 不急着暴露 manifest 调参

先不要在 `qualy.yml` 冻结一堆：

```text
cost
counter
workers
keyPrefixLength
...
```

第一版内部常量：

```ts
algorithm = 'PBKDF2/SHA-256'

cost = 5000

counter = 7500

ttl = 5 minutes

workers = 1
```

只是 benchmark 起点，不是最终性能裁决。

先写 benchmark，再决定哪些值值得成为 operator config。

---

# 37. PoW 的安全理解必须写进文档

不要描述成：

> 浏览器很难算，但脚本很难绕。

真实模型是对称的。

PBKDF2 本身就是标准计算：

```text
浏览器算一次
攻击脚本也算一次
```

PoW 提供的是：

> **每一次密码猜测必须支付可量化 CPU 时间。**

因此参数应该从目标反推：

```text
希望单核攻击者
每小时最多做多少次尝试？
```

再结合：

```text
普通手机
低端手机
桌面浏览器
```

决定 cost/counter。

不要追求：

```text
攻击者算不出来
```

只追求：

```text
规模化猜测变贵
正常真人偶尔一次仍可接受
```

---

# 38. ALTCHA challenge data

生成：

```ts
data: {
  version: 1,
  id: randomUUID(),
  tenantId,
  purpose,
  bindingHash,
}
```

这里没有：

```text
email
userId
password
IP
```

只有不可逆 binding hash。

同时：

```ts
expiresAt = new Date(Date.now() + 5 * 60_000)
```

ALTCHA v2 `verifySolution()` 会检查 challenge 签名、expiry 和 solution。

---

# 39. ALTCHA replay protection

自托管 ALTCHA 必须自己做 replay protection，官方也明确要求 custom integration 实现 challenge expiration、rate limiting 和 processed payload registry。

新增 provider-owned entity：

```text
CaptchaAltchaUsedChallenge
```

表：

```text
captcha_altcha_used_challenges
```

字段：

```text
id
tenant_id
challenge_id
expires_at
created_at
```

唯一约束：

```text
UNIQUE (tenant_id, challenge_id)
```

索引：

```text
expires_at
```

---

# 40. ALTCHA 验证严格顺序

收到 opaque response 后：

```text
1. parse
2. verifySolution()
3. 检查 verified=true
4. 读取 signed data
5. version === 1
6. tenantId === expected tenant
7. purpose === expected purpose
8. bindingHash === expected binding
9. 原子 INSERT replay row
```

只有第 9 步成功才：

```text
verified
```

unique conflict：

```text
rejected
```

不要：

```text
SELECT used
↓
INSERT used
```

避免 TOCTOU。

两个并发请求用同一 proof：

```text
恰好一个成功
```

---

# 41. Replay row cleanup

challenge TTL 5 分钟。

replay row 可以保留稍长，例如：

```text
1 hour
```

然后按当前 limiter 的顺带 sweep 模式：

```text
每 N 次操作
清一个小 batch
```

不要为这件事引入后台队列或 Redis。

---

# 42. ALTCHA 浏览器侧必须自动开始

用户不应该看到：

```text
□ 我不是机器人
```

PoW 本来就是 silent challenge。

ALTCHA widget 支持：

```text
auto="onload"
```

以及 invisible/floating 等展示模式。

最终 UX：

```text
服务器返回 CAPTCHA_REQUIRED
↓
组件出现
↓
自动开始 PoW
↓
显示一行轻量状态：
“正在进行安全验证…”
↓
完成
↓
自动重新提交原请求
```

没有额外点击。

---

# 43. ALTCHA 严格 CSP

当前 Qualy CSP 已经：

```text
worker-src 'self'
```

不要为了 ALTCHA 加：

```text
worker-src blob:
```

默认 ALTCHA bundle 内嵌 worker，严格 CSP 下可能需要 `blob:`；官方专门提供：

```text
altcha/external
```

把 worker 独立出来，并允许显式注册 PBKDF2 worker。

因此使用：

```ts
await import('altcha/external')

import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker'
```

真实实现时保证 worker 最终是：

```text
same-origin staged asset
```

这样现有：

```text
worker-src 'self'
```

即可。

ALTCHA provider 不应该向 `ShellPolicy` 新增任何外站域名。

---

# 44. ALTCHA 必须 lazy load

以下不能进入登录首屏：

```text
altcha widget
PBKDF2 worker
```

provider `client/register.ts` 只能轻量注册 driver。

真正收到：

```text
CAPTCHA_REQUIRED(provider=altcha)
```

以后才动态加载。

加 bundle test 防止以后有人：

```ts
import 'altcha'
```

写进 register 顶层。

---

# 45. 浏览器 provider 不必注册 React Component

建议比上一版再干净一点。

`@qualy/plugin-captcha/client` 定义：

```ts
export interface BrowserCaptchaProvider {
  readonly code: string

  readonly mount: (input: {
    container: HTMLElement
    challenge: Record<string, unknown>
    onSolved: (response: string) => void
    onError: (error: unknown) => void
  }) => Promise<() => void>
}
```

provider：

```text
altcha
turnstile
```

都以 imperative browser driver 注册。

通用 React：

```tsx
<CaptchaChallenge />
```

只负责：

```text
创建 container
按 provider 找 driver
mount
unmount 时 dispose
```

这样 capability 不需要维护“插件 React component registry”。

这和 RUM / Storage 浏览器 driver 模式更接近。

---

# 46. ALTCHA browser response

不要自己重构 ALTCHA proof。

provider 应把 widget 生成的 opaque payload：

```text
原样
```

交给：

```ts
onSolved(response)
```

服务器交给 `verifySolution()`。

不要让 browser provider理解：

```text
counter
salt
keyPrefix
signature
```

这些属于 ALTCHA 协议。

---

# 47. 邮箱变化必须取消当前 CAPTCHA

Login：

```text
CAPTCHA_REQUIRED
↓
ALTCHA 正在算
↓
用户把 email 改了
```

原 proof 已绑定旧 email 的 bindingHash。

因此：

```ts
onEmailChange:
  setCaptchaPrompt(null)
  unmount/abort current provider
```

Reset page 同样。

不要等服务器：

```text
binding mismatch
```

后再浪费一次请求。

密码变化不需要自动取消，因为 binding 不包含密码。

---

# 48. Turnstile provider

Turnstile 作为第二实现：

```text
@qualy/plugin-captcha-turnstile
```

默认 disabled。

配置：

```text
QUALY_CAPTCHA_TURNSTILE_SITE_KEY
QUALY_CAPTCHA_TURNSTILE_SECRET_KEY
```

其中：

```text
site key
→ public

secret key
→ server only
```

不从 Qualy master secret 派生第三方 credential。

Cloudflare secret 应保持独立可轮换。

---

# 49. Turnstile challenge payload

provider issue：

```json
{
  "siteKey": "...",
  "action": "...",
  "cData": "..."
}
```

其中：

```text
cData = bindingHash
```

64 hex：

```text
只含 [0-9a-f]
长度 64
```

满足 Turnstile cData 最多 255 且只能用字母数字、`_`、`-` 的要求。

---

# 50. Turnstile purpose → action 映射

Turnstile `action`：

```text
最多 32 字符
只能 A-Z a-z 0-9 _ -
```

通用 `CaptchaPurpose`：

```text
assessment/something-very-long
```

不能直接使用。

映射函数：

```ts
const plain = purpose.replaceAll('/', '_')

if (plain.length <= 32 && /^[A-Za-z0-9_-]+$/.test(plain)) {
  return plain
}

return `q_${sha256(purpose).slice(0, 30)}`
```

由于通用 purpose grammar 本身不允许 `_`：

```text
/ → _
```

在短字符串范围内不会因为原字符串已有 `_` 发生碰撞。

超长 purpose 使用 hash，不要简单截断。

测试：

```text
31
32
33
超长
不同 purpose
稳定映射
```

---

# 51. Turnstile server verification

调用官方：

```text
POST
https://challenges.cloudflare.com/turnstile/v0/siteverify
```

发送：

```text
secret
response
remoteip（有则发送）
```

Siteverify 是 mandatory，token 5 分钟有效且 single-use。

必须检查：

```text
success === true

hostname
== 当前 publicHost 规范化后的 hostname

action
== actionOfPurpose(expectedPurpose)

cdata
== expected bindingHash
```

不能只看：

```text
success
```

---

# 52. Turnstile client

使用 explicit rendering。

只有收到：

```text
CAPTCHA_REQUIRED
```

后才 lazy load：

```text
https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
```

保持 module-level loading Promise：

```text
整个页面最多加载一次 script
```

unmount：

```text
turnstile.remove(widgetId)
```

success callback：

```text
onSolved(token)
```

---

# 53. Turnstile CSP

provider 自己注册：

```text
script-src
  https://challenges.cloudflare.com

frame-src
  https://challenges.cloudflare.com
```

Cloudflare 官方要求的核心 CSP 就是这两个来源。

不要写进：

```text
auth
plugin-web
全局固定 CSP
```

Turnstile disabled：

```text
CSP 不出现 Cloudflare
```

---

# 54. 一个重要的 fail-open 边界：浏览器 CDN 故障无法安全 fail-open

这里要比前面的讨论更严谨。

服务器可以可靠判断：

```text
Siteverify timeout
Cloudflare 5xx
```

所以这些可以：

```text
server-side unavailable
→ fail-open
```

但是浏览器如果：

```text
challenges.cloudflare.com 加载失败
```

服务器无法区分：

```text
真人确实加载失败
```

和：

```text
攻击者故意不加载，然后声称失败
```

所以不能允许浏览器发：

```json
{
  "captchaUnavailable": true
}
```

然后服务器信任并绕过。

否则攻击者自己写这个字段就绕过 CAPTCHA。

因此：

> **Turnstile 无法保证客户端侧完整 fail-open。**

浏览器 widget 加载失败：

```text
显示“安全验证暂时无法加载”
允许重试
```

不能自动绕过。

如果服务器本身已经因为 Siteverify 故障进入 provider unavailable 状态，则下一次业务请求可以 server-side fail-open。

这也是：

```text
ALTCHA 默认
Turnstile 只作为海外选项
```

的重要理由。

---

# 55. Turnstile unavailable 分类

以下属于：

```text
CaptchaUnavailable
```

可以 server-side fail-open：

```text
connect timeout
DNS/server network failure
Cloudflare 5xx
```

以下属于：

```text
CaptchaRejected
```

不能 fail-open：

```text
invalid token
expired
timeout-or-duplicate
binding mismatch
action mismatch
hostname mismatch
```

如果 Cloudflare返回配置级错误：

```text
invalid secret
invalid site key
```

记录高等级 Error / metric，然后按 provider unavailable 处理。

不能把认证整体打挂，但必须非常容易被运维发现。

---

# 56. 0 provider 的语义

允许：

```text
@qualy/plugin-captcha
active
provider = none
```

但是启动必须明确：

```text
WARN
captcha protection has no provider;
risk-triggered challenges will be bypassed
```

不能静默。

Auth：

```text
risk elevated
↓
Captcha.guard
↓
no provider
↓
passed(bypassed)
↓
继续 password
```

这样系统仍然工作，但安全降级是可见的。

---

# 57. LocalLoginMethod React 改造

当前：

```text
packages/plugins/base/auth-local/
src/client/LoginMethod.tsx
```

增加：

```ts
const [captchaPrompt, setCaptchaPrompt] = useState<CaptchaPrompt | null>(null)
```

登录 mutation payload：

```ts
{
  email,
  password,
  ...(captchaProof
    ? { captcha: captchaProof }
    : {})
}
```

捕获：

### `INVALID_CREDENTIALS`

保持现状：

```text
shake
1s pause
错误文案
```

### `TOO_MANY_ATTEMPTS`

保持现状：

```text
hold
Retry-After countdown
```

### `CAPTCHA_REQUIRED`

```text
不要 hold()
不要显示普通错误

setCaptchaPrompt(...)
busy=false / challenge mode
```

渲染：

```tsx
<CaptchaChallenge prompt={captchaPrompt} onSolved={(response) => retryLogin(response)} />
```

solved：

```text
自动重试 login
```

用户不需要再点击一次登录。

---

# 58. CAPTCHA solving 时 UI

ALTCHA：

```text
按钮禁用
显示：
“正在进行安全验证…”
```

验证完：

```text
自动提交
```

Turnstile：

如果无交互：

```text
同样自动继续
```

如果 Cloudflare需要交互：

```text
显示 widget
```

输入 email：

```text
onChange
→ 清 captchaPrompt
→ provider unmount
→ 恢复普通提交
```

---

# 59. `hold.ts` 不修改

当前：

```text
PAUSE_MS
Retry-After countdown
```

继续只处理：

```text
普通 credentials refusal
429
```

`CAPTCHA_REQUIRED`：

```text
不进入 hold
```

---

# 60. ResetPasswordPage React 改造

当前 `Ask()` mutation：

```ts
createPasswordReset({
  payload: { email },
})
```

扩展 CAPTCHA。

onError：

```ts
if CaptchaRequired:
  setCaptchaPrompt(...)
  return

const retry = retryAfterOf(error)

if retry:
  hold(...)
else:
  normal error
```

ALTCHA完成：

```text
自动重新 mutate
```

邮箱发生变化：

```text
clear captcha prompt
```

成功：

```text
继续现在 generic：
“如果该邮箱已完成验证……”
```

绝不能因 CAPTCHA path 泄露邮箱是否存在。

---

# 61. CAPTCHA contract 不知道 Auth

公共错误和 proof shape 应放在 CAPTCHA capability 的公开叶子，例如：

```text
@qualy/plugin-captcha/contract
@qualy/plugin-captcha/plugin
@qualy/plugin-captcha/server
@qualy/plugin-captcha/client
```

`plugin-captcha` 不 import：

```text
auth
assessment
directory
```

反过来：

```text
auth
assessment
```

通过 capability facade 使用 CAPTCHA。

符合当前 plugin-isolation 纪律。

---

# 62. 插件依赖建议

`@qualy/plugin-captcha`：

```text
dependsOn:
  @qualy/plugin-secrets
```

因为 owner 负责：

```text
bindingHash
```

ALTCHA：

```text
dependsOn:
  @qualy/plugin-captcha
  @qualy/plugin-database
  @qualy/plugin-secrets
```

因为它拥有：

```text
replay table
derived HMAC secret
```

Turnstile：

```text
dependsOn:
  @qualy/plugin-captcha
```

并像 `rum-tencent` 一样在 layer 中读取：

```text
ShellPolicy
```

Auth：

```text
dependsOn:
  @qualy/plugin-captcha
```

`plugin-captcha` 本身永远可以 0 provider，所以这不意味着 deployment 必须安装某个具体 CAPTCHA 实现。

---

# 63. Telemetry

新增低基数 metric：

```text
qualy.captcha.guard
```

outcome：

```text
required
verified
rejected
bypass_no_provider
bypass_unavailable
```

purpose 最好规范成拥有者或有限枚举？

由于未来 purpose 可开放，直接把任意：

```text
assessment/foo
```

作为 metric label 会存在 cardinality 风险。

因此第一版 metric：

```text
provider
outcome
```

或者只记录：

```text
purposeOwner
```

例如：

```text
auth
assessment
```

不要直接用完整 arbitrary purpose 当 metric label。

日志里也绝不能记录：

```text
email
bindingKey
proof
Turnstile token
ALTCHA payload
password
```

---

# 64. 本轮不需要 Redis

仍然坚持：

```text
auth_rate_limit_buckets
→ PostgreSQL

ALTCHA replay
→ PostgreSQL
```

不引入：

```text
Redis
BullMQ
```

这两个工作量和规模都不足以支撑新的基础设施依赖。

---

# 65. 必须新增的测试：limiter

测试语义而不是只测函数返回值。

### login identifier

```text
连续 5 次 credential failure
→ 第 6 次 requires challenge

再多失败
→ identifier 永远不会返回 hard 429
```

这是核心不变量。

### address risk

```text
前 N 次
→ no challenge

N+1
→ challenge
```

### address hard fuse

```text
前 limit 次允许
limit+1
→ 429
```

### 成功登录

```text
credential verified
→ identifier risk 清除
```

### disabled account

```text
password correct
completeLogin refuses disabled user
→ identifier risk 仍被清除
```

---

# 66. 必须新增：校园 NAT 回归测试

明确模拟：

```text
同一个 clientIp
多个不同用户
```

大量合法账号请求不能因为：

```text
victim@example.com
```

的风险状态而让：

```text
other@example.com
```

变成账号级 429。

同 IP 高流量达到 challenge threshold：

```text
→ CAPTCHA
```

而不是立刻：

```text
→ account lock
```

这条测试就是为了防未来再次引入：

```text
identifier + IP hard bucket
```

---

# 67. `clientIp=undefined` 测试

必须覆盖：

```text
currentRequestContext.clientIp = undefined
```

预期：

```text
challenge elevated
```

而不是正常无限进入 Argon2。

fallback resource fuse 生效。

同时打 metric/log。

---

# 68. Auth enumeration tests

针对：

```text
真实邮箱
不存在邮箱
真实邮箱但没 password binding
```

建立同样的失败序列。

必须得到相同：

```text
401
401
...
428 CAPTCHA_REQUIRED
```

节奏。

不能：

```text
存在邮箱第 6 次 428
不存在邮箱始终 401
```

---

# 69. ALTCHA tests

必须覆盖：

```text
有效 solution
→ verified

过期
→ rejected

challenge signature 改动
→ rejected

bindingHash 改动
→ rejected

purpose 改动
→ rejected

tenantId 改动
→ rejected

proof replay
→ rejected

并发 replay
→ exactly one succeeds
```

以及：

```text
hmacSignatureSecret
!=
hmacKeySignatureSecret
```

---

# 70. Secrets deriveSecret tests

新增专门测试：

```text
同 master + 同 domain
→ stable

不同 domain
→ 不同

deriveSecret
!= fingerprint of same literal

生产 master key 变化
→ derived secret 变化
```

最重要的是确保 external caller 无法通过：

```text
deriveSecret("qualy/secrets/fingerprint/v1")
```

得到当前内部 fingerprint key。

因为公开 API 自带：

```text
qualy/secrets/derived/v1
```

前缀。

---

# 71. Password reset tests

必须覆盖：

```text
第一次 reset
→ no CAPTCHA

第二次
→ CAPTCHA_REQUIRED

无效 proof
→ fresh CAPTCHA_REQUIRED

正确 proof
→ 请求接受

第四个 accepted reset / hour
→ 429
```

不存在邮箱与真实邮箱的外部行为仍一致。

---

# 72. Reset link DoS tests

生成：

```text
reset A
reset B
reset C
```

验证：

```text
A 仍有效
B 仍有效
C 仍有效
```

A 真正改密：

```text
B 失效
C 失效
```

另外：

```text
change email
```

仍然应作废旧 reset links，因为它们发往旧地址。

---

# 73. Turnstile tests

不要让 CI 真请求公网。

server provider 提供可注入 fetch/transport。

测试：

```text
success
failure
timeout
5xx
token replay
binding mismatch
action mismatch
hostname mismatch
```

官方测试 key 可以用于 browser/manual smoke，但普通单测不要依赖 Cloudflare 网络。

Token single-use 和 5 分钟 TTL 是 Cloudflare明确保证的协议行为。

---

# 74. Turnstile action mapping tests

特别测试：

```text
auth/login
→ auth_login

31 chars
32 chars
33 chars
very long purpose
```

超长：

```text
hash mapping
```

不同长 purpose 不能简单因为前 32 字符相同而碰撞。

---

# 75. Browser lifecycle tests

ALTCHA：

```text
未 challenge
→ 不加载 altcha chunk
→ 不创建 worker

challenge
→ lazy load

email changed
→ dispose worker

unmount
→ 不允许旧 onSolved 回调重新提交
```

Turnstile：

```text
未 challenge
→ 不请求 challenges.cloudflare.com

challenge
→ load once

unmount
→ remove widget
```

---

# 76. CSP tests

默认 ALTCHA：

```text
worker-src 'self'
```

保持不变。

不得出现：

```text
blob:
```

Turnstile disabled：

```text
CSP 不含 challenges.cloudflare.com
```

Turnstile enabled：

```text
script-src 有 Cloudflare
frame-src 有 Cloudflare
```

---

# 77. Assembly tests

```text
captcha owner + no provider
→ boot succeeds
→ warning

captcha + altcha
→ success

captcha + turnstile
→ success

captcha + altcha + turnstile
→ assembly failure
→ error 点名双方
```

以及：

```text
provider declaration
但 runtime 没 register
→ barrier failure
```

完全照 RUM 的测试风格。

---

# 78. 仓库治理文件同步

实现过程中不要漏：

```text
root package.json
pnpm-lock.yaml

qualy.yml
qualy.lock.json

provider package exports

DB entities
migration

entity parity tests

tools/tests/error-codes.test.ts

catalogs / i18n

plugin-isolation allowlist
（只在确实新增合法 public edge 时加）

.env.example
deploy/.env.example

docs
```

由于没有新 endpoint：

```text
frozen-routes.ts
```

路径集合不应改变。

但 API schema / OpenAPI aggregate 会因为：

```text
captcha payload
CaptchaRequired error
```

发生变化，所有 parity 门禁必须通过。

---

# 79. 文档

新增：

```text
docs/captcha.md
```

说明：

### CAPTCHA 的定位

```text
不是 authentication factor
不是 account lock
不是 bot identity oracle

是 risk-triggered admission cost
```

### Provider

```text
ALTCHA
→ default
→ local PoW

Turnstile
→ optional
→ not for Mainland China
```

### 安全不变量

明确写：

```text
1. login identifier risk 绝不能直接产生 hard denial。

2. exact IP hard limit 只是资源熔断，
   IP 不等于用户。

3. reset email quota 是外部副作用限额，
   与 login lockout 不是同一语义。

4. CAPTCHA proof 一次只允许一个业务尝试。

5. provider server-side unavailable 时
   附加保护 fail-open，
   resource fuse 继续工作。

6. client-side third-party CAPTCHA
   无法安全依赖“客户端自报不可用”实现 fail-open。
```

更新：

```text
docs/notes/auth-security.md
```

把现在：

```text
sign-in email 10 / 15min → 429
```

的旧描述彻底删除。

---

# 80. 推荐开发阶段

建议 Claude Code 不要一把完成。

## Phase A — Secrets + limiter primitives

完成：

```text
Secrets.deriveSecret()

HardLimitRule
RiskRule

consumeHard
riskRequired
observeRisk
clearRisk
```

补单测。

暂时不改 UI。

---

## Phase B — NAT-safe auth risk model

修改：

```text
sign-in.ts
LoginSessions contract
auth-local handler
```

实现：

```text
address risk
address hard fuse
identifier credential risk
success clear
```

此时没有 CAPTCHA provider 时：

```text
risk 被检测
但 challenge 暂时 bypass
```

确保现有登录仍可工作。

---

## Phase C — `plugin-captcha`

建立：

```text
provider extension
owner
registry
barrier
Captcha service
Captcha.guard
contract
browser registry
CaptchaChallenge
428 error
```

0 provider warning。

---

## Phase D — ALTCHA

实现：

```text
altcha-lib v2
derived secrets
signed data
PBKDF2
replay table
sweep
external worker
lazy browser driver
auto=onload
```

然后真正启用默认：

```text
captcha-altcha
```

---

## Phase E — auth-local UI

接：

```text
CAPTCHA_REQUIRED
auto solve
auto retry
email change cancellation
```

`hold.ts` 保持不动。

---

## Phase F — password reset

实现：

```text
reset CAPTCHA
reset identifier risk
reset mail hard quota
```

同时修：

```text
reset challenge 不 supersede 旧 challenge
successful reset retire all
```

---

## Phase G — Turnstile

最后加：

```text
lazy explicit renderer
action mapping
cData binding
Siteverify
hostname verification
remoteip
CSP
server-side fail-open
```

这样第三方服务接入不会阻塞本轮最重要的认证模型修复。

---

# 81. 最终 Login 状态机

最终应当是：

```text
POST local login
       │
       ▼
exact-IP hard fuse
       │
       ├──────── exceeded ───────→ 429
       │
       ▼
observe exact-IP request risk
       │
       ▼
read identifier credential risk
       │
       ▼
challenge required?
       │
       ├─ no ──────────────────────────┐
       │                               │
       └─ yes                          │
            │                          │
            ▼                          │
       Captcha.guard                   │
            │                          │
     ┌──────┼───────────┐              │
     │      │           │              │
 required verified   unavailable       │
     │      │           │              │
    428     └─────┬─────┘              │
                  │                    │
                  └────────────────────┘
                           │
                           ▼
                       find user
                           │
                       find binding
                           │
                           ▼
                        Argon2
                    ┌──────┴──────┐
                    │             │
                  wrong         correct
                    │             │
                    ▼             ▼
           observe identifier   clear risk
             credential risk       │
                    │              ▼
                    │        completeLogin()
                    │          ┌─────┴─────┐
                    ▼          │           │
           INVALID_CREDENTIALS session   unusable
                                         account
```

注意最后：

```text
correct password
→ clear risk
→ completeLogin
```

即使最终：

```text
account disabled
```

也不重新把它当 credential failure。

---

# 82. 最终 Password Reset 状态机

```text
POST password reset
       │
       ▼
exact-IP hard fuse
       │
       ├── exceeded ──────────→ 429
       │
       ▼
address/request risk
+
identifier reset risk
       │
       ▼
challenge required?
       │
       ├─ yes → CAPTCHA
       │          │
       │          ├─ required → 428
       │          ├─ rejected → fresh 428
       │          └─ verified/unavailable → continue
       │
       ▼
resetMailByIdentifierHard
       │
       ├─ 4th accepted / hour
       │        → 429
       │
       ▼
observe reset risk
       │
       ▼
generic account lookup
       │
       ├─ no usable account
       │       → generic success
       │
       └─ usable account
               │
          create reset link
          WITHOUT retiring old reset links
               │
             mail
```

---

# 83. 最终要删除的旧设计

Claude Code 在实现时，不要保留这些“暂时兼容”：

```text
signInByIdentifier hard 429

identifier + /24
identifier + /64

sourceNetwork parser（地址规范化只保留 auth 的 networkKeyOf：IPv4 /32、IPv6 /64，见 §14 修订；不做 identifier + 网段）

CaptchaPurpose union

Captcha purpose registry

QUALY_CAPTCHA_ALTCHA_SECRET

ALTCHA v1 maxNumber

counterMin/counterMax manifest config

CAPTCHA pass cookie

CAPTCHA success clear credential risk

reset request supersedes old reset link

Turnstile as Mainland default
```

这些已经全部被本轮设计取代。

---

# 84. 本轮明确不做

仍然不做：

```text
Redis
BullMQ

阿里云 CAPTCHA
腾讯云 CAPTCHA

ALTCHA Sentinel
ALTCHA Cloud

多 provider fallback chain

admin CAPTCHA settings UI

device fingerprint

IP reputation

GeoIP

MFA
WebAuthn

CAS CAPTCHA
OIDC CAPTCHA
GitHub CAPTCHA

Argon2id PoW
Scrypt PoW
```

ALTCHA 第一版只做：

```text
PBKDF2/SHA-256
```

先把模型做正确，再根据 benchmark 决定是否需要更重的 PoW。

---

我不建议把三种方式硬选一个，而是把它设计成“同一个 CAPTCHA gate，有不同表现形态”。默认策略我会定为：

**ALTCHA：方案 1 为主；需要交互的 provider：方案 2；方案 3 只作为特定场景的容器策略，不作为 CAPTCHA 的默认产品形态。**

也就是说，不应该让 `plugin-captcha` 规定“验证码永远是 Modal”或者“永远是表单项”。它真正应该抽象的是：

> 业务动作被 challenge 暂停 → provider 开始验证 → 必要时展示交互 → proof 就绪 → 原动作自动继续。

### 对 ALTCHA，我最喜欢你的方案 1

用户第一次按：

```text
登录
```

服务端返回 `CAPTCHA_REQUIRED` 后，按钮直接变成：

```text
◌ 正在进行安全验证…
```

ALTCHA 自动开始 PoW。

完成以后无需用户再按：

```text
正在进行安全验证…
↓
正在登录…
↓
登录成功
```

整个过程中表单结构不动。

这最符合 ALTCHA 的性质。它本来就是静默的计算挑战，如果突然展开一个：

```text
安全验证
[ ALTCHA 窄条 ]
```

实际上只是为了告诉用户“这里有个验证码”，却没有需要用户完成的交互，UI 反而多了一层噪音。

所以 ALTCHA 不应该因为技术上有 widget，就强行把 widget 视觉化。

对于登录页，我会做成大致这样的状态机：

```text
登录
↓
正在进行安全验证…
↓
正在登录…
```

如果 PoW 花了两三秒，按钮就是很自然的进度反馈。

同时给屏幕阅读器一个 `aria-live="polite"` 状态：

```text
正在进行安全验证
```

不需要单独的视觉卡片。

---

### Turnstile 更适合方案 2

Turnstile 的 Managed 模式有可能无感通过，也有可能真的要求用户点选/交互。

因此收到 challenge 后可以先：

```text
登录按钮
↓
正在进行安全验证…
```

如果 Cloudflare直接无感通过：

```text
用户完全看不到额外 UI
↓
自动继续
```

如果 provider 告诉我们：

> 现在需要呈现交互界面

那么在表单末尾、提交按钮之前展开一块 challenge region：

```text
邮箱
[____________]

密码
[____________]

┌─────────────────────┐
│   Turnstile widget   │
└─────────────────────┘

[        登录        ]
```

这里我赞成你说的：

> “只在需要验证码时展开出现”。

而不是登录页一开始就预留一个大空洞。

出现时可以：

```text
height: 0
opacity: 0

→

height: auto
opacity: 1
```

200ms 左右，和你现在 Qualy 表单错误提示、找回密码页面的展开动画保持同一套语言。

这也是我认为最通用的视觉默认值。

---

### Modal 我不建议作为默认 CAPTCHA 容器

主要有几个问题。

登录场景中：

```text
输密码
→ 点击登录
→ 突然 Modal
→ 完成
→ Modal 消失
→ 回到登录页
```

比直接在原表单里完成多了一层上下文切换。

移动端尤其麻烦：

```text
键盘
focus
dialog focus trap
iframe
dialog close
重新恢复原表单焦点
```

而且如果用户：

```text
CAPTCHA 成功
→ 密码还是错
→ 再输一次
→ 又弹 Modal
```

会非常烦。

所以我不会规定：

```text
CAPTCHA_REQUIRED
= openDialog()
```

但是 Modal 应该作为**通用能力支持的一种 host presentation**。

因为未来 Assessment 很可能有这种动作：

```text
点击“提交申报”
↓
服务器发现需要 CAPTCHA
```

这时页面可能根本不存在一个适合插 CAPTCHA 的表单尾部：

```text
复杂工作台
右侧浮动提交按钮
底部 sticky action bar
```

这种地方弹一个：

```text
完成安全验证
```

Modal 就可能比硬塞到页面某处合理。

所以：

> Modal 是调用场景选择的布局方式，不是 CAPTCHA provider 自己的固有属性。

---

## 我建议把“验证码类型”和“放在哪里”彻底拆开

不要这样：

```ts
provider === 'altcha' ? button : modal
```

也不要：

```ts
CaptchaPrompt {
  display: 'modal'
}
```

服务器不应该决定 UI 布局。

应该分成两层。

Provider 只描述自己当前的**交互状态**：

```ts
type CaptchaInteractionState = 'working' | 'interaction-required' | 'solved' | 'failed'
```

业务 UI 决定 challenge **摆在哪里**。

例如：

```ts
type CaptchaPlacement = 'inline' | 'modal'
```

而 `working` 状态根本不需要 placement：

```text
working
→ caller 通常只改变提交按钮状态
```

这就是关键。

---

# 通用 browser provider contract 我会重新设计一下

之前的：

```ts
mount({
  container,
  challenge,
  onSolved,
})
```

还不够，因为通用层不知道：

> provider 是在后台算，还是已经需要用户交互。

建议变成：

```ts
export type CaptchaClientState =
  | { readonly kind: 'working' }
  | { readonly kind: 'interaction-required' }
  | { readonly kind: 'solved'; readonly response: string }
  | { readonly kind: 'failed' }

export interface BrowserCaptchaProvider {
  readonly code: string

  readonly start: (input: {
    readonly container: HTMLElement
    readonly challenge: Record<string, unknown>
    readonly onStateChange: (state: CaptchaClientState) => void
  }) => Promise<{
    readonly dispose: () => void
  }>
}
```

ALTCHA：

```text
start
↓
working
↓
solved
```

正常情况下永远没有：

```text
interaction-required
```

所以 container 虽然存在，却始终：

```text
height: 0
overflow: hidden
```

用户只看到按钮 spinner。

Turnstile：

```text
start
↓
working
```

如果无感通过：

```text
solved
```

如果需要 widget：

```text
interaction-required
↓
用户完成
↓
solved
```

这时通用 host 才展开容器。

---

# 再提供一个通用 `CaptchaGate`

业务插件不应该自己维护这些 provider 状态。

`@qualy/plugin-captcha/client` 提供：

```ts
const captcha = useCaptchaGate({
  prompt,
  placement: 'inline',
  onSolved,
})
```

返回类似：

```ts
{
  state:
    | 'idle'
    | 'working'
    | 'interaction'
    | 'failed',

  containerRef,
  cancel,
}
```

于是登录页：

```tsx
<form>
  <EmailField />
  <PasswordField />

  <CaptchaInlineRegion state={captcha.state} ref={captcha.containerRef} />

  <SubmitButton>
    {captcha.state === 'working' ? '正在进行安全验证…' : loginPending ? '正在登录…' : '登录'}
  </SubmitButton>
</form>
```

`CaptchaInlineRegion`：

```text
idle / working
→ height 0

interaction
→ 展开
→ provider widget 可见
```

所以一个组件同时自然支持：

```text
ALTCHA
Turnstile silent
Turnstile interactive
未来其他验证码
```

业务代码完全不判断 provider。

---

# Modal 也复用同一个 gate

Assessment 将来可以：

```ts
const captcha = useCaptchaGate({
  prompt,
  placement: 'modal',
  onSolved,
})
```

逻辑仍然一样：

```text
working
→ 提交按钮显示“正在进行安全验证…”

interaction-required
→ 打开通用 CaptchaDialog

solved
→ 自动关闭
→ 继续原动作
```

注意：

**即使 placement='modal'，ALTCHA 的 `working` 也不应该弹 Modal。**

因为没有任何东西需要用户操作。

Modal 只在：

```text
interaction-required
```

时打开。

这可以避免出现很荒唐的体验：

```text
[完成安全验证]
正在计算……
```

然后两秒钟自己消失。

---

# 所以 placement 应该属于调用方，不属于 provider

例如 Auth：

```ts
useCaptchaGate({
  placement: 'inline',
})
```

Assessment 的某个复杂确认动作：

```ts
useCaptchaGate({
  placement: 'modal',
})
```

一个普通报名表：

```ts
useCaptchaGate({
  placement: 'inline',
})
```

provider 完全不关心。

这对于你要求的可拓展性很重要。

否则未来如果写：

```text
Geetest → modal
ALTCHA → button
Turnstile → inline
```

等于 provider 在决定 Qualy 页面布局，架构马上就脏了。

---

# 我甚至不会把“button”当作 placement

这点也值得明确。

你提的三个选项从 UI 上看是：

1. button；
2. inline；
3. modal。

但从组件架构看其实应该只有：

```text
inline
modal
```

因为：

> “按钮 spinner”不是 CAPTCHA 容器，而是业务动作的 pending 状态。

例如：

```text
ALTCHA working
```

登录按钮显示：

```text
正在进行安全验证…
```

Assessment 提交按钮显示：

```text
正在进行安全验证…
```

导入按钮显示：

```text
正在进行安全验证…
```

这属于调用动作自己的状态表达。

CAPTCHA capability 只告诉它：

```text
state === working
```

不应该去渲染一个：

```tsx
<CaptchaSubmitButton />
```

否则 captcha 插件就会开始控制业务按钮。

---

# 状态建议完整定义成这几个

我会让通用 hook 返回：

```ts
type CaptchaGateState = 'idle' | 'preparing' | 'working' | 'interaction' | 'submitting' | 'failed'
```

但其中 `submitting` 我其实更倾向仍由业务 mutation 自己表示。

因此更干净的是：

```ts
type CaptchaState = 'idle' | 'loading-provider' | 'working' | 'interaction' | 'failed'
```

Login 自己再有：

```text
login.isPending
```

最终按钮文案：

```ts
if (captcha.state === 'loading-provider') '正在准备安全验证…'

if (captcha.state === 'working') '正在进行安全验证…'

if (login.isPending) '正在登录…'
else '登录'
```

对于 Assessment：

```text
正在准备安全验证…
正在进行安全验证…
正在提交…
提交
```

完全复用。

---

# interaction 区域的设计

我建议统一一个非常克制的：

```tsx
<CaptchaInlineRegion />
```

不要做成带标题的大 Card。

展开后大致：

```text
────────────────────────
[ provider interaction ]
────────────────────────
```

甚至两条线都未必需要。

更像普通 form field：

```text
密码
[................]

        Turnstile
   [ widget area ]

[      登录      ]
```

如果 provider 本身已经有明显边框，就不要 Qualy 再套一层 card。

ALTCHA 即便未来因为 fallback 情况需要展示东西，也可以在这里渲染一条很轻的：

```text
正在进行安全验证…
```

但正常 PoW 不需要。

---

# 无障碍也由通用 host 负责

`working`：

```html
<div aria-live="polite">正在进行安全验证</div>
```

可以 visually hidden，因为按钮本身已经显示。

`interaction-required`：

```text
inline region 展开
↓
将 focus 移到 challenge 内第一个可交互元素
```

但注意不要每次动画都强抢 focus。

Modal 模式：

```text
真正进入 interaction-required
↓
才创建 Dialog
↓
focus trap
↓
完成后恢复到触发按钮
```

ALTCHA silent flow 永远不碰 focus。

---

# Cancellation 必须成为通用 gate 的正式能力

你前面指出过：

```text
proof 绑定 email
```

所以：

```text
email 改了
↓
当前 challenge 作废
```

这不应该让 Auth 自己去研究 ALTCHA worker 怎么 cancel、Turnstile widget 怎么 remove。

统一：

```ts
captcha.cancel()
```

内部：

```text
dispose current provider
ignore stale callbacks
clear state
```

最好每次 challenge 带一个 generation：

```ts
let generation = 0

start()
→ const mine = ++generation

callback
→ if (mine !== generation) ignore
```

避免这种 race：

```text
旧 ALTCHA worker 刚好算完
↓
用户已经修改邮箱
↓
旧 onSolved 晚到
↓
错误地自动重提
```

这是通用组件必须自己解决的，而不是每个业务页面解决。

---

# 自动重提也最好由 caller 控制

Captcha 不应该知道：

```text
登录
提交申报
发送重置邮件
```

所以：

```ts
useCaptchaGate({
  ...
  onSolved(response) {
    login.mutate({
      ...,
      captcha: {
        provider: prompt.provider,
        response,
      },
    })
  },
})
```

Captcha 的职责止于：

```text
给你一个 proof
```

不应该自己重新执行 HTTP request。

这也让它能通用于任意插件。

---

# 最终我会给 Claude Code 写成这个产品规则

```text
CAPTCHA presentation is adaptive, not provider-specific.

1. A challenge first enters a non-interactive "working" state.
   The caller reflects this in its own primary action
   ("正在进行安全验证…").

2. Providers that can finish silently do not cause any new visible
   form element.

3. If and only if the provider reports that user interaction is
   required, the generic CAPTCHA host presents its interaction
   container.

4. The caller chooses the interaction placement:
   - inline: default for forms such as login/password reset
   - modal: available for actions without a natural inline form slot

5. Providers never choose page layout.
   They only report interaction state and mount into the container
   supplied by the generic CAPTCHA host.
```

对于你现在的两个 provider：

| Provider 状态                   | 登录页实际效果                                    |
| ------------------------------- | ------------------------------------------------- |
| ALTCHA                          | **按钮 spinner +「正在进行安全验证…」→ 自动提交** |
| Turnstile 无感通过              | 同 ALTCHA                                         |
| Turnstile 需要交互              | **按钮进入验证态 + 表单末尾展开 widget**          |
| 未来交互式 provider             | 默认同 Turnstile                                  |
| Assessment 等无合适 inline 位置 | 可把同一 interaction host 放进 Modal              |

所以如果只回答你最开始的三个方案，我的选择其实是：

> **1 是静默 challenge 的表现；2 是需要真实用户交互时的默认表现；3 是通用组件支持的可选布局，但不作为登录页默认。**

这比固定选任何一个都更适合作为 Qualy 的通用 CAPTCHA 能力。

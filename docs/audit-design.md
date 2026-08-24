我会把优先级定得很明确：

> **先做审计日志 + 登录记录 + 用户生命周期（软删除），OpenTelemetry 紧接着做。**
>
> 但在这两者之前，先抽一个很薄的 `RequestContext` 基础层，把 `requestId / clientIp / userAgent / sessionId? / traceId?` 的位置定下来。

原因不是审计“比 OTel 更重要”，而是**历史数据缺口不可补，Telemetry 可以后接**。今天没有 trace，明天接 OTel 后从明天开始有 trace，问题不大；但今天管理员修改了角色、删除了用户、调整了组织结构而没有留下审计事件，以后永远无法准确重建。OWASP 也把认证成功/失败、授权失败、用户管理、权限变化、配置变化、数据导出等列为应重点记录的安全事件。([OWASP Cheat Sheet Series][1])

而且你现在正处于非常适合补这个基础设施的阶段：IAM、RBAC、组织和 Assessment 的写路径还没有多到难以梳理。

---

## 一、我建议最终形成四套东西

不要做一个“大日志系统”。

```text
Qualy
│
├─ Audit
│  └─ audit_events
│     管理操作 / 权限操作 / 高风险业务操作
│
├─ Auth
│  └─ sign_in_events
│     登录成功 / 登录失败 / Provider 回调失败
│
├─ Domain History
│  ├─ role_grants
│  ├─ review_events
│  ├─ phase_events
│  └─ ...
│
└─ Observability
   └─ OpenTelemetry
      ├─ traces
      ├─ metrics
      └─ logs correlation
```

其中：

- Audit 是**业务安全事实**；
- Sign-in Events 是**认证安全事实**；
- Domain History 是**业务状态演进事实**；
- OTel 是**运行诊断数据**。

这四个不要互相代替。

---

# 二、Audit 应该是插件，但不是 infra 插件

我建议新增：

```text
packages/contracts/audit/
packages/plugins/base/audit/
```

包名：

```text
@qualy/audit-contract
@qualy/plugin-audit
```

不要放：

```text
packages/plugins/infra/audit
```

因为 Qualy 现在 `infra` 里面是 database、storage、web、ui-registry 这类纯基础设施能力。

Audit 不一样，它：

- 有 tenant 概念；
- 有 actor；
- 有业务 action；
- 有 RBAC 权限；
- 有管理页面；
- 是其他业务插件依赖的平台能力。

所以它和 `auth / rbac / org` 更接近，应当放 `base/audit`。当前 `base` 本身就是这些平台基础业务能力所在的位置。

而且我会把 Audit 定义成**生产环境必须存在的基础插件**，不是“想开就开”的功能。

一个需要审计的插件如果缺少 Audit：

> 应该 assembly 失败，而不是静默运行但不记录。

---

# 三、但是 Contract 必须独立

这是非常重要的。

不能让别的插件直接：

```ts
import { AuditService } from '@qualy/plugin-audit'
```

应该：

```ts
import { Audit } from '@qualy/audit-contract/effect'
```

模式和你现在的 `@qualy/rbac-contract`、`@qualy/auth-contract` 一样。当前项目已经明确采用 contract + provider 这种结构。

大致：

```text
@qualy/audit-contract
├─ effect.ts
├─ action.ts
├─ plugin.ts
└─ index.ts

@qualy/plugin-audit
├─ db/
├─ server/
├─ client/
├─ api.ts
├─ permissions.ts
└─ index.ts
```

---

# 四、Audit 插件绝对不要依赖 Auth/RBAC 才能“写”

这里很容易踩循环依赖。

如果：

```text
audit → auth → rbac → audit
```

整个服务图会越来越难维护。

尤其 RBAC 自己就必须审计：

```text
创建角色
修改权限
授予角色
撤销角色
```

所以 Audit Writer 本身应该只依赖：

```text
Database
Audit action registry
RequestContext（可选）
```

而不是：

```text
Auth
Rbac
Org
Assessment
```

操作人由调用方传进去。

例如：

```ts
yield *
  audit.record(UserDisabled, {
    tenantId,
    actor: {
      kind: 'user',
      userId: as.userId,
    },
    target: {
      id: user.id,
      label: user.displayName,
    },
    details: {
      from: 'active',
      to: 'disabled',
    },
  })
```

Audit 不应该反过来：

```ts
const currentUser = yield* CurrentUser
const user = yield* Auth.load(...)
```

否则它马上就成为依赖图中心。

---

# 五、Audit 的读取 API 可以使用 Auth/RBAC

这个没有问题。

也就是说：

```text
Audit Writer Layer
    ↓
只依赖 Database

Audit Admin API
    ↓
CurrentUser
Rbac
Audit Writer/Repository
```

这不是服务循环。

你当前项目实际上已经有类似的细粒度依赖思想。比如 RBAC 插件自己的 descriptor 只声明 database/ui-registry 依赖，而其 API handler 可以使用 `CurrentUser`；数据库依赖又单独声明。

所以 `@qualy/plugin-audit` 不需要因为管理页面要鉴权，就让整个 Audit service 依赖 RBAC。

---

# 六、我建议 Audit 也建立“Action Registry”

这一点我认为值得现在就做。

因为你已经有：

```text
Permission registry
Login driver registry
UI registry
```

Audit 也很适合：

```text
Audit Action Registry
```

每个插件声明它拥有的审计动作。

例如 Auth：

```ts
export const UserDisabled = AuditAction.define({
  code: 'auth.user.disable',
  target: 'auth.user',
  version: 1,
  details: Schema.Struct({
    previousStatus: Schema.Literal('active'),
  }),
})
```

RBAC：

```ts
export const RolePermissionsChanged = AuditAction.define({
  code: 'rbac.role.permissions.update',
  target: 'rbac.role',
  version: 1,
  details: Schema.Struct({
    added: Schema.Array(Schema.String),
    removed: Schema.Array(Schema.String),
  }),
})
```

然后：

```ts
Audit.actions('auth', [
  UserCreated,
  UserUpdated,
  UserDisabled,
  UserEnabled,
  UserDeleted,
  UserRestored,
])
```

最终由：

```ts
Audit.provider
```

汇总。

这有三个非常大的好处。

第一，插件不能随手：

```ts
audit.record('whatever-i-want', someRandomObject)
```

第二，`details` 有 Schema，天然形成**审计字段 allowlist**。

第三，Audit UI 知道：

```text
这个 action 是谁定义的
叫什么
target 是什么
details schema version 是多少
```

---

# 七、Audit Action 一定要有 version

这个很容易现在忽略，几年以后很难处理。

例如今天：

```json
{
  "added": ["a", "b"],
  "removed": ["c"]
}
```

以后改成：

```json
{
  "permissions": {
    "added": [...],
    "removed": [...]
  }
}
```

历史 JSON 已经存在。

所以事件至少要：

```text
action_code
action_version
```

例如：

```text
rbac.role.permissions.update
1
```

以后 schema 意义变化：

```text
rbac.role.permissions.update
2
```

不要直接让旧 JSON 和新 JSON 长得不一样却都叫同一版本。

---

# 八、AuditEvent 表我会一次设计成这样

大概：

```ts
AuditEvent {
  id

  tenantId
  occurredAt

  actionCode
  actionVersion

  actorKind
  actorUserId
  actorLabel

  targetKind
  targetId
  targetLabel

  organizationId

  outcome
  reasonCode

  details

  source

  requestId
  traceId
  sessionId

  clientIp
  userAgent
}
```

数据库：

```text
audit_events

id                    uuid
tenant_id             uuid
occurred_at           timestamptz

action_code           varchar(127)
action_version        smallint

actor_kind            varchar(16)
actor_user_id         uuid nullable
actor_label           varchar(255) nullable

target_kind           varchar(127) nullable
target_id             varchar(255) nullable
target_label          varchar(255) nullable

organization_id       uuid nullable

outcome               varchar(16)
reason_code           varchar(127) nullable

details               jsonb

source                varchar(16)

request_id            uuid nullable
trace_id              char(32) nullable
session_id            uuid nullable

client_ip             inet nullable
user_agent            text nullable
```

`actor_kind` 至少：

```text
user
system
service
anonymous
```

`source`：

```text
http
job
cli
system
```

我会让：

```text
target_id
```

是 string，而不是强制 UUID。

插件以后完全可能审计一个不是 UUID 的资源。

---

# 九、不要给 actor/target 建跨插件 FK

Audit 最好保存：

```text
actor_user_id = uuid
```

但不要：

```sql
FOREIGN KEY actor_user_id → users(id) ON DELETE ...
```

同样：

```text
target_id
```

也不要 FK。

Audit 是历史。

它不能因为：

```text
User 被删除
Role 被删除
Batch 被删除
插件被卸载
```

就失效。

因此应该同时保存极小量 snapshot：

```text
actor_user_id
actor_label = "张三"

target_id
target_label = "审核员"
```

ID 是真正身份，label 只是历史展示快照。

---

# 十、最关键的实现：Audit 要写在业务 Service 内，而不是 Handler 内

例如现在用户写操作就是：

```text
HTTP Handler
  ↓
Iam.users.setEnabled(...)
  ↓
transaction
  ↓
lock tenant
  ↓
业务修改
```

当前 `users.ts` 的写入已经统一进入 transaction + tenant lock。

Audit 应该放：

```text
Iam.users.setEnabled
```

里面。

而不是：

```text
setUserStatus.handler
```

原因很简单。

以后可能：

```text
HTTP
Job
CLI
另一个 Plugin
```

都调用：

```ts
Iam.users.setEnabled()
```

如果 Audit 在 Handler：

> 非 HTTP 调用没有审计。

如果在 Domain Service：

> 谁调用都审计。

---

# 十一、而且 Audit 必须和业务修改同一个事务

这一点你现在的数据库层已经为此做好了非常漂亮的基础。

当前 `transaction()` 的设计明确是：

> 一个 service 在别人的 transaction 里调用时，会自动 join 当前 transaction，连接通过 Effect fiber context 传播。

所以：

```ts
yield* transaction(
  Effect.gen(function* () {
    yield* updateUser(...)

    const audit = yield* Audit

    yield* audit.record(UserDisabled, {
      ...
    })
  }),
)
```

Audit 内部：

```ts
yield * entityManager<AuditEntities>()
```

拿到的仍然是**同一个 transaction manager**。

所以天然得到：

```text
UPDATE users
INSERT audit_events
COMMIT
```

而不是：

```text
UPDATE users
COMMIT

INSERT audit_events
失败
```

这是非常适合 Qualy 当前架构的一点。

我的规则会定死：

> **一个声明为必须审计的成功业务操作，如果 AuditEvent 写不进去，该业务事务就不能提交。**

---

# 十二、哪些操作现在就全部接进去

第一轮我会把现有的管理写操作全部扫一遍。

### Org

```text
org.type.create
org.type.update
org.type.delete

org.type-rule.update

org.node.create
org.node.update
org.node.move
org.node.delete
```

### Auth

```text
auth.user.create
auth.user.update
auth.user.move
auth.user.enable
auth.user.disable
auth.user.delete
auth.user.restore

auth.user-type.create
auth.user-type.update
auth.user-type.enable
auth.user-type.disable
auth.user-type.placement.update
auth.user-type.delete

auth.provider.create
auth.provider.update
auth.provider.enable
auth.provider.disable
auth.provider.audience.update

auth.identity.bind
auth.identity.unbind
auth.identity.password.reset

auth.session.revoke
```

### RBAC

```text
rbac.role.create
rbac.role.update
rbac.role.enable
rbac.role.disable
rbac.role.delete

rbac.role.permissions.update
rbac.role.eligibility.update
rbac.role.anchor-policy.update
rbac.role.grant-rules.update

rbac.grant.create
rbac.grant.revoke
```

### Assessment

重点审计行政/配置能力：

```text
assessment.batch.create
assessment.batch.update
assessment.batch.archive

assessment.phase-plan.update
assessment.phase.force

assessment.policy.update

assessment.entry.proxy
assessment.entry.record

assessment.review.reopen

assessment.result.publish
assessment.result.unpublish

assessment.data.import
assessment.data.export
```

但是普通：

```text
用户提交申报
审核员通过
审核员退回
```

如果已经有完整 Domain Event，就不要再复制一份 Audit。

---

# 十三、RequestContext 现在就应该补

当前 access log 直接拿 `HttpServerRequest`，记录 method/path/status/duration，但是没有统一 `requestId`。

当前登录代码又自己直接读取：

```text
request.remoteAddress
request.headers['user-agent']
```

写入 Session。

我建议现在统一出：

```ts
RequestContext {
  requestId: string

  clientIp?: string
  userAgent?: string

  sessionId?: string

  traceId?: string
}
```

放到 server-side 的 `@qualy/api-kit` 中，而不是 Audit。

以后：

```text
Access Log
Audit
Sign-in Event
OTel
Error report
```

全部读它。

---

# 十四、Client IP 也应该现在解决

不要到处：

```ts
request.remoteAddress
```

更不要随手：

```ts
X - Forwarded - For
```

因为反向代理环境下：

```text
Browser
 ↓
Cloudflare / Caddy / Nginx
 ↓
Qualy
```

socket remote address 往往是代理。

但无条件相信 `X-Forwarded-For` 又可以被客户端伪造。

所以现在应该定义统一：

```text
ClientAddressResolver
```

规则：

```text
没有 trusted proxy
→ remoteAddress

remoteAddress 属于 trusted proxy
→ 才解析 Forwarded / X-Forwarded-For
```

Audit 和 Sign-in Event 都必须使用这个统一结果。

这个属于“现在做了以后省很多麻烦”的基础设施。

---

# 十五、登录记录不要放 audit_events

我仍然坚持单独：

```text
sign_in_events
```

而且表由：

```text
@qualy/plugin-auth
```

拥有。

因为登录是 Auth 领域自己的高频安全事件。

当前 Auth 已经拥有：

```text
AuthProvider
UserIdentity
Session
```

所以 `SignInEvent` 放在同一个插件最自然。

---

# 十六、SignInEvent 我会这样设计

```text
sign_in_events

id
tenant_id nullable
occurred_at

provider_id nullable
provider_type
provider_code
provider_label

user_id nullable
identity_id nullable

outcome
reason_code

session_id nullable

request_id
trace_id

client_ip
user_agent
```

`outcome`：

```text
success
failure
```

`reasonCode` 内部可以精确：

```text
invalid-credentials
identity-not-found
user-disabled
user-deleted
user-type-disabled
tenant-disabled
provider-disabled
audience-denied

oauth-state-invalid
oauth-provider-error
oidc-callback-invalid
cas-ticket-invalid

internal-error
```

但返回给匿名客户端仍然应该是：

```text
INVALID_CREDENTIALS
```

不能因为日志内部知道：

```text
user-disabled
identity-not-found
```

就把这个区别泄露给客户端。

当前 `auth-local` 正是在刻意把多个失败路径统一成 `InvalidCredentials`，同时用 Argon2 equalizer 避免用户名存在性计时泄露。

这个行为要继续保持。

---

# 十七、认证 Contract 最好引入 SignInAttempt

未来你还有 OAuth、CAS。

不要让每个驱动自己：

```ts
insertSignInEvent(...)
```

应该让 Auth Core 管。

例如：

```ts
const attempt =
  yield *
  sessions.beginAttempt({
    providerCode,
    expectedType: 'local',
  })
```

驱动认证失败：

```ts
return (
  yield *
  sessions.failAttempt(attempt, {
    reason: 'invalid-credentials',
    identityId,
    userId,
  })
)
```

成功：

```ts
return (
  yield *
  sessions.completeLogin(attempt, {
    userId,
    identityId,
  })
)
```

这样：

```text
Password
OAuth
OIDC
CAS
```

都遵循同一个登录事件模型。

尤其 `completeLogin()` 应该改成一个事务：

```text
BEGIN

INSERT session
UPDATE identity.last_used_at
INSERT sign_in_event success

COMMIT
```

当前 `completeLogin` 已经集中负责 Session 创建和 `lastUsedAt` 更新，所以这是非常合适的落点。

---

# 十八、登录失败一定记录

包括：

```text
密码错误
不存在的身份
账号停用
账号删除
用户类型停用
Tenant 停用
Provider 不允许该 UserType
OAuth state 错误
CAS ticket 错误
Provider callback 错误
```

OWASP 明确要求认证成功和认证失败都应被记录，特别是密码失败。([OWASP Cheat Sheet Series][1])

但是：

> **绝对不记录 password / token / OAuth code / CAS ticket / Cookie。**

---

# 十九、失败登录里的 identifier 不要随便明文保存

比如攻击者尝试：

```text
admin@example.com
president@example.com
...
```

没必要把所有输入原样永久存起来。

我会：

- 如果已经 resolve 到 `identityId/userId`：记录 ID；
- 如果根本不存在：默认不记录完整 identifier；
- 最多记录经过 masking 的 hint；
- 安全分析主要依靠 IP/provider/时间窗口。

以后真需要 credential-spraying 的 account 聚合，再引入 HMAC pseudonym，不要现在直接把失败用户名全部塞进日志。

---

# 二十、然后是用户软删除，我建议这次做完整

当前 User 是：

```text
enabled
createdAt
updatedAt
```

没有 `deletedAt`。

我建议加：

```text
deletedAt nullable
version
```

状态：

```text
enabled=true  deletedAt=null
→ active

enabled=false deletedAt=null
→ disabled

enabled=false deletedAt!=null
→ deleted
```

DB CHECK：

```sql
deleted_at IS NULL OR enabled = false
```

即：

> Deleted 一定 Disabled。

---

# 二十一、我还建议 User 这次顺便加 version

UserType/AuthProvider 已经有 optimistic concurrency version，但 User 目前没有。

用户详情以后改成二级页面后，很容易出现：

```text
管理员 A 打开张三
管理员 B 修改张三组织
管理员 A 还拿着旧页面保存
→ 覆盖 B 的修改
```

所以：

```text
users.version integer default 1
```

所有：

```text
update
move
enable
disable
delete
restore
```

都带 expected version。

这是一个很适合跟软删除一起补的基础一致性能力。

---

# 二十二、删除条件我会正式定成

```text
非系统用户
+
当前处于 disabled
+
操作者拥有 auth.user.delete
+
操作者对当前组织节点有对应管理范围
+
版本一致
```

然后：

```text
disabled
   ↓ delete
deleted
```

我不建议继续让：

```text
auth.user.manage
```

同时拥有“修改信息”和“删除人”的权限。

删除是明显更高风险的能力。

新增：

```text
auth.user.delete
```

同样是 `org-node` scope。

恢复也可以使用：

```text
auth.user.delete
```

或者更清晰：

```text
auth.user.restore
```

我倾向单独两个：

```text
auth.user.delete
auth.user.restore
```

---

# 二十三、删除用户时不能只设置 deletedAt

同一个事务应该：

```text
1. 验证用户 disabled
2. 验证不是 system account
3. revoke 所有 live role grants
4. revoke 所有 login identities
5. 删除全部 session
6. user.deletedAt = now()
7. version++
8. Audit auth.user.delete
```

然后 commit。

---

# 二十四、尤其是 RoleGrant 必须处理

你现在 `role_grants` 已经有非常好的历史模型：

```text
revokedAt
revokedBy
createdAt
createdBy
```

而且注释明确：

> withdrawn rather than deleted: who could do what, and until when, is history

所以用户删除时：

```text
不要 DELETE role_grants
```

而是：

```text
revoked_at = now()
revoked_by = actor
```

一次 revoke all。

恢复用户以后：

> **以前的角色不要自动恢复。**

必须重新授权。

这是安全上更合理的行为。

---

# 二十五、当前 RoleGrant 的 User FK 也要顺便修

现在是：

```sql
role_grants
  → users
  ON DELETE CASCADE
```

这和“授权历史”本身是矛盾的。

我会现在改成：

```sql
ON DELETE RESTRICT
```

甚至明确：

> User 不允许物理删除，只允许 soft delete。

以后如果真做 GDPR/数据清理意义上的 hard purge，那应该是一个完全独立的 Purge 机制，不是管理员页面的 Delete。

---

# 二十六、UserIdentity 也应该这次顺便变成可撤销历史

这是我认为值得一起做的另一点。

现在 `UserIdentity`：

```text
boundAt
lastUsedAt
credentialHash
```

没有解绑历史。

既然现在准备做：

```text
GitHub
Google
CAS
Password
登录记录
用户删除
```

我建议直接加：

```text
revokedAt
revokedBy
```

变成：

```text
UserIdentity
├─ boundAt
├─ lastUsedAt
├─ revokedAt
└─ revokedBy
```

登录查询统一：

```sql
WHERE revoked_at IS NULL
```

删除用户：

```text
revoke all identities
```

恢复用户：

> 不自动恢复身份。

管理员需要重新启用/绑定。

这样不会出现：

```text
一个已经被删除很久的用户
→ 恢复
→ 启用
→ 三年前的 GitHub/密码立即重新能登录
```

---

# 二十七、Identity unique index 也要改成“live only”

现在：

```text
tenant + provider + identifier
```

全表唯一。

如果 UserIdentity 变成历史记录，那么改成：

```sql
UNIQUE (...)
WHERE revoked_at IS NULL
```

同样：

```text
tenant + user + provider
```

也是：

```sql
WHERE revoked_at IS NULL
```

这样旧 binding 留历史，但允许未来明确重新绑定。

---

# 二十八、BusinessNo 我反而建议继续永久占用

User 当前：

```sql
UNIQUE (tenant_id, business_no)
WHERE business_no IS NOT NULL
```

加 `deletedAt` 后不要改成：

```sql
WHERE deleted_at IS NULL
```

我建议继续：

```text
删除用户仍占 businessNo
```

因为如果是同一个人：

> 应该 Restore，而不是 Create 一个新的 User ID。

否则：

```text
旧张三 userId=A businessNo=20240001
新张三 userId=B businessNo=20240001
```

历史审核、授权、登录日志会开始产生身份连续性歧义。

---

# 二十九、软删除后所有查询必须重新梳理一次

这个不能只改 User list。

例如当前组织节点的人数统计就是：

```sql
select count(*)
from users
where tenant_id = ...
  and primary_org_node_id = ...
```

没有 deleted 条件。

以后必须统一：

```sql
deleted_at IS NULL
```

至少扫：

```text
用户列表
用户搜索
人员 Picker
组织人数
UserType userCount
RBAC eligibility
last administrator
Assessment participant selection
排名候选
登录
身份查询
导入去重
```

这一步应该有 repository-wide tests。

否则最常见的 bug 就是：

> 用户页面看不到 deleted 用户，但某个统计还算着他。

---

# 三十、deleted 用户和 Org/UserType 外键还有一个细节

我不会让软删除用户永久阻止组织节点和 UserType 删除。

所以我倾向把：

```text
user_type_id
primary_org_node_id
```

变成 nullable，但加 CHECK：

```sql
deleted_at IS NULL
→ user_type_id IS NOT NULL
→ primary_org_node_id IS NOT NULL
```

即：

```sql
CHECK (
  deleted_at IS NOT NULL
  OR (
    user_type_id IS NOT NULL
    AND primary_org_node_id IS NOT NULL
  )
)
```

对应 FK 对历史 deleted user 可以：

```text
ON DELETE SET NULL
```

而 live user 因为 CHECK，不允许 SET NULL，因此节点/type 删除仍会失败。

效果很好：

```text
Live user 引用 Class A
→ Class A 不能删

Soft-deleted user 引用 Class A
→ Class A 后来被删除
→ user.primaryOrgNodeId = null
→ 历史 User 仍保留
```

删除时的原组织名称/id 已经在 `auth.user.delete` AuditEvent snapshot 中。

这是比“deleted user 永远卡住组织结构清理”更合理的设计。

---

# 三十一、恢复用户默认恢复成 disabled

不要：

```text
deleted → active
```

而是：

```text
deleted
  ↓ restore
disabled
  ↓ enable
active
```

如果：

```text
原 UserType 已删
原 OrgNode 已删
```

Restore 时必须重新选择：

```text
UserType
Organization
```

身份和角色也不自动恢复。

也就是说 Restore 是：

> 恢复这个人的 User identity continuity。

不是：

> 恢复他以前全部权限和登录能力。

---

# 三十二、Audit details 不要成为任意 JSON 垃圾桶

虽然 DB 用 JSONB，我仍会让 Action Schema 限制进去的内容。

例如：

```ts
UserUpdated.details = Schema.Struct({
  changes: Schema.Array(
    Schema.Struct({
      field: Schema.Literal('displayName', 'businessNo', 'userTypeId'),
      before: AuditValue,
      after: AuditValue,
    }),
  ),
})
```

密码根本不属于 Schema。

OAuth Secret：

```text
clientSecret:
  changed: true
```

不允许：

```text
before
after
```

另外 Audit Writer 再做第二层防御：

```text
details 最大尺寸，例如 32 KiB
string 最大长度
拒绝 credential/password/token/secret 等危险结构
```

Action Schema 是第一道。

Writer guard 是第二道。

---

# 三十三、Audit 中不要记录 Response body

只记录：

```text
outcome
reasonCode
result summary
```

例如导入：

```json
{
  "created": 320,
  "updated": 41,
  "skipped": 7
}
```

不是把 368 个对象全部存进去。

创建用户：

```text
target = user:xxx
```

就够了。

---

# 三十四、Audit 权限

新增：

```text
audit.event.read
audit.event.export
```

都 tenant scope。

Audit 页面：

```text
时间
操作人
操作
对象
结果
IP
```

过滤：

```text
时间
操作人
Action
Target
结果
IP
```

Cursor：

```text
occurred_at DESC
id DESC
```

索引至少：

```text
(tenant_id, occurred_at desc, id desc)

(tenant_id, actor_user_id, occurred_at desc)

(tenant_id, action_code, occurred_at desc)

(tenant_id, target_kind, target_id, occurred_at desc)
```

---

# 三十五、Audit 本身 append-only

应用层：

```text
INSERT
SELECT
```

没有：

```text
UPDATE
DELETE
```

Admin API 也绝不能提供。

Audit export 本身：

```text
audit.event.export
```

要记录 Audit。

Audit list 每次翻页不要再写一条 Audit，不然递归污染。

---

# 三十六、然后才接 OpenTelemetry

这个阶段马上接，不要拖到“项目完成以后”。

但我反而**不建议把 OpenTelemetry 做成普通 Plugin**。

原因是：

> Telemetry 要观察 Plugin 本身的加载、Layer 构建、HTTP server、Database 等东西。

如果它只是：

```text
@qualy/plugin-telemetry
```

跟其他插件平级加载，它无法自然地包住整个应用 composition root。

当前 Qualy 的 root logging 是在 `main.ts` 里甚至早于 `makeApplication()` 建立的。

HTTP server 也是 host 在 `runtime.ts` 最终统一组合。

所以我会放：

```text
packages/core/telemetry/
```

或者：

```text
apps/server/src/telemetry.ts
```

如果后面代码较多再抽 core package。

然后由：

```text
main.ts
runtime.ts
```

安装 OTel layer。

这样它才能真正包：

```text
startup
plugin layers
HTTP
database
background tasks
```

---

# 三十七、Effect 现在已经有官方 OTel 集成

当前 `@effect/opentelemetry` 就是 Effect 的 OpenTelemetry integration，并提供 NodeSdk/WebSdk 用来导出 Effect tracing、metrics 和 logs；Effect v4 仍是 beta，因此版本要和 `effect` 保持匹配。([GitHub][2])

所以后面可以：

```text
Effect spans
Effect metrics
Effect logs
     ↓
@effect/opentelemetry
     ↓
OTLP
```

但我第一阶段只做：

```text
Traces
Metrics
```

保留你现在自己的 logger。

因为你现在已经专门实现了一套 Qualy logger、access log、source filtering 和 pretty/json renderer。

没必要为了 OTel 一上来把整个 logging 体系推翻。

---

# 三十八、Audit 从第一天就预留 traceId

即使 OTel 还没接，也先有：

```text
trace_id nullable
```

开始时：

```text
null
```

接入 OTel 后：

```text
requestId = 019...
traceId   = 67f5...
```

Audit UI 详情里：

```text
Request ID
Trace ID
```

将来点击 Trace ID 可以跳 Grafana/Jaeger/Tempo。

这样两套系统是关联的，但不互相依赖。

---

# 三十九、我建议实际开发顺序

我会按这个顺序落地：

### Phase 1：请求上下文

先补：

```text
RequestContext
requestId
trusted client IP
userAgent
sessionId optional
traceId optional
```

Access Log 也开始带 `requestId`。

---

### Phase 2：Audit Contract + Plugin

新增：

```text
@qualy/audit-contract
@qualy/plugin-audit
```

实现：

```text
Action Registry
Audit service
audit_events
query API
permissions
basic UI
```

先把最核心的：

```text
record()
```

和事务语义测透。

---

### Phase 3：User 生命周期重构

一次完成：

```text
User.deletedAt
User.version

status:
active
disabled
deleted

delete
restore

UserIdentity.revokedAt/revokedBy
RoleGrant revoke-all

历史 FK 修正
所有查询 deleted filter
```

并且让这些操作从第一天就产生 Audit。

---

### Phase 4：Sign-in Events

Auth 中新增：

```text
SignInEvent
SignInAttempt
```

让：

```text
auth-local
OAuth
CAS
```

未来都必须通过统一 attempt contract。

登录成功：

```text
Session + Identity.touch + SignInEvent
```

原子提交。

失败：

```text
SignInEvent failure
```

---

### Phase 5：补齐现有插件审计

逐个扫：

```text
org
auth
rbac
assessment
storage/import/export
```

每一个 mutation 问：

```text
是否已有 Domain History？
是否改变安全边界？
是否管理员干预？
是否改变关键配置？
是否敏感读取/导出？
```

然后补 Action。

---

### Phase 6：OpenTelemetry

再接：

```text
HTTP trace
Effect spans
PostgreSQL
background jobs
metrics
trace ↔ audit requestId
```

---

## 最后给一个架构图

我认为最终应该是：

```text
                         apps/server
                             │
                  ┌──────────┴──────────┐
                  │                     │
          RequestContext          OpenTelemetry
                  │               host-level
                  │
        ┌─────────┴─────────┐
        │                   │
 @qualy/plugin-audit   @qualy/plugin-auth
        │                   │
   audit_events         sign_in_events
        │                   │
        │                   ├─ sessions
        │                   └─ identities
        │
        ▼
 @qualy/audit-contract
        ▲
        │
 ┌──────┼────────┬──────────────┐
 │      │        │              │
Org    Auth     RBAC        Assessment
 │      │        │              │
 └──────┴────────┴──────────────┘
       explicit record()
       inside transaction
```

这里面我最想强调两个现在就应该定死的原则：

1. **Audit 是 mandatory base capability，不是一个可有可无的 logging addon。**
2. **审计调用发生在领域事务内，不发生在 HTTP middleware 里。**

而登录失败这种事件则由 Auth 的 `SignInAttempt` 统一记录；OTel 最后作为 host-level observability 包住整个系统。

如果按“哪些东西以后最难补”排序，我会是：

> **历史模型与软删除 > Audit Action Contract > 登录事件模型 > Request correlation > OpenTelemetry instrumentation > Dashboard/告警。**

前四个现在不做好，以后要重新解释旧数据；OTel 晚一两个开发阶段接，代价远低得多。

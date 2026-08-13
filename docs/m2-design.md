# Qualy M2 实施设计：Storage + Evidence + Entry 最小业务闭环

> 基线：`main@2e2fa2b1a94090e4b38d3a2513a3739e99c2790b`
>
> 目标：在 M1 已冻结的 Batch / Phase / Roster / 三层授权骨架上，第一次落下真实业务事实，使系统完成“学生提交材料 → 审核 → 得分”和“工作人员行政认定 → 学生可见 → 计入得分”两条可演示竖切。Storage 从本里程碑起同时实现 Local 与腾讯云 COS：Local 是开发/CI 默认且可独立正式部署，COS 是当前生产推荐后端。
>
> 权威来源：`CLAUDE.md`、`docs/assessment-design.md`（重点 §7、§11–§16、§19–§26、§27、§28、§32.14/16/17/19/20/21/33/34/46/47/56）、当前 `STATUS.md`。本文是 M2 的施工展开，不重开已冻结业务决策；若与 `assessment-design.md` 冲突，先更新权威文档再施工。

---

## 1. M2 的完成定义

M2 不是“把附件、Entry、计分器几个底层类写出来”，而是第一个真实业务里程碑。结束时必须能完整演示：

### 学生路径：退役复学 +3

1. 管理员已有一个运行中的 Batch，题目“退役复学”已配置：
   - `itemType = evidence`
   - `entrySource = student`
   - 附件 1 份必填
   - `fixed@1 = +3.00`
   - `sum@1`
   - 单 stage 审核策略
2. 学生选择退役证明后，先向后端申请一次上传 reservation：
   - 后端生成 `attachmentId`
   - 后端直接确定最终不可变 `storageKey = attachments/{tenantId}/{attachmentId}`
   - reservation 立即占用临时上传额度
   - Local 返回一次性本地上传 grant；COS 返回只允许 `PUT` 当前 exact ObjectKey 的短期 STS grant
3. 浏览器把文件上传到当前 Storage backend：
   - Local：上传到 Storage 的一次性本地入口，Local 内部先写临时文件，完整结束后原子安装到最终 key
   - COS：浏览器直接 `PutObject` 到最终 ObjectKey，文件字节不经过 Qualy 业务后端
   - COS 上传必须携带 `x-cos-forbid-overwrite: true`，且 STS policy 同时限制 exact key 与最大 `Content-Length`
4. 浏览器调用 `completeUpload(reservationId)`：
   - body 不提交 key / size / hash / etag
   - 后端从 reservation 取最终 key，主动 `stat/HEAD`
   - Local 得到可信 `size + sha256`
   - COS 得到可信 `size + CRC64-ECMA + ETag`
   - 成功后生成 `Attachment(status=staged)`，reservation → completed
5. 学生保存草稿：
   - 创建 `Entry`
   - 创建不可变 `EntryRevision 1`
   - 关联附件
   - 附件从 `staged → bound`
6. 学生提交：
   - `Entry: draft → in_review`
   - 创建新的 `ReviewInstance(round=1, origin=initial)`
   - 审核链只解析一个 `roleAt + any` stage
7. 审核人通过：
   - `ReviewInstance → completed/approved`
   - `Entry → approved`
8. 学生打开“我的结果”：
   - `calcParticipant()` 真实读取 approved Entry
   - `fixed@1` 产生 +3.00
   - `sum@1` 聚合
   - 显示最小 Breakdown
9. 不是 mock，不允许结果页写死 `+3`。

### 驳回重提路径

1. 审核人 reject 时：
   - 文字意见必填
   - 可以提交一份 `suggestedPayload`
   - 建议只作为 `ReviewEvent` 的不可变参考
2. 学生看到：
   - 原材料
   - 驳回意见
   - 建议稿只读
   - 没有“一键套用”“复制建议到表单”
3. 学生自己修改：
   - 追加 `EntryRevision 2`
   - `Entry: rejected → draft`
4. 再次 submit：
   - 新建 `ReviewInstance(round=2)`
   - 不复用 round 1
5. round 2 approve 后计分。

### 行政路径：一条扣分题

1. 题目：
   - `entrySource = administrative`
   - `fixed@1 = -1.00`（M2 用固定负分即可）
2. 持 `assessment.entry.record` 且其实际 Batch authority 覆盖目标 participant frozen anchor 的工作人员录入。
3. 服务端推导：
   - `source = record`
   - `actor = 工作人员`
   - `subject = 学生`
4. 创建即：
   - `Entry.status = approved`
   - 不创建 ReviewInstance
5. “认定依据”必填。
6. 学生可读取：
   - 来源
   - 录入人
   - 时间
   - 依据
   - 附件
7. 实时结果从 +3.00 变成 +2.00。

M2 结束的定义就是这三条路径全部真实跑通，并满足下面的安全、审计和并发不变量。

---

## 2. M2 明确不做什么

这些能力虽然已有权限码、设计位或最终表草案，但不属于 M2：

- 不做 `entry.proxy`。M2 对 `student` 题目的规则仍是：除 participant 本人外，任何人走普通 Entry 写接口都 403。代录在 M3 正式接入。
- 不做 `source_claims` / 编码唯一占用。M3 献血实例再做。
- 不做 `event_pick`、`enum_with_other`、`pattern`。M2 evidence DSL 只实现 `text / date / attachment`。
- 不做完整 Review：
  - 不做多 stage
  - 不做 `nearestRole`
  - 不做 `all / atLeast`
  - 不做 panel / votes
  - 不做 escalation
  - 不做巡检、BLOCKED 双向自愈
  - 不做滞留水位
- 不做 `resubmit`、`review.reopen`、申诉轮。
- 不做 ScoreRun、Publication、排名。
- 不做 `lookup / range / decrement / countTier / max / min` 等后续计算器和聚合器；M2 只有 `fixed@1 + sum@1`。
- 不做任意代码沙箱。
- 不做 CDN / EdgeOne / 全球加速、缩略图、病毒扫描、内容识别平台；M2 **要实现 Local + 腾讯云 COS 两个 Storage backend**，但不建设任意 S3 provider 动物园。
- 不做通用低代码表单平台。
- 不做通用工作流引擎。
- 不为了 M3/M4 提前建设 Review panel、source claim、Publication 等空表。

原则：M2 只建设第一条业务竖切真正需要、且已经冻结的稳定骨架。

---

## 3. M2 开工前补七处实现裁决

### 3.1 Storage 状态机补齐上传 reservation 与显式 `bind`

业务附件长期状态仍是：

```text
staged → bound → retired
```

浏览器开始上传前增加独立短期能力 `UploadReservation`。它不是 Attachment：

```text
issued
  ├── completed
  ├── expired
  └── failed
```

不再增加 `promoting`。COS 与 Local 都直接落到最终不可变 ObjectKey；上传完成后的 `completeUpload` 只是 stat + 落 Attachment row，没有对象搬运阶段。

Storage 对 Assessment 暴露：

```ts
interface Storage {
  prepareUpload(input): Effect.Effect<UploadReservationView, StorageError>
  completeUpload(input): Effect.Effect<AttachmentMeta, StorageError>
  metadata(tenantId, attachmentId): Effect.Effect<AttachmentMeta, StorageError>
  bind(input): Effect.Effect<AttachmentMeta, StorageError>
  open(input, authorize): Effect.Effect<AttachmentOpen, StorageError | AccessDenied>
  retire(input): Effect.Effect<void, StorageError>
}
```

语义严格区分：

```text
prepareUpload = “预留额度并签发一次有限上传能力”
completeUpload = “后端已经确认最终对象真实存在，形成 staged Attachment”
bind = “这个附件已经进入不可变业务历史”
```

### 3.2 Local 与腾讯云 COS 都是 M2 正式后端

正式支持：

```text
BlobBackend
├── local
└── cos
```

用途：

- `local`
  - 日常开发默认
  - CI / `createTestContext()` 默认
  - 离线、自托管、小规模正式部署可直接使用
  - 不依赖外部云服务
- `cos`
  - 当前生产推荐 backend
  - private bucket
  - Browser 直传
  - Backend 只承担 control plane：reservation、STS、stat、GC、下载签名、业务状态
  - 上传文件 bytes 不经过 Qualy Backend

M2 不同时建设七牛、多吉或任意 S3 endpoint provider。未来出现第二个真实对象存储部署需求时再新增 backend。

### 3.3 Browser 直接上传最终不可变 key，不做 `incoming → canonical` promotion

最终 key：

```text
attachments/{tenantId}/{attachmentId}
```

服务端生成 `attachmentId` 和 key，客户端永远不能自选。

COS 通过三层约束直接保证对象不可变：

```text
server-generated UUID key
∩ STS resource = exact object
∩ x-cos-forbid-overwrite = true
```

Bucket 版本控制保持关闭，因为腾讯云的禁止覆盖头在开启版本控制后不再提供“禁止同名写入”的语义。

M2 因此明确删除：

```text
incoming/*
CopyObject
promote()
promoting state
source/destination reconciliation
临时双份对象
```

这不是减少安全性，而是把不可变性放在第一次对象写入的位置实现。

Local backend 内部为了防止半文件可以使用：

```text
<root>/.tmp/{reservationId}
→ fsync/close
→ atomic rename
→ <root>/attachments/{tenantId}/{attachmentId}
```

这个临时文件只是 Local 的实现细节，不进入通用 Storage 状态机，也不出现在业务 ObjectKey 中；Local contract 对外仍然只有最终 `storageKey`。

### 3.4 COS Callback 不进入正确性链路

正确性链路统一为：

```text
Browser
  │ prepareUpload
  ▼
Qualy
  │ reservation + upload grant
  ▼
Browser ─────────────────────► Storage backend
  │
  │ 上传成功
  ▼
Browser ── completeUpload ───► Qualy
                               │
                               │ stat / HEAD final key
                               ▼
                           Storage backend
                               │
                               │ trusted size/integrity
                               ▼
                            Qualy DB
```

Browser 的 `completeUpload` 只表示“现在可以检查”，不是数据真相来源。禁止它提交：

```text
storageKey
bucket
backend
size
CRC64 / SHA256
ETag
```

这些全部由 reservation 与 backend 实际对象派生。

腾讯云事件/回调未来可用于 telemetry 或运维补充，但 M2 不依赖 callback、webhook、SCF 或 callback tunnel。

### 3.5 Storage authorizer 不建立反向业务依赖

`@qualy/plugin-storage` 继续只依赖 database，不知道 Assessment / RBAC / Auth 的业务概念。

Assessment 调用：

```ts
Storage.open({
  tenantId,
  attachmentId,
  principal,
  authorize: assessmentAttachmentAuthorizer,
})
```

Storage 负责对象状态/backend/短期读取能力；Assessment authorizer 负责“这个 principal 为什么有权读这份业务材料”。

第二个业务领域真正出现以前，不做通用 authorizer registry。

### 3.6 integrity 是完整性元数据，不是业务身份

统一存：

```text
integrity_algorithm
integrity_value
```

M2：

```text
local → sha256
cos   → crc64-ecma
```

不变量：

```text
Attachment.id = 业务身份
storageKey    = backend 对象身份
integrity_*   = 完整性指纹
```

`integrity_value` 不 UNIQUE。未来若做全局内容去重，再独立增加 `content_sha256`，不能复用完整性字段偷换语义。

### 3.7 Batch workspace URL 统一

M2 frontend 使用 Batch workspace：

```text
/assessment/batches/:batchId/submission
/assessment/batches/:batchId/result
/assessment/batches/:batchId/reviews
```

未来批次级填报进度：

```text
/assessment/batches/:batchId/submissions
```

跨 Batch 工作仍属于 `/workbench`。

---

## 4. 插件与模块边界

M2 之后：

```text
@qualy/plugin-storage
  └─ dependsOn: database

@qualy/plugin-storage-local
  └─ dependsOn: storage

@qualy/plugin-storage-cos
  └─ dependsOn: storage

@qualy/plugin-assessment
  ├─ dependsOn: auth
  ├─ dependsOn: database
  ├─ dependsOn: org
  ├─ dependsOn: rbac
  ├─ dependsOn: ui-registry
  └─ dependsOn: storage

@qualy/plugin-assessment-evidence
  ├─ dependsOn: assessment
  └─ dependsOn: storage
```

Assessment 仍是一个 bounded context，不拆 entry/review/scoring 子插件，只拆内部 module：

```text
assessment/core/src/
├── item/
├── entry/
├── review/
├── scoring/
└── server/
    └── index.ts
```

不要顺手重构 M1 已稳定的 batch/phase/roster。

Storage 拆成能力拥有者与 provider 两层（Conversation 1 落地时相对 v3 的调整，理由见下）：

```text
packages/plugins/infra/storage/          能力拥有者
├── src/
│   ├── index.ts                          descriptor
│   ├── plugin.ts                         backend ExtensionPoint + Storage.backend()
│   ├── errors.ts
│   ├── upload.ts                         UploadGrant / UploadTicket（两端共用）
│   ├── db/entities.ts                    storage_upload_reservations / storage_attachments
│   ├── server/
│   │   ├── index.ts
│   │   ├── backend.ts                    StorageBackend 契约（四 primitives）
│   │   ├── registry.ts                   StorageBackends 注册表 + boot 屏障
│   │   ├── service.ts                    prepare/complete/metadata/bind/open/retire
│   │   ├── quota.ts
│   │   ├── cleanup.ts
│   │   └── db.ts
│   ├── client/index.ts                   upload driver 注册表 + upload()
│   └── testkit/
│       ├── index.ts                      memory backend
│       └── contract.ts                   所有 provider 共用的契约用例
│
packages/plugins/infra/storage-local/    provider：本机磁盘
│   ├── src/index.ts                      Storage.backend({code:'local'}) + 注册
│   ├── src/payload.ts                    grant payload（两端共用）
│   ├── src/server/{backend,config}.ts    .tmp + 原子安装 + 流式 SHA-256
│   └── src/client/upload.ts              raw PUT driver
│
packages/plugins/infra/storage-cos/      provider：腾讯云 COS
    ├── src/index.ts                      Storage.backend({code:'cos'}) + 注册
    ├── src/payload.ts
    ├── src/server/{backend,config,policy,sts}.ts
    └── src/client/upload.ts              cos-js-sdk-v5 putObject driver
```

为什么这样拆：

- 「什么叫附件」是 Qualy 的概念，「附件现在放在腾讯云」是部署决策。两者放进同一个包会让每个安装都背上 COS SDK 与本机磁盘代码。
- 这与仓库已有形态一致：auth 定义 `LoginDriverDeclarations`，`@qualy/plugin-auth-local` 经 `Login.driver` 贡献；storage 定义 `StorageBackendDeclarations`，provider 经 `Storage.backend` 贡献。
- **可以同时安装多个 backend，但同一时刻只有一个默认写入 backend**。新附件写 `config.defaultBackend`；历史附件按 `attachments.backend` 回到写它的那个 provider。否则把默认从 local 换成 cos 会让此前所有附件打不开。
- Assessment 只 `dependsOn storage`，**绝不依赖任何 provider**。

装配期的两半：

- 声明是纯数据，`prepare` 相位编译成 `DeclaredBackends`；同一 code 被两个插件认领在编译期硬失败。
- 实现是服务：provider 在自己的 layer 里 `StorageBackends.register(backend)`（provider `dependsOn storage`，注册表此时已存在）。
- 两半在 Assembled 屏障对齐：**声明了却没注册**、**默认 backend 没安装**都是启动硬失败，而不是第一个上传的人才发现。

浏览器同理分两层。`prepareUpload` 返回 `{ driver, payload }`，core 不解释 payload；业务 UI 只调 `upload(ticket, file)`，由 provider 的 client driver 认领自己的 driver 名。因此 `cos-js-sdk-v5` 只在 storage-cos 的浏览器半边出现。

Local 的 raw PUT route 归 `@qualy/plugin-storage-local`（不是 Assessment），Conversation 1 只落地 receiver primitive 与契约测试，route 随附件 API 一起接入；COS 不需要 route，因为浏览器直传。

第三方依赖全部继续进入 workspace `catalog:`，不在单包散写版本。Conversation 1 安装/更新时锁定当前验证过的兼容版本并提交 lockfile；不要把“最新版”写成运行时行为。

Storage 生产只配置一个默认写 backend；`attachments.backend` 记录实际写入来源，使历史对象自描述，但 M2 不实现动态多云路由。

---

## 5. Storage 设计

### 5.1 两张表：`storage_upload_reservations` 与 `storage_attachments`

上传能力与业务附件分表。表名带插件前缀：`attachments` 这种通用名在共享 schema 里迟早会被另一个域想要。

#### `storage_upload_reservations`

```text
id                    uuidv7 PK
tenant_id             uuid NOT NULL
owner_user_id         uuid NOT NULL
attachment_id         uuid NOT NULL
backend               text NOT NULL
storage_key           text NOT NULL
filename              text NOT NULL
declared_mime         text NOT NULL
reserved_bytes        bigint NOT NULL
status                issued | completed | expired | failed
grant_expires_at      timestamptz NOT NULL
cleanup_after         timestamptz NOT NULL
created_at            timestamptz NOT NULL
completed_at          timestamptz NULL
expired_at            timestamptz NULL
failed_at             timestamptz NULL
cleanup_claimed_at    timestamptz NULL
```

`attachment_id` 在 prepare 时就生成，因此最终 key 从第一秒固定：

```text
attachments/{tenantId}/{attachmentId}
```

`grant_expires_at` 是上传凭据失效时间；`cleanup_after` 必须晚于它，给已经开始但仍在传输中的 PUT 留安全余量。

推荐起始值：

```text
upload grant TTL = 15 min
cleanup_after     = grant_expires_at + 30 min
```

因此 unused reservation 最长大约占 45 分钟 reservation quota。不要提供 M2 的“刷新同一 reservation 上传凭据”能力；凭据过期后重新 prepare，得到新的 attachmentId/key，避免无限续租。

#### `storage_attachments`

只有 `completeUpload` 真正确认对象后才创建：

```text
id                    uuidv7 PK
tenant_id             uuid NOT NULL
owner_user_id         uuid NOT NULL
backend               text NOT NULL
filename              text NOT NULL
declared_mime         text NOT NULL
size                  bigint NOT NULL
integrity_algorithm   text NOT NULL
integrity_value       text NOT NULL
etag                  text NULL
storage_key           text NOT NULL
status                staged | bound | retired
bound_at              timestamptz NULL
created_at            timestamptz NOT NULL
cleanup_claimed_at    timestamptz NULL
```

约束：

- `(tenant_id, id)` unique。
- `(backend, storage_key)` unique。
- reservation `(backend, storage_key)` unique。
- reservation `attachment_id` unique，避免一张票生成多个 Attachment。
- `reserved_bytes > 0`。
- Attachment `size >= 0`。
- status check。
- `integrity_value` 不唯一。
- `bound_at` 一旦出现不再清空。
- `cleanup_claimed_at` 是短租约，不是业务状态；claim 超时后允许别的 worker 接管。
- `bind` / `complete` 必须拒绝仍处于有效 cleanup claim 的对象，避免网络 delete 与业务绑定并发。
- 不对 `tenant_id / owner_user_id` 建 org/auth FK，保持 `storage -> database` 单向依赖。

建议索引：

```text
storage_upload_reservations(tenant_id, owner_user_id, created_at)
storage_upload_reservations(status, cleanup_after)
storage_attachments(tenant_id, owner_user_id, status)
storage_attachments(status, created_at)
```

### 5.2 ObjectKey：直接最终 key，不存 filename

唯一格式：

```text
attachments/{tenantId}/{attachmentId}
```

禁止：

```text
attachments/{user}/证明材料.pdf
attachments/{user}/avatar.jpg
由 Browser 自己上传任意 Key
```

filename 只进 DB 展示字段，不进入 object identity。

直接最终 key 的三个不变量：

1. key 由 Backend 生成。
2. 一个 Attachment 一个 UUIDv7 key。
3. 第一次成功写入后禁止同名覆盖。

COS 依赖 `x-cos-forbid-overwrite: true`；Local 使用“临时文件 + 原子 rename/create-no-replace”达到同一语义。

### 5.3 quota：Object 还没存在，上传能力已经占额度

定义：

```text
physicalBytes =
  SUM(size of attachments where status in staged|bound|retired)

reservedBytes =
  SUM(reserved_bytes of reservations where status = issued)

committedBytes =
  physicalBytes + reservedBytes
```

因此恶意用户连续申请 key，即使一个都没有 PUT，也会耗尽：

```text
activeReservationCount
activeReservedBytes
```

`completed / expired / failed` reservation 不再计 reservedBytes，但不能立即物理删除：至少保留一个覆盖 `prepareRate` 窗口的运维周期，推荐开发/生产都保留 7 天后再批量清理，便于 rate limit、故障排查和审计。

推荐部署起始值：

```text
storage.maxFileBytes                  = 50 MiB
storage.defaultFieldMaxFileBytes      = 20 MiB
storage.owner.maxActiveReservations   = 5
storage.owner.maxReservedBytes        = 100 MiB
storage.owner.maxStagedBytes          = 250 MiB
storage.owner.maxStoredBytes          = 1 GiB
storage.uploadGrantTtl                = 15 min
storage.uploadCleanupGrace            = 30 min
storage.stagedTtl                     = 24 h
storage.prepareRate                   = 20 / hour / user
```

更严格的业务限制来自 Assessment：

```text
attachment.maxCount
attachment.maxFileBytes
Entry.max_entries
```

Storage 不认识 Batch；未来要做 Batch 总量配额时，由 Assessment 在 prepare 前叠加。

Tenant 必须有：

```text
warningBytes
criticalBytes
hardBytes
```

hard limit 的判断也按 `physical + reserved`，不能只看已经存在的 Attachment。

### 5.4 quota 并发：禁止 `SUM → INSERT` 超卖

错误：

```text
A read usage = 90 MiB
B read usage = 90 MiB
limit = 100 MiB
A reserve 10
B reserve 10
=> 110 MiB
```

M2 使用 PostgreSQL transaction-scoped advisory lock 串行化 quota admission。锁顺序固定：

```text
tenant quota lock
→ owner quota lock
→ 查询 rate / active reservation / physical usage
→ validate
→ INSERT reservation
→ commit
```

可以用 `pg_advisory_xact_lock(...)`，锁 key 从固定 namespace + tenant/owner id 确定性派生。具体 Kysely/Effect 写法必须遵循仓库当前 `Db.scope(...).query(...)` 与 ambient transaction API，不另开 pg client。

不要为了这件事增加容易漂移的 `usage_counter` 表。

### 5.5 `StorageBackend`：只保留四个 primitives

不需要 `promote`。实现这四个就是「成为一个 storage provider」的全部；其余（附件是什么、算谁的额度、什么时候被清理）归 core storage，与哪个 store 无关：

```ts
interface StorageBackend {
  /** 写进 attachments.backend 的那个词；历史附件据此找回写它的 provider */
  readonly code: string

  prepareUpload(request: {
    tenantId: string
    ownerUserId: string
    attachmentId: string
    reservationId: string
    key: string
    maxBytes: bigint
    grantExpiresAt: Date
  }): Effect.Effect<UploadGrant, BackendUnavailable>

  stat(key: string): Effect.Effect<BlobStat | null, BackendUnavailable>

  open(key: string, options: OpenOptions): Effect.Effect<BackendOpen, BackendUnavailable>

  /** 删除不存在的对象必须算成功：sweeper 会重跑 */
  delete(key: string): Effect.Effect<void, BackendUnavailable>
}
```

`BackendOpen` 是 `{ kind: 'redirect', url, expiresInSeconds }`（能签 URL 的 store）或 `{ kind: 'stream', body, size }`（不能的）。不是文件路径——那只对恰好用文件的 provider 有意义。

```ts
interface BlobStat {
  readonly size: bigint
  readonly integrityAlgorithm: 'sha256' | 'crc64-ecma'
  readonly integrityValue: string
  readonly etag?: string
}
```

`UploadGrant` 是 `{ driver, payload }`：core 不解释 payload，业务页面也不解释——页面只调 `upload(ticket, file)`，由该 driver 名对应的 provider client 认领。

### 5.6 Conversation 1 固定使用的 SDK / 库

#### Backend COS

```text
cos-nodejs-sdk-v5
```

只封装：

```text
headObject
deleteObject
getObjectUrl
```

M2 Backend 自己不上传对象，不需要 CopyObject、multipart、ListBucket。

#### Backend STS

```text
qcloud-cos-sts
```

使用 `getCredential(options, callback)`。它是 callback 风格，必须只在 `server/backends/cos/sts.ts` 做一次 Effect adapter，例如概念上：

```ts
const getCredential = (options: StsOptions) =>
  Effect.async<StsCredential, StsError>((resume) => {
    STS.getCredential(options, (err, data) => {
      if (err) {
        resume(Effect.fail(mapStsError(err)))
        return
      }
      resume(Effect.succeed(decodeCredential(data)))
    })
  })
```

实际 import 形式和类型以安装后的 `index.d.ts` 为准，不凭 CommonJS/ESM 记忆猜。

#### Browser COS

```text
cos-js-sdk-v5
```

M2 只使用：

```text
putObject
```

不要使用：

```text
uploadFile
sliceUploadFile
InitiateMultipartUpload
UploadPart
CompleteMultipartUpload
```

M2 全局硬上限 50 MiB，而 COS `PUT Object` 的能力远高于此，没有理由引入 multipart 状态机。

#### Local

只用 Node 内置：

```text
node:fs
node:fs/promises
node:path
node:crypto
```

不引入 multer / busboy / formidable；Local upload adapter 接原始 request body stream，不用 `multipart/form-data`。

### 5.7 COS `prepareUpload`：STS 必须精确到一个对象

示例：

```text
bucket = qualy-dev-files-1301296774
region = ap-beijing
key    = attachments/{tenantId}/{attachmentId}
```

临时 policy 概念上：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": ["name/cos:PutObject"],
      "resource": [
        "qcs::cos:ap-beijing:uid/1301296774:qualy-dev-files-1301296774/attachments/TENANT/ATTACHMENT"
      ],
      "condition": {
        "numeric_less_than_equal": {
          "cos:content-length": 20971520
        },
        "string_equal": {
          "cos:x-cos-forbid-overwrite": "true"
        }
      }
    }
  ]
}
```

实际代码必须用当前 bucket/region/appId/key/maxBytes 构造，不硬编码示例值。

Browser 获得的能力必须满足：

```text
只能 PutObject
只能 exact key
不能 Get/Delete/List
不能超过 maxBytes
必须 x-cos-forbid-overwrite=true
不得改写对象 ACL
有效期短
```

**限定 key 不等于限定这次写入**。`PutObject` 允许请求自带 `x-cos-acl` 与四个
`x-cos-grant-*`,拿到 STS 的人完全可以绕开我们的 upload helper,自己发一个合法 PUT 并附上
`x-cos-acl: public-read` —— 于是这份「私密证明材料」在第一次写入时就公开了。因此 policy 必须同时:

```text
string_equal_if_exist { "cos:x-cos-acl": "private" }

deny × 4(每个 header 一条独立 statement):
  string_like { "cos:x-cos-grant-read": "*" }
  string_like { "cos:x-cos-grant-read-acp": "*" }
  string_like { "cos:x-cos-grant-write-acp": "*" }
  string_like { "cos:x-cos-grant-full-control": "*" }
```

两处细节都是实测定下来的:`if_exist` 而不是 `string_equal`,否则不带 acl 头的正常上传会被拒
(不带就是桶默认的 private,本来就对);四条 deny 拆开写,因为同一个 condition 块里的多个键是**与**关系,
合并成一条只会在「四个头都带上」时才触发。CAM 父策略照同样口径再限一次。

Browser 永远拿不到 `QUALY_STORAGE_COS_SECRET_ID/KEY`。

父 CAM 用户 `qualy-dev-storage` 仍按最小权限限制在开发桶；建议 PutObject statement 也强制 `cos:x-cos-forbid-overwrite=true`，Head/Get/Delete 另行允许。不要关联 COS FullAccess。

### 5.8 Browser upload helper

业务 UI：

```ts
await storageUpload(grant, file)
```

而不是页面直接 import COS。

COS client adapter 概念上：

```ts
const cos = new COS({
  SecretId: grant.tmpSecretId,
  SecretKey: grant.tmpSecretKey,
  SecurityToken: grant.sessionToken,
  StartTime: grant.startTime,
  ExpiredTime: grant.expiredTime,
})

await putObject({
  Bucket: grant.bucket,
  Region: grant.region,
  Key: grant.key,
  Body: file,
  ContentType: file.type || 'application/octet-stream',
  'x-cos-forbid-overwrite': 'true',
})
```

最终 SDK Promise/callback 形态以当前 `cos-js-sdk-v5` 类型为准。client adapter 负责 SDK 差异，Assessment form 只处理 progress/success/error。

Browser 返回的：

```text
ETag
CRC64
Content-Length
```

全部只能用于 UI/debug，不进入 Attachment 真值字段。

### 5.9 COS `completeUpload`

`POST complete` body 为空。

Backend：

```text
1. lock/read reservation
2. assert owner
3. status=completed -> 返回既有 Attachment（幂等）
4. status!=issued -> 按状态拒绝
5. backend.stat(storageKey)
6. not found -> UPLOAD_NOT_COMPLETED，reservation 保持 issued
7. size > reservedBytes -> 拒绝,但 reservation 保持 issued(见下)
8. 验证 stat 中存在可接受 integrity
9. transaction:
     insert Attachment(staged)
     reservation issued -> completed
10. return Attachment
```

COS `stat` 从 `HEAD Object` 读取：

```text
Content-Length
ETag
x-cos-hash-crc64ecma
```

CRC64 以字符串保存，不转 JavaScript `number`。

由于 key 从第一次上传起就是最终 key，complete 不再有对象存储写操作；`HEAD → DB transaction` 即可。HEAD 成功后进程崩溃，客户端重试 complete 即能收敛。

**oversized 分支不得把 reservation 置 failed**。置 failed 会在对象还躺在桶里的时候把额度还给用户,
而 abandoned sweeper 只扫 `status = 'issued'` —— 那个对象从此没有任何人负责,成为永久 orphan。正确做法是
保持 issued、直接拒绝,让凭据失效 + grace 之后的正常 sweep 删对象、再释放额度。正常路径上 COS 的
`cos:content-length` 与 Local 的流式限长已经拦住了超量写入,这条分支是 defense-in-depth——而 defense-in-depth
不该制造更坏的状态。

### 5.10 Local backend：语义与 COS 一致，实现细节可以不同

Local 最终路径：

```text
<root>/attachments/{tenantId}/{attachmentId}
```

一次性 local upload handler：

```text
raw request body
  ↓
<root>/.tmp/{reservationId}
  ├── 流式累计 size
  ├── 超 maxBytes 立即中止
  └── 流式 SHA-256
  ↓ successful EOF/close
atomic install to final key
```

安装 final key 必须 create-no-replace；若 final key 已存在，视为 overwrite conflict。

失败/断流删除 `.tmp` 文件。

`completeUpload` 再 stat 最终文件并得到可信 size/SHA-256；不要直接信上传 handler 返回给 Browser 的值。

Local 拆成独立 provider 之后，raw PUT route 归 `@qualy/plugin-storage-local` 自己（它可以依赖 api/web，而 core storage 不必），不再挂到 Assessment 的 HTTP boundary。Conversation 1 只落地 stream receiver primitive 与契约测试，route 随附件 API 一起接入：route 需要判断“谁在上传”，那份判断随 reservation 凭据一起设计更合适。无论如何都不要因为 Local route 给 core storage 增加 auth/assessment 反向依赖。

### 5.11 abandoned upload GC：必须晚于上传凭据失效

直接最终 key 后，没有 `incoming/` lifecycle。

对：

```text
UploadReservation.status = issued
AND cleanup_after <= now
```

scheduler：

```text
claim reservation
→ backend.delete(storageKey)
→ status = expired
→ 释放 reserved quota
```

`cleanup_after` 必须晚于 `grant_expires_at` 足够时间，避免“签名已开始的慢 PUT 与 GC 同时完成”造成晚到对象。

M2 推荐：

```text
grant TTL = 15 min
cleanup grace = 30 min
```

如果 delete/网络调用失败：

- reservation 保持可重试 cleanup 状态/claim lease
- 不释放 reserved quota
- 下轮继续

不要在持有 DB row lock 时调用 COS。采用：

```text
短事务 CAS claim
commit
网络 delete
短事务 finalize
```

claim 使用 `cleanup_claimed_at + lease`（或仓库已有等价 primitive），多实例只允许一个 worker 当前处理。

**lease 只对 sweeper 有意义,对业务 transition 没有**。`bind` 与 `completeUpload` 遇到
`cleanup_claimed_at IS NOT NULL` 一律拒绝,不看它有多旧:「租约过期」只说明另一个 sweeper 可以接手,
不说明原来那个 worker 已经停下——它那个迟到的 DELETE 可能正在路上。如果按「过期即视为无人认领」放行,就会出现:

```text
T0        worker A claim
T0+5m     lease 过期
T0+5m1s   用户 bind 成功    staged → bound
T0+5m2s   A 那个迟到的 delete 成功
          DB = bound,对象不存在
```

这是不可恢复的历史损坏。反过来,「claim 了就永远不能 bind」不会卡死:那一行本来就在被删除的路上。

直接最终 key 以后**不要给 `attachments/` 配“1 天全部删除”的 COS Lifecycle**，否则会把 staged/bound/retired 正常对象一起删掉。M2 的未完成上传由 DB-backed sweeper 负责。

### 5.12 staged GC：已经 complete 但没保存业务草稿

```text
Attachment.status = staged
AND created_at < now - stagedTtl
AND 没有任何 EntryRevisionAttachment 引用
```

清理：

```text
CAS claim staged row
→ bind 因有效 claim 暂时不能取得 staged→bound
→ 再次确认仍未 bound/无 relation
→ backend.delete(storageKey)
→ delete Attachment row
```

先删 backend object，再删 DB row；反过来会制造不可索引 orphan。

`bind` 与 GC 对同一 Attachment 必须串行/条件竞争，只有一个能赢。一旦：

```text
staged → bound
```

TTL GC 永久停止。

### 5.13 staged / bound / retired

`staged`：

- backend 已确认
- 尚未进入不可变 Revision
- uploader 可在业务授权入口预览
- 受 staged TTL

`bound`：

- 已被不可变 Revision 引用
- 同一 Entry 的后续 Revision 可按规则复用
- 不进入 TTL GC

`retired`：

- **只能从 `bound` 进入**
- 禁止新增引用
- 普通选择器隐藏
- 历史不可变引用仍可授权读取
- M2 不物理删除
- 继续计入 physicalBytes

`staged → retired` 是被明确拒绝的(`not-bound`)。retire 是一句关于历史的话——「它曾被引用,今后不再接受新引用」;
staged 附件没有历史可言,把它 retire 只会为了「有人上传过、又没用」而永久保留一行和一份字节,还得伪造一个
`bound_at` 去满足 check 约束。staged 的归宿是 TTL sweep。

### 5.14 新 Revision 引用附件

- staged：必须 `owner_user_id == actor`
- **owner 检查在幂等之前**:已经 bound 的附件被别人再 bind 一次,答 `not-owner` 而不是「已绑定,成功」。
  幂等是给 owner 重试用的,不是给所有人用的;把成功的 bind 当作「这份材料是我的」的凭据是后续会话很自然的写法。
- bound：M2 只允许已被当前 Entry 旧 Revision 引用的附件复用
- retired：禁止新增 relation
- 禁止跨 Entry 借用 bound attachment
- driver 验证 `required / maxCount / maxFileBytes / accept`
- `accept` 是产品约束，不是恶意内容安全边界

bind 与 EntryRevision 必须在同一个数据库 transaction 中完成。

### 5.15 防图床 / 网盘

上传侧：

```text
prepare rate limit
∩ active reservation count
∩ active reserved bytes
∩ owner staged/stored quota
∩ tenant hard quota
∩ exact-object STS
∩ max Content-Length
∩ forbid overwrite
```

读取侧：

- Bucket private。
- 无 permanent public URL。
- `GET /assessment/attachments/{id}` 先过 Assessment authorizer。
- COS 返回 60 秒级短期 signed GET URL。
- Local 由受控 HTTP handler stream。
- download ticket / endpoint 做 rate limit。
- 默认 `Content-Disposition: attachment`。
- `X-Content-Type-Options: nosniff`。
- HTML/SVG 等主动内容不在主站 origin inline。

因此“拿到一张上传票”既不是永久存储能力，也不是永久公开分发能力。

### 5.16 MIME / filename

`declared_mime` 来自客户端，只是展示/产品校验信息，不是可信内容检测。

filename：

- 只存 DB
- 不进 ObjectKey
- 输出 header 前安全编码
- 禁 CRLF/header injection

M2 不建设 MIME sniffing/病毒扫描服务。

### 5.17 COS 下载

Assessment 鉴权完成后：

```text
Storage.open
→ COS backend getObjectUrl(Sign=true, Expires≈60s)
→ API 302 到 signed URL
→ Browser 直接 COS 下载
```

M2 可以用受最小 CAM 权限约束的 Backend credential 本地生成短期签名；永久 SecretKey 永远不返回 Browser。

自定义下载域名是 deployment 配置，不进入 correctness。Backend 的 Head/Delete 继续按 Bucket + Region 调 COS。

### 5.18 COS CORS（开发桶）

开发 Bucket 至少允许实际开发 origin，例如：

```text
http://localhost:<vite-port>
https://qualy.hprogq.com
```

Methods：

```text
PUT
GET
HEAD
```

Allowed-Headers 可按腾讯云 Web SDK 要求配置；开发期可以 `*`。

可 expose：

```text
ETag
Content-Length
x-cos-request-id
x-cos-hash-crc64ecma
```

即使 Browser 能看到 CRC64，Attachment 入库仍只使用 Backend HEAD 的值。

生产 Bucket 不保留 localhost origin。

### 5.19 配置与密钥

配置按插件分开：能力拥有者管额度与默认写入 backend，provider 管自己的存放位置与凭据。

`@qualy/plugin-storage`（非 secret，进 `qualy.yml`）：

```yaml
'@qualy/plugin-storage':
  config:
    defaultBackend: local # 必须是某个已安装 provider 的 code
    limits:
      maxFileBytes: 52428800
      maxActiveReservationsPerOwner: 5
      maxReservedBytesPerOwner: 104857600
      maxStagedBytesPerOwner: 262144000
      maxStoredBytesPerOwner: 1073741824
      uploadGrantTtlMinutes: 15
      uploadCleanupGraceMinutes: 30
      stagedTtlHours: 24
      prepareRatePerHour: 20
      tenantWarningBytes: 51539607552
      tenantCriticalBytes: 60129542144
      tenantHardBytes: 68719476736
```

`@qualy/plugin-storage-local`：

```yaml
'@qualy/plugin-storage-local':
  config:
    root: ./data/storage # 相对 manifest 解析，与 cwd 无关
```

`@qualy/plugin-storage-cos`（region/bucket 进清单，密钥永不进）：

```yaml
'@qualy/plugin-storage-cos':
  config:
    region: ap-beijing
    bucket: qualy-dev-files-1301296774
    downloadDomain: https://files.qualy.hprogq.com
```

本地开发 secret：

```env
QUALY_STORAGE_COS_SECRET_ID=...
QUALY_STORAGE_COS_SECRET_KEY=...
```

同一份清单要在两台机器上写不同地方时，用 env 覆盖（env 优先于清单）：

```env
QUALY_STORAGE_DEFAULT_BACKEND=cos
QUALY_STORAGE_LOCAL_ROOT=/var/lib/qualy/storage
QUALY_STORAGE_COS_REGION=ap-beijing
QUALY_STORAGE_COS_BUCKET=qualy-dev-files-1301296774
QUALY_STORAGE_COS_DOWNLOAD_DOMAIN=https://files.qualy.hprogq.com
```

「装了哪些 backend」是清单决定（provider 插件的启停），「写哪个」是 `defaultBackend`。默认 backend 没安装 = 启动硬失败。

严禁：

```text
VITE_*SECRET*
PUBLIC_*SECRET*
NEXT_PUBLIC_*SECRET*
```

### 5.20 CAM 权限边界

开发 CAM 用户：

```text
qualy-dev-storage
```

只关联开发桶自定义策略，不使用 COS FullAccess。

长期 Backend 身份只需要：

```text
HeadObject
GetObject
PutObject
DeleteObject
```

其中：

- Head：complete/stat。
- Get：授权下载签名最终由 COS 验证。
- Put：作为 Browser STS `PutObject` 的权限上限。
- Delete：abandoned/staged GC。

不需要：

```text
ListBucket
GetService
PutBucket*
DeleteBucket
multipart actions
ACL write
CopyObject-specific workflow
```

`PutObject` 策略同时强制(不是建议,是必须):

```text
cos:x-cos-forbid-overwrite = true
cos:x-cos-acl              = private
拒绝任何 cos:x-cos-grant-*
```

STS 再进一步把 resource 缩到 exact ObjectKey,限制 `cos:content-length`,并把上面三条重复一遍——
CAM 与 STS 是两层,任何一层写松了都能让「私密材料」变成公开链接。

### 5.21 Conversation 1 腾讯云官方文档清单

编码时优先查官方当前版本，不根据旧博客猜 SDK：

- Node.js SDK 快速入门  
  `https://cloud.tencent.com/document/product/436/8629`
- 临时密钥生成及使用指引 / COS STS SDK  
  `https://cloud.tencent.com/document/product/436/14048`
- 使用临时密钥访问 COS  
  `https://cloud.tencent.com/document/product/436/68283`
- 上传安全限制（Content-Length / 防覆盖）  
  `https://cloud.tencent.com/document/product/436/104266`
- 条件键说明及使用示例  
  `https://cloud.tencent.com/document/product/436/71307`
- PUT Object  
  `https://cloud.tencent.com/document/product/436/7749`
- CRC64 校验  
  `https://cloud.tencent.com/document/product/436/40334`
- 生成预签名 URL  
  `https://cloud.tencent.com/document/product/436/36121`

编码前再核对 SDK 的当前 `.d.ts`，特别是：

```text
qcloud-cos-sts ESM/CJS import
cos-js-sdk-v5 putObject callback/promise shape
cos-nodejs-sdk-v5 headObject response headers
getObjectUrl Domain/Expires behavior
```

### 5.22 生产资源原则

M2 只冻结架构原则，不把会变化的腾讯云价格写进业务设计：

1. private COS bucket，标准存储，与生产计算资源尽量同地域。
2. 先用已有容量/流量权益或按量观察真实数据，再决定资源包。
3. 当前不为附件启用 CDN / EdgeOne / 全球加速。
4. 请求包不是当前优化重点。
5. 外网下载形成稳定月度用量以后再按实际分布买流量包。
6. 腾讯云费用预算告警与 Qualy tenant hard quota 同时启用。
7. 已归档 Batch 若长期低访问，再专项评估低频存储。
8. 不在同一台 2C4G/60G 主机上部署 MinIO 作为生产 canonical storage；Local backend 已覆盖自托管能力，同机 MinIO 不增加独立故障域。

---

## 6. Item / ItemRevision / ScoreGroup

### 6.1 `score_groups`

M2 只支持单层，但表结构可以直接采用最终形态：

```text
id
tenant_id
batch_id
parent_group_id NULL
name
cap numeric NULL
floor numeric NULL
sort_order
created_at
updated_at
```

M2 API 暂时拒绝 `parent_group_id != NULL`，M4 再开放树形编辑。

不要把“单层限制”编码成 DB 永久约束，否则 M4 还要 destructive change。

### 6.2 `assessment_items`

```text
id
tenant_id
batch_id
item_type
title
current_revision_id
score_group_id
max_entries
sort_order
status active | voided
voided_at?
voided_by?
void_reason?
created_at
updated_at
```

关键点：

- `current_revision_id` 是当前配置，不代表历史 Entry 应按它解码。
- 题目激活后不删。
- draft Batch：可硬删未产生业务事实的题。
- active Batch：只 void / restore。

### 6.3 `assessment_item_revisions`

```text
id
tenant_id
item_id
revision_no
entry_source student | administrative
form_config jsonb
scoring_config jsonb
review_policy jsonb
display_config jsonb
created_by
reason?
created_at
```

不提供 UPDATE 内容的 repo/service。

每次保存配置：

1. lock item / batch
2. 验 driver 安装
3. 验 configSchema
4. 验 scoring refs
5. 验 M2 reviewPolicy shape
6. 对 `{in_review, approved}` 的当前 EntryRevision 做兼容性试算
7. insert ItemRevision N+1
8. update item.currentRevisionId
9. active batch：`config_revision++` + config event

### 6.4 M2 `review_policy`

只支持这一种形状：

```json
{
  "stages": [
    {
      "selector": {
        "kind": "roleAt",
        "nodeTypeId": "<uuid>",
        "roleIds": ["<uuid>", "..."]
      },
      "quorum": { "type": "any" }
    }
  ],
  "normalTerminal": 0
}
```

M2 validator 明确拒绝：

- stages != 1
- nearestRole
- all
- atLeast
- normalTerminal != 0

这样 M3 是“开放更多已经冻结的 review grammar”，不是推翻 M2 数据。

---

## 7. `assessment.item-type` 扩展点

### 7.1 Server registry

采用现有 `Login.driver` 同型的 `prepare` ExtensionPoint。

建议真实接口比设计稿伪码多一个“附件引用提取”能力，因为 core 拥有 `entry_revision_attachments`，却不能理解 evidence payload 的字段结构：

```ts
interface AssessmentItemTypeDriver {
  readonly id: string

  readonly configSchema: Schema.Schema<unknown>

  decodePayload(
    config: unknown,
    payload: unknown,
    batch: { materialRange: { start: string; end: string } },
  ): Effect.Effect<unknown, ItemPayloadInvalid>

  attachmentRefs(
    config: unknown,
    payload: unknown,
  ): readonly {
    field: string
    attachmentId: string
    accept?: readonly string[]
  }[]

  readonly interaction: 'entry' | 'task' | 'derived'

  readonly scoring: {
    calculator: string
    aggregator: string
  }
}
```

这一增加是 M2 的真实需要，不是“为未来留 hook”：如果没有它，core 只能硬编码 evidence payload。

### 7.2 Evidence plugin

`@qualy/plugin-assessment-evidence` 只贡献：

```text
itemType = evidence
interaction = entry
```

M2 DSL：

```text
text
date
attachment
```

建议字段：

```ts
type EvidenceField =
  | {
      key: string
      type: 'text'
      label: string
      required?: boolean
    }
  | {
      key: string
      type: 'date'
      label: string
      required?: boolean
      min?: ISODate
      max?: ISODate
    }
  | {
      key: string
      type: 'attachment'
      label: string
      required?: boolean
      maxCount: number
      maxFileBytes?: number
      accept?: readonly string[]
    }
```

M2 不加 pattern，M3 需要编码校验时再加，避免当前无需求时顺带引入管理员 regex 的 ReDoS 语义。

date：

```text
合法范围 =
Batch.materialRange
∩ field.min/max（若配置）
```

---

## 8. Scoring registry 与精度

### 8.1 从 M2 就只有一个 `calcParticipant`

绝不写：

- Entry 页一个 +3 计算
- 结果页另一个 +3 计算
- 未来 ScoreRun 再写第三份

结构：

```text
collectParticipantScoreInput(...)
              ↓
       calcParticipant(input)
              ↓
        Breakdown
```

M2 的 `/my-result` 调同一个 `calcParticipant`。

M4 的 ScoreRun 只负责：

1. 冻结 input manifest
2. 对每个 participant 调同一个 `calcParticipant`
3. 存结果

### 8.2 M2 就采用 exact amount primitive

虽然复杂精度验收在后续里程碑展开，但数值规则已冻结，M2 没必要先留下 JS float 技术债。

内部建议从第一天使用 scale=1e4 的整数/BigInt：

```text
3.00   -> 30000
-1.00  -> -10000
```

API / JSON 不直接传 BigInt，输出 canonical decimal string：

```json
{
  "value": "3.00"
}
```

M2 fixed 只接受 decimal string 配置，不接受 JSON float。

### 8.3 M2 registry

同一个 `assessment.calculator` registry 可以用 tagged contribution：

```ts
type ScoringDriver =
  | { kind: 'calculator'; ref: 'fixed@1'; ... }
  | { kind: 'aggregator'; ref: 'sum@1'; ... }
```

core 自己贡献：

```text
fixed@1
sum@1
```

### 8.4 `fixed@1`

输入：

```json
{ "value": "3.00" }
```

对于 approved Entry：

```text
entry line = fixed value
```

对于 rejected / voided 等：

- rejected 且曾正式提交过：`excluded-evidence` 0.00 行
- draft：无行
- item voided：不再把 entry 行送入 aggregator，改为题级“不计分”行

### 8.5 `sum@1`

M2：

```text
item approved entry lines → sum
items in one group → sum
group floor/cap
all root groups → total
```

没有嵌套。

### 8.6 最小 Breakdown

建议从 M2 就采用稳定 lineId：

```text
entry:{entryId}
item:{itemId}:voided
grp:{groupId}:floor
grp:{groupId}:cap
```

输出最少包含：

```ts
interface BreakdownLine {
  lineId: string
  kind: 'entry' | 'excluded-evidence' | 'item-voided' | 'group-adjustment'
  label: string
  value: string
  itemId?: string
  provenance?: {
    entryId?: string
    entryRevisionId?: string
    reviewEventId?: string
    calculatorRef?: string
  }
}
```

顺序必须确定：

```text
group.sortOrder
→ item.sortOrder
→ entry.createdAt
→ entry.id
```

相同输入逐字节一致。

---

## 9. Entry / EntryRevision

### 9.1 `entries`

```text
id
tenant_id
batch_id
item_id
participant_id
current_revision_id
current_review_instance_id NULL
status draft | in_review | approved | rejected | voided
source self | proxy | record | import | system
created_at
updated_at
```

M2 实际产生：

```text
self
record
```

其他枚举可保留，但没有 API 路径产生。

### 9.2 `entry_revisions`

```text
id
tenant_id
entry_id
item_revision_id
revision_no
payload jsonb
actor_id
subject_id
source
note?
created_at
```

规则：

- client 不提交 `source`
- client 不提交 `item_revision_id`
- server 永远取 item.currentRevisionId
- actor = principal.userId
- subject = participant.userId
- 每次编辑 append
- 不 UPDATE payload

### 9.3 `entry_revision_attachments`

```text
tenant_id
revision_id
attachment_id
position
```

payload 内仍保留字段到 attachment id 的结构，关系表负责：

- 真实 FK
- 反向授权查询
- 引用完整性
- 顺序

### 9.4 Same-batch 数据库约束

M2 已经出现 self 与 record 两条写路径，因此按 M1 收尾时记入触发表的规则，现在应该真正补“同批次”约束，而不是继续只相信 service。

至少做到：

- Entry `(tenant,batch,item)` → Item `(tenant,batch,id)`
- Entry `(tenant,batch,participant)` → Participant `(tenant,batch,id)`
- `entries.current_revision_id` 必须属于本 Entry
- ReviewInstance `(entry_id, revision_id)` 必须指向同一 Entry
- relation `(tenant, attachment_id)` → Storage `(tenant,id)`

为了 composite FK，可增加必要的 unique indexes，例如：

```text
assessment_items (tenant_id, batch_id, id)
batch_participants (tenant_id, batch_id, id)
entry_revisions (tenant_id, entry_id, id)
```

不要为了“也许未来”加无业务依据的重复列；只加能直接堵住 M2 两条写路径交叉引用的约束。

---

## 10. ResourcePolicy：M2 最重要的安全工作

M1 的三层授权已经有：

```text
Authority → PhaseGate → ResourcePolicy
```

M2 第一个优先事项就是把第三层从空槽变成真实规则。

### 10.1 不要把 ResourcePolicy 写成“大 if”

建议分成纯决策：

```text
entryCreatePolicy
entryEditPolicy
entrySubmitPolicy
entryWithdrawPolicy
entryRecordPolicy
reviewDecisionPolicy
resultViewSelfPolicy
```

or 一个 tagged target：

```ts
type ActionTarget =
  | { kind: 'new-entry'; item; participant }
  | { kind: 'entry'; entry; item; participant }
  | { kind: 'review'; instance; entry; participant }
```

服务先把 ID 解析成 server-side target，再交给 policy。

### 10.2 Participant authority

participant action 的 Authority 仍然只回答：

```text
这个人现在是不是 active participant？
```

然后 ResourcePolicy 再回答：

```text
这个具体 Entry 是不是他的？
```

这保持 §32.56：

```text
成员关系行存在 = 历史可读
active = 当前写资格
```

### 10.3 staff authority 必须 target-aware

M1 的 `batchAuthority()` 只返回 `Set<permission>`，M2 不能继续拿它给 `entry.record` 做最终授权，因为它已经丢掉 assignment scope。

必须增加类似：

```ts
canStaffActOnParticipant(principal, batchId, permissionCode, participantFrozenAnchor)
```

判定必须同时满足：

```text
Role 当前仍携带 permission
∩ Batch 曾接受这个 permission
− Batch deny
∩ assignment scope 覆盖 participant frozen anchor
∩ resource scope 是 general 或当前 batch
```

不能出现：

```text
A 班有 entry.record
→ 因为 batchAuthority.has(record)
→ 去给 B 班 participant 录行政扣分
```

### 10.4 M2 action matrix

#### `entry.create`（student）

必须：

- active participant
- target participant = principal 自己
- item active
- current ItemRevision `entrySource=student`
- PhaseGate opens create
- phase item/participant scope 命中
- `max_entries` 未达到
- Batch 非 archived

#### `entry.edit`

必须：

- active participant
- Entry participant = principal
- item `entrySource=student`
- Entry.status ∈ `{draft,rejected}`
- 若 rejected，追加 revision 后 entry 回 draft
- PhaseGate opens edit
- item active

明确：

```text
in_review → 403
approved → 403
record entry → 403
其他 participant → 403
```

这就是 M2 验收里的 “SUBMITTED 后 edit 被 ResourcePolicy 拒”。

#### `entry.submit`

必须：

- active participant
- owner
- Entry.status = draft
- current revision 可按其 ItemRevision 解码
- 当前 item 仍 active
- PhaseGate opens submit
- 单 stage terminal 可解析且至少有一名有效 reviewer

成功原子：

```text
lock batch
lock entry
validate
create ReviewInstance round N
append submitted event
Entry.status = in_review
Entry.currentReviewInstanceId = new instance
```

#### `entry.withdraw`

必须：

- active participant
- owner
- Entry.status = in_review
- 当前 ReviewInstance active
- PhaseGate opens withdraw

成功：

```text
instance completed/cancelled
review event CANCELLED_BY_SUBMITTER
entry → draft
```

Revision 不回滚、不删除。

#### `entry.record`

必须：

- item active
- current ItemRevision `entrySource=administrative`
- target participant active
- principal 的 accepted `assessment.entry.record` authority 覆盖 target frozen anchor
- PhaseGate opens record
- basis/note 非空
- payload 合法
- attachments 合法

成功：

```text
source = record
actor = principal
subject = participant user
Entry.status = approved
不建 ReviewInstance
```

M2 不编码 `actor != subject` 作为全局规则：验收示例要求 actor≠subject，但现有领域设计没有裁决“工作人员不能行政认定自己”。不要偷偷替政策做决定。

---

## 11. Minimal Review

### 11.1 `review_instances`

建议直接落最终可演进的核心列：

```text
id
tenant_id
entry_id
revision_id
round_no
origin initial | appeal | reopen
initiator participant | staff
effective_chain jsonb
mode normal | escalated
current_stage_index
state active | blocked | completed
outcome?
current_role_ids uuid[]
current_node_id uuid
current_node_path ltree
created_at
completed_at?
```

M2 实际只会产生：

```text
origin = initial
initiator = participant
mode = normal
stage = 0
state = active/completed
```

这不是提前做申诉；只是 round 作为“每次正式提审一行”的审计身份从第一天就需要。

DB：

```text
UNIQUE(entry_id, round_no)
UNIQUE(entry_id) WHERE state IN ('active','blocked')
```

第二条直接防双击 submit / 并发 submit。

### 11.2 单 stage resolver

从 participant `anchor_lineage`：

1. 向上找最近 `nodeTypeId == policy.selector.nodeTypeId`
2. 得到 frozen node id
3. 解析 `roleIds` 在这个 node 上**精确锚定**的当前 holder
4. coverage=subtree 不参与“谁是审核人”
5. 剔除 self-review conflict：
   - subject
   - revision.actor
6. terminal 解析为空：
   - M2 submit 直接拒绝
   - 不静默上浮
   - 不找上级代审

M3 再加入 structural skip、BLOCKED、巡检等完整逻辑。

### 11.3 Inbox

M2 就坚持 pull model：

```text
active instance
× current_node_id
× current_role_ids
× 当前精确 RoleGrant
× Batch accepted review.process
× deny
× PhaseGate review.process
```

不落 assignee user id。

换届后列表天然变化，即使 M2 暂时不做五分钟巡检。

### 11.4 `review_events`

M2 至少：

```text
SUBMITTED
APPROVED
REJECTED
CANCELLED_BY_SUBMITTER
CANCELLED_ITEM_VOIDED
```

建议列：

```text
id
tenant_id
review_instance_id
kind
actor_id?
comment?
suggested_payload?
created_at
```

### 11.5 Reject suggestion

reject：

- `comment` 必填，trim 后非空
- `suggested_payload` optional
- 若有，必须按“受审 Revision 自己的 ItemRevision schema”验证
- attachment 字段不能引入新 attachment id；只能引用原受审 payload 已有附件
- 建议稿不推进 Entry.currentRevisionId
- 学生端只读
- 不提供 apply/copy action

reject 原子：

```text
lock instance
lock entry
guard active
append REJECTED
instance → completed/rejected
entry → rejected
```

approve 同样 first-writer-wins：

```text
UPDATE/guard state=active
append APPROVED
instance → completed/approved
entry → approved
```

approve/reject 并发：事务顺序决定，后到者得到结构化 conflict，而不是生成两个终局。

---

## 12. Item void

这是 M2 验收的一部分，不能留给 M3。

### draft Batch

- 未产生业务事实：delete
- 不显示“作废”仪式

### active Batch

void 必填 reason。

一个事务内：

1. lock batch
2. lock item
3. item.status → voided + actor/time/reason
4. 当前 `draft` Entry → `voided`
5. 当前 `in_review` Entry：
   - current ReviewInstance → completed/cancelled
   - append `CANCELLED_ITEM_VOIDED`
   - Entry → voided
6. approved / rejected Entry：
   - 保留原 status
   - 不删 revision/review
7. active batch：
   - bump config_revision
   - config event

M2 没有 source_claim，因此不存在 claim release；M3 加 claim 后，void 事务扩展 release。

### scorer

voided item：

- 不把任何 approved Entry 输入 `sum@1`
- 若 participant 对该 item 完全没历史：不生成 line
- 若有历史：生成一个 `item:{itemId}:voided`、0.00、“本题已作废，不计分”行

### UI

- 零 Entry 的 voided item：学生端隐藏
- 有 Entry：灰卡 + “本题已作废”
- 已终态 Entry 仍可展开全部历史

---

## 13. API

M2 建议增量 API：

### Item / ScoreGroup

```text
GET  /assessment/batches/{batchId}/items
POST /assessment/batches/{batchId}/items
GET  /assessment/items/{itemId}
PATCH /assessment/items/{itemId}
PUT  /assessment/items/{itemId}/status

GET  /assessment/batches/{batchId}/score-groups
PUT  /assessment/batches/{batchId}/score-groups
```

`PATCH item` 的“配置修改”不是 UPDATE ItemRevision，而是服务内部 append revision。

### Entry

```text
POST /assessment/entries
GET  /assessment/entries/{entryId}
POST /assessment/entries/{entryId}/revisions
PUT  /assessment/entries/{entryId}/status
```

建议 create body：

```json
{
  "batchId": "...",
  "itemId": "...",
  "participantId": "...",
  "payload": {},
  "note": "..."
}
```

不接收：

```text
source
actorId
subjectId
itemRevisionId
status
```

server 全部推导。

### Review

```text
GET  /assessment/review/inbox
GET  /assessment/review/instances/{instanceId}
POST /assessment/review/instances/{instanceId}/decisions
```

M2 decision：

```json
{
  "decision": "approve"
}
```

或：

```json
{
  "decision": "reject",
  "comment": "证明日期与填报日期不一致，请核对。",
  "suggestedPayload": {}
}
```

### Result

```text
GET /assessment/batches/{batchId}/my-result
```

M2 永远：

```json
{
  "mode": "provisional",
  ...
}
```

Publication 到 M5 再扩 mode。

### Attachment HTTP 边界

Storage 不直接暴露“任意用户上传任意文件”的公共业务 API。Assessment 已知 Batch / Item / field 后才能申请上传能力。

推荐：

```text
POST   /assessment/attachments/uploads
POST   /assessment/attachments/uploads/{reservationId}/complete
GET    /assessment/attachments/{attachmentId}
DELETE /assessment/attachments/{attachmentId}   # 仅 staged + owner 的显式放弃
```

prepare body：

```json
{
  "batchId": "...",
  "itemId": "...",
  "fieldKey": "proof",
  "filename": "proof.pdf",
  "declaredMime": "application/pdf",
  "size": 18245222
}
```

这里的 `size` 只用于 reservation admission 与 STS 最大 Content-Length；最终 `Attachment.size` 必须来自 backend stat。

Assessment 先做：

```text
participant/staff 是否能对该 item/field 上传
∩ field maxCount / maxFileBytes
∩ Entry/resource policy
∩ Storage owner/tenant quota
```

然后 Storage 生成：

```text
reservationId
attachmentId
expiresAt
uploadGrant
```

COS grant 的 key 是最终：

```text
attachments/{tenantId}/{attachmentId}
```

不是 incoming key。

`complete` body：

```json
{}
```

不得提交：

```text
key
bucket
size
hash
etag
backend
```

GET：

- Assessment authorizer 先鉴权。
- Local：受控 stream。
- COS：生成约 60 秒 signed GET，API 可 302。
- 普通调用者永远拿不到永久公开 URL。

所有 API 与 `tools/tests/support/frozen-routes.ts` 同笔更新。

---

## 14. 前端

### 14.1 Batch workspace

M2 增加：

```text
概览

个人
  我的填报
  结果公示/我的结果

工作
  审核工作

管理
  阶段安排
  参评名单
  人员权限
  批次设置
```

M2 暂不增加“填报进度”，等跨 participant 的 submission 列表真正建设时再放。

### 14.2 我的填报

桌面：

```text
当前阶段上下文
[简短 timeline context]

品德行为表现
  退役复学               +3.00
  [状态] [材料摘要] [审核状态]
  [新增/继续编辑/查看]

...
```

题目卡不要暴露：

```text
EntryRevision
ReviewInstance
permissionProfile
```

显示业务词：

```text
草稿
待审核
已通过
已驳回
已作废
```

### 14.3 Entry editor

evidence generic form：

- text
- date
- attachment
- 保存草稿
- 提交

`in_review` 后：

- 表单只读
- edit button 不出现
- 若 PhaseGate 允许 withdraw，可显示“撤回修改”

rejected：

- 顶部显示驳回意见
- 建议稿 read-only diff
- “修改并重新提交”进入本人编辑
- 保存时生成新 Revision

### 14.4 Review inbox

M2 只需：

```text
申请人
题目
提交时间
状态
```

keyset pagination。

Review detail：

```text
左：材料
右：申请人 / 题目 / 当前轮 / 历史
底：通过 / 驳回
```

reject dialog：

```text
审核意见 *
建议修改后的内容（可选）
```

### 14.5 我的结果

M2 就按未来核心页的结构做最小版：

```text
当前成绩（实时预览）

品德行为表现  2.00
  退役复学          +3.00
  行政扣分          -1.00

总分              2.00
```

不是只显示一个总分数字。

administrative line 可展开：

```text
来源：学院录入
录入人：...
录入时间：...
依据：...
附件：...
```

---

## 15. 错误模型

至少新增清晰域错误，而不是一律 `BadRequest`：

```text
ITEM_NOT_FOUND
ITEM_VOIDED
ITEM_CONFIG_INVALID
ITEM_TYPE_UNAVAILABLE
SCORING_DRIVER_UNAVAILABLE
ENTRY_NOT_FOUND
ENTRY_STATE_INVALID
ENTRY_PAYLOAD_INVALID
ENTRY_MAX_REACHED
ENTRY_NOT_OWNER
ENTRY_SOURCE_INVALID
ATTACHMENT_NOT_FOUND
ATTACHMENT_NOT_BINDABLE
ATTACHMENT_ACCESS_DENIED
REVIEW_NOT_FOUND
REVIEW_STATE_INVALID
REVIEW_ASSIGNEE_NOT_FOUND
REVIEW_NOT_ASSIGNEE
REVIEW_COMMENT_REQUIRED
```

外部 HTTP：

- malformed schema → 400
- not found → 404
- business state conflict → 409 / 422，按仓库既有语义
- authorization / ResourcePolicy → 403

ResourcePolicy 的内部 reason 要保留：

```text
not-participant
not-owner
item-voided
entry-not-editable
entry-not-submittable
staff-out-of-scope
review-not-assignee
```

便于测试与诊断，但 UI 不要把内部授权结构原样暴露给普通学生。

---

## 16. 事务与并发

### 16.1 总原则

继续 M1 纪律：

> 任何 Assessment 业务写先锁 Batch row，再对本聚合内对象做后续写。

这样 roster / item / entry / phase / void 不会互相穿透。

### 16.2 revision_no

```text
lock entry
read max/current revision_no
insert N+1
unique(entry,revision_no) backstop
update current_revision_id
```

### 16.3 round_no

```text
lock entry
ensure no active round
max(round_no)+1
insert
```

DB 两个 unique 兜底。

### 16.4 审核终局

approve/reject：

- lock ReviewInstance
- 只允许 `state=active`
- first writer wins
- event + projection + Entry status 同事务

### 16.5 `prepareUpload` quota admission

`prepareUpload` 的 DB 事务中：

```text
tenant advisory xact lock
owner advisory xact lock
read rate / active reservations / actual bytes
validate limits
generate attachmentId + storageKey
insert UploadReservation(issued)
commit
```

**提交事务后**再请求腾讯云 STS。禁止持有 DB lock 等云 API。

STS 失败：

```text
reservation → failed
```

并释放 reservation quota。

### 16.6 `completeUpload` 幂等

直接最终 key 后不再有对象 promotion：

```text
backend.stat(final key)   # 网络读，不在长事务中

TX:
  lock reservation
  if completed:
    return existing attachment
  assert issued
  re-check stat result belongs to same immutable key
  insert Attachment(staged) if absent
  reservation → completed
commit
```

客户端不提交可信元数据。

如果 stat 后进程崩溃，没有外部副作用需要回滚；重试即可。

### 16.7 Attachment bind

EntryRevision transaction：

```text
lock batch
lock entry
lock referenced staged attachments
validate refs
insert revision
insert relation rows
staged → bound
update entry current revision
commit
```

Storage.bind 必须加入 ambient transaction，不能内部自行 `Effect.run*` 或另开连接。

### 16.8 GC 与 bind / complete 竞态

网络 delete 不在 DB row lock 中执行。cleanup 使用短租约/CAS：

```text
TX1:
  claim row
commit

backend.delete(key)

TX2:
  verify claim + state
  finalize expired/delete
commit
```

reservation 只有在 `cleanup_after <= now` 后才允许 claim，保证 STS 已失效并留出慢 PUT tail。

staged GC 与 bind：

```text
bind:
  lock/conditional staged → bound

cleanup:
  claim only stale staged
  before delete re-check no relation
```

一旦 bound，cleanup 永远不得删除。

### 16.9 目标 staff scope

对 record/review 的 staff scope 判断必须发生在实际目标 participant 已解析之后。

M2 不需要把所有 RBAC 变更锁进同一 Assessment 事务；一个已经开始执行、在 revocation 并发提交前完成过授权判断的请求可以在线性化顺序上视为先发生。真正禁止的是“请求开始时根本没覆盖目标，却因为 batchAuthority 丢 scope 而放行”。

---

## 17. 测试门禁

### 17.1 Storage

公共 contract：

- prepare 立即 reserve bytes。
- active reservation count/bytes 超限拒绝。
- tenant/owner 并发 prepare 不 oversell。
- prepare rate limit 跨实例可重复验证。
- STS/prepare backend 失败后 reservation 释放。
- complete 不接受 client key/size/hash/etag。
- complete 对不存在对象返回 `UPLOAD_NOT_COMPLETED` 且 reservation 仍可用。
- complete 幂等，同一 reservation 不产生两个 Attachment。
- `integrity_value` 不 unique。
- tenant physicalBytes 包含 retired。
- grant 过期但 cleanup_after 未到时不提前删。
- cleanup_after 到时 abandoned object 被删除并释放 reserved quota。
- staged 超 TTL 且无 relation 被删除。
- staged GC 与 bind 并发不会误删 bound。
- bound/retired 永不 TTL GC。

Local mandatory：

- `../` filename 不影响路径。
- CRLF filename 不能注入 response header。
- raw stream 超限立即中断。
- SHA-256 / size 从真实文件派生。
- 断流无 final partial object。
- final install create-no-replace，同 key 第二次写失败。
- CI 不访问腾讯云即可完整跑绿。

COS opt-in：

- `qcloud-cos-sts` 能获取临时凭据。
- STS exact key：目标 key PUT 成功，另一个 key 403。
- `cos:content-length`：超 reservation 大小 403。
- 缺少/伪造 `x-cos-forbid-overwrite:true` 被 policy 拒绝。
- 同 key 第一次 PUT 成功，第二次覆盖失败。
- HEAD 得到真实 Content-Length + CRC64。
- ETag 不被当作内容 hash。
- complete 只使用 Backend HEAD 元数据。
- expired abandoned object delete 成功。
- signed GET 可下载，短 TTL 过期后不可继续使用。
- localhost + dev bucket 集成不需要 callback tunnel。

下载：

- staged uploader/业务授权边界正确。
- bound subject/reviewer/admin 由 Assessment authorizer 决定。
- private bucket 无永久 public URL。
- local response / API gateway 应使用 attachment disposition + `nosniff`。

### 17.2 Item / Evidence

- 重复 field key 拒绝
- date 超 batch materialRange 拒绝
- attachment required / maxCount
- 缺 driver 拒绝
- scoring ref 缺失拒绝
- M2 不支持的 review policy shape 拒绝
- active item config change append ItemRevision，不 UPDATE 旧 revision
- config revision 单调递增

### 17.3 Entry ResourcePolicy

矩阵至少：

| 场景                           | create | edit | submit | withdraw |
| ------------------------------ | -----: | ---: | -----: | -------: |
| active owner + open phase      |      ✓ |    ✓ |      ✓ |   按状态 |
| excluded owner                 |      × |    × |      × |        × |
| 其他 participant               |      × |    × |      × |        × |
| submitted/in_review 后 edit    |      - |    × |      - |        ✓ |
| approved edit                  |      - |    × |      - |        × |
| item voided                    |      × |    × |      × |        × |
| student 对 administrative item |      × |    × |      × |        × |

staff record：

- accepted record + scope A → A participant ✓
- 同 staff → B participant ×
- deny 后 ×
- role permission 被撤后 ×
- item source=student → ×

### 17.4 跨批次 FK 敌意测试

直接 SQL 尝试：

- Batch A Entry 指向 Batch B Item
- Batch A Entry 指向 Batch B Participant
- Entry.currentRevision 指向另一 Entry revision
- ReviewInstance revision 指向另一 Entry

全部由 DB 拒绝。

### 17.5 Review

- submit 新建 round 1
- double submit 只一轮
- reject comment 空拒绝
- reject suggestion 不改 Entry revision
- suggestion 引入陌生 attachment 拒绝
- reject → edit → revision 2 → submit → round 2
- reviewer exact node role 匹配
- subtree coverage 不能把错误节点上的 role 变成 stage member
- self-review 唯一候选时 submit 拒绝
- approve/reject concurrency 只有一个终局

### 17.6 Scoring

- approved +3 → `"3.00"`
- approved -1 → `"-1.00"`
- +3 + -1 → `"2.00"`
- rejected submitted entry → excluded 0 line
- draft 无 line
- voided item 不计分且有历史时产生 item void line
- group cap / floor 最小测试
- 同输入 Breakdown 深比较完全相等
- lineId 稳定

### 17.7 Browser E2E

最终至少 4 条：

1. 学生（Local backend）：prepare reservation → 上传 → complete → 保存草稿 → submit → reviewer approve → result +3
2. reject + suggestion → 学生自己改 → revision 2 → resubmit → approve
3. administrative -1 → 学生看到 actor/time/basis → result 2
4. item void → student grey card / banner，分数不再计入
5. 上传完成但不保存草稿：测试时钟推进超过 staged TTL 后 attachment 被 GC
6. 连续申请未使用上传 reservation：达到 active quota 后拒绝，过期后恢复

另加一个 HTTP hostile test：

```text
学生 B 直接调用学生 A 的 revision endpoint → 403
```

---

## 18. 九个对话的施工拆分

推荐 **9 个对话**。M2 的范围已经超过“一个会话写完再审”的合理体量；9 段可以让每段都以真实可验证的不变量收口，而不是把 Storage、Entry、Review、Scoring、UI 混在一次大提交里。

### 对话 1：Storage 基座

目标：

- 建 `@qualy/plugin-storage`
- `storage_upload_reservations` + `storage_attachments` entity / migration
- `BlobBackend` 四 primitives：prepare/stat/open/delete
- final immutable key：`attachments/{tenant}/{attachmentId}`
- Local backend（默认开发/CI）
- 腾讯云 COS backend（生产）
- `prepareUpload / completeUpload / metadata / bind / open / retire`
- quota：
  - owner active reservation count
  - owner reserved bytes
  - owner staged/stored bytes
  - tenant hard limit
  - DB-backed prepare rate
  - advisory-lock hostile concurrency
- Local：
  - raw stream receiver primitive
  - `.tmp` + atomic final install
  - streaming SHA-256
- COS：
  - `cos-nodejs-sdk-v5`
  - `qcloud-cos-sts`
  - `cos-js-sdk-v5`
  - exact-object `PutObject`
  - `cos:content-length`
  - `cos:x-cos-forbid-overwrite`
  - `HeadObject` / CRC64
  - `DeleteObject`
  - short-lived `getObjectUrl`
- abandoned reservation GC（只在 grant 失效 + grace 后）
- staged TTL GC
- cleanup claim lease，多实例安全
- provider-neutral integrity
- Storage service/testkit
- client upload adapter，不让 Assessment page 直接操作 COS SDK

明确不做：

- `incoming → canonical`
- CopyObject / promoting / reconciler
- COS callback / SCF
- CDN / EdgeOne / 全球加速
- multipart
- S3 provider 动物园
- 内容去重
- 病毒扫描

依赖：

```text
catalog:
cos-nodejs-sdk-v5
qcloud-cos-sts
cos-js-sdk-v5
```

版本在实际编码时核对官方当前 SDK/npm 与类型定义后锁入 catalog + lockfile，不在文档硬编码会快速过期的版本号。

实施顺序：

```text
1. CLAUDE.md / Effect source policy / assessment-design / STATUS
2. 先更新权威设计：直接最终 immutable key
3. package + catalog dependencies
4. entities/migration/indexes
5. quota admission + advisory lock tests
6. Local backend + shared contract tests
7. COS Node stat/delete/open adapter
8. STS policy builder + qcloud-cos-sts Effect adapter
9. Browser cos-js-sdk-v5 putObject adapter
10. cleanup lease + abandoned/staged GC
11. opt-in COS integration tests
12. generate/typecheck/test/frozen resolve/prettier
13. STATUS
```

Effect v4 的 HTTP body/stream/fs bridge 必须按仓库 source policy 检查 vendored source。腾讯云 SDK 的 import、callback、response header key 也必须以当前安装后的 `.d.ts` + 官方文档为准。

CI 只依赖 Local backend；COS integration test 用显式环境变量 opt-in，例如：

```text
QUALY_TEST_COS=1
```

没有云凭据时普通 `pnpm test` 必须全绿。

提交建议：

`feat(storage): add local and cos attachment backends`

落地记录（对话 1 完成时相对本节的偏离）：

- 拆成三个包：`@qualy/plugin-storage`（能力拥有者）+ `storage-local` + `storage-cos`，理由与形态见 §4。`BlobBackend` 改名 `StorageBackend`，`id` 改成 `code`，多 backend 可并存、`defaultBackend` 决定写哪个。
- 表名加插件前缀：`storage_upload_reservations` / `storage_attachments`。
- Storage 的失败不是 wire error。目前没有任何 HTTP 边界服务它们，所以它们是普通 tagged Error（`_tag` + reason），不带 `httpApiStatus`、不进 `tools/tests/error-codes.test.ts` 的全局码表、不写翻译。附件 API 接入时，由暴露端点的那个插件声明它自己答什么码并同笔登记——这也避免 core storage 为了几句文案去依赖 ui-registry。
- Local 的 raw PUT route 仍然没做（§5.10 已改成归 storage-local）。`prepareUpload` 已经返回 `/api/storage/local/uploads/{reservationId}`，route 随附件 API 接入。
- 浏览器 upload driver 的注册表已就绪，但「哪个模块把 provider 的 client driver 引进浏览器包」留到第一个上传表单出现时再定：现在没有任何页面上传，提前建聚合通道就是提前建错。
- tenant 三档配额（warning/critical/hard）落在 core config；warning 与 critical 只进日志，不拦上传。

### 对话 2：Assessment M2 数据骨架 + registry

目标：

- assessment dependsOn storage
- ScoreGroup
- AssessmentItem
- ItemRevision
- Entry
- EntryRevision
- EntryRevisionAttachment
- minimal ReviewInstance
- ReviewEvent
- composite same-batch FK
- `assessment.item-type`
- `assessment.calculator`
- fixed@1 / sum@1 registry skeleton
- 不做业务 API

重点：schema 一次定好，不一口气建 M3/M5 表。

提交：

`feat(assessment): add item and entry persistence`

落地记录（对话 2 完成时相对本节的偏离）：

- ExtensionPoint 的 id 字符串按仓库惯例命名（`@qualy/plugin-assessment/item-types` /
  `@qualy/plugin-assessment/calculators`），`assessment.item-type` / `assessment.calculator`
  仍是概念名。构造器住 `@qualy/plugin-assessment/plugin` 子路径（mirror `Login.driver` /
  `Storage.backend`），evidence 插件（对话 3）从这里贡献。
- **review_events.kind 用本插件既有的 kebab-case**（`submitted` / `approved` / `rejected` /
  `cancelled-by-submitter` / `cancelled-item-voided`），不用文档里的 SCREAMING_SNAKE——
  phase_events 已经把 `kind ~ '^[a-z0-9-]+$'` 定成插件口径，两张事件表两种大小写没有任何好处。
  对话 5 写事件时按此拼写。
- `items.current_revision_id` 与 `entries.current_revision_id / current_review_instance_id`
  在 DB 里 **nullable**：行与它的第一个 revision 互相引用，非空约束会让插入顺序无解
  （与 `assessment_batches.current_phase_id` 同型）。service 层从创建后保持非空。
- 同批次约束落了比 §9.4 底线更多的三条同型键：item→score_group 同批次、score_group parent
  同批次、item→current_revision 同 item、entry→current_review_instance 同 entry——
  都是"能直接堵住 M2 写路径交叉引用"的同一类，不需要新增列。
- `score_groups.cap/floor` 落 `numeric(12,4)`（1e-4 定点的列宽），配置金额从第一天就是
  decimal string：`fixed@1` 的 configSchema 拒绝 JSON number。
- `uq_review_instances_open_entry` 的谓词按 `pg_get_indexdef` 的回读形态拼写
  （`(state)::text = ANY (...)`）——comparator 对 expression index 做文本配对，
  更好看的写法会永远 diff 自己的 introspection。
- 收口一轮（外部审计六条）：`entry_revisions` 增列 `item_id`，两条复合键合抱钉死
  「payload 只按本 entry 所属题目的 revision 解码」（§9.2 的列表相应 +item_id）；items 的
  void shape 改真二选一并要求 `btrim(reason) <> ''`；review_instances 合并为 lifecycle 检查
  （completed ⇔ 有 completed_at 且有 outcome，outcome 词表仍留给审核状态机冻结）；
  score_groups 加 `floor <= cap`；`ItemTypes.driver` 声明期校验 id 格式（与 `item_type` 列
  同一正则）；scoring 注册点 id 定名 `@qualy/plugin-assessment/scoring-drivers`。
  生成器两个实测坑记 docs/notes/mikro-orm.md（改 CHECK 要换名；已有表 add CHECK 勿用 IN 列表）。

### 对话 3：Item 配置 + Evidence driver

目标：

- 新建 `@qualy/plugin-assessment-evidence`
- evidence text/date/attachment
- item/score-group API
- ItemRevision append
- M2 review policy validator
- configRevision 事件
- 两个 fixture：
  - 退役复学 +3
  - 行政扣分 -1

暂不做 Entry write。

提交：

`feat(assessment): add evidence item configuration`

落地记录（对话 3 完成时相对本节的偏离）：

- ~~administrative 题的 review_policy 必须是空对象~~ **已纠正（收口审计 P0）**：这条与
  assessment-design §13/§15 的冻结规则直接冲突——record 首次录入确实不走链，但申诉/复查按
  **EntryRevision 引用的 ItemRevision.review_policy** 现场解析救济链，administrative 题**必须配置**
  同一 M2 单 stage 形状。validator 现在对两种 entry_source 要求同一形状；行政 -1 fixture 带链。
  没有任何 Entry 曾按空 policy 落库（Entry write 尚未存在），无历史需要修复。
- scoring_config 的存储形状定为
  `{ calculator: { ref, config }, aggregator: { ref, config } }`，两个 ref 各自过目录、config 各自过
  该驱动的 configSchema。
- 组树 PUT 的 payload **没有 parent 字段**：M2 单层由形状保证，而不是收下再拒绝。
- 两个 fixture 落在测试（经 `validateItemConfig` + 真驱动 + 真内置 refs 的完整验证路径），不进 demo
  seed——seed 目前不建批次，等对话 8 有界面可看时一起做。
- evidence 插件 `dependsOn` 只有 assessment：驱动本身不 import storage（附件引用只是 id 提取），
  §4 图中的 storage 依赖等对话 4 真用到再声明。
- 收口一轮（外部审计八条）：`AttachmentRef` 增 `maxFileBytes`（core 持可信文件事实、驱动持字段规则，
  ref 是两者相遇处）；驱动契约增可选 `configIssues(config, batch)`（date 窗口与 materialRange 无交集
  在保存关卡拒绝）；`updateBatch` 改 materialRange 走 impact check（逐条 live entry 按**其自身
  ItemRevision 的 form** 在候选范围下试解，越界点名拒绝，`ASSESSMENT_MATERIAL_RANGE_INVALID`）；
  active 批次计分语义变更（scoringConfig / 换组 / cap / floor）理由必填（§32.8），装饰性修改不问；
  config 事件 diff 记 itemId 与 old/newRevisionId、组树 diff 记 added/removed/changed 逐字段
  [old,new]，**真 no-op 不追加 revision、不写事件、不动计数器**（jsonb 回读键序重排,比较用
  canonical stringify）；金额 wire schema 收到 `numeric(12,4)` 列宽（整数部分 ≤8 位）、int 字段收到
  int4 范围，floor/cap 比较走 1e4 定点 bigint 不再过 Number；policy 每一层都拒未知键；
  **entrySource 在题目存在任何 Entry 后冻结**（`entry-source-frozen`，改事实来源走作废+替换）。

### 对话 4：Entry + ResourcePolicy

这是 M2 安全核心。

目标：

- target-aware staff authority
- create self Entry
- append revision
- submit/withdraw state guard
- record trusted path
- source/actor/subject server derived
- max_entries
- attachment reservation 接入 + relation + transactional bind
- GET entry
- 结构化 ActionDecision 真正实现 policy layer

此时 submit 可以创建最小 ReviewInstance，但 inbox/decision 放下一会话。

hostile tests 必须先于 UI。

提交：

`feat(assessment): enforce entry resource policies`

### 对话 5：单 stage Review

目标：

- roleAt resolver
- exact-node holder
- self-review exclusion
- inbox
- detail
- approve
- reject
- reject comment
- suggestedPayload
- withdraw cancellation
- reject → revision → new round

不做 quorum/escalate/patrol。

提交：

`feat(assessment): add single-stage review flow`

### 对话 6：唯一 scorer + provisional result

目标：

- exact `ScoreAmount`
- fixed@1
- sum@1
- single-layer ScoreGroup
- collectParticipantScoreInput
- 全系统唯一 `calcParticipant`
- Breakdown / provenance / stable lineId
- `/my-result`
- +3 / -1 / +2 完整测试

提交：

`feat(assessment): add provisional scoring`

### 对话 7：题目作废 + 历史/附件授权闭环

目标：

- draft delete / active void
- void reason
- cancel in_review instance
- draft/in_review entry void
- terminal entries preserve
- scorer item-void line
- restore 不复活 review
- Assessment attachment authorizer
- excluded participant historical read
- retired old attachment read
- 重新做一轮跨域 security audit

提交：

`feat(assessment): close item lifecycle`

### 对话 8：前端真实竖切

目标：

- Batch workspace 新组：
  - 个人
  - 工作
- 我的填报
- evidence form
- provider-neutral upload UI（prepare → Storage client helper → complete；页面不判断 Local/COS）
- entry history
- reject suggestion read-only
- review inbox/detail
- 我的结果
- administrative record 入口
- Batch Settings 最小题目/组配置 UI
- responsive 只做必要布局，不扩 UI 设计范围

浏览器测试从这里开始大幅增加。

提交：

`feat(web): add assessment entry workflow`

### 对话 9：M2 收官审计

不要再加业务能力。

只做：

- 按本文全部 hostile matrix 重新审
- migration upgrade / clean replay
- frozen routes
- error code gate
- browser E2E
- build/chunk/smoke
- 删除死代码/陈旧注释
- `assessment-design.md` 补本轮实际裁决
- STATUS 摘录
- M2 验收报告

最终门禁：

```text
pnpm qualy resolve --frozen-lockfile
pnpm qualy generate
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
prettier --check .
```

提交：

`test(assessment): lock the first business vertical slice`

---

## 19. 每个对话都必须遵守的施工纪律

开场：

```text
CLAUDE.md
docs/agents/effect-source-policy.md
docs/effect-migration.md 相关节
docs/assessment-design.md 本会话相关节
STATUS.md 尾部
```

涉及 Effect v4：

- multipart
- stream/file body
- HttpApi binary response
- Layer/ExtensionPoint

全部实查 `repos/` 当前 catalog 对应源码，不凭 Effect v3 记忆。

收场：

1. 真实执行门禁。
2. 输出摘录入 STATUS。
3. 更新“下一步”为下一个会话的准确入口。
4. Conventional Commit，英文。
5. commit message 不出现 M2/s1/s2 等内部编号。

---

## 20. M2 最容易做错的 18 件事

1. **把 staff Batch permission 当成全 Batch 无范围权限。**  
   `batchAuthority.has(record)` 不能代替 target participant frozen anchor scope。

2. **让 client 提交 source / actor / subject / itemRevisionId。**  
   全部 server derive。

3. **student Entry 被工作人员通过普通 create/revision 接口修改。**  
   M2 无 proxy；任何他人写 student item 都应 403。

4. **SUBMITTED 后还能 append revision。**  
   `in_review` 内容冻结。

5. **ReviewInstance 复用。**  
   每次 formal submit 新 round。

6. **把 reviewer user id 永久写进 single stage。**  
   M2 使用 pull model + live holder。

7. **用 subtree coverage 决定 exact-node 审核人。**  
   stage membership 与 authority scope 不能混。

8. **附件授权只看 owner。**  
   record 等场景会把 subject 锁在业务材料外。

9. **把 retired 当物理删除。**  
   会破坏历史；retired 继续计 physical quota。

10. **把 Browser 的 size/hash/etag 当可信元数据。**  
    最终值必须 backend stat。

11. **未上传 ObjectKey 完全不占 quota。**  
    issued reservation 必须 reserve bytes。

12. **quota 只做 `SUM → INSERT`。**  
    并发会 oversell；tenant→owner advisory xact lock 顺序固定。

13. **给 Browser prefix 级 STS。**  
    M2 必须 exact ObjectKey + PutObject only + max Content-Length。

14. **只靠随机 UUID，不强制 forbid-overwrite。**  
    同一未过期 credential 仍可能尝试覆盖；COS policy/request 必须强制 `x-cos-forbid-overwrite=true`。

15. **凭据一过期就立刻 GC。**  
    已开始的慢 PUT 可能仍在进行；必须有 `cleanup_after` grace，而且网络 delete 不在长 DB transaction 内。

16. **COS Callback 成为正确性机制。**  
    正确性是 Browser complete hint + Backend HEAD；本地开发不需要 callback tunnel。

17. **结果页写临时 +3 / 用 JS float。**  
    必须唯一 `calcParticipant` + exact amount。

18. **为了未来顺手做 multipart/CDN/quorum/source_claim。**  
    会让 M2 再次退化成基础设施扩张。

---

## 21. M2 完成后的稳定接口，M3 可以直接站上去

M2 结束后，M3 应只是在这些稳定点上扩展：

### Entry

已稳定：

```text
Entry identity
immutable Revision
actor/subject/source
attachment relation
ResourcePolicy
round-per-submit
```

M3 加：

```text
proxy
source_claim
pattern/event_pick
```

### Review

已稳定：

```text
ReviewInstance
round_no
effective chain snapshot
roleAt exact-node
pull inbox
ReviewEvent
approve/reject
```

M3 加：

```text
multi-stage
nearestRole
quorum
panel/votes
escalation
BLOCKED
patrol
source claim approve transaction
```

### Scoring

已稳定：

```text
exact amount
registry
fixed@1
sum@1
calcParticipant
Breakdown
provenance
```

M4 加：

```text
nested ScoreGroup
lookup/range/decrement
max/min/countTier
更完整精度属性测试
```

### Storage

已稳定：

```text
UploadReservation
quota reservation before bytes exist
server-generated final immutable key
exact-object upload capability
complete = backend stat + staged Attachment
immutable Attachment
staged/bound/retired
Local backend
Tencent COS backend
provider-neutral integrity metadata
abandoned upload / staged GC
domain authorizer hook
private short-lived download
```

后续业务不应该再修改 Storage 的核心语义。新增对象存储厂商只能实现同一个窄 `BlobBackend`，不能把厂商特性泄漏进 Entry/Review。

---

## 22. 最终判断

M2 的真正风险不在“表多”，而在六个边界：

```text
上传能力 ≠ 已存在的业务附件
浏览器报告的元数据 ≠ backend 确认的可信元数据
附件所有权 ≠ 附件业务读取权
Batch staff authority ≠ 对所有 participant 的 authority
Entry 当前状态 ≠ 谁拥有修改权
Review 当前审核人 ≠ 提交时固定的某个 user
```

只要这六条从第一天建对，M2 可以作为 M3/M4/M5 的稳定业务地基。

推荐按 9 个对话施工，不再压缩。M2 完成后应当第一次具备“给非开发者现场演示”的价值，而不是只能解释数据库和接口。

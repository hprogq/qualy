# Qualy 行政认定完整开发设计方案

本文是实现规格。实现前先阅读本文提到的现有源码，不要根据旧文档重新发明领域模型。若本文与旧设计文档冲突，以当前源码已经实现的不变量为准。

目标不是建立一个新的“后台加分系统”，而是把目前已经存在、但 UI 仅有简单表单的 `administrative entry` 能力完善为完整的「行政认定」工作面。

---

# 1. 最终产品定义

当前用户侧名称：

`代为登记`

修改为：

`行政认定`

行政认定的准确含义是：

> 工作人员基于机构已经形成的正式事实，为参评人员直接登记加分、扣分或其他认定事项。认定提交后立即成为正式 Entry/Recognition，不进入普通审核链；参评人员如有异议，通过现有申诉机制处理。

它与真正的「代录」必须继续严格区分：

- `assessment.entry.proxy`：代录。工作人员替学生提交学生本可自行提交的材料，之后仍走正常审核。
- `assessment.entry.record`：行政认定。工作人员代表机构形成正式事实，直接生效，不经过普通审核。

不要把两者合并。

内部名称继续保持：

- `assessment.entry.record`
- `Entry.source = record`
- `/assessment/batches/:batchId/record`
- `RecordPage` 可逐步重命名文件，但不是必须

不要为了中文 UI 改名而迁移稳定的权限码、source enum 或 API。

---

# 2. 必须保持的现有领域不变量

实现过程中以下规则不得弱化。

## 2.1 行政认定仍然是普通 Entry

手动认定最终形成：

```text
Entry
  source = record

EntryRevision
  source = record
  actorId = 工作人员
  subjectId = 参评人员
  note = 认定依据

EntryRecognition
  source = record
  createdBy = 工作人员

Entry.status = approved
Entry.currentRecognitionId = recognition
```

批量导入最终形成完全相同的业务对象，只将来源换成：

```text
Entry.source = import
EntryRevision.source = import
EntryRecognition.source = import
```

任何评分、结果页、申诉、公示、撤销逻辑都只能消费 Entry/Recognition。

禁止增加：

```text
manual_scores
imported_scores
admin_points
```

等平行计分表。

`AdministrativeImport` 只是 provenance，不参与计分。

---

## 2.2 行政事实仍然 append-only

不得：

```text
UPDATE EntryRevision.payload
UPDATE EntryRecognition.values
DELETE Entry
DELETE EntryRecognition
```

现有系统已经明确采用：

```text
事实写入
→ 永久保留
→ 当前是否生效由 Entry.status / current pointer 表达
```

因此行政认定填错后的正确模型仍然是：

```text
旧 Entry → voided
+
重新创建一条新的行政认定
```

第一版不要增加“直接编辑行政认定”。

以后如果需要「更正」快捷操作，也只能把“撤销旧 Entry + 创建新 Entry”包装成一个原子业务动作，不能修改历史。

---

## 2.3 禁止自我认定

必须继续执行当前服务层规则：

```text
participant.userId === actor.userId
→ self-record-refused
```

批量导入也必须执行。

不要因为 Excel 是批量操作而绕过该检查。

数据库目前对 `record/import` 的 EntryRevision 也要求：

```text
actor_id <> subject_id
```

应用层和 DB 双层都必须保持。

---

## 2.4 必须填写认定依据

所有 `record/import` 最终 EntryRevision.note 都必须非空。

批量导入支持：

```text
统一认定依据
+
单行认定依据 override
```

最终规则：

```ts
finalBasis = rowBasis.trim() || defaultBasis.trim()
```

若最终为空，则该行 blocker。

---

## 2.5 行政认定必须经过当前 PhaseGate

手动认定和批量认定都继续使用：

```text
assessment.entry.record
```

作为 phase-gated action。

因此：

- 当前阶段未开放行政认定 → 不允许创建；
- 阶段关闭以后 → 不允许偷偷通过 Excel 导入；
- 撤销行政认定也继续按当前 `interveneOnEntry(void)` 规则执行；
- batch archived → 所有写操作拒绝。

不要为 bulk import/bulk reversal 开 bypass。

如果未来产品希望“阶段结束后仍允许纠错”，应该统一重新设计 `entry.record` 的纠错权限，而不是只给批量接口开洞。

---

## 2.6 权限必须按参评人的 frozen anchor 判断

不能只检查：

```text
authority.has('assessment.entry.record')
```

还必须执行当前：

```ts
staffReachesParticipant(...)
```

因此 Excel 中即使存在合法学号，只要该工作人员的 record scope 不覆盖该 participant：

```text
→ 不允许导入
```

外部错误不要泄露：

```text
“该学号存在，但你没有权限”
```

统一表现为类似：

```text
“未找到可认定的参评人员”
```

避免利用 Excel 接口枚举其他组织人员。

---

# 3. 导航与页面信息架构

继续放在现有 workspace：

```text
工作
  审核工作
  行政认定
```

不要挪到「管理」。

因为 `assessment.entry.record` 是独立工作人员能力，一个认定员完全可以没有 `assessment.batch.manage`。

页面 route 保持：

```text
/assessment/batches/:batchId/record
```

Page id 也暂时保持：

```text
assessment/batch-record
```

只修改用户可见 label：

```text
Record for someone
代为登记
```

→

```text
Administrative records
行政认定
```

图标建议从 `pen-line` 调整成更像“机构认定”的图标，例如 `stamp`（如果当前 icon registry 支持），否则继续使用 `pen-line`，不要为了图标增加基础设施。

---

# 4. 页面最终结构

「行政认定」不再以空白录入表单作为首页。

首页应首先回答：

> 当前这个批次已经做过哪些行政认定？

建议：

```text
行政认定
登记由机构直接确认并生效的加分、扣分和其他认定事项。

认定记录    导入记录                         [手动认定] [批量导入]
────────

[项目] [来源] [状态] [组织范围]     [搜索姓名 / 学号]

参评人员      认定项目       来源       状态          操作人       时间
─────────────────────────────────────────────────────────────
郭航旗        CET-6          手动认定   已认定        张老师       09-16
王君惠        优秀学生干部   批量导入   申诉处理中    李老师       09-16
邱毓          违纪扣分       手动认定   已撤销        王老师       09-15
```

不要增加：

- KPI 卡片；
- 饼图；
- 彩色 dashboard；
- “XX%认定率”。

这是工作台，不是经营驾驶舱。

---

# 5. 页面内部导航状态

建议沿用 Qualy 已有 `usePageQueryState + Drill + BatchBanner` 模式。

保持只有一个 Page route。

建议 query：

```text
/record
/record?mode=manual
/record?mode=import
/record?import=<importId>
/record?entry=<entryId>
```

其中：

- 默认：认定记录；
- `tab=imports`：导入记录；
- `mode=manual`：进入手动认定完整内容；
- `mode=import`：进入批量导入 wizard；
- `import=id`：进入一次导入详情；
- `entry=id`：打开行政认定 Entry Sheet。

不要为这些状态增加五个 workspace page。

手动表单和 Import Wizard 信息量较大，应采用 content drill，而不是小 Dialog。

单条 Entry 详情仍适合 Sheet。

---

# 6. 手动认定重构

现有 `RecordPage` 的领域逻辑基本正确，主要问题是页面结构和 participant picker。

当前代码只调用一次：

```ts
listParticipants({
  params: { batchId },
  query: {},
})
```

然后把第一页人员放进 `<NativeSelect>`。

由于 participant API 是 keyset pagination，这会导致 roster 较大时后面的人员无法选择。

因此必须修改 participant endpoint：

```http
GET /assessment/batches/:batchId/participants
```

新增：

```ts
q?: string
```

服务端 SQL 对：

```text
displayName
businessNo
```

搜索。

注意：

- q 必须进入 cursor fingerprint；
- record-only staff 原有 SQL reach filter 必须继续生效；
- 不允许先查询所有人再前端过滤。

然后实现共享：

```text
ParticipantPicker
```

支持：

- 输入姓名；
- 输入业务编号/学号；
- server-side search；
- keyset pagination；
- loading；
- empty；
- 显示 displayName + businessNo；
- 只选 active participant。

---

# 7. 手动认定表单继续沿用现有语义

抽出：

```text
AdministrativeRecordForm
```

从现有 `RecordPage.tsx` 迁移：

- EvidenceForm；
- Recognition Contract；
- recognition default assignment；
- dirty field 行为；
- basis；
- `expectedItemRevisionId`；
- createEntry。

不得破坏现有这一重要行为：

```text
材料字段发生变化
→ untouched recognition field 跟随默认推导

工作人员主动修改 recognition field
→ 该 field 成为人工 judgement
→ 后续材料变化不再覆盖
```

保留当前 session identity：

```text
itemRevisionId + participantId + attempt
```

换人、换项目、成功提交后都必须清空旧表单状态。

继续保留现有 `__proto__` 等 opaque recognition id 安全行为。

---

# 8. 行政认定记录 Read Model

新增专用 read endpoint：

```http
GET /assessment/batches/:batchId/administrative-entries
```

不要硬扩通用 `EntryView`。

query：

```ts
{
  cursor?
  limit?
  q?
  itemId?
  source?: 'record' | 'import'
  status?
  orgNodeIds?
  orgScope?
}
```

只返回：

```text
Entry.source IN ('record', 'import')
```

建议 response row：

```ts
{
  entryId: string

  participant: {
    id: string
    userId: string
    displayName: string
    businessNo: string | null
  }

  item: {
    id: string
    title: string
  }

  source: 'record' | 'import'

  status:
    | 'approved'
    | 'in_review'
    | 'rejected'
    | 'voided'
    | ...

  revision: {
    id: string
    payload: unknown
    note: string | null
    actorId: string
    actorName: string | null
    createdAt: string
  }

  recognition: null | {
    id: string
    itemRevisionId: string
    values: Record<string, unknown>
    fields: readonly {
      id: string
      schema: AtomicSchema
    }[]
  }

  importId: string | null
}
```

`recognition.fields` 必须按该 recognition 所引用的 frozen ItemRevision 读取，而不是按 Item 当前 revision 推断。

否则：

```text
三个月前认定的字段
+
今天已经修改的认定 schema
```

会被错误解释。

---

# 9. 行政认定状态显示

不要只有：

```text
有效 / 已撤销
```

因为行政事实可以被申诉。

现有 appeal 会执行：

```text
approved/rejected
→ in_review
```

申诉期间，当前成绩停止计入原结论。

因此直接复用现有 EntryStanding 的状态体系。

行政认定页面可翻译得更业务化：

```text
approved       已认定
in_review      申诉/复核处理中
rejected       认定未维持
voided         已撤销
```

但底层仍使用统一 Entry status。

不要创建第二个 administrative status state machine。

---

# 10. 单条行政认定详情

点击认定记录行打开：

```text
AdministrativeEntrySheet
```

可以最终与前面规划的 `ManagedEntrySheet` 合并。

内容：

```text
参评人员
认定项目

认定材料
...

认定结果
...

认定依据
...

来源
手动认定 / 批量导入

操作人
认定时间

若来自 import：
  [查看所在导入记录]

历史
EntryTrail / EntryHistory

[撤销认定]
```

所有内容应使用 frozen revision。

不要只展示当前 Item configuration。

---

# 11. 单条撤销认定

直接使用现有：

```http
POST /assessment/entries/:entryId/interventions

{
  kind: 'void',
  reason: '...'
}
```

不要添加：

```text
DELETE /administrative-record
```

确认文案：

```text
撤销此项行政认定？

撤销后，该事项将不再计入当前成绩。
原认定内容、依据、认定结果及历史记录仍会保留。

撤销原因 *
[...]

取消    确认撤销
```

如果当前 Entry 有正在进行的行政认定申诉，继续使用现有服务语义：

```text
cancel appeal round
→ ReviewEvent cancelled-by-staff
→ Entry voided
```

不要在前端手工处理。

---

# 12. 批量导入基本原则

V1 强制：

```text
一次 Import
=
一个 Batch
+
一个 administrative Item
+
一个确定的 ItemRevision
+
一个 XLSX 文件
```

禁止 V1 一个文件同时导入多个项目。

不要开发“万能 Excel 映射器”。

流程：

```text
① 选择认定项目
② 下载模板
③ 填写 Excel
④ 上传文件
⑤ 校验和预览
⑥ 确认导入
```

---

# 13. 不做持久化 Draft Import Job

不要一上传 Excel 就创建：

```text
AdministrativeImport(state=draft)
```

产品导入记录应该只表示：

> 一次真正成功发生过的批量行政认定。

因此：

- 上传文件：Storage staged attachment；
- Preview：临时计算，不产生 business history；
- 校验失败：不产生 Import row；
- 用户退出：staged file 由现有 storage GC 回收；
- Commit 全部成功后：才创建 `AdministrativeEntryImport`。

这与现有 `RosterImport` 的“import 是一次历史行为，不是当前真相”的设计保持一致。

---

# 14. 新数据模型

新增三个 entity。

## AdministrativeEntryImport

表：

```text
administrative_entry_imports
```

字段建议：

```ts
id UUIDv7 PK

tenantId
batchId

itemId
itemRevisionId

sourceAttachmentId

filenameSnapshot
sizeBytes
contentHashAlgorithm
contentHash

actorId

defaultBasis: string | null
importedCount: int

createdAt
```

这里不需要：

```text
state = draft/validating/failed/committed
```

因为只有 committed import 才有 row。

`itemRevisionId` 必须冻结。

`sourceAttachmentId` 指向 Storage Attachment。

成功 Commit 时：

```text
storage.bind()
+
insert AdministrativeEntryImport
```

必须在同一业务事务语义内完成，确保“正式 import”一定拥有已经绑定的原文件。

---

## AdministrativeEntryImportRow

表：

```text
administrative_entry_import_rows
```

字段：

```ts
tenantId

importId
sourceRowNo

participantId
entryId

businessNoSnapshot
displayNameSnapshot
```

不要重复保存：

```text
payload
recognition
basis
```

这些已经分别存在：

```text
EntryRevision.payload
EntryRecognition.values
EntryRevision.note
```

ImportRow 只负责 provenance：

```text
Excel 第 37 行
→ Entry abc
```

约束：

```text
unique(importId, sourceRowNo)
unique(entryId)
```

---

## AdministrativeEntryImportEvent

表：

```text
administrative_entry_import_events
```

用于记录 import-level 的业务动作。

字段：

```ts
id
tenantId
importId

kind
actorId
reason
affectedCount
createdAt
```

V1 kind 仅：

```text
reversed
```

单条 Entry 已有自己的 `voided-by-staff` EntryEvent。

ImportEvent 则回答：

> 为什么这 126 条在同一次操作中被撤销？

两者语义不同，都需要。

---

# 15. Import 当前效果不要存状态

不要在 Import row 存：

```text
activeCount
voidedCount
status = partially-reversed
```

这些都属于 derived state。

查询时根据 ImportRow → Entry.status 聚合：

```text
importedCount = 126

current:
  approved = 116
  inReview = 4
  rejected = 1
  voided = 5
```

UI 可进一步显示：

```text
126 条导入
121 条仍存在非撤销状态
5 条已撤销
```

不要维护第二份可漂移的计数。

---

# 16. Excel 身份字段

V1 使用：

```text
businessNo
```

作为外部稳定身份。

当前 users 已有：

```text
UNIQUE (tenant_id, business_no)
WHERE business_no IS NOT NULL
```

因此适合做 Excel identifier。

不要用姓名作为 identity。

模板：

```text
业务编号 *    姓名
20230001      张三
```

其中：

- 业务编号：真正匹配条件；
- 姓名：仅用于人工核对。

如果 businessNo 匹配但姓名不同：

```text
warning: name-mismatch
```

不是 blocker。

如果 participant 没有 businessNo：

```text
V1 不支持通过 Excel 定位
→ 使用手动认定
```

不要偷偷使用姓名模糊匹配。

---

# 17. XLSX 模板

当前仓库没有 XLSX library。

增加一个 server-only XLSX dependency。

优先尝试：

```text
exceljs
```

但在正式采用前必须验证：

- Node 24 ESM；
- 当前 tsconfig；
- pnpm build；
- server bundle；
- license；
- 不进入 browser common bundle。

如 ExcelJS 与当前 bundling 不兼容，再选择其他维护中的 server-side XLSX library。

不要直接引入老旧、无法维护或有已知安全问题的 SheetJS 包版本。

---

# 18. Workbook 结构

可见 Sheet：

```text
行政认定
```

隐藏 Sheet：

```text
_qualy
```

## 可见列

固定前两列：

```text
业务编号 *
姓名
```

之后按 ItemRevision.formConfig：

```text
evidence fields...
```

再按 recognition contract：

```text
认定：xxx
认定：yyy
```

最后：

```text
认定依据
```

---

## `_qualy`

至少记录：

```json
{
  "templateVersion": 1,
  "batchId": "...",
  "itemId": "...",
  "itemRevisionId": "...",
  "columns": [
    {
      "column": "C",
      "kind": "evidence",
      "key": "...",
      "type": "choice"
    },
    {
      "column": "F",
      "kind": "recognition",
      "id": "...",
      "type": "decimal"
    }
  ]
}
```

metadata 不是安全凭据。

服务器仍必须重新校验：

- batch；
- item；
- current revision；
- authority；
- reach；
- payload；
- recognition。

隐藏 metadata 只负责防止模板版本误用和稳定映射。

无需 HMAC。

---

# 19. Excel 类型规则

EvidenceForm 当前支持：

```text
text
date
integer
decimal
choice
attachment
```

Recognition 支持：

```text
text
integer
decimal
choice
boolean
date
```

导入规则：

### text

Excel text。

不得自动 trim 有业务意义的正文内容；只按现有 decoder 规则处理。

### businessNo

强制文本格式。

防止：

```text
001234
→ Excel 变成 1234
```

### date

模板要求：

```text
YYYY-MM-DD
```

server 最终使用现有 date validation。

不要信 Excel serial date 的本地 timezone 推断；parser 必须规范化为 calendar date。

### integer

必须 safe integer，继续遵守现有 bounds。

### decimal

转成 canonical decimal string。

禁止 IEEE float 直接进入 scoring。

例如：

```text
0.1
```

最终必须走 Qualy 现有 decimal parser/canonicalizer。

### choice

Workbook 对用户显示 label。

模板生成时同时保留 stable value mapping。

若 choice labels 唯一：

```text
国家级
省级
```

可直接映射。

若两个 enum value 的 label 相同，模板必须显示：

```text
国家级 [national]
国家级 [national-special]
```

保证可逆。

### boolean

显示：

```text
是
否
```

严格映射为 boolean。

---

# 20. Attachment 字段

V1 不实现 Excel + ZIP。

规则：

如果 administrative Item 存在：

```text
required attachment field
```

则：

```text
bulkImportAvailable = false
```

UI：

```text
该认定项目要求上传证明材料，暂不支持批量导入。
请使用手动认定。
```

optional attachment 字段在 import 中必须保持 absent。

以后如果真实业务需要附件批导，再单独设计：

```text
xlsx + manifest + zip
```

不要在本次实现。

---

# 21. Recognition 默认值语义

手动认定当前是：

```text
Evidence
↓
default assignments
↓
Recognition form seed
↓
工作人员可以 override
```

批量导入必须完全一致。

每一个 recognition field：

```text
Excel 明确填写
→ 使用工作人员填写值

Excel 留空 + contract 有 default assignment
→ 从该行 evidence payload 通过现有 applyAssignment 推导

Excel 留空 + 无 default
→ blocker
```

最后统一执行：

```ts
provenRecognition(...)
```

不要为 Excel 写一套独立 recognition validator。

---

# 22. 统一依据与行级依据

Import Wizard 提供：

```text
统一认定依据
```

Excel 另有：

```text
认定依据
```

规则：

```ts
basis = nonBlank(rowBasis) ? rowBasis : defaultBasis
```

两者均为空：

```text
basis-required
```

每一条 EntryRevision.note 最终都必须实际写入完整 basis。

不要只把统一依据存到 Import 表而让 Entry 自己没有依据。

---

# 23. 批量导入上传

不要把 workbook 当普通 Entry evidence。

增加 Import 专用 upload door。

建议 API：

```http
POST /assessment/batches/:batchId/administrative-import-uploads
```

payload：

```ts
{
  itemId
  filename
  declaredMime
  size
}
```

检查：

```text
batch exists
item belongs to batch
item active
item.currentRevision.entrySource = administrative
caller has accepted assessment.entry.record
batch not archived
```

complete：

```http
POST /assessment/administrative-import-uploads/:reservationId/complete
```

底层继续使用现有 Storage.prepareUpload / completeUpload。

此时 attachment 仍是：

```text
staged
```

只有成功 import commit 才 bind。

用户退出或 preview 失败：

```text
staged attachment
→ storage GC
```

---

# 24. Server 读取 XLSX

Preview 必须由服务器重新解析 workbook。

不能：

```text
浏览器解析 Excel
→ 把 rows JSON 给服务器
→ 服务器相信 JSON
```

否则：

```text
保存的原始 Excel
!=
实际写入的 rows
```

provenance 就失去意义。

使用 Storage.open 读取 staged attachment。

需要兼容两种 backend target：

```text
content stream
redirect URL
```

若是：

```text
content
```

直接 bounded read。

若是：

```text
redirect
```

server-side fetch signed URL：

- timeout；
- 最大 body 限制；
- 不接受超出 attachment meta.size；
- 不把 URL 写入日志；
- 非 2xx 视为 storage/backend failure。

不要为了 XLSX 增加另一个文件存储系统。

---

# 25. Import Preview API

建议：

```http
POST /assessment/batches/:batchId/administrative-import-previews
```

payload：

```ts
{
  attachmentId: string
  itemId: string
  expectedItemRevisionId: string
  defaultBasis?: string
}
```

Preview 是临时计算，不创建 DB Import row。

response：

```ts
{
  item: {
    id
    title
    revisionId
  }

  summary: {
    rows
    valid
    warnings
    errors
  }

  rows: [{
    rowNo
    businessNo
    displayNameFromFile
    matchedParticipant: {
      id
      displayName
      businessNo
    } | null

    payloadPreview
    recognitionPreview

    issues: [{
      severity: 'error' | 'warning'
      field: string | null
      reason: string
    }]
  }]

  canCommit: boolean
}
```

V1 设明确上限：

```ts
MAX_ADMINISTRATIVE_IMPORT_ROWS = 2000
```

超过直接拒绝：

```text
too-many-rows
```

这是防止一个 HTTP request 意外变成后台批处理系统。

如果未来确实需要 1 万/10 万条，再设计异步 Import Job。

---

# 26. Preview 校验顺序

先 global，再 rows。

## Global blocker

检查：

```text
文件不是合法 XLSX
模板版本不支持
batchId 不匹配
itemId 不匹配
itemRevisionId 不匹配
当前 ItemRevision 已变化
Item 不是 administrative
Item 不是 active
required attachment field 存在
batch archived
当前 phase 不开放 assessment.entry.record
caller 不再持有 record authority
行数超过限制
```

其中 ItemRevision stale 建议直接使用现有：

```text
ASSESSMENT_ITEM_REVISION_CONFLICT
```

---

## 每行 blocker

依次检查：

```text
businessNo 为空
businessNo 找不到 active participant
participant 不在当前 batch
participant excluded
participant 超出 caller record reach
participant == caller
payload 无法 decode
材料日期超出 materialRange
required evidence 缺失
recognition 无法完整形成
recognition schema invalid
scoring determination refused
最终 basis 为空
maxEntries 超限
```

---

## warning

建议 V1：

```text
name-mismatch
duplicate-in-file
possibly-duplicate-existing-entry
```

warning 不自动阻止 commit，但 commit 必须要求：

```text
confirmWarnings = true
```

避免用户完全没看就导。

---

# 27. Participant resolution 必须一次 SQL 完成

不要：

```text
for row:
  select user
  select participant
  staffReachesParticipant
```

形成 N+1。

新增 DB helper，大意：

```ts
resolveAdministrativeImportParticipants({
  tenantId,
  batchId,
  actorId,
  businessNos,
})
```

SQL 一次完成：

```text
User
JOIN BatchParticipant
+
active participant
+
businessNo in (...)
+
staffReachOver(...)
```

返回当前 caller 真正能认定的 participant。

对于其他 businessNo：

```text
全部表现为 participant-not-found
```

这样既高效也不泄露 scope 外身份。

---

# 28. maxEntries 批量检查

不能每行单独 `entryCountOf()`。

一次聚合：

```text
GROUP BY participantId
```

得到：

```text
existing effective entry count
```

然后加上 workbook 内相同 participant/item 即将创建的数量。

注意当前 quota 不计：

```text
voided
```

继续遵守这一规则。

例如：

```text
maxEntries = 2

数据库有效 entry = 1
Excel 同一学生有 2 行
→ 两行均不能整体 commit
```

Preview 必须能指出具体超限行。

---

# 29. Duplicate 不等于 maxEntries

不要建立：

```text
UNIQUE(participant, item)
```

因为 maxEntries 可以大于 1。

duplicate 仅作为业务 warning。

可以基于 canonical：

```text
payload
+
recognition
```

生成 fingerprint。

`basis` 不参与事实 fingerprint。

同一个事实换了一段依据，不应该躲过 duplicate warning。

但 duplicate 不是 blocker：

有些项目本来允许同类型多次获奖。

---

# 30. Scoring proof：这里必须特别谨慎

当前单条行政认定不是在 DB transaction 中运行 calculator。

它使用：

```text
attempt write
→ ProbeNeeded
→ transaction rollback
→ transaction 外 prove
→ 第二次 write
```

这个设计必须保留。

批量导入绝对不能：

```text
BEGIN
for 2000 rows:
  runtime calculator
COMMIT
```

这会长时间占用 batch lock / DB connection，而且破坏当前 scoring isolation。

批量流程应为：

```text
解析和业务预校验
        ↓
形成全部 canonical recognition
        ↓
DB transaction 外
prepare calculator once
        ↓
对 unique recognition values 做 bounded scoring proof
        ↓
得到 proof identities
        ↓
进入最终 write transaction
```

建议在：

```text
scoring/failure-boundary.ts
```

增加 bulk helper，例如：

```ts
proveSettlements(...)
```

要求：

- 相同 item revision / scoring plan 只 prepare runtime 一次；
- recognitionHash 去重；
- concurrency 延续当前 4；
- 错误映射必须与 `proveSettlement` 一致；
- ScoringUnavailable 仍然使整个 Import 无法提交；
- DeterminationRefused 返回对应 row blocker。

不要在 Import Service 自己解释 sandbox errors。

---

# 31. Import Commit API

```http
POST /assessment/batches/:batchId/administrative-imports
```

payload：

```ts
{
  attachmentId
  itemId
  expectedItemRevisionId
  defaultBasis?: string
  confirmWarnings?: boolean
}
```

不要从 client 接收：

```text
participants
payload[]
recognition[]
parsedRows[]
```

服务器必须重新读取 workbook。

Preview 结果不是授权凭据。

---

# 32. Commit 算法

严格执行：

```text
A. 重新打开原 XLSX
B. 重新解析
C. 重新规范化 payload / recognition / basis
D. 重新进行完整 Preview checks
E. transaction 外完成全部 scoring proof
F. 开启 write transaction
G. lock batch
H. 重新读取 authoritative state
I. 二次检查会发生 race 的全部条件
J. 全部合法才写入
K. 任意一行失败 → rollback 全部
```

最终事务内二次检查至少包括：

```text
batch still active/non-archived
item current revision still expected
item still administrative
record PhaseGate still open
caller authority still held
participant still active
participant still reachable
self-record still false
maxEntries still has room
```

任何变化都：

```text
0 条导入
```

V1 坚持：

> all-or-nothing。

不要增加：

```text
跳过错误行继续导入
```

这种模式会显著增加导入历史解释成本。

---

# 33. 公共 administrative record 核心

当前 `createEntry` 内的 administrative 分支已经包含大量正确规则。

不要再复制一套 Import writer。

重构出 server-internal primitive。

例如：

```ts
recordAdministrativeEntryTx({
  tenantId,
  batchId,
  item,
  revision,
  participant,
  actor,
  payload,
  recognition,
  basis,
  source: 'record' | 'import',
  provenSettlement,
  liveMode,
})
```

它只在已经打开的 transaction/context 中写一条事实。

负责：

```text
insert Entry
insert EntryRevision
bind evidence attachments
insert EntryRevisionAttachments
insert EntryRecognition
set Entry approved/currentRecognition
bump participant attention
```

手动 `createEntry` 和 Import Commit 都调用这一 primitive。

但是：

> authorization / decoding / scoring proof 的边界不要为了抽函数硬揉成一层。

可以拆成：

```text
prepareAdministrativeRecord(...)
recordAdministrativeEntryTx(...)
```

重点是手动和批量最终使用同样的 canonical validation/write path。

---

# 34. Import source 应正确写成 import

公共 writer 必须接受：

```ts
source: 'record' | 'import'
```

并同步写：

```text
Entry.source
EntryRevision.source
EntryRecognition.source
```

不要出现：

```text
Entry.source = import
EntryRevision.source = record
```

这类 provenance 分裂。

---

# 35. Import DB 写入性能

不要为了第一版提前实现复杂 ETL engine。

在 `MAX_ROWS=2000` 下：

- 所有 expensive validation/scoring 均 transaction 外完成；
- transaction 内只剩 deterministic DB writes。

可以先以清晰正确的 sequential Effect 写法实现。

但增加一项 benchmark/测试：

```text
1000-row import
```

确认事务时间和内存合理。

如果明显过慢，再将 Entry/Revision/Recognition insert 改成批量 insert。

不要一开始写巨大 raw SQL CTE 把全部领域规则复制进去。

正确性优先。

---

# 36. 成功 Import 写入

事务内：

```text
Storage.bind(sourceAttachment)

INSERT AdministrativeEntryImport

for each row:
  recordAdministrativeEntryTx(source='import')
  INSERT AdministrativeEntryImportRow

COMMIT
```

所有行成功才产生 Import。

因此数据库永远不会出现：

```text
Import importedCount = 126
实际只有 83 个 Entry
```

---

# 37. Source workbook integrity

在成功 commit 时保存：

```text
original filename
size
integrity algorithm
integrity value
```

优先直接使用 Storage backend 已计算/验证的 integrity metadata。

不要为了 hash 再相信浏览器传来的值。

最终能够回答：

> 现在下载的 Excel 是否就是当时导入的那份文件？

---

# 38. Import Live Events

不要产生：

```text
2000 × entries-changed
2000 × result-changed
```

bulk writer 增加 event collection/suppress mode。

仍然逐 Entry：

```text
bumpParticipantAttention
```

因为这是持久的 owner unread state。

但事务末尾只：

```ts
announce(batchId, [{ kind: 'entries-changed' }, { kind: 'result-changed' }])
```

`subjectUserId = null`。

如果 bulk reversal 取消了正在进行的 appeal，再附加：

```text
review-inbox-changed
review-instance-changed
```

同样各一次。

---

# 39. 导入记录列表

第二个 Tab：

```text
导入记录
```

endpoint：

```http
GET /assessment/batches/:batchId/administrative-imports
```

keyset pagination。

row：

```ts
{
  id
  item: {
    id
    title
  }

  filename

  actor: {
    id
    name
  }

  createdAt

  importedCount

  standing: {
    approved
    inReview
    rejected
    voided
  }
}
```

UI：

```text
文件                  认定项目        操作人    时间       当前情况
─────────────────────────────────────────────────────────
优秀学生干部.xlsx     优秀学生干部    张老师    09-16      126 条
CET6.xlsx             CET-6           李老师    09-15      438 条 · 3 条已撤销
```

---

# 40. Import Detail

使用：

```text
/record?import=<id>
```

content drill。

显示：

```text
优秀学生干部.xlsx
09-16 18:22 · 张老师

认定项目
优秀学生干部

项目版本
Revision 4

统一认定依据
《关于……》

原始文件
[下载]

导入情况
126 条

当前
118 已认定
3 申诉处理中
1 未维持
4 已撤销

[撤销本次导入]
```

下面分页：

```text
Excel 行    学号       姓名       状态       当前认定
2           ...        张三       已认定     ...
3           ...        李四       已撤销     ...
```

行点击：

```text
AdministrativeEntrySheet
```

不要复制 Entry detail。

---

# 41. Source File 下载授权

Existing assessment attachment authorizer 只理解：

```text
Entry citation
Review citation
Supplement citation
```

不要把 Import source file 塞进这个逻辑假装是 evidence。

新增 Import-specific source endpoint：

```http
GET /assessment/administrative-imports/:importId/source
GET /assessment/administrative-imports/:importId/source/content
```

内部：

```text
authorize import
→ Storage.open(...)
```

返回继续使用现有 attachment descriptor/content 模型。

---

# 42. Import History 权限

行政认定主页面继续只提供给：

```text
assessment.entry.record
```

批次管理员如果没有 record 权限，可通过未来/现有「参评结果」管理员视图查看具体 Entry，不因此自动获得行政认定工作台写权限。

对于 record staff：

```text
认定记录
→ 当前 record reach 内的 participant

Import history
→ 当前仍在其可管理范围内的 Import
```

推荐 conservative rule：

record-only staff 可读取一个 Import，当且仅当：

```text
import.actorId == current user
AND
该 Import 的所有 linked participants 当前仍在其 assessment.entry.record reach 内
```

否则 Import 在列表中隐藏。

`batch.manage` 不应自动赋予 `entry.record` 的写/撤销能力。

如果后续希望 batch manager 监督全部 Import，可另加 read-only surface，而不是扩大 record mutation 权限。

---

# 43. Import 原文件权限再严格一级

原文件可能一次包含大量个人数据。

source workbook 下载条件：

```text
当前用户有 assessment.entry.record
AND
仍覆盖此次 Import 的全部 participant
```

如果未来需要 batch manager 下载，应显式增加产品裁决。

不要因为：

```text
actorId == currentUser
```

就永久赋予文件读取权。

当前组织权限撤销后，历史上传者也不应继续凭“我当年上传过”访问学生名单。

---

# 44. 整批撤销

新增：

```http
POST /assessment/administrative-imports/:importId/reversals
```

payload：

```ts
{
  reason: string
}
```

不是：

```text
DELETE import
POST rollbackImport
```

语义：

> 撤销该 Import 当前仍未撤销的所有行政认定。

---

# 45. Bulk reversal 算法

先找到该 Import 创建的全部 Entry。

分类：

```text
already voided
→ skip

其他状态
→ candidate
```

对 candidate 逐条应用与现有：

```ts
interveneOnEntry((kind = 'void'))
```

完全相同的业务规则：

```text
batch not archived
record PhaseGate open
caller has entry.record
caller != subject
caller currently reaches participant
entry source is record/import
```

注意 Import source Entry 可能当前是：

```text
approved
in_review（申诉中）
rejected
```

都允许按当前行政撤销规则处理。

如果 `in_review`：

```text
取消 appeal/review
→ cancelled-by-staff
```

---

# 46. Bulk reversal 必须 atomic

V1：

```text
要么全部 candidate 被撤销
要么一个都不撤销
```

例如一批 120 条：

```text
118 条仍在权限范围
2 条现在超出当前 reach
```

结果：

```text
整批撤销拒绝
0 条改变
```

UI 提示：

```text
本次导入中有 2 条认定当前无法撤销。
请检查权限或分别处理后重试。
```

不要留下：

```text
前 73 条撤销成功，第 74 条失败
```

---

# 47. Bulk reversal 不应该影响后续替代 Entry

例如：

```text
9/1 Import 创建 Entry A
9/5 Entry A 被撤销
9/6 手工重新认定 Entry B
```

9/10 点击：

```text
撤销 9/1 Import
```

只允许操作 ImportRow 指向的：

```text
Entry A
```

永远不能根据：

```text
participant + item
```

查“当前 Entry”然后撤销。

否则会误伤后来更正的数据。

---

# 48. Bulk reversal history

每条被撤销 Entry：

```text
EntryEvent:
  kind = voided-by-staff
  actor
  same reason
```

同时新增：

```text
AdministrativeEntryImportEvent:
  kind = reversed
  actor
  reason
  affectedCount
```

如果已经有 6 条此前单独撤销，本次剩余 120：

```text
affectedCount = 120
```

不要改：

```text
import.status = reversed
```

Import 本身永远是一件发生过的历史事实。

---

# 49. Import 不能删除

规则：

```text
committed import
→ 永远不能 delete
```

支持的动作只有：

```text
查看
查看 linked Entries
下载原文件
撤销仍有效的 Entries
```

没有：

```text
删除导入记录
```

失败 Preview 本来没有 Import row，因此也无需清理历史。

---

# 50. Administrative Import 错误模型

增加：

```ts
AdministrativeImportNotFound
```

404。

增加 aggregate validation：

```ts
AdministrativeImportInvalid {
  issues: [{
    rowNo: number | null
    field: string | null
    severity: 'error' | 'warning'
    reason: string
  }]
}
```

Preview 的正常数据错误最好作为成功 response 的 issues。

真正 malformed：

```text
not-xlsx
unsupported-template-version
metadata-corrupt
too-many-rows
```

可以返回 ImportInvalid。

Commit 在重新校验发现 blockers 时：

```text
AdministrativeImportInvalid
```

revision moved：

继续优先使用现有：

```text
ItemRevisionConflict
```

不要创造第二个“template stale”错误表达同一件事。

---

# 51. Warning confirmation

Preview：

```ts
canCommit = errors === 0
```

如果：

```text
errors = 0
warnings > 0
```

按钮：

```text
确认导入 126 条
```

点击前明确展示 warning。

commit payload 必须：

```ts
confirmWarnings: true
```

如果 server 重新解析后仍有 warning、但 client 未确认：

```text
拒绝 commit
```

避免 UI bug 绕过提醒。

---

# 52. API 最终建议

新增：

```text
GET
/assessment/batches/{batchId}/administrative-entries

POST
/assessment/batches/{batchId}/administrative-import-uploads

POST
/assessment/administrative-import-uploads/{reservationId}/complete

GET
/assessment/items/{itemId}/administrative-import-template

POST
/assessment/batches/{batchId}/administrative-import-previews

POST
/assessment/batches/{batchId}/administrative-imports

GET
/assessment/batches/{batchId}/administrative-imports

GET
/assessment/administrative-imports/{importId}

GET
/assessment/administrative-imports/{importId}/rows

GET
/assessment/administrative-imports/{importId}/source

GET
/assessment/administrative-imports/{importId}/source/content

POST
/assessment/administrative-imports/{importId}/reversals
```

已有：

```text
POST /assessment/entries/{entryId}/interventions
```

继续承担单条撤销。

所有新增 route 同笔更新：

```text
tools/tests/support/frozen-routes.ts
```

不要遗漏。

---

# 53. API 不增加 source 参数

客户端永远不得发送：

```ts
source: 'record'
source: 'import'
```

当前 Entry service 的重要规则是：

> server decides who is speaking and how the Entry came to exist.

保持：

```text
manual createEntry route
→ server derives record

administrative-import commit
→ server derives import
```

---

# 54. 前端文件结构建议

将现在的大 `RecordPage.tsx` 拆为：

```text
client/record/
  AdministrativeRecordsPage.tsx

  AdministrativeEntryList.tsx
  AdministrativeEntrySheet.tsx

  ManualRecordView.tsx
  AdministrativeRecordForm.tsx
  ParticipantPicker.tsx

  import/
    AdministrativeImportView.tsx
    AdministrativeImportUploader.tsx
    AdministrativeImportPreview.tsx
    AdministrativeImportHistory.tsx
    AdministrativeImportDetail.tsx
    AdministrativeImportRows.tsx
```

不要做一个 2000 行：

```text
RecordPage.tsx
```

---

# 55. Server 文件结构建议

不要把 import 全塞进：

```text
server/index.ts
```

新增领域模块：

```text
administrative-import/
  service.ts
  db.ts
  workbook.ts
  model.ts
```

`server/index.ts` 只负责 wiring。

手动行政认定仍主要属于：

```text
entry/service.ts
```

但抽公共 administrative record primitive。

---

# 56. Workbook parser 必须纯化

`workbook.ts` 尽量只负责：

```text
XLSX bytes
↓
metadata
↓
typed raw rows
```

不要在那里：

- 查数据库；
- 查权限；
- 写 Entry；
- 跑评分。

推荐：

```ts
parseAdministrativeWorkbook(bytes): ParsedWorkbook
```

然后 Service 层负责 domain validation。

这样 workbook parser 可用纯 unit test 覆盖大量 Excel 边界。

---

# 57. Participant Picker 与 listParticipants

修改：

```text
GET /assessment/batches/:batchId/participants
```

新增：

```text
q
```

数据库过滤：

```text
display_name ILIKE ...
OR business_no ...
```

需要与 keyset pagination 正确组合。

不要：

```text
client.fetchEveryPage()
```

这同时修掉现有 RecordPage 的第一页限制。

---

# 58. Query/Live invalidation

手动认定成功：

```text
administrative entries list
participant result
participant entries
```

都需要刷新。

bulk import 已发 coarse：

```text
entries-changed
result-changed
```

新 AdministrativeRecordsPage 接入现有 `useBatchLive()`。

建议：

```text
entries-changed
→ invalidate administrative-entry list

result-changed
→ 不必刷新 import history
```

Import commit/reversal 的本地 mutation success：

```text
invalidate administrative-imports
invalidate administrative-entries
```

不要：

```ts
invalidateQueries(assessmentApi.key())
```

把整个插件缓存全部炸掉。

---

# 59. 与「参评结果」功能集成

前面规划的参评结果页完成后，应支持双向跳转。

Administrative Entry：

```text
点击参评人员
→ /results?participant=<id>
```

Import row：

```text
点击 Entry
→ 行政认定 Sheet
```

参评结果中的：

```text
source=record/import
```

同样显示：

```text
手动认定 / 批量导入
```

如果 import：

```text
查看导入记录
```

这样 provenance 是完整可走通的。

---

# 60. 特殊情况矩阵

实现和测试至少覆盖以下情况。

### Person

```text
正常 active participant → 可以
excluded participant → 拒绝新认定
不存在 participant → 拒绝
scope 外 participant → 与不存在表现一致
自己 → self-record-refused
businessNo null → Excel 不支持，手工可选
```

### Item

```text
student item → 不能行政认定
administrative item → 可以
draft item → 不可以
voided item → 不可以
current revision changed → stale template / conflict
```

### Batch

```text
active + phase open → 可以
active + phase closed → 拒绝
archived → 所有写拒绝
```

### Recognition

```text
无 recognition field → {}
全部 default → 自动形成
部分 default + 部分 Excel → merge
缺 mandatory recognition → blocker
invalid enum → blocker
invalid decimal → blocker
calculator refuses recognition → blocker
calculator unavailable → 整批不能 commit
```

### Evidence

```text
required text 缺失
非法 date
日期超 material range
integer 越界
decimal scale 超限
choice unknown
required attachment
```

全部覆盖。

### Quota

```text
maxEntries null
maxEntries=1
existing approved
existing voided
同一 workbook 多行占 quota
preview 后别人抢先写入导致 commit quota race
```

### Import

```text
0 data rows
超过 MAX_ROWS
重复 businessNo
相同事实重复
错误 template batch
错误 template item
旧 revision template
人为修改 hidden metadata
缺隐藏 sheet
多余未知列
空白尾行
公式 cell
merged cell
非常大的 string
错误日期 cell
```

### Reversal

```text
全部有效
部分已单独 void
全部已 void
某条申诉处理中
某条申诉已改认定
当前 record phase 已关闭
权限已撤销
scope 已缩小
batch archived
重复点击整批撤销
```

---

# 61. Excel 公式安全

解析 XLSX 时不要执行公式。

Cell：

```text
=...
```

不得作为 executable content。

只读取 cached/static value；如果库不能明确保证这一点，则 formula cell 直接：

```text
formula-not-allowed
```

特别是导出原文件时也不要生成任何由用户输入直接成为公式的 cell。

生成模板/错误报告时，任何以：

```text
=
+
-
@
```

开头的用户文本如被重新写入 Excel，应按照 CSV/Excel formula-injection 规则作为文本处理。

---

# 62. 文件资源限制

除 row 数限制外再限制：

```text
XLSX 最大文件大小
Sheet 数
Column 数
Cell string length
```

使用常量集中定义，例如：

```ts
ADMIN_IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 2000,
  maxColumns: 128,
}
```

列数还应受 form/recognition schema 的实际字段数约束。

防止 ZIP bomb / 极端 workbook 消耗内存。

如果 XLSX library 支持压缩解包限制，启用。

---

# 63. Migration 规范

新增 migration 时遵守仓库现有规范：

- UUIDv7 database-side default；
- tenant-scoped composite FK；
- explicit constraint names；
- indexes 与 MikroORM entities 保持 schema parity；
- migration SQL 可独立执行；
- 更新 `entities.ts`；
- 更新 `entities` export；
- 更新 `compositeForeignKeys`；
- 跑数据库 introspection/parity gates。

不要只改 ORM entity 不写 migration。

---

# 64. Generic Audit 不重复记录

不要为：

```text
手动认定
Import
单条撤销
整批撤销
```

全部再复制一套 AuditEvent。

当前 assessment 设计明确倾向：

> 有 domain-history row 的业务动作不重复写 generic audit。

现有：

```text
EntryRevision
EntryRecognition
EntryEvent
AdministrativeEntryImport
AdministrativeEntryImportEvent
```

已经形成充分审计证据。

只有真正没有领域历史的行为才应进入 generic Audit。

---

# 65. Browser UI 细节

样式继续遵循当前 Qualy：

- `StyleX`
- `tokens`
- 克制表格；
- 细分隔线；
- 不使用大面积彩色 Card；
- status 继续复用 `EntryStanding`；
- tab 继续采用当前轻量 underline；
- `BatchScreen` / `BatchBanner` 不另造页面 shell；
- narrow/mobile 下内容 drill 替换主区域，而不是双层 Sheet。

---

# 66. 文案建议

主入口：

```text
行政认定
```

hint：

```text
登记由机构直接确认并生效的加分、扣分及其他认定事项。
```

actions：

```text
手动认定
批量导入
```

tabs：

```text
认定记录
导入记录
```

manual：

```text
认定对象
认定项目
认定材料
认定结果
认定依据
确认认定
```

Import：

```text
下载模板
上传认定名单
校验结果
确认导入
```

撤销：

```text
撤销认定
撤销本次导入
```

不要再出现：

```text
代为登记
替学生登记
```

---

# 67. Tests：现有测试不得删

当前：

```text
record-recognition.browser.test.tsx
recognition.test.ts
entry-policy tests
scoring tests
```

已有大量重要边界。

重构 RecordPage 后，应迁移测试，不要为了组件结构变化删断言。

尤其保留：

```text
recognition follows default
dirty recognition wins
switch participant resets form
switch item resets form
successful submit resets form
__proto__ recognition id
self-record refused
basis required
staff reach
administrative void
```

---

# 68. 新增纯单元测试

建议：

```text
administrative-import-workbook.test.ts
```

覆盖：

- metadata；
- every evidence kind；
- every recognition kind；
- date；
- decimal；
- choice；
- boolean；
- formula；
- malformed workbook；
- limits；
- duplicate label；
- stale template。

---

# 69. 新增 Effect/service 集成测试

建议：

```text
administrative-import.test.ts
```

至少测试：

```text
successful import writes source=import everywhere
recognition is immediately approved
every EntryRevision has basis
businessNo resolution
out-of-reach indistinguishable
self row refused
excluded participant
phase closed
archived batch
maxEntries across existing + import rows
scoring refusal
scoring unavailable
revision race
scope race
all-or-nothing rollback
source attachment bound only on success
participant attention bumped
live events coalesced
```

---

# 70. Bulk reversal tests

至少：

```text
all effective
some already voided
appeal open
scope lost
phase closed
batch archived
second reversal
replacement Entry unaffected
one unauthorized row rolls back all
ImportEvent affectedCount correct
EntryEvent reason correct
```

---

# 71. Browser tests

新增/重构：

```text
administrative-records.browser.test.tsx
administrative-import.browser.test.tsx
```

测试：

```text
首页默认为认定记录
搜索 participant
pagination picker
manual form drill
recognition seeding
成功后返回并刷新 list

Import wizard
选择项目
下载模板入口
上传
preview error/warning
warning confirmation
commit
Import detail
Entry Sheet
single void
bulk reversal confirm
browser back/forward
mobile drill
```

---

# 72. Frozen protocol gates

新增 API 后必须更新：

```text
tools/tests/support/frozen-routes.ts
```

新增 TaggedError 后检查仓库所有：

```text
error catalog
error code snapshot
localization mapping
wire tests
```

不要让新 error 只存在 server class，没有 UI sentence。

---

# 73. 建议实现阶段

按照以下顺序做，避免一个 PR 同时改 UI、DB、Excel、scoring 后无法定位问题。

## Phase A — 行政认定页面重构

1. 用户文案全部 `代为登记 → 行政认定`
2. RecordPage 重构为 AdministrativeRecordsPage
3. 行政认定记录 read endpoint
4. participant `q` search
5. searchable paged ParticipantPicker
6. 抽 AdministrativeRecordForm
7. 单条 Entry Sheet
8. 单条撤销认定

完成后系统先具备：

```text
查已有认定
手动认定
查看详情
撤销
```

---

## Phase B — Import domain + workbook preview

1. XLSX dependency
2. workbook parser/generator
3. Import entities + migration
4. Import upload doors
5. template download
6. participant bulk resolution
7. preview validation
8. bulk settlement proof helper

先做到：

```text
下载模板
上传
看到完整 preview
```

此阶段尚不 Commit。

---

## Phase C — Atomic Import Commit

1. shared administrative write primitive
2. commit revalidation
3. Import + rows + Entry writes
4. source Storage.bind
5. attention
6. coalesced live events
7. success response
8. history list

---

## Phase D — Import Detail + Reversal

1. import detail endpoint
2. rows endpoint
3. source download
4. bulk reversal
5. ImportEvent
6. UI detail
7. cross-links

---

# 74. Claude Code 实施要求

开始修改前，必须先重新阅读当前 main 中：

```text
packages/plugins/assessment/core/src/client/record/RecordPage.tsx
packages/plugins/assessment/core/src/entry/service.ts
packages/plugins/assessment/core/src/entry/db.ts
packages/plugins/assessment/core/src/scoring/recognition-db.ts
packages/plugins/assessment/core/src/scoring/failure-boundary.ts
packages/plugins/assessment/core/src/attachment/service.ts
packages/plugins/assessment/core/src/server/index.ts
packages/plugins/assessment/core/src/server/db.ts
packages/plugins/assessment/core/src/db/entities.ts
packages/plugins/assessment/core/src/api.ts
packages/plugins/assessment/core/src/permissions.ts
packages/plugins/assessment/core/src/live/events.ts
packages/plugins/assessment/core/src/index.ts
packages/plugins/assessment/core/tests/record-recognition.browser.test.tsx
packages/plugins/assessment/core/tests/recognition.test.ts
tools/tests/support/frozen-routes.ts
```

不要按照本文中的伪代码机械覆盖已经演进的新代码。

如果当前 main 已经发生变化：

1. 保留本文定义的领域不变量；
2. 适配当前 abstraction；
3. 不回退新的安全/并发保护；
4. 不复制已有公共能力。

---

# 75. 必须跑的门禁

至少：

```text
assessment package typecheck
assessment unit tests
assessment browser tests
database schema/introspection tests
frozen routes tests
API/error contract tests
workspace typecheck
workspace test
```

如果增加 XLSX dependency：

```text
production build
server startup smoke
```

必须额外跑。

确认 XLSX package 没有被错误打进无关 browser chunks。

---

# 76. Hard non-goals

本轮明确不做：

```text
万能 Excel 列映射器
保存导入 mapping 模板
CSV/XLS/XLSX 多格式兼容
Excel + ZIP 附件导入
忽略错误行部分提交
异步后台 Import Job
跨多个行政项目单文件导入
修改已有行政 Entry
删除 committed Import
导入结果旁路计分
新的第二套行政评分表
```

任何实现过程中发现“为了完成这里需要顺便做一个通用 ETL 平台”的情况，停止扩张。

---

# 77. 最终验收场景

功能完成后必须完整跑通：

```text
管理员进入某批次
↓
行政认定
↓
看到已有手工/批量认定
↓
搜索郭航旗
↓
手动登记一条正式行政认定
↓
结果立即进入其 provisional score
↓
学生可以看到并按现有机制申诉
↓
工作人员能查看完整历史
↓
工作人员撤销
↓
成绩立即重新计算
```

以及：

```text
选择“优秀学生干部”
↓
下载 Qualy 模板
↓
填写 126 名学生
↓
上传
↓
系统逐行解析、匹配和校验
↓
展示 2 warnings / 0 errors
↓
管理员明确确认 warning
↓
126 条原子提交
↓
生成 126 个普通 Entry/Recognition
↓
生成一个 Import provenance
↓
结果立即出现在所有学生账户
↓
导入详情可以追到 Excel 第 N 行和对应 Entry
↓
可以单独撤销某一条
↓
可以整批撤销剩余有效认定
↓
所有原始文件、认定、撤销和申诉历史仍可解释
```

如果以上两条链都成立，行政认定功能才算完成。

核心原则始终只有一句：

> **Import 是来源，Entry 是事实，Recognition 是决定，Status 是当前效力；不要让任何批量功能成为第二份业务真相。**

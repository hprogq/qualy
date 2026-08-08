已并入 docs/assessment-design.md(权威版;冲突以 a 系列与裁决为准),本文只作来源存档,不再更新。

---

# Qualy 综合素质测评域实施设计

> 面向：Claude Code  
> 文档性质：领域设计 + 实施规范  
> 状态：核心架构冻结，可按里程碑施工  
> 建议路径：`docs/assessment-design.md`

---

# 0. Claude Code 首先需要理解：我们到底在做什么

Qualy 不是一个“学生填写表单，管理员审核”的普通信息系统。

它要实现的是高校每学期一次或多次开展的**综合素质测评全过程**：

```text
管理员创建综测批次
    ↓
确定参加学生和组织范围
    ↓
学生提前准备材料
    ↓
正式填报、提交材料
    ↓
班委 / 专业 / 年级 / 辅导员等按规则审核
    ↓
审核收尾
    ↓
第一次正式公示
    ↓
学生针对第一次公示结果申诉
    ↓
复查、更正
    ↓
第二次正式公示
    ↓
归档、打印、签字
```

综测规则具有几个决定系统架构的特征：

1. 学校有统一政策，但不同学院、年级在实施细节上可能不同。
2. 不同类型材料有完全不同的审核路线。
3. 一个学生的审核人取决于其班级、专业、年级等组织位置。
4. 学生材料可能被本人、班委、管理员修改，需要完整审计。
5. 第一次公示之后允许申诉，因此“第一次公示时看到的结果”必须永久可追溯。
6. 分数不是简单的条目求和，还存在分组、封顶、取最高、查表等规则。
7. 有些数据来自学生填报，有些来自教师评价，有些来自成绩库、寝室系统等外部业务域。
8. 一个批次可能持续数周，期间人员、班长、组织关系可能发生变化，但历史业务不能因此漂移。

所以整个 assessment 域的核心问题实际上是：

> **把一个长周期、多角色、多规则、可申诉、必须可审计的评价流程建模成稳定的业务系统。**

实现时不要把它退化成 CRUD，也不要为了“通用”把它设计成 BPMN、低代码工作流平台或者万能规则引擎。

---

# 1. 五条冻结架构原则

下面五条原则视为 assessment 域 ADR。除非发现与真实政策或现有仓库架构不可兼容，否则实现时不得重新推翻。

## ADR-1：正式公示永远是不可变快照

系统存在两类成绩：

```text
实时预览成绩
正式公示成绩
```

实时预览可以随着：

- 新材料审核通过；
- 材料撤回；
- 教师评分；
- 管理员更正；

不断变化。

但正式公示一旦产生，就不能变化。

原因很简单：

> 学生申诉必须能够明确指出“我针对第一次公示中的这项结果提出异议”。

因此：

```text
第一次公示 S1
       ↓
申诉 / 更正
       ↓
第二次公示 S2
```

S1 永远保留原样。

不能把 S1 原地修改成 S2。

---

## ADR-2：审核中的“不确定”和学生“申诉”是两个工作流

审核员点击：

```text
不确定，向上提审
```

属于：

```text
Review Escalation
```

学生看到第一次公示之后提出：

```text
我认为这个审核结果有问题
```

属于：

```text
Appeal
```

这是两个不同的业务过程。

Primary Review 可以：

```text
通过
驳回
不确定并上提
```

Appeal Review 的业务语言则应该是：

```text
维持原决定
更正原决定
上提复核
```

不要因为它们看起来都像“继续向上审核”，就在数据库和状态机中混成一套东西。

---

## ADR-3：审核路线冻结，普通审核人实时解析

每个学生在批次内都有一个冻结的：

```text
assessmentAnchor
```

例如：

```text
软件2401班
```

审核路线永远从这个锚点出发。

但审核路线和审核人要区分：

```text
路线结构
    冻结

普通 single / any 审核节点的具体审核人
    实时解析
```

因此如果 9 月 2 日班长换届：

```text
旧班长立即失去待审列表
新班长立即获得待审列表
```

不需要迁移 ReviewTask。

只有：

```text
all
atLeast(n)
```

这种需要稳定投票分母的节点，才在进入该节点时快照 voter set。

---

## ADR-4：缺审核人必须区分三种原因

不要把所有 `resolve() -> []` 都当成一样的问题。

### 结构性缺失

例如学生直属专业，没有“班级”节点。

配置中虽然有：

```text
RoleAt(class, class-monitor)
```

但学生祖先链上根本不存在 class。

这是合法组织结构。

处理：

```text
跳过这个 stage
记录原因
normalTerminal 向后顺延
```

### 职位空缺

班级存在，但没人具有班长角色。

这是配置问题。

处理：

```text
BLOCKED
通知管理员
```

不能偷偷找专业负责人替代。

### 自审冲突

唯一班长恰好就是提交材料的学生本人。

必须把本人从候选审核人集合删除。

如果 single/any 因此无人：

```text
跳过该 stage
记录 self_review_conflict
继续上一级
```

绝不允许自己审核自己。

最终 terminal stage 在任何情况下都必须存在并能解析到审核人，否则拒绝提交并告警管理员。

---

## ADR-5：Claim 与 ScoreGroup 分离

题目负责回答：

> 这个事实成立吗？成立后本身值多少分？

ScoreGroup 负责回答：

> 多个事实组合以后最终计多少？

例如：

```text
优秀学生教官 = +2
国旗班成员   = +2
```

这是两个事实，应该分别：

```text
举证
审核
申诉
```

然后：

```text
教官/国旗班组合组 cap = 3
```

最终：

```text
只有教官       2
只有国旗班     2
二者都有       min(4, 3) = 3
```

不要在“优秀学生教官题型”内部写：

```text
if 国旗班 then ...
```

组合规则属于 ScoreGroup，而不是单个题型。

---

# 2. 系统的核心业务对象

整个 assessment 域可以理解成：

```text
AssessmentBatch
│
├── Roster
│     └── BatchParticipant
│
├── PhasePlan
│     └── BatchPhase[]
│
├── ScoreGroup Tree
│
├── AssessmentItem[]
│     │
│     └── Entry[]
│            │
│            ├── EntryRevision[]
│            │
│            └── ReviewInstance
│
├── ScoreRun[]
│
├── Publication preliminary
│     └── AppealCase[]
│
├── Publication final
│
└── Archive
```

这里最重要的聚合根是：

```text
AssessmentBatch
```

所有学生填报、审核、计分、公示、申诉最终都属于一个 Batch。

---

# 3. Batch：一次独立的综测开展

一个批次例如：

```text
2025-2026-2 本科生综合素质考核
```

或者：

```text
2025-2026-2 软件学院2024级综合素质测评
```

Batch 至少包含：

```text
name
descriptionMarkdown
scopeNode
participantSelector
materialDateRange
timezone
status
```

## 3.1 scope

一个批次有一个组织树根节点，例如：

```text
学校
学院
年级
```

Roster 从这个子树产生。

v1 不做多个不连续 scope。

如果未来真有：

```text
学院A + 学院C
```

这种需求，再扩展。

---

## 3.2 材料日期使用 daterange

材料政策通常表达为：

```text
2026-03-01 ～ 2026-08-31
```

证书一般只有日期，没有时间。

因此存：

```text
[2026-03-01, 2026-09-01)
```

使用 PostgreSQL `daterange`。

不要存：

```text
2026-08-31 23:59:59.999
```

题型可以继续缩小：

```text
合法日期
=
Batch.materialRange
∩
Item.dateConstraint
```

阶段时间则使用：

```text
timestamptz
```

并按 Batch.timezone 展示。

---

# 4. Roster：批次参加人员快照

不要在整个综测过程中实时问：

> 现在组织树里有哪些学生？

因为学期中可能：

- 转专业；
- 转班；
- 休学；
- 复学；
- 组织调整。

批次激活时生成：

```text
BatchParticipant
```

核心字段：

```text
batchId
userId
assessmentAnchorNodeId
anchorPathSnapshot
userTypeId
status
includedAt
excludedAt?
```

## 4.1 assessmentAnchor

这是后续：

```text
找班长
找专业负责人
找年级负责人
找辅导员
```

的唯一起点。

例如：

```text
张三
assessmentAnchor = 软件2401班
```

则其审核组织路径固定为当时：

```text
软件2401班
→ 软件工程专业
→ 2024级
→ 软件学院
→ 学校
```

不要从用户现在的所有 membership 临时推断。

---

## 4.2 Roster 不自动删除成员

组织树发生变化后，提供差异面板：

```text
新迁入
已迁出
锚点发生变化
```

管理员决定是否应用。

尤其：

```text
已迁出
```

绝不能自动删除。

否则该学生历史：

```text
Entry
Review
Score
Publication
Appeal
```

都会失去业务归属。

正确方式是：

```text
status = excluded
```

保留历史。

---

## 4.3 roster diff 默认不是 Publication blocker

Roster 快照本来就是为了避免实时组织树变化影响历史批次。

因此：

```text
“当前组织树和 roster 不一致”
```

只是运营提示，不应该天然阻止公示。

只有真正的 roster 完整性问题才 block，例如：

```text
管理员明确要求纳入的新生尚未裁决
participant 缺失 anchor
重复 participant
```

不要要求“所有实时组织差异必须清零才能公示”。

---

# 5. Phase 是时间管理的主模型

Assessment 不采用一堆独立 capability window 作为管理员主界面。

原因是管理员真正思考的是：

```text
现在是什么阶段？
这个阶段能干什么？
```

而不是：

```text
entry.create window 开了吗？
entry.submit window 开了吗？
review window 开了吗？
```

因此：

> Phase 是有名称的业务状态 + 权限 Profile + 进入方式。

---

# 6. 默认 Phase 流程

推荐默认模板：

```text
预填报期
    │ scheduled
    ▼
正式填报期
    │ scheduled
    ▼
审核整理期
    │
    │ 发布第一次公示
    ▼
申诉期
    │ scheduled：申诉截止
    ▼
申诉处理期
    │
    │ 发布第二次公示
    ▼
结果确认期
    │ manual / scheduled
    ▼
归档期
```

注意：

> **没有“第一次公示期”和“第二次公示期”。**

公示是一个 Result Publication 对象，不是时间阶段。

---

# 7. 为什么必须有“审核整理期”

如果：

```text
正式填报截止
=
审核截止
```

就必然出现：

```text
填报截止到了
但还有几十条材料没审核完
```

所以拆开：

```text
正式填报期
学生：
  create
  edit
  submit

审核人：
  review
```

到截止时间：

```text
审核整理期
学生：
  不能再提交

审核人：
  继续审核
```

直到可以进行第一次正式公示。

同理：

```text
申诉期
```

截止只意味着：

> 不接受新的申诉。

已经存在的 Appeal 继续处理，所以进入：

```text
申诉处理期
```

---

# 8. Phase 数据模型

建议 canonical 模型不要同时维护两套重复状态。

## batch_phases

```text
id
tenant_id
batch_id

ordinal
phase_key
display_name

entry_trigger
  scheduled
  manual

planned_entry_at?
actual_entry_at?

permission_profile

source_template_id?
source_template_version?
```

其中：

```text
actual_entry_at
```

一旦产生永久不可修改。

未来计划：

```text
planned_entry_at
```

可以修改。

所有计划修改和实际切换都写审计事件。

Batch 可冗余：

```text
current_phase_id
```

作为查询投影。

---

## 8.1 不存 start/end

一个 Phase 的时间自然是：

```text
[this.actual_entry_at,
 next.actual_entry_at)
```

因此天然：

```text
无重叠
无隐式空洞
```

最后一个：

```text
[start, ∞)
```

---

## 8.2 需要重新开放怎么办

例如正式填报已经结束，但是后来决定补充两天。

不要篡改历史：

```text
正式填报期
  actual end = 9月5日
```

而应该插入：

```text
补充填报期
```

套用和正式填报期一样的 Phase Template。

于是历史可以准确解释：

```text
9月1日～9月5日 正式填报
9月5日～9月7日 审核整理
9月7日～9月9日 补充填报
```

---

# 9. Phase Template

管理员可以预先保存：

```text
本科生标准综测流程
```

包含：

```text
阶段名称
阶段顺序
默认权限 Profile
默认时间偏移
trigger 类型
```

应用模板时：

```text
复制
```

而不是运行时继承。

保存：

```text
sourceTemplateId
sourceTemplateVersion
```

只用于审计。

以后模板修改不得影响既有批次。

---

# 10. 三层授权模型

最终业务授权：

```text
RBAC
∩
PhaseGate
∩
ResourcePolicy
```

---

## 10.1 RBAC

回答：

> 这个人本来有没有资格干这件事？

例如：

```text
assessment.review.process
```

某班长在其班级节点范围拥有。

---

## 10.2 PhaseGate

回答：

> 当前阶段有没有开放这项业务能力？

Permission metadata 增加：

```ts
phaseControlled?: boolean
```

例如：

```text
assessment.entry.create       true
assessment.entry.edit         true
assessment.entry.submit       true
assessment.entry.proxy        true
assessment.review.process     true
assessment.appeal.create      true
assessment.appeal.process     true
assessment.result.view_peers  true
assessment.ranking.view       true
```

而：

```text
auth.login
org.*
iam.*
assessment.batch.manage
```

不受 Phase 控制。

PhaseGate：

```ts
if (!permission.phaseControlled) {
  return true
}

return currentPhase.permissionProfile.includes(permission.code)
```

必须：

```text
fail closed
```

也就是说未来新增一个 phaseControlled 权限，旧 Phase Profile 没有它：

```text
默认拒绝
```

---

## 10.3 ResourcePolicy

回答：

> 当前这个具体对象状态允不允许这个动作？

例如：

```text
正式填报期允许 entry.edit
RBAC 也允许
```

但是 Entry：

```text
IN_REVIEW
```

则：

```text
ResourcePolicy(edit) = false
```

仍然不能编辑。

---

# 11. 推荐 Phase 权限模板

| Phase    | create/edit | submit | proxy | primary review | appeal create | appeal process |  peers | ranking |
| -------- | ----------: | -----: | ----: | -------------: | ------------: | -------------: | -----: | ------: |
| 预填报   |           ✓ |      × |     ✓ |              × |             × |              × |      × |       × |
| 正式填报 |           ✓ |      ✓ |     ✓ |              ✓ |             × |              × |      × |       × |
| 审核整理 |           × |      × |     × |              ✓ |             × |              × |      × |       × |
| 申诉     |           × |      × |     × |              ✓ |             ✓ |              ✓ | 按配置 |       × |
| 申诉处理 |           × |      × |     × |           按需 |             × |              ✓ | 按配置 |       × |
| 结果确认 |           × |      × |     × |              × |             × |              × | 按配置 |       ✓ |
| 归档     |           × |      × |     × |              × |             × |              × |      × |       × |

`assessment.result.view_self` 不受 Phase 控制。

学生什么时候都可以进入自己的成绩页，只是页面展示内容不同：

```text
填报期：
实时预览

第一次公示后：
S1

最终公示后：
S2
```

---

# 12. Publication 与 Phase 必须正交

Publication 回答：

> 哪一个结果版本正式对外公布？

Phase 回答：

> 现在允许进行哪些动作？

不要混起来。

---

# 13. 正式公示生命周期

Publication：

```text
DRAFT
READY
SCHEDULED
PUBLISHED
CANCELLED
SUPERSEDED
```

其中：

```text
SCHEDULED
```

就是“公示预告”。

不需要再建 PublicationAnnouncement。

---

# 14. Publication 正确工作流

不要把：

```text
preflight
计算
快照
发布
```

混成一个按钮。

推荐：

```text
① Preflight
      ↓
② Freeze ScoreRun Inputs
      ↓
③ ScoreRun COMPUTING
      ↓
④ ScoreRun READY
      ↓
⑤ Materialize Publication Snapshot
      ↓
⑥ Publication READY
      ↓
⑦ 管理员预览
      ↓
⑧ 立即发布
   或 SCHEDULED
      ↓
⑨ PUBLISHED
```

---

# 15. Preflight 检查什么

正式公示之前至少检查：

```text
待审 Primary Review 数量
Escalated Review 数量
BLOCKED 条目数量
未完成 EvaluationTask 数量（M7 后）
ScoreRun 是否覆盖全部 active participant
规则配置是否完整
```

每个 blocker 必须存在业务出路，例如：

```text
继续审核
管理员裁决
补任命审核人
转派
作废评价任务
补录评价
```

管理员不是点击：

```text
“忽略错误继续发布”
```

而是先把业务对象推进到明确终态。

正式公示中不允许出现：

```text
张三 83.2（复核中）
```

---

# 16. SCHEDULED 的意义

只有已经：

```text
内容完整
计算完成
快照已经固定
```

的 Publication 才允许 SCHEDULED。

一旦 SCHEDULED：

```text
任何会导致“即将公布结果”和当前业务状态产生差异的写操作
全部拒绝
```

例如：

```text
修改审核决定
新增有效 Entry Revision
修改计分规则
更改 Appeal Decision
```

提示：

```text
存在已预告公示，请先取消预告。
```

取消：

```text
SCHEDULED
→ CANCELLED
→ 修改
→ 重算
→ 新 Publication / 重新准备
```

这样：

> 已经告诉学生 9 月 10 日 09:00 公布，就不会到 09:00 突然因为后台重新检查失败而不公布。

---

# 17. Publication 本身就是正式快照 Envelope

v1 不需要额外再建一个和 Publication 几乎一一对应的 `ResultSnapshot` 聚合。

推荐：

```text
ScoreRun
    ↓
Publication
    ↓
PublicationRow[]
```

`PublicationRow` 在 READY 时从 ScoreRun 结果复制：

```text
participant
breakdown
category scores
total
ranking partition
rank
provenance
```

之后不可修改。

因此：

```text
Publication + PublicationRows
```

本身就是 immutable result snapshot。

---

# 18. 两次公示

第一次：

```text
Publication(kind=preliminary)
```

发布后：

```text
进入申诉期
```

第二次：

```text
Publication(kind=final)
```

使用吸收所有更正后的新 ScoreRun。

例如：

```text
S1：
82.3

Appeal：
献血材料复核，更正 +1

S2：
83.3
```

S1 永远可以重新查看。

---

# 19. Publication 和 Phase 的领域编排

不建设通用：

```text
event → arbitrary phase transition
```

规则引擎。

直接在 assessment 领域代码里写清楚：

```text
publishPreliminary()
=
publish publication
+
advance phase → appeal
```

以及：

```text
publishFinal()
=
publish publication
+
advance phase → confirmation
```

同一事务完成。

Phase trigger 类型仍然只有：

```text
scheduled
manual
```

Publication 驱动进入 Appeal，本质上仍然是一个由领域动作触发的 manual transition。

---

# 20. 申诉截止时间

第一版不要建设 BusinessCalendar。

管理员发布/预告第一次公示时填写：

```text
publishAt
appealDeadline
```

UI 可以提供：

```text
+3 个工作日
```

辅助按钮。

但结果仍然只是普通：

```text
timestamptz
```

管理员可以手动调整。

需要注意：

如果 Publication 是 scheduled：

```text
publishAt
```

是业务上承诺的生效公示时间。

可以同时记录：

```text
publishedAt
```

作为后台任务实际执行时间。

不要因为 scheduler 晚执行几十秒就重新移动学生申诉截止。

---

# 21. Entry：所有学生材料统一成“条目”

系统不要存在：

```text
单条题型
多条题型
```

两套逻辑。

统一：

```text
AssessmentItem
    ↓
Entry[]
```

只允许一次：

```text
maxEntries = 1
```

就是普通配置。

献血可以：

```text
maxEntries = 多条
```

---

# 22. EntryRevision 必须不可变

Entry 是业务身份：

```text
“张三的第 2 条献血申报”
```

EntryRevision 是每一次内容版本。

例如：

```text
Revision 1
学生填写

Revision 2
班委代为修正日期

Revision 3
驳回后学生重新上传证明
```

不要 UPDATE 旧内容。

---

## 22.1 为什么需要 Revision

否则会发生：

> 第一次公示是根据旧材料审核的，但几个月后查看 Entry 时已经是后来修改过的新材料。

这会使审计失真。

因此：

```text
ReviewDecision
PublicationRow
Appeal
```

都必须能追溯到具体：

```text
revisionId
```

---

# 23. 班委代录不是 impersonation

不要：

```text
“以张三身份操作”
```

而应该：

```text
subject = 张三
actor = 李四
source = proxy
```

页面明确显示：

```text
由 李四 于 2026-09-03 代为修改
```

这对综测争议非常重要。

---

# 24. Entry Source

统一：

```text
self
proxy
import
system
```

这会覆盖：

```text
学生自己填报
班委代录
管理员 Excel 导入
系统根据成绩库派生
```

扣分以后即使主要来自批量导入，也不需要另一套数据模型。

---

# 25. AssessmentItemType：题型是驱动，不是一题一个插件

不要创建：

```text
plugin-blood-donation
plugin-veteran
plugin-flag-team
```

应该：

```text
assessment core
    owns AssessmentItemType ExtensionPoint

assessment-evidence
    contributes evidence driver

assessment-appraisal
    contributes appraisal drivers

grades integration
    contributes derived drivers
```

然后：

```text
献血
退役复学
优秀学生教官
国旗班
```

都是：

```text
ItemInstance 数据行
```

而不是 Plugin。

---

# 26. ItemTypeDriver 建议接口

概念上：

```ts
interface AssessmentItemTypeDriver {
  id: string

  configSchema: Schema

  buildEntrySchema(config: unknown, batch: BatchContext): Schema

  buildSourceKey?(config: unknown, payload: unknown): SourceClaim | null

  interaction: 'entry' | 'task' | 'derived'

  scoring: {
    calculator: CalculatorRef
    aggregator: AggregatorRef
  }

  client?: {
    entryForm?: ClientComponentRef
    entryView?: ClientComponentRef
  }
}
```

实际 Effect/Schema API 以仓库当前版本源码为准，不要照抄这个 TS 伪代码。

---

# 27. evidence 驱动

第一版字段 DSL 只做真实需要的：

```text
text
number
date
enum
enum_with_other
event_pick
attachment
boolean
```

不要一开始做完整低代码表单平台。

---

## 27.1 date

自动：

```text
value ∈ batch.materialRange
```

题型可继续缩窄。

---

## 27.2 event_pick

献血不要分别配置：

```text
日期：[3月31日, 4月1日]
地点：[A, B]
```

否则会隐式允许错误组合。

应该：

```text
BloodDonationEvent

2026-03-31 · A献血屋
2026-04-01 · B献血车
```

用户整体选择。

---

## 27.3 enum_with_other

对应：

```text
固定选项
+
其他
```

是旧 Excel 中真实存在且非常便宜的通用能力。

---

# 28. Source Claim / 防重复

不要把“献血编码终身唯一”写死在 kernel。

题型配置：

```text
uniqueness:
  none
  batch
  tenant
```

SourceClaim 推荐逻辑字段：

```text
tenant_id
namespace
scope_key
normalized_key
entry_id
```

例如：

```text
namespace = evidence:blood-donation
scope_key = tenant

normalized_key = ABC123456
```

数据库唯一：

```text
tenant + namespace + scope_key + normalized_key
```

提交时：

```text
软提示
```

例如：

```text
该编号已有另一条待审核申报
```

最终审核通过时：

```text
事务内占用唯一 claim
```

若冲突：

```text
审核不能通过
```

不要仅靠前端查询。

---

# 29. ReviewPolicy：只做受限审核链，不做 BPMN

一个 Item 只配置一条完整审核链：

```text
班长/学委
→ 专业负责人
→ 年级负责人
→ 辅导员
```

然后配置：

```text
normalTerminal
```

例如献血：

```text
normalTerminal = 班长/学委
```

正常：

```text
班长 approve
→ DONE
```

班长：

```text
ESCALATE
```

则继续：

```text
专业负责人
→ 年级负责人
→ 辅导员
```

科研项目可能：

```text
normalTerminal = 年级负责人
```

于是普通流程自然就是完整链的前缀。

不存在 normalFlow / doubtFlow 两张独立图。

---

# 30. Stage Selector

不要简单：

```text
沿祖先找到最近拥有某 role 的人
```

优先使用：

```text
RoleAt
```

例如：

```ts
RoleAt({
  nodeTypeKey: 'class',
  roleKeys: ['class-monitor', 'study-committee'],
})
```

含义：

```text
从学生冻结 anchor 向上
找到最近 class 节点
只在该节点寻找这些角色
```

这样不会错误找到：

```text
学院节点上误授予的“班长”
```

对于真正具有继承意义的角色才用：

```text
NearestRole({
  roleKey: "counselor"
})
```

---

# 31. ReviewInstance

Entry 提交时创建：

```text
ReviewInstance
```

建议它自己拥有当前投影：

```text
entryId
effectiveChain
normalTerminalStage
mode
currentStage
state
currentRoleKeys
currentNodePath
```

不要把大量 workflow projection 字段塞回 `entries`。

Entry 只需要：

```text
currentReviewInstanceId
```

或通过关系查询。

---

# 32. 审核链结构快照

Entry 提交时计算：

```text
EffectiveChain
```

保存的是：

```text
stage selector
解析到的组织节点
quorum
normalTerminal 映射
被跳过 stage 及原因
```

普通节点不保存具体 reviewer 用户 ID。

这样：

```text
组织路线不漂移
但班长换届仍能立即生效
```

---

# 33. 收件箱采用 Pull Model

不要为 single reviewer 创建：

```text
Task assigned_to = userId
```

审核员的 inbox 通过：

```text
ReviewInstance 当前 role/node
+
RBAC grants
```

实时查询。

因此：

```text
班长撤职
→ inbox 立即消失

新班长上任
→ inbox 立即出现
```

不需要任务迁移。

---

# 34. Quorum

第一版：

```text
any
all
atLeast(n)
```

覆盖：

```text
或签
会签
N-of-M
```

其中：

```text
single / any
```

审核人实时解析。

```text
all / atLeast(n)
```

进入 Stage 时：

```text
snapshot voter set
```

保持稳定分母。

已投票永久留在 ReviewVote / ReviewEvent。

---

# 35. Escalation

任意有资格审核的人点击：

```text
不确定，向上提审
```

可以直接：

```text
short-circuit 当前 stage
```

保留已经产生的审核意见，然后进入下一级。

不要让：

```text
2 人已经同意
第 3 人觉得有疑问
```

仍然卡在当前会签等待。

---

# 36. Reject 语义不要过度泛化

现有需求明确：

普通审核模式：

```text
审核节点可以 approve / reject / escalate
```

进入 escalated mode 后：

```text
中间节点不能 reject
只能 comment / recommend / escalate
最终 terminal 才能 approve / reject
```

对于未来复杂的：

```text
3 人中几票 reject 才算驳回
```

当前资料没有冻结规则。

Claude Code 不要自行发明通用 reject quorum。

遇到真实题型需要时再补。

---

# 37. Review Events：审计事件，不做完整 Event Sourcing

正确模型：

```text
review_instances
    当前状态投影

review_events
    append-only 历史

review_votes
    append-only 票
```

事务：

```text
validate guard
    ↓
append event / vote
    ↓
update ReviewInstance projection
```

不要建设：

```text
靠 replay 所有 events 重建整个系统状态
```

没有必要承担 projection rebuild、event schema migration 等成本。

---

# 38. Appeal

Appeal 必须引用已经冻结的对象：

```text
PublicationRow
或 PublicationRow 内对应的审核决定
```

而不是：

```text
当前实时 Entry
```

---

# 39. AppealPolicy

Appeal 和 PrimaryReview 使用不同 Policy。

默认可以：

```text
AppealPolicy
=
Primary Review Chain 的后缀
```

例如从：

```text
专业负责人
```

开始。

但它是复制后的独立配置，不是运行时引用 primary chain。

动作：

```text
UPHOLD
CORRECT
ESCALATE
```

其中：

```text
UPHOLD
维持原决定

CORRECT
更正原决定

ESCALATE
上提复核
```

中间节点默认只能：

```text
comment
recommend
escalate
```

最终节点才能：

```text
UPHOLD / CORRECT
```

---

# 40. Scoring：事实与规则分离

核心思想：

```text
数据库存事实
计分器存规则
```

不要给所有学生预创建：

```text
默认 8 分
默认 9 分
```

这样的记录。

例如教师评价模式为默认：

```text
calc(no evaluation facts)
→ 8
```

这是规则，不是事实。

---

# 41. Scoring 输入

`calcParticipant()` 输入应当是明确且可重现的：

```text
Participant
当前规则配置
已确认事实
审核决定
外部事实版本
```

输出：

```text
Breakdown
```

例如：

```text
教师评价             7.68
学生互评             0.93
献血                 1.00
优秀学生教官         2.00
国旗班               2.00
教官/国旗班组封顶   -1.00
-------------------------
品德行为表现         12.61
```

一定要让学生看懂：

> 分是怎么得到的。

---

# 42. v1 Calculator

只实现已有真实需求：

```text
fixed
lookup
range
decrement
```

### fixed

```text
审核通过 → +3
```

### lookup

根据若干字段查配置矩阵。

### range

审核人在：

```text
[min, max]
```

内决定实际分数。

### decrement

类似：

```text
第一名 base
第二名 base-step
第三名 base-2*step
```

---

# 43. v1 Aggregator

只需要：

```text
sum
max
countTier
```

例如：

```text
1 项 = 0.5
2 项 = 0.8
3 项 = 1.0
```

就是：

```text
countTier
```

---

# 44. ScoreGroup

树形：

```text
总分
├── 品德 15
├── 学业 75
└── 文体 10
     ├── 基础 3
     ├── 干部 3
     └── 活动 4
```

允许嵌套 cap。

算法：

```text
entry
→ item aggregate
→ child group
→ child cap
→ parent group
→ parent cap
→ total
```

Breakdown 必须保留截断过程。

---

# 45. 计分测试不要使用错误的全局不变量

由于未来存在负分条目：

```text
撤销任何条目
→ 总分一定不增加
```

并不成立。

删除一个：

```text
-0.8
```

扣分事实反而会使总分增加。

正确的不变量包括：

```text
相同输入 → 相同输出

任何 group 最终值不超过 cap

正分事实被移除：
  在不存在特殊非单调规则时不得使对应原始贡献增加

负分事实被移除：
  不得使对应原始贡献进一步降低

Publication 使用同一个 frozen input：
  必须得到相同 Breakdown
```

`countTier` 如果要求单调，也必须首先校验配置中的 tier 本身单调。

不要写超出业务模型保证范围的 property test。

---

# 46. ScoreRun

实时看一个学生：

```text
直接现算
```

不需要 MQ / Cache。

一个学生几十条 Entry，完全没有必要为了“性能”提前建设缓存。

批次级：

```text
管理员试算
正式公示
```

才创建：

```text
ScoreRun
```

生命周期：

```text
PENDING
COMPUTING
READY
FAILED
```

启动时冻结：

```text
participant ids
entry revision ids
review decision ids
item config hash/version
外部事实版本
```

随后计算。

计算期间后台发生其他数据变化：

```text
不影响这个 run
```

---

# 47. Ranking

排名只存在于正式 Publication。

填报期不提供实时排名。

RankingPolicy 至少定义：

```text
partition
tieBreak
是否纳入某些特殊 participant
```

例如：

```text
按年级排名
按学院排名
整个 Batch 排名
```

批次范围和排名范围不是一个概念。

---

## 47.1 默认 tie-break

根据当前政策：

```text
总分
→ 品德
→ 学业
→ 文体
```

仍然完全相同时：

```text
标记 unresolved tie
```

由学院明确裁决并记录原因。

不要静默用：

```text
user_id
created_at
```

破除并列。

---

# 48. 成绩可见性

拆开：

```text
result.view_self
result.view_peers
ranking.view
```

能看到别人：

```text
≠
```

能看到排名。

推荐：

第一次公示：

```text
ownScore   true
peers      租户配置
ranking    false
```

第二次公示：

```text
ownScore   true
peers      租户配置
ranking    true
```

---

# 49. Storage 插件

附件是系统的基础设施，不属于 Evidence 数据表本身。

Plugin：

```text
@qualy/plugin-storage
```

只提供窄接口：

```text
put
open
metadata
retire
```

v1：

```text
local filesystem
```

以后真的需要时再增加：

```text
S3 compatible provider
```

不要提前做：

```text
预签名 URL
CDN
缩略图服务
多副本对象存储
```

---

# 50. 附件不可变

Attachment 上传成功以后内容不能替换。

要修改材料：

```text
上传新 Attachment
+
创建新 EntryRevision
```

附件本身只支持：

```text
retire
```

逻辑退役。

---

# 51. Attachment 关系不要用 uuid[]

如果需要数据库级引用完整性，不要：

```text
entry_revisions.attachment_ids uuid[]
```

推荐关系表：

```text
entry_revision_attachments
appeal_attachments
```

这样可以：

```text
真实 FK
顺序
字段归属
附件类型
```

并避免 PostgreSQL 数组元素无法正常建立 FK 的问题。

---

# 52. 插件边界

最终推荐：

```text
packages/plugins/
├── assessment/
│   ├── core/
│   ├── evidence/
│   └── appraisal/
│
├── data/
│   ├── grades/
│   └── dormitory/
│
└── infra/
    └── storage/
```

---

## 52.1 assessment/core

一个插件内部包含：

```text
batch/
phase/
roster/
item/
entry/
review/
appeal/
scoring/
publication/
archive/
```

不要拆：

```text
eval-batch
eval-flow
eval-scoring
eval-publication
```

这些模块：

```text
共享实体
共享事务
共享生命周期
强外键耦合
```

拆成插件只会制造大量 Contract 和依赖仪式。

---

## 52.2 evidence

通用学生举证型 ItemType。

覆盖：

```text
献血
退役复学
优秀学生教官
国旗班
各种证书
竞赛证明
科研证明
```

通过实例配置表达。

---

## 52.3 appraisal

独立处理：

```text
教师评价
学生互评
```

因为它的 interaction model 是：

```text
管理员创建任务
→ 指定评价人
→ 对一组学生逐个打分
```

不是普通 Entry Form。

---

## 52.4 grades

成绩库是独立事实域。

即使没有综测：

```text
学生
学期
课程
学分
考试成绩
导入记录
```

仍然成立。

所以应该独立 Plugin。

---

## 52.5 dormitory

寝室也是独立事实域：

```text
寝室
入住
调寝
退寝
查寝批次
查寝成绩
```

生命周期跨 AssessmentBatch。

因此独立 Plugin。

---

# 53. Grades 不是单纯总分 CRUD

M6 至少考虑：

```text
Term
Course
CourseNature
Credit
GradeRecord
Attempt
ImportBatch
ImportError
```

需要保留课程行级事实，因为规则可能问：

```text
所有必修是否 ≥ 85
不及格课程有几门
课程加权平均
第一次考试成绩是多少
```

不要只存：

```text
学生学期平均分
```

---

# 54. Grades 只负责事实

Grades：

```text
这门课：
3 学分
必修
首考 87
补考 92
```

Assessment：

```text
按照本综测规则首考 87 怎么计分
```

绝不能把：

```text
全85加2
```

写到 Grades Plugin。

---

# 55. 教师评价

教师评价属于 Appraisal。

模式：

```text
default
evaluation
```

default：

```text
规则直接给默认基础分
```

不创建几千条默认 Score 记录。

evaluation：

```text
管理员创建 EvaluationTask
→ 指定范围
→ 指定教师
→ 教师逐生打分
→ 完成任务
```

---

## 55.1 未完成任务

不能：

```text
老师漏打 1 人
→ 已经打的 99 人全部作废
```

正式公示前：

```text
EvaluationTask incomplete
=
Publication blocker
```

管理员出路：

```text
补录
转派
显式作废任务
```

作废必须填写原因。

如果：

```text
100/100 都录完
只是没点击“完成”
```

可以自动 complete。

---

## 55.2 公式不要猜

政策没有明确：

```text
100 分制 → 8 分
```

怎么转换。

因此配置化。

多教师给同一学生评分时：

```text
平均
加权平均
取最高
```

同样配置化。

---

# 56. Dormitory

自动寝室模式不应该让学生挑最有利的数据。

不要：

```text
学生自己选哪些查寝批次参与平均
学生自己选某个时间点证明自己住在这个寝室
```

因为会产生 cherry-picking。

应该由管理员配置：

```text
纳入哪些 InspectionBatch
```

或：

```text
满足日期条件的批次自动纳入
```

系统根据 Occupancy 时间区间自动判断。

---

## 56.1 Occupancy

建议：

```text
user
room
period daterange
source
```

例如：

```text
A寝室
[2026-03-01, 2026-04-12)

B寝室
[2026-04-12, ∞)
```

---

## 56.2 寝室长

不要 first-write-wins：

```text
第一个自称寝室长的人锁死唯一约束
```

应为：

```text
DormLeaderClaim
```

多人冲突：

```text
CONFLICT
```

交人工裁决。

---

## 56.3 无住宿/无成绩三态

支持：

```text
FULL
ZERO
NOT_APPLICABLE
```

不要只支持：

```text
0 / 满分
```

NOT_APPLICABLE 最终怎么影响 ScoreGroup，由规则配置。

---

# 57. 旧 Excel 怎么使用

旧 Excel 是：

> “现有人工业务流程的真实记录”。

它可以帮助发现：

```text
班委喜欢横向网格录入
哪些字段容易填错
哪些证明需要特殊格式
哪些项目过去经常核对历史
```

但不要因为旧表里存在某个旧政策，就立刻把它建设成新系统 kernel。

当前明确保留的便宜能力：

```text
source_key
字段 pattern 校验
enum_with_other
proxy 代录
批量导入 source=import
```

当前明确推迟：

```text
跨学期补差
跨学期累计限额
月度结算
QuickJS 自定义公式
```

等新版细则确认真实需要再做。

---

# 58. UI：用户必须看到“业务流程”，而不是内部状态机

学生首页重点不是数据库状态。

应该显示：

```text
2025-2026-2 综合素质测评

当前：正式填报期
提交截止：9月5日 23:59

接下来：
审核整理
第一次成绩公示：9月10日 09:00
申诉截止：9月13日 17:00
最终成绩：待定
```

没有 Publication 预告时：

```text
第一次成绩公示：待定
```

不要显示：

```text
管理员尚未创建公示
```

这种内部系统语言。

---

# 59. 学生填报中心

按大类展示：

```text
品德行为表现
学业表现
文体表现
```

每张 Item Card：

```text
题目名称
当前计入分
组上限
条目状态汇总
新增入口
```

例如：

```text
无偿献血

当前计入：1.0
2 条记录
✓ 1 已通过
… 1 审核中
```

---

# 60. Item 页面

统一：

```text
Entry List
+
新增条目
```

Entry 卡片：

```text
状态
当前 Revision 摘要
预计/实际分值
审核到哪一级
附件
审核时间线
编辑 / 撤回 / 申诉等动作
```

---

# 61. 成绩明细页是核心产品页面

必须能解释：

```text
为什么是这个分？
```

建议：

```text
品德行为 13.2 / 15
  教师评价 7.5
  学生互评 0.9

  献血 +1
  教官 +2
  国旗班 +2
  教官/国旗班组合封顶 -1

学业 ...

文体 ...
```

不要只显示：

```text
总分：86.23
```

大量真实申诉都来自：

> “我不知道系统为什么算成这样。”

---

# 62. 管理端

Batch Admin 页面至少包含：

```text
基本信息
Phase 时间线
Roster / Diff
Item 配置
ScoreGroup 树
审核异常
ScoreRun / 试算
Publication
归档
```

Preflight 应该成为一个非常重要的管理面板。

---

# 63. 审核端

统一 Inbox：

```text
当前我可以处理的所有 ReviewInstance
```

支持：

```text
Item 筛选
Batch 筛选
状态筛选
组织范围
```

详情：

```text
Entry Revision
附件
审核链
历史事件
当前动作
```

---

# 64. API 原则

具体 HttpApi API 必须读取仓库当前 Effect 版本源码。

路径层面保持：

```text
/assessment/batches
/assessment/items
/assessment/entries
/assessment/review/inbox
/assessment/appeals
/assessment/score-runs
/assessment/publications
```

不要建设：

```text
/doApprove
/submitEntryNow
/publishResult
```

这类动作式 RPC 路径。

状态变化优先：

```text
PUT .../status
```

领域决定：

```text
POST .../decisions
POST .../votes
```

可以作为一等资源。

---

# 65. 核心逻辑表建议

不是要求 Claude Code 一次性创建所有表，而是给出最终 ownership。

## assessment/core

```text
assessment_batches

batch_phases
phase_templates
phase_events

batch_participants

score_groups
assessment_items

entries
entry_revisions
entry_revision_attachments

source_claims

review_instances
review_stage_panels
review_votes
review_events

appeal_cases
appeal_stage_panels
appeal_events
appeal_attachments

score_runs
score_results

publications
publication_rows
```

## storage

```text
attachments
```

## grades

M6 再设计。

## dormitory

M8 再设计。

---

# 66. Publication Row 应该自包含正式结果

建议至少物化：

```text
publication_id
participant_id

breakdown
category_scores
total_score

ranking_partition
rank

source_score_run_id
```

不要正式公示页面每次再实时调用评分引擎。

---

# 67. 归档

归档是 Batch 的终态。

Gate：

```text
Final Publication 已发布
所有 Appeal 终态
无必须处理的业务 blocker
```

归档后：

```text
禁止业务写入
```

学生仍然可以：

```text
查看自己最终结果
查看允许的排名
打印材料
```

打印引用：

```text
Final Publication
EntryRevision
```

而不是重新计算当前数据库。

---

# 68. 明确禁止的过度设计

Claude Code 不得在没有真实需求时主动建设以下能力：

```text
万能 BPMN / DAG Workflow
通用规则表达式引擎
完整 Event Sourcing
BusinessCalendar
QuickJS 沙箱
Score Cache / Redis
BullMQ
分布式调度锁
S3 Provider
附件缩略图服务
月度考勤系统
跨学期自动补差
通知中心
实时全员排名
动态正式公示
```

这些都已经有合理扩展位置。

现在不做。

---

# 69. 明确禁止的错误简化

同样不能为了省事做：

```text
把所有 Entry 内容直接 UPDATE
让班委 impersonate 学生
把 Publication 做成实时查询
审核任务永久绑定具体用户
组织变化时自动删 Roster
Dormitory 插件缺失时静默转人工
学生自由挑查寝批次
用一个“权限交集”影响 auth.login 等全局权限
把 escalation 当 appeal
每个政策条款建一个 Plugin
```

---

# 70. 插件依赖原则

assessment/core 是综测 bounded context。

它可以依赖：

```text
db
server
ui
org
rbac
auth
```

Storage 在 M2 接入。

Assessment 不依赖：

```text
grades
dormitory
```

反过来通过驱动 / contract / capability 消费它们。

这样：

```text
没有 grades
```

仍然可以运行纯材料填报综测。

---

# 71. 实施里程碑

---

## M1 — Batch + Phase + Roster + PhaseGate

目标：

> 建立整个综测运行时骨架。

实现：

```text
AssessmentBatch CRUD
material daterange
scope

BatchParticipant
Roster generation
Roster diff

BatchPhase
Phase Template
scheduled/manual transition
Phase events

phaseControlled Permission metadata
PhaseGate
Student Timeline
Batch Admin basic UI
```

验收重点：

```text
预填报能 edit 不能 submit
正式填报能 submit
审核整理关闭提交但继续 review

scheduled transition 幂等

未来 planned time 可以修改
已经发生的 actual time 不可回改

Roster 不随组织变化自动漂移
```

M1 不做：

```text
Entry
Attachment
复杂 Review
Scoring
Publication
```

---

## M2 — Storage + Evidence 最小闭环

目标：

> 做出系统第一条真正能演示的端到端业务。

实现：

```text
storage local provider

AssessmentItemType ExtensionPoint
Evidence Driver

Entry
EntryRevision
Attachment

单 stage Review
approve / reject

proxy amendment
```

第一个实例：

```text
退役复学
```

流程：

```text
学生上传退役证明
→ 提交
→ 审核人审核
→ 通过
→ 固定 +3
→ 我的成绩看到 +3
```

到这里必须已经是可演示系统，而不是只有基础设施。

---

## M3 — Review 完整体

目标：

> 把综测最复杂的人工审核问题解决。

实现：

```text
完整 chain
normalTerminal

RoleAt
NearestRole

结构性缺失
职位空缺
自审回避

single / any
all
atLeast(n)

voter panel snapshot

escalation

pull inbox

source claim uniqueness
```

第二个验收实例：

```text
献血
```

测试：

```text
班长换届后 inbox 即时变化

学生自己是班长时不会自审

不存在 class 的直属学生会跳过 class stage

class 存在但无班长会 BLOCKED

相同献血 source claim 不能重复通过
```

---

## M4 — Scoring

目标：

> 从“审核系统”升级成真正的综测系统。

实现：

```text
calcParticipant

Breakdown

fixed
lookup
range
decrement

sum
max
countTier

ScoreGroup Tree
nested cap

ScoreRun
```

验收实例：

```text
优秀学生教官
国旗班
```

两项各：

```text
+2
```

共同组：

```text
cap=3
```

验证：

```text
2
2
3
```

三种组合。

---

## M5 — Publication + Appeal + Archive

目标：

> 完成真正可以用于一个完整学期的系统。

实现：

```text
Publication preflight
ScoreRun → Publication READY

immediate publish
scheduled publish
scheduled freeze

PublicationRow immutable snapshot

publishPreliminary
publishFinal

AppealCase
AppealPolicy

partition ranking
archive
printing source
```

完整验收：

```text
学生填报
→ 多级审核
→ ScoreRun
→ 第一次公示
→ 申诉
→ 更正
→ 第二次公示
→ 归档
```

M5 完成时：

> 即使 Grades / Appraisal / Dormitory 都还没有，Qualy 已经是一套完整可投入使用的“纯材料型综测系统”。

---

## M6 — Grades

实现成绩事实库以及派生 ItemType。

至少：

```text
term
course
course nature
credit
grade attempt
first attempt
import batch
error report
```

Assessment 派生：

```text
课程加权基础分
全85/80加分
不及格扣分
```

不要把这些规则写到 Grades。

---

## M7 — Appraisal

实现：

```text
教师评价
学生互评
```

以及旧 Excel 用户迁移需要的：

```text
班委批量网格代录
```

教师任务：

```text
创建
分配
录入
完成
转派
作废
```

未完成任务进入 Publication Preflight。

---

## M8 — Dormitory

最后实现。

原因：

```text
数据模型较大
但与 Assessment 主链相对独立
手动证据模式可以先满足业务
```

实现：

```text
Room
Occupancy daterange
InspectionBatch
InspectionScore
DormLeaderClaim
```

Assessment 再消费这些事实。

---

# 72. 测试重点

比普通 CRUD 测试更重要的是不变量。

必须覆盖：

## Phase

```text
phaseControlled fail closed

scheduled transition 幂等

actual_entry_at 不可回改

PhaseGate 只能减少 RBAC 权限
```

## Review

```text
普通路径始终是 escalation chain 的前缀

禁止自审

职位空缺不自动上浮

terminal 必须存在

计票 voter set 稳定

single reviewer 换届实时生效
```

## Entry

```text
Revision append-only

审核的是具体 revision

proxy actor/subject 不混淆
```

## Scoring

```text
确定性

group cap 永远成立

Publication 使用冻结 input 时结果一致

正负分场景分别按语义测试
```

## Publication

```text
READY/SCHEDULED/PUBLISHED 后 rows 不可修改

SCHEDULED 时影响结果的写操作拒绝

取消后恢复写入

S1 永远不会因 S2 修改

Appeal target 永远指向 immutable 对象
```

---

# 73. 仍未冻结的业务问题

遇到这些问题时 Claude Code 不得猜。

必须询问用户。

1. 教师评价 `100 → 8` 的换算公式。
2. 多个教师对同一学生评价时的聚合方式。
3. 学生互评范围以及防恶意规则。
4. 献血编号实际唯一范围。
5. 两次公示 `viewPeers` 的默认策略。
6. all / N-of-M 审核节点复杂 reject 投票语义。
7. 某些新版学院规则是否仍存在跨学期补差/累计限额。
8. Dormitory 中最终采用“检查日在住 / 全期间在住 / 区间加权”的哪一种政策口径。

---

# 74. 工程纪律

本设计定义领域模型，不覆盖仓库工程规范。

Claude Code 开始实现前必须先阅读：

```text
CLAUDE.md
STATUS.md
当前插件描述器实现
当前 RBAC contract
当前 org node / ltree 实现
当前 MikroORM 7/Kysely 封装
当前 Effect v4 vendored source
```

尤其：

```text
Effect v4
```

仍有 unstable API。

禁止根据 Effect v3 记忆编码。

具体：

```text
HttpApi
multipart
Schedule
Fiber
Layer
Schema
```

API 以仓库同版本源码为准。

---

# 75. 如何判断是否应该新建 Plugin

只有满足至少一个条件：

```text
拥有独立数据生命周期
可以独立启停
是某个 ExtensionPoint 的驱动
```

才建 Plugin。

否则优先：

```text
assessment/core 内部 module
```

不要为了“看起来解耦”制造 package。

---

# 76. Claude Code 的施工原则

每次实现新能力时按这个顺序问：

### 这是事实还是规则？

事实：

```text
落数据库
```

规则：

```text
进配置 / scorer
```

### 这是历史结构还是实时身份？

历史结构：

```text
快照
```

实时身份：

```text
动态解析
```

### 这是正式结果还是当前预览？

当前预览：

```text
动态
```

正式结果：

```text
immutable publication
```

### 这是业务状态还是权限？

身份资格：

```text
RBAC
```

时间开放：

```text
PhaseGate
```

对象当前能否操作：

```text
ResourcePolicy
```

### 这是独立领域还是 Assessment 内部职责？

独立生命周期：

```text
Plugin
```

强耦合核心：

```text
assessment/core module
```

大多数后续架构问题都应该先用这五个问题判断。

---

# 77. 最终系统应达到的用户体验

管理员不是在操作数据库状态机。

管理员看到：

```text
2025-2026-2 本科生综合素质考核

当前阶段：
审核整理期

材料提交：
已于 9月5日 23:59 截止

审核状态：
已完成 4231 / 4250
待处理 14
疑点 5

第一次公示：
尚未生成

[运行发布前检查]
```

全部处理后：

```text
发布前检查：全部通过

[生成成绩]
```

然后：

```text
成绩计算完成
4250 / 4250

[查看公示预览]

发布时间：
○ 立即
● 9月10日 09:00

申诉截止：
9月13日 17:00

[创建公示预告]
```

学生看到：

```text
当前：审核整理期

第一次成绩公示
9月10日 09:00

申诉截止
9月13日 17:00
```

到时间：

```text
当前：申诉期

第一次公示成绩
83.25

[查看详细计算过程]
[提出申诉]
```

申诉处理结束后管理员：

```text
生成最终成绩
→ 第二次公示
```

学生：

```text
最终成绩
84.25

品德 13.40
学业 62.10
文体 8.75

年级排名 17
```

最终：

```text
归档
打印
签字
```

几年以后重新进入该批次：

```text
第一次公示
第二次公示
当年的材料 Revision
审核过程
申诉过程
最终成绩
```

仍然可以完整还原。

---

# 78. 最终一句设计总纲

Qualy Assessment 的核心不是“把 Excel 搬到网页上”，而是：

> **把原本依赖班委人工维护 Excel、口头审核和人工复核的综测流程，转换成一个以 Batch 为边界、以 Phase 表达时间、以 Roster 固定人员语境、以 Revision 保留事实历史、以受限审核链处理责任流转、以纯函数评分解释成绩、以 immutable Publication 固定正式结果、以 Appeal 处理争议的可配置审计系统。**

第一版的目标不是做最通用的综测平台。

第一版的目标是：

> **让一个真实学院能够完整跑完一次“学生填报 → 审核 → 第一次公示 → 申诉 → 第二次公示 → 归档”的学期流程，同时保证每一个分数、每一次修改、每一个审核决定都可以解释和追溯。**

所有进一步抽象，都应由真实出现的第二个需求推动，而不是提前建设。

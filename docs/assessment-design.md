# Qualy 综合素质测评域 · 完整设计与实施规范

> 状态：**核心架构冻结，可按里程碑施工**（2026-08-08 起）
>
> 本文是综测领域的**唯一权威文档**。它合并三个来源：设计稿 v2.1
> (`docs/p2-tutorial-a-v2_1.md`)、沙箱归属增补 (`docs/p2-tutorial-a-supplement-1.md`)
> 与两轮用户裁决（逐条记录在 §32）。三者与本文冲突时**一律以本文为准**；那三份留在
> 库里只作来源存档，不再更新。§7 的五条原则另有 ADR 副本：docs/adr/0004-0008。

## 阅读说明

1. **CLAUDE.md 是工程宪法，本文档是领域定案。** Effect 纪律、迁移流程、API 路径规范、测试分层、i18n 边界、租户纪律等一律以 CLAUDE.md 为准，本文档只在接口点处引用。两者冲突时停下来向用户报告，不要自行裁决。
2. 你目前的仓库认知停在 P1 基座收尾：已有多租户、组织树（ltree）、RBAC、认证驱动、UI 组合、插件描述器与装配体系——**但还没有任何一行业务代码，也不知道这个系统是给谁用的**。所以本文档第一部分先讲业务，读完再看架构。不理解第一部分就动手，做出来的一定是错的 CRUD。
3. §7–§20 的设计决策已经过多轮讨论与外部审计收敛，视为冻结；实现时不重开方案讨论，发现与仓库现实冲突时报告并提出最小修正。§27 的推迟项**禁止提前建设**；§30 的问题遇到即问用户，不得替政策做假设。
4. 按 §26 里程碑垂直切片施工。每个里程碑收尾：逐条真实执行验收、摘录输出进 STATUS.md、提交（Conventional Commits，英文，禁写里程碑编号）。

---

# 第一部分 · 业务认知

## 1. 这个项目在做什么

**综合素质测评（简称"综测"）**是中国高校每学期对每位学生进行的一次量化评价，实行 100 分制：

```text
品德行为表现 15 分   = 基础分 9（教师评价 8 + 学生互评 1）+ 奖扣分
学业表现     75 分   = 课程加权平均 × 75% + 加扣分
文体表现     10 分   = 基础分 3 + 学生干部奖励 3 + 文体活动奖励 4
```

它是奖学金评定、评优评先、研究生推免和就业推荐的重要依据——**分数错一位小数都会引发真实争议**，这是整个系统对审计与可解释性要求极高的根源。

加扣分条目五花八门，举几个真实政策条款让你建立手感：

- 献血：凭献血证期末加 1 分（编码不得重复通过，管理员可限定为学校组织的几场活动）。
- 退役复学：所在学期加 3 分（上传退役证书，审核通过即得）。
- 优秀学生教官 +2、国旗班成员 +2、**兼具者共 3 分**（两个事实、一个组合上限——见 ADR-5）。
- 优秀寝室：学期查寝平均 ≥90 的寝室成员 +0.8、寝室长 +1（数据来自寝室管理域）。
- 专业竞赛：第一名国家级 3 / 省 2 / 市 1，第二名起每名递减 0.2，集体项目减半（参数化公式）。
- 科研：论文/课题/专利 × 主持人/第一~四参与人的二维查分表。
- 社会实践/志愿服务：1 项 0.5、2 项 0.8、3 项 1（**非线性计数分档**，不是逐条求和）。
- 各大项与若干子项均有封顶（品德加分后不超 15、文体内部 3+3+4 再封 10……）。

流程由政策刚性规定：**每年 3 月和 9 月公示学期综测成绩；学生自公示之日起三个工作日内可提出异议；工作小组三个工作日内答复；自第一次公示起六个工作日内进行第二次公示**；之后归档、打印材料、签字上报。

最后一个决定架构的政策事实：学校有统一办法，但**各学院可制定实施细则**（政策第八条）。同一道"献血"，不同学院的字段约束、审核链、甚至存在与否都可能不同。所以：**机制进代码（题型驱动），细则进配置（题目实例 = 数据行）**——这就是"插件化综测系统"的含义，不是每条政策一个插件。

## 2. 参与者与组织语境

租户 = 一所学校。组织树由 org 插件维护（ltree）：`学校 → 学院 → 年级 → 专业 → 班级`。批次的 scope 是任意子树（全校、某学院、某年级）。用户单类型单归属：学生通常挂在班级节点，编制特例（一个专业只有一人）可能直属专业——这会导致审核链上"班级"一级天然不存在，系统必须正确处理（ADR-4）。

| 角色            | 锚定位置              | 在综测里做什么                                                          |
| --------------- | --------------------- | ----------------------------------------------------------------------- |
| 学生            | 班级（或特例上级）    | 填报材料、查看成绩明细、对公示结果申诉                                  |
| 班长 / 学习委员 | 班级节点              | 大多数材料的第一级审核（normalTerminal）；可代录本班漏报材料（§13）     |
| 专业负责人      | 专业节点              | 疑点上审链的中间层                                                      |
| 年级负责人      | 年级节点              | 疑点上审链的中间层；部分高分项的普通终点                                |
| 辅导员          | 年级/学院（继承语义） | 审核链条终点：疑点与申诉的最终裁决者，唯一能在这两种流程中驳回/更正的人 |
| 学院/批次管理员 | 学院及以上            | 批次全生命周期：建批次、配题目、管阶段、跑公示、处理异常、归档          |

角色是 RBAC 授予，锚在组织节点上；"找到学生 A 的班长"永远意味着"从 A 在**本批次冻结的锚点**出发，向上找到最近的班级型节点，取该节点上持有班长角色的人"——不是全树搜索，也不是看 A 现在的实时归属（ADR-3）。

## 3. 一个学期的完整流程

把三种人的视角压进一条时间线（这也是默认阶段模板的由来）：

```text
[管理员] 创建批次：名称、组织范围、材料日期范围(daterange)、说明(markdown)
         套用阶段模板 → 配置 ScoreGroup 树与题目实例 → 激活 → 生成花名册快照
    ↓
预填报期        学生可新增/编辑草稿，不能提交（提前准备材料）
    ↓ scheduled
正式填报期      学生提交；代录漏报材料（§13）；第一级审核并行进行
    ↓ scheduled（提交截止 ≠ 审核截止，所以有下一阶段）
审核整理期      学生侧冻结；审核继续清尾；BLOCKED/疑点逐个处理
    ↓ 管理员：preflight 全绿 → 生成 ScoreRun → Publication READY → 预告(SCHEDULED)
    ↓ 到点自动 PUBLISHED，同一事务切入下一阶段
申诉期          学生查看第一次公示(S1)，对具体行/决定发起申诉；截止时间在发布时设定
    ↓ scheduled（申诉截止 = 不再受理新申诉）
申诉处理期      既有申诉继续裁决（维持/更正/上提）
    ↓ 管理员：发布第二次公示(S2，吸收更正，含排名)，同事务切入下一阶段
结果确认期      查看终版成绩与排名
    ↓
归档期          批次只读；打印材料、签字；多年后仍可逐字节还原当年结果
```

学生首页看到的不是内部状态机，而是这条时间线的人话版："当前：正式填报期 · 提交截止 9月5日 23:59 · 第一次成绩公示：9月10日 09:00（已预告）· 申诉截止：9月13日 17:00 · 最终成绩：待定"。**没有预告就显示"待定"，永远不显示"管理员尚未创建公示"这种系统内部语言。**

## 4. 一条材料的一生（用献血走一遍所有机制）

1. 张三在"无偿献血"题下**新增条目**：从 event_pick 里选"2026-03-31 · XX爱心献血屋"（日期+地点是一个整体选项，防止拼出不存在的组合）、填献血编码（正则校验）、上传献血证照片 → 生成 **EntryRevision 1**（不可变）。
2. **提交** → 系统按张三冻结的锚点解析出**有效审核链快照**：`班长/学委@软件2401(any, normalTerminal) → 专业负责人 → 年级负责人 → 辅导员`，创建 ReviewInstance；同键待审条目若已存在则给出软提示。
3. 班长收件箱（**拉模型**：按"当前 stage 的角色@节点 × 我的 RBAC 授予"实时查询）出现该条目。班长觉得证书日期模糊，点"**不确定，向上提审**"→ 进入 escalated 模式。
4. 专业负责人、年级负责人只能 comment / recommend / 继续上提；**辅导员（终点）approve** → 事务内占用 source_claim（编码在配置的唯一域内不得重复）→ 条目 approved。
5. 计分引擎把它作为已确认事实：+1 进品德组，封顶后计入总分。张三随时能在"我的成绩"看到**实时预览**与逐行 breakdown。
6. 第一次公示 S1 发布：张三 83.25。他对另一条**被驳回**的条目不服 → 从 S1 该行的 BreakdownLine 发起**申诉轮**（origin='appeal' 的新一轮 review_instances，锚定 publication + line，不指实时条目）→ 在同一条已快照链上越过 normalTerminal 继续 → 辅导员（终点）approve = **更正原决定**。
7. 第二次公示 S2：84.25，含年级排名。S1 原样保留——管理员可以解释"第一次 83.25 → 申诉更正 +1 → 第二次 84.25"。
8. 归档。三年后重新打印，看到的仍是当年的 Revision、审核事件与 S2，不重算。

## 5. 我们从哪里来：旧 Excel

此系统之前，整个流程靠一张班委手填的 Excel 横表：行 = 学生，列 = 各题字段，公式自动算总分；"避免重复加分"靠班委人工翻既往学期的旧表核对；填错格式靠"打回"。旧表教给我们的，分三类处理：

- **保留的便宜能力**：字段正则校验（活动名必须含届次/年份/"校赛"——直接消灭大半"打回"）、`enum_with_other`（佐证材料类型 A–G + 手动输入）、`event_pick`、规范化 source_key（重复核对从人肉变成唯一约束）。
- **改变的交互**：学生自填为主；**修改永远只有本人**——审核人发现填错在驳回里附修改建议，由学生自己照着改（管理员在线 Excel 改学生内容不做）。**代录**只是创建代理：替学生提交其本可自提的漏报材料，subject=学生、照常走审核链（§32.16）。行政事实（扣分、特殊加分）是另一条 trusted 路径，见 §13。
- **明确推迟的旧机制**：跨学期补录补差、累计限额、月度小结平均、自定义公式沙箱——旧表里存在 ≠ 新细则需要，等真实需求触发（§27）。

## 6. 为什么不能做成普通 CRUD

八个决定架构的业务特征：① 校规统一但院系细则不同（驱动+配置）；② 不同材料审核路线完全不同（受限审核链）；③ 审核人取决于学生的组织位置（锚点解析）；④ 材料只由本人修改（代录仅创建，行政事实由权威录入），每次变更必须完整审计（不可变 Revision）；⑤ 第一次公示后允许申诉，公示结果必须永久可追溯（不可变 Publication）；⑥ 分数有分组、封顶、取最高、查表、计数分档（纯函数计分 + ScoreGroup 树）；⑦ 数据来源混合：学生填报 / 教师评价 / 成绩库 / 寝室系统（interaction: entry|task|derived）；⑧ 批次持续数周，期间换届、转组织，历史业务不能漂移（快照结构 + 实时身份）。

核心问题一句话：**把一个长周期、多角色、多规则、可申诉、必须可审计的评价流程，建模成稳定的业务系统**——既不能退化成 CRUD，也不许膨胀成 BPMN / 低代码平台 / 万能规则引擎。

---

# 第二部分 · 冻结的架构决策

## 7. 五条 ADR（写入 docs/adr）

**ADR-1 正式公示永远是不可变快照。** 系统只有两类成绩：实时预览（provisional，随审核/撤回/评分/更正不断变化）与正式公示（released，immutable）。学生申诉必须能指着"第一次公示中的这一行"；因此 S1 永不原地改成 S2，申诉更正产生新输入、生成 S2，S1 原样保留。只有完整、通过 preflight、由 READY 的 ScoreRun 支撑的快照才可进入 SCHEDULED；SCHEDULED 存续期间一切影响其输入的写操作被拒绝（先取消预告）。不存在"动态正式公示"。

**ADR-2 审核中的"不确定"与学生"申诉"是两个工作流。** 审核员点"不确定，向上提审"= Review Escalation，走主链的疑点延伸段，动作词汇是 通过/驳回/上提；学生对已公示结果或既有决定的异议 = Appeal，终局动作词汇是 **维持原决定 / 更正原决定 / 上提复核**。（修订 2026-08-09：**概念仍分，存储统一为"轮"**——申诉/复查是 review_instances 的新一轮而非独立表，词汇、锚定、仅终点可驳、审计可分四条动机全部保留，见 ADR 0005 修订段与 §15、§32.14。）

**ADR-3 审核路线冻结，普通审核人实时解析。** 每个参与者在批次内有唯一冻结的 assessmentAnchor；审核路线（有效链结构：哪些 stage、锚在哪些节点、quorum、normalTerminal、被跳过的 stage 及原因）在提交时快照。但 **single/any 节点不保存具体审核人 user id**——收件箱按"当前 stage 的角色@节点 × RBAC 授予"实时解析：班长换届，旧班长收件箱即时清空、新班长即时可见，零任务迁移。只有 all / atLeast(n) 计票节点在进入时快照 voter set（稳定分母）；已投票永久有效。

**ADR-4 缺审核人三分，绝不静默转移审批权。**

- _结构性缺失_：锚点祖先链上根本不存在该 nodeType 节点（专业直属生没有班级）→ 跳过该 stage、记录原因、normalTerminal 向后顺延。这是合法组织形态。
- _职位空缺_：节点存在但无人持有角色 → 条目/实例 `BLOCKED`，告警管理员补任命或转派。**不能偷偷找上一级替代**——那是静默转移审批权。
- _自审冲突_：解析结果含提交人本人 → 从候选中剔除；single/any 剔空则该 stage 对本条目跳过（记录 `self_review_conflict` 事件，normalTerminal 照 a 顺延）；计票节点剔除后 quorum 不可达 → 按 b 处理。绝不允许自己审自己。
- 任何情况下：terminal stage 必须存在且解析非空，否则拒绝提交并告警。不允许零人审核。

**ADR-5 Claim 与 ScoreGroup 分离。** 题目回答"这个事实成立吗、单独值多少分"；ScoreGroup 回答"多个事实组合后计多少"。教官 +2 与国旗班 +2 是两个题目（分别举证/审核/申诉），挂进同一 cap=3 的组 → 2 / 2 / min(4,3)=3。禁止在题型内部写 `if 国旗班 then …`；组合规则（封顶、互斥、取最高）永远属于组，不属于单个题型。

## 8. 领域对象总览

```text
AssessmentBatch（聚合根）
├── PhasePlan：BatchPhase[]（有名业务阶段 + 权限档案 + 进入方式）
├── Roster：BatchParticipant[]（冻结 assessmentAnchor）
├── ScoreGroup 树（品德15 / 学业75 / 文体10 及子组，嵌套 cap）
├── AssessmentItem[]（题型驱动 id + 实例配置数据行）
│     └── Entry ── EntryRevision[]（不可变） ── ReviewInstance（主链投影）
├── ScoreRun[]（冻结输入的批次级计算）
├── Publication(preliminary) ── 申诉/复查轮（review_instances origin='appeal'，锚定 S1 的行）
├── Publication(final)
└── Archive（引用终版，只读打印）
```

## 9. Batch 与 Roster

**AssessmentBatch**：`name, description_md, material_range(daterange), timezone(默认 'Asia/Shanghai'), status(draft|active|archived), config_revision, current_phase_id(投影)`；scope 落在配套表 `batch_scope_nodes(batch_id, node_id)`——**节点集合，不是单一子树**（裁决 §32.35）。

- **材料日期用 `daterange` 左闭右开**（`[2026-03-01, 2026-09-01)`）：证书只有日期没有时间，彻底避开 23:59:59.999 与时区噪音。daterange 自定义类型**仿照 org 插件 `src/db/ltree.ts` 先例**实现。题型可继续缩窄：合法日期 = `batch.material_range ∩ item.dateConstraint`。阶段等流程时间一律 `timestamptz`，按 batch.timezone 展示。
- **scope = 人群的定义（intent），roster = 人群的事实**（裁决 §32.35，"纯导入模式"否决——导入完成后系统不再知道批次面向谁，**新迁入检测因此失明**：转入生既不在花名册也不在任何落库定义里，无从发现）。scope 是**节点集合**（`batch_scope_nodes`，"只允许 1/2/3 班填报"= 一个批次三个节点，~~v1 不做不连续多 scope~~ 撤销）；只存 node_id，**路径实时解析**——引用的是"这些组织单位"，单位挪动批次跟着单位走，原 scope_path 快照列取消（要冻结的是 roster，不是 intent）。刻意**不带 org_nodes 外键**：节点被删除 → diff 面板出 **scope 完整性警告**，生成与新迁入检测跳过该节点，roster 既有成员因 lineage 冻结不受影响。校验：同租户；**拒绝互为祖先后代的选择**（并集语义下嵌套无害但必然困惑管理员）；集合非空。管辖判定随之泛化：创建与管理批次要求操作者的 batch.manage reach **覆盖每个 scope 节点**。draft 期 scope 可改（active 锁定——roster 已依赖它）。范围外手工纳入（借读生等锚点不在任何 scope 子树内者）v1 不做，触发条件记 §27。新迁入谓词 = 在任一 scope 子树内 ∧ 类型匹配 ∧ 不在 roster。description_md 是管理员业务数据，i18n 上属 **literal**，不进 message catalog。
- **One Batch = One Rule Set**（不变量，裁决 §32.19）：一个批次内所有 participant 共用同一套 Item / ScoreGroup / 评分规则。软件学院与英语学院细则不同 → **开两个批次**，而不是在一个全校批次里加 item 适用性 DSL 或按院覆盖计分——那会让系统复杂度翻倍。未来真需要学校统一管理多个子批次时再建 `AssessmentCampaign` 上层编排（触发条件记 §27），绝不现在做。
- **配置生命周期是分级的，不是"出现提交后冻结"**（裁决 §32.8——配置错误恰恰是被填报过程发现的，把修改做成重流程等于逼管理员绕过系统）：
  - 批次 **draft**：随便改，零仪式。
  - **激活后、S1 前、无 SCHEDULED**：自由编辑；每次保存追加一条配置事件（操作人、前后 diff、可选理由），保存时给影响提示（"本题已有 37 人提交"）作**确认对话框**而非审批流程；在途 ReviewInstance 保持已快照的链不受影响（"重新路由在途条目"开关**删除**——与链快照不可变冲突；将来真需要 = 取消旧实例 + 开新实例，触发条件记 §27）。
  - **S1（preliminary）已发布后：评分语义冻结**（ADR 0009；冻结绑定于"存在未被 retract 的 preliminary publication"——retract 即解冻回上一档规则，新 S1 发布再冻）——calculator/aggregator/组树（cap/floor/结构）/题目计分配置/参与者集合不可普通修改；要改必须 `retractPreliminary(reason)` 撤回公示 → 修正 → 重新 ScoreRun → 重新发布可申诉的 preliminary。S1 后仍可变的只有：申诉/复查裁决、既有事实状态变化、行政认定录入（S2 preflight 显式确认）、装饰性文本（审计）。S1 后要新增题目/改计分再开补充期，**强制走 retract**——新题的分也要经过一次可申诉的公示。
  - 存在 **SCHEDULED** 公示：冻结，拒绝写入，先取消预告（§17）。
  - **归档后**：只读。
  - **理由必填按操作类型挂，不按阶段挂**：题目作废必填；active 批次上任何**计分语义变更**（calculator/参数/聚合器/cap/换组）必填；装饰性修改（标题、说明、字段 label）理由可选——S2 与 S1 的规则性差异说明素材由此而来。
  - **"改了必须可重算"是现有快照体系的免费推论**：批次上单调递增的 config_revision 进 ScoreRun 的 input_manifest，配置一改旧 run 的 manifest 落后，preflight 自动判"试算已过期需重跑"，零新机制。`BatchConfigRevision` 因此降级为 **append-only 配置事件日志 + 单调计数器**，不是审批实体。
  - 材料范围修改前做 impact check（列出将越界的既有条目）。

**BatchParticipant**：`batch_id, user_id(唯一对), assessment_anchor_node_id, anchor_path(ltree 快照), user_type_id, status(active|excluded), included_at, excluded_at?`。

- 批次激活时**同步生成**（单条 `INSERT…SELECT`，EXISTS 于 scope 节点集合的并集 + 用户类型过滤，事务内完成，不上队列；嵌套选择已在写入时拒绝，子树两两不相交）。
- **锚点是批次自治的边界，不是在途条目的稳定器**（表述修正，裁决 §32.7）：在途条目的稳定靠 ReviewInstance 提交时快照的**有效链**——链钉死的是节点，实时解析的是"该节点此刻谁持有角色"，所以学生转走后旧链照常由**原节点**的现任审核（有意为之：否则任何转移都会把在途条目甩进可能无人的新链）。roster 的 `assessment_anchor_node_id + anchor_path` 买的是**此后**的语义：新提交与申诉按冻结锚点路由（学期中转走的学生在原单位完成本学期综测，材料不会出现在新学院毫无上下文的收件箱）、排名分区确定（partition key 取锚点祖先）、行政录入的管辖判定稳定、以及管理员的控制杆——转移不静默改变批次行为，而是进 diff 面板显式应用，应用时当场校验新链（"新锚点下班长一级无人，应用后**该生此后的新提交**将 BLOCKED，确认？"——在途条目保持已快照链不受影响）。仅有 anchor_path 还不够（第二轮审计 P0）：ltree 冻结了 ID 链，但没冻结**每一级当时的节点类型**，而 org 的节点类型变更是仓库的真实设计面——类型漂移后 `RoleAt(nodeType)` 会解析错位。所以 participant 另存 **anchor_lineage jsonb**：`[{nodeId, nodeTypeId}]` 自锚点到根逐级冻结，`RoleAt` 从 lineage 找节点、再在该冻结节点上实时解析角色持有人——组织语境 frozen、持有人 live，这才完整兑现 ADR 0006。存 jsonb 不建独立表：快照的本义是与活数据脱钩，独立表配 FK 反而把冻结数据重新拴回可能被删的活节点，且 lineage 永远整条读取、不按层查询。anchor_path 保留，继续服务子树范围判断（管辖 canAt、diff）。成员资格已用快照（excluded 保历史），位置若实时会得到嵌合体语义——两者是"谁、以什么位置参加本批次"这同一事实的两半。可配糖："该生**首次提交前**锚点变更自动同步"（低风险开关）；首提之后必须走 diff 面板。不从用户实时 membership 推断；本系统单归属，未来双学位歧义在 enrollment 层解决，禁止改 org 全局约束。
- **永不自动增删，转入转出对称**（裁决 §32.7）：组织树变化后 diff 面板列出新迁入（未纳入）/已迁出（仍在册）/锚点变更/**用户类型或资格变更**，外加 **scope 完整性警告**（scope 行指向已删除节点），管理员显式应用。**漂移检测 on-read 派生**（面板打开现算、徽标同源），不进巡检也不用每分钟扫——漂移有天然的请求驱动发现路径（转入生自己会打开批次页，管理员会开面板）且不阻塞任何在途流程；真需要主动提醒时在五分钟巡检摘要里加一个 diff 计数（触发条件留档，现在不做）。**转入不自动纳入**——转出不自动删 + 转入自动加 = 每次学期中转移都制造**双重参与**（同一学期两个批次同时算分、公示、排名），而"这学期他在哪边评"是政策与两院协调问题，且系统只能看见自己（对方学院可能不用本系统，跨批次查重只覆盖子集），纳入判断的 owner 是人。系统辅助：纳入时查该 user 在其他未归档批次的 active 记录并警告；当场校验新锚点下的有效链。"填报截止前自动纳入"开关保留但**默认关**，且加"其他批次无 active 记录"守卫。scope 内未纳入的学生打开批次页显示"你尚未被纳入本批次，如有疑问联系学院"。已迁出者置 `excluded` 保留全部历史（Entry/Review/Score/Publication/Appeal 的业务归属不能悬空）；显式移出时管理员当场决定其条目去向。锚点变更只影响此后新提交条目的路由，在途条目保持已快照的链。
- **实时组织树与 roster 的差异不是公示 blocker**——快照的意义就是隔离漂移。只有真正的 roster 完整性问题才 block：participant 缺 anchor、重复行、管理员已明确要求纳入但未裁决的新生。
- 花名册是一切的分母：计分迭代对象、评价任务完整性基准、公示覆盖范围。无任何提交的学生也在计分与公示中（基础分由规则给出，**不为默认分预创建记录**——事实落表、规则进引擎）。

## 10. Phase：时间管理的主模型

管理员思考的是"现在什么阶段、这个阶段能干什么"，不是一堆能力窗口的集合运算——所以 **Phase = 有名称的业务状态 + 权限 Profile + 进入方式**，是配置与用户认知的主模型。公示不是阶段（§17）。

**batch_phases**：`batch_id, ordinal(唯一对), phase_key(kind), display_name, entry_trigger(**scheduled|manual|publication**), planned_entry_at?, actual_entry_at?, entry_offset(jsonb?), estimated_entry_at?, opens_publication_id?, permission_profile(jsonb: code[]), source_template_id?, source_template_version?`。三种时间形态各有落点（第三轮审计 §2——模板应用是复制，offset 不落列则事件发生时无据可物化）：`entry_offset` 存模板复制来的时长规格（锚"前一边界的 actual"，上游事件发生时物化进 planned_entry_at，物化前可改）；`estimated_entry_at` 纯展示"约"，与任何 trigger 共存；`opens_publication_id` 的**绑定生命周期**（裁决 §32.26——约束挂在武装时刻，不是创建时刻）：创建时 NULL 合法（= 未武装态，模板建批次天然合法）；`schedulePreliminary` 绑定并武装；**未进入前可重绑**（公示 CANCELLED 即释放绑定、阶段回未武装、下游已物化 planned 清空——"取消回待定"的机械实现）；`actual_entry_at` 一旦产生，绑定永久不可改。约束三条：非 publication trigger 必须 NULL；publication trigger 可 NULL；部分唯一 `WHERE opens_publication_id IS NOT NULL` 保一一对应。M1 落 nullable uuid 列（无 FK——publications 表 M5 才建，届时一条 ALTER 补 FK）。这是四成员的受限领域联合，不是规则引擎。配套两张 join 表 `phase_item_scopes(phase_id, item_id)` 与 `phase_participant_scopes(phase_id, participant_id)`（补充期的作用范围，§11；两者同为空 = 普通阶段）。

- **不存 start/end**。区间 = `[本阶段 actual_entry_at, 下一阶段 actual_entry_at)`，派生而非存储——空隙和重叠在这个表达下写不出来；末阶段 `[start, ∞)`。批次冗余 current_phase_id 作查询投影。
- **actual_entry_at = 语义生效时刻**（裁决 §32.10）：scheduled 边界触发时写入的是 **planned 值**——阶段在法律意义上于计划时刻开始，哪怕调度 fiber 晚了 47 秒才扫到；机器执行时刻另记 `phase_events.processed_at`。manual 边界的 actual = 动作事务时间。这与 Publication 的 `publish_at`（承诺）/`published_at`（执行）是同一个模式，两处对称。**planned 与 actual 分离，历史永不改写**：未发生的 planned 可改（审计 + 可选通知学生）；actual 一旦产生永久不可修改。要"重开填报"就在序列中插入新阶段（补充填报期）——历史于是能被准确讲述。
- **PhaseGate 按时钟判定，不按物化状态**：`effectivePhase(now)` 在当前物化阶段基础上向后看——下一边界是 scheduled 且 planned 已过、**或是 publication 边界且其所绑公示 effectivePublished(now) 为真**（§17），即视为已进入（连续多个都过了就循环推进），物化只是追认。"9.5 00:00 截止"精确到秒兑现，与调度延迟彻底解耦（调度器宕机七分钟也说得清 00:03 提交的那条算不算数）。
- **时间线是队列，武装前缀精化**（第三轮审计 §2）：**武装前缀 = 从队头起，穿过 scheduled 边界与"已绑定 SCHEDULED 公示"的 publication 边界，止于首个未武装边界**（manual，或未绑草稿的 publication）。调度器只推进武装前缀内到点的边界；前缀之外的任何 scheduled 时间都不会被触发。公示被 retract/cancel 时，其下游已物化的 planned 一并清空回"待定"。下游时间只有三种形态：① **硬计划**（绝对时间、自动生效）——只允许出现在"队头到第一个未发生的 manual 边界"的连续前缀上（校验强制），学期初能定死的日历段属于此类；② **偏移量**——挂在事件边界之后的段在模板里存**时长**（申诉期 = 发布后 +1 天 / +3 工作日），**锚的语义时刻一旦确定即可物化**（裁决 §32.34）：manual 边界在事件发生时确定；SCHEDULED 公示的 publish_at 在 schedule 时刻就已确定——申诉截止此刻已是对学生的承诺，允许提前物化，cancel/retract 再清除；③ **预计**——纯展示的软时间（"第一次公示：约 9 月 10 日"），不武装、不生效、可随便改。物化下游时间时若早于上游 actual → 拒绝并要求重设，不静默压缩阶段。
- **边界分两类**：**承诺型**（面向学生的 deadline：填报截止、申诉截止）到点必然生效、一秒不差，绝不因内部状态延迟——这是对用户的信用；**里程碑型**（面向流程：审核结束、公示发布、归档）guard 优先于时钟——到点但 guard 红 → 告警给人，绝不强行切。公示 preflight 是这一原则的第一个实例，审核期结束是第二个。**公示发布是会转化的边界**（裁决 §32.34）：进入 SCHEDULED 之前是 guard 控制的里程碑；一旦 SCHEDULED，就转化为**承诺型**——到点必须发布（§32.18 的照发语义由此而来）。
- **审核期怎么结束**（一个 manual 边界的三个旋钮，裁决 §32.11）：提审关闭后待审数单调递减（`count(review_instances where state in (active, blocked))`，blocked 计入；插入 scoped 补充期会让计数回升——显式动作，回升即预期），"全部审完"因此是稳定谓词。① **手动按钮（默认）**：batch-admin 常驻"剩余 n 条在审"计数器（分列 在审/疑点上行/卡死），归零时"结束审核期"点亮，未归零时变为"强制结束"（force-advance + 必填理由）；动作内断言当前 profile 的 entry.submit 已关闭且无 active 补充期。② **计划时间 = SLA（可选）**：给该 manual 边界填 planned——不自动切，只做逾期检测（到点未归零 → 批次告警 + 滞留清单）。③ **归零自动切（可选开关）**`auto_advance_on_review_completion`：骑在巡检上（§14），归零即 advance——硬编码的领域条件，与 publishPreliminary 同一性质，**不是**通用条件引擎。推荐默认：手动 + SLA——"结账"是值得人类按下的按钮，它同时是对"可以进入公示准备"的确认。
- **phase_events**（append-only）：计划修改与实际切换全部落审计事件（kind, phase_id, planned_at / actual_at, processed_at, actor, reason）。
- **调度器**：core layer 内 fork 一根 Effect fiber，每分钟幂等扫描 ① 队头 scheduled 边界 ② due 的 SCHEDULED publication；另挂五分钟档的监护巡检（§14）。单实例假设（与迁移器同款表述），动作幂等可重入。**不引入 Redis/BullMQ/分布式锁**。
- **PhaseTemplate**：租户级预设（阶段名/顺序/权限 Profile/**时间形态：硬计划锚点或偏移时长**/trigger）。应用 = **复制**并记 source_template_id/version（仅审计溯源），绝不运行时继承；改模板不影响既有批次。
- 手动切换 `advancePhase(to, reason?)` 走 `assessment.batch.manage`；跳过 guard 的强制切换要求 `assessment.batch.force-advance` + 必填理由。插入阶段只能插在当前阶段之后（ordinal 事务内重排，外部无引用），**允许插到序列末尾**（裁决 §32.37）；权限 profile 可直接套用模板段。

**默认阶段序列**（含公示创建期）：

```text
预填报        scheduled  硬计划
正式填报      scheduled  硬计划
审核整理      scheduled  硬计划（承诺型截止：提交关闭，审核继续清尾）
公示创建      manual    "结束审核"（里程碑型；guard=待审归零，可挂 SLA / 自动切）
申诉          由 SCHEDULED Publication 发布驱动进入；显示时间直接取 publication.publish_at
              （单一事实源，不复制进 planned，杜绝两处不同步）
申诉处理      scheduled  发布时刻按模板偏移物化（承诺型截止：申诉关闭，存量继续裁决）
结果确认      由 publishFinal 驱动进入（里程碑型）
归档          manual    terminal（里程碑型）
```

**没有"公示期"**（公示不是阶段），但有**公示创建期**：它给学生"审核已完成、公示准备中"的明确信号；`publishPreliminary` 的 guard 检查当前处于此阶段——先结账、再 preflight、再预告，向导式一条流。时间线渲染的取值优先级一次定死：`actual（已发生）> 队头 scheduled 的 planned（确定）> 关联 publication 的 publish_at（已预告）> 预计（约）> 待定`——任何时刻的时间线都是诚实的：日历段确定，事件段随事件逐格点亮。

## 11. 三层授权

```text
authorize(principal, code, resource) =
  RBAC.can(principal, code, resource.scope)            # 身份与组织授权（既有 rbac，不动）
  ∧ PhaseGate.allows(currentPhase, code)               # 时间开放上限（只减不加）
  ∧ ResourcePolicy.allows(resource.state, action)      # 对象状态机 guard
```

**PhaseGate**：**rbac 原封不动，零改动**（裁决 §32.13）。曾考虑给权限目录加 `phaseControlled?: boolean` 元数据，被分层反对否决——`phaseControlled` 是 PhaseGate 的词汇，PhaseGate 住在 assessment；`PermissionDefinition` 的契约注释本就写明"刻意不放别人的关切"（哪个通道可携带、谁默认持有都被刻意排除），往里加上层旗标恰好违反这个契约自己文档化的原则。而且事实基础是：**所有被门控的权限全部是 `assessment.*` 自己的码**——"哪些码受门控"这份注册表是门的属性，不是权限定义的属性。

实现落在 assessment 自己的 `src/permissions.ts` 叶子（照 org 先例）：权限声明 `Access.permissions` 照常上车（纯 rbac 契约形状），旁边同文件导出 `PHASE_GATED: Set<string>` 白名单——成员 = 下表 ✓ 列，一字不多。启动断言集合 ⊆ 本插件声明的码（防手滑）。判定：`PHASE_GATED.has(code) ? code ∈ currentPhase.permission_profile : true`，**fail closed** 语义不变——新增受控权限在旧 Profile 缺席即拒绝。阶段编辑器的数据源就是这个集合（code + name 同文件可取）。

由此获得一个**结构性安全升级**：原方案里任何插件理论上都能给任意权限打旗（需要额外校验拦"给 auth.login 打旗"），现在 `auth.login / org.* / iam.*` 在结构上就不可能出现在阶段编辑器——它们不在 assessment 的集合里，不需要任何校验去拦。PhaseGate 只限制、绝不授予：阶段开放 review.process 不会让无审核 RBAC 的学生获得审核权。未来某驱动插件要新增受门控权限时，给 `ItemTypeDriver` 加 `gatedPermissions?: readonly string[]`，prepare 相与题型目录一起并入集合——与驱动注册题型同一条机制，现在不建。

**ResourcePolicy** 即条目/申诉状态机的动作 guard：正式填报期 + RBAC 允许 entry.edit，但条目 IN_REVIEW → 仍拒绝。

**scoped 补充期**（裁决 §32.11 的配套）：PhaseGate 签名为 `allows(phase, code, ctx?)`——item-scope 仅约束**创建族**（create/edit/submit/withdraw/proxy/record）：检查 `ctx.itemId ∈ phase_item_scopes`；**resubmit 天然不受 item scope 限制**（它锚定公示行，本就跨题——第三轮审计裁决）；participant-scope 对 entry 动作族全体生效（`ctx.participantId ∈ phase_participant_scopes`）；两 scope 空集 = 不限。`review.process` 与 `review.reopen` **永不受 scope 限制**——新交上来的东西总得有人审。item-scope 服务"改题/新增题后开补充提交期，只对被改的题操作"；participant-scope 服务"审核期后才被纳入的转入生，单独开补充期，全班不受影响"。UI：scoped 阶段下填报中心只点亮范围内的题，其余锁定注明"本阶段仅开放：…"；范围外学生时间线显示"补充提交（仅限指定题目/人员）"。

**authorize 返回结构化拒因，不是布尔**：三层再叠 scope 之后拒因已有六七种，"已过提交截止 / 本阶段仅开放部分题目 / 条目审核中不可编辑 / 该题已作废"是完全不同的用户体验——拒因枚举一次定义，全端复用。

**权限目录**（`./permissions` 纯常量，`Access.permissions` 上车）：

| code                                               | phaseControlled | 说明                                                                    |
| -------------------------------------------------- | --------------- | ----------------------------------------------------------------------- |
| assessment.batch.manage                            | ×               | 批次/阶段/题目/花名册管理（org-scope）                                  |
| assessment.batch.force-advance                     | ×               | 强制切换阶段（必填理由）                                                |
| assessment.publication.manage                      | ×               | 公示全生命周期（含 retract，理由必填）                                  |
| assessment.result.view-self                        | ×               | 看自己成绩——**任何阶段可进入成绩页**，页面内容随状态变化（预览→S1→S2）  |
| assessment.entry.create / edit / submit / withdraw | ✓               | 学生填报动作（只对自己的条目）                                          |
| assessment.entry.proxy                             | ✓               | **代录**：替学生提交其本可自提的材料（subject=学生，走正常审核链，§13） |
| assessment.entry.record                            | ✓               | **行政认定**：扣分与特殊加分，trusted 直接生效不走审核（§13）           |
| assessment.entry.resubmit                          | ✓               | 对**终态条目**发起新一轮（申诉窗内即申诉轮，§15）                       |
| assessment.review.process                          | ✓               | 审核链动作（approve/reject/escalate/投票）                              |
| assessment.review.reopen                           | ✓               | 工作组主动复查：对已定结果开 staff 轮，直达链条终点（§15）              |
| assessment.result.view-peers                       | ✓               | 看他人公示（≠ 看排名）                                                  |
| assessment.ranking.view                            | ✓               | 看排名                                                                  |

`assessment.review.reassign` **v1 删除**（拉模型下语义悬空；空缺的正道是补授角色 + 巡检自愈）；
reviewer override 设计留档，触发条件："出现不能正式授予角色、但需要此人审这一个实例的真实场景"，
届时按 review_stage_override(instance, stage, explicit_user_ids, reason) 建，名字用 override。
appeal.create / appeal.process **随统一轮模型取消**（§15）——申诉窗是 phase 开关组合，不是独立权限族。

**权限码用连字符分段**（`force-advance`、`view-self`），与仓库既有 `iam.tenant-role.bind` 一致；
段内下划线是本设计稿的写法，落库时统一（裁决 §32.3）。表中 phaseControlled 列的 ✓ 即
**PHASE_GATED 集合成员**——它是 assessment 自有的白名单，不是 rbac 字段（裁决 §32.13）。

**默认阶段权限矩阵**（全是 permission_profile 配置，零特判代码）：

| Phase    | create/edit | submit    | proxy | record | review | resubmit | reopen | view-peers | ranking |
| -------- | ----------- | --------- | ----- | ------ | ------ | -------- | ------ | ---------- | ------- |
| 预填报   | ✓           | ×         | ×     | ✓      | ×      | ×        | ×      | ×          | ×       |
| 正式填报 | ✓           | ✓         | ✓     | ✓      | ✓      | ×        | ×      | ×          | ×       |
| 审核整理 | ×           | ×         | ×     | ✓      | ✓      | ×        | ✓      | ×          | ×       |
| 公示创建 | ×           | ×         | ×     | ×      | ×      | ×        | ×      | ×          | ×       |
| 申诉     | ✓(scoped)   | ✓(scoped) | ×     | ✓      | ✓      | ✓        | ✓      | 按配置     | ×       |
| 申诉处理 | ×           | ×         | ×     | ✓      | 按需   | ✓†       | ✓      | 按配置     | ×       |
| 结果确认 | ×           | ×         | ×     | ×      | ×      | ×        | ×      | 按配置     | ✓       |
| 归档     | ×           | ×         | ×     | ×      | ×      | ×        | ×      | ×          | ×       |

† 申诉处理期的 resubmit **仅限 S1 后新立的不利终局**（ResourcePolicy 谓词放行，§15 裁决 §32.31）；
普通终态条目的申诉在申诉期截止。**proxy = 原子"创建+提交"**，自身即窗口（预填报 ×——预填报连
submit 都关，代录没有落点）；
**申诉行的 ✓(scoped)** = create/submit 开放但 item_scope 锁定为内建"成绩异议"题（§15），
普通题不受影响；resubmit 全域（锚公示行，跨题）。

行政认定（record）在审核整理与申诉阶段仍开放：违规名单与处分决定往往在填报截止乃至 S1 之后
才由职能部门送到（S1 后新录条目进 S2 前经 preflight 显式确认，§17）。**公示创建期全 ×**
（第二轮审计 §十）：进入它意味着审核账已结清；发现问题应显式插入新的审核整理阶段，
而不是一边"公示创建中"一边继续改。申诉期的"申诉窗"= 开放 resubmit（仅限终态条目）+
审核链继续 + 关闭非链尾驳回，就是这三个开关的组合（§15）。

## 12. 题型：驱动 + 实例

core 拥有 ExtensionPoint `assessment.item-type`（prepare 相编目录，一比一镜像 auth 的 `Login.driver`：协议族=驱动插件、实例=数据行、同 id 双注册硬失败）。**禁止** plugin-blood-donation / plugin-veteran 这类"一条政策一个插件"。

驱动概念接口（TS 伪代码，**实际 Effect/Schema API 以仓库同版本 `repos/` 源码为准，禁止照抄**）：

```ts
interface AssessmentItemTypeDriver {
  id: string // 'evidence' | 'appraisal.teacher' | 'grades.derived' …
  configSchema: Schema // 实例配置校验
  buildEntrySchema(config, batchCtx): Schema // 由配置生成条目 payload 校验（date 自动 ∈ materialRange）
  buildSourceKey?(config, payload): SourceClaim | null
  interaction: 'entry' | 'task' | 'derived' // 学生填报 / 任务型(教师评价) / 派生型(成绩库,无条目)
  scoring: { calculator: CalculatorRef; aggregator: AggregatorRef }
  client?: { entryForm?: ClientComponentRef; entryView?: ClientComponentRef } // 缺省用 evidence 通用渲染
}
```

**AssessmentItem（实例）**：`batch_id, item_type, title, current_revision_id, score_group_id, max_entries, sort_order, status(active|voided)`。**题目配置有真正的版本实体**（第二轮审计 P0）：`assessment_item_revisions`（不可变）——`item_id, revision_no, form_config, scoring_config, review_policy, display_config, created_by/at, reason?`。每次配置保存 = 追加一个 ItemRevision；**EntryRevision 记 `item_revision_id`**，payload **永远按自身引用的 ItemRevision 的 form_config 解码**——渲染、导出、打印、审核详情一律如此（裁决 §32.33）；**ScoreRun 的 input_manifest 精确引用各题所用的 scoring ItemRevision**。**保存新配置的验证不变量**：用新 scoring 映射**实测 {in_review, approved} 状态条目的 current revision**——消费不了则拒绝保存并引导"作废 + 替换"；draft 与 rejected 不进验证集（它们经新表单重入：编辑器对 draft 一律加载最新 schema，兼容字段迁移、失效字段标记，下次保存的 revision 记新 item_revision_id）。不建通用 schema 兼容引擎，实测现存 payload 即可。批次级配置事件日志与它不重复：事件是"谁何时为何改了什么"，ItemRevision 是"可被引用的数据版本"。**ScoreGroup**：`batch_id, parent_group_id?, name, cap?, floor?, sort_order`，树形嵌套。**floor 默认 null（不托底）**，只在真正需要的组显式设置——默认树的品德/学业/文体三个大项显式 floor=0（seed 写死）；若所有中间组都默认 0，纯扣分子组的负值在到达大项前就被吃掉，扣分凭空蒸发（第三轮审计 §7，改判早先"默认 0"）。默认树 = 品德(15) / 学业(75) / 文体(10)，文体下 基础(3)/干部(3)/活动(4)；教官与国旗班两题挂 cap=3 子组（ADR-5 示范）。

**题目生命周期**（裁决 §32.8）：批次 draft 期**只删不作废**（零仪式——没人见过它）；激活后**只作废不删**，作废必填理由（记操作人/时间）。作废语义：填报中心灰卡"本题已作废"（**零条目的作废题直接隐藏**——没人交互过的题灰卡是纯噪音），ResourcePolicy 拒绝新建；在途 ReviewInstance 以终态事件 `cancelled_item_voided` 结束（state 离开 active，拉模型下收件箱自然清空——零遍历零通知），**其条目落 `voided`（reason=item_voided）**——与 admin void 共用终态、区分 reason；已终态条目保留原状态 + 横幅"该题目已作废"；计分跳过 voided 题但 breakdown 保留一行"本题已作废，不计分"（学生 S1 拿过这题的分、S2 没了，必须看得懂为什么）。**作废事务内释放 source_claims**（该题条目占用的行删除，事件表留审计）——否则"配错作废重建"的新题会被旧占用把学生重报全部拦死；恢复作废反向重占，冲突即恢复失败并提示先处理新题的占用；恢复不复活已终结的审核实例，学生在阶段允许时重新提交。管理端决策指引：**能改则改，改不了才作废重建**——只是分值/参数错 → 原地编辑（config_revision 递增让旧 run 自动过期，零折腾）；字段结构错、题本身立错 → 作废 + "作废并替换"便捷动作（克隆配置为新题、同组、新 id），**不做条目迁移**——payload schema 都变了，迁移只会制造脏数据，学生在补充期重交。

**多条目是统一形态**：一切题型天然多条目，`max_entries=1` 只是配置。允许超出组上限继续填报（撤销缓冲 + "不确定哪张证书能过全交上去"）；封顶只作用于计分层，UI 明示"已通过 5.5 → 按上限 4 计入"。

**evidence 驱动字段 DSL（v1 只做真实需要的，不做低代码表单平台）**：`text(pattern?)、number(min/max)、date(∈materialRange, 可再缩窄)、enum、enum_with_other、event_pick、attachment(required/maxCount/accept)、boolean`。其中 `event_pick` 专治献血类：管理员维护 `[{date, location, label}]` 整体选项（"2026-03-31 · XX爱心献血屋"），用户整体单选，杜绝"3.31 + B献血车"这种隐式非法组合；可配 allowOther。

**首发三实例**（seed/fixtures）：① 退役复学（hello world）：attachment ×1，fixed(3)，max_entries=1，M2 用单 stage 链、M3 换四段默认链；② 献血（M3 验收件）：event_pick + 编码 text(pattern) + attachment，fixed(1)，uniqueness=tenant，多条不限；③ 教官 / 国旗班（M4 验收件）：两个独立题各 fixed(2)，同 cap=3 组。

## 13. Entry · Revision · SourceClaim

**entries（轻量业务身份）**：`batch_id, item_id, participant_id, current_revision_id, current_review_instance_id?(指向最新轮), status(draft|in_review|approved|rejected|voided), source(self|proxy|record|import|system), created/updated`。工作流投影**不塞回 entries**，归 ReviewInstance（§14）。状态机（裁决 §32.14/§32.16）：

```text
draft ──submit──▶ in_review ──approve@normalTerminal──▶ approved
  ▲                   │ └─escalate─▶ (escalated mode, 下一 stage)
  └──withdraw─────────┘ └─reject──▶ rejected ──编辑新 revision──▶ draft ──submit──▶ 新一轮
任意 ──admin void(必填理由)──▶ voided        blocked 由 ReviewInstance 承载（可恢复）
record/import 来源 ──创建即──▶ approved（trusted，不建审核实例）
```

- **withdraw = 取消当前审核实例**（事件 `CANCELLED_BY_SUBMITTER`）→ entry 回 draft；**没有独立的 withdrawn 状态**。下次 submit 开全新一轮实例，绝不复用——每次正式提审都有独立审核历史。
- **从未提交过的空草稿允许硬删**：无业务历史，没必要永存。
- source 语义：`self` 学生自填；`proxy` **代录**（他人替学生提交其本可自提的材料，subject=学生、actor=录入人，走正常审核链）；`record` **行政认定**（手工）；`import` 行政认定（批量，v1 无入口）；`system` 派生。**source 与 actor 全部服务端推导，客户端永远不提交 source**（安全不变量，裁决 §32.34）——由路由、持有权限与题目 entrySource 共同决定。

**entry_revisions（不可变）**：`entry_id, revision_no(唯一对), payload(jsonb), actor_id, subject_id, source, note?, created_at`。学生自改、代录提交、驳回重提、行政录入——**一律追加，禁止 UPDATE 内容**。审核决定、公示行、复审轮全部锚定具体 `revision_id`，杜绝"公示按旧材料算、点开看到新材料"。附件走**关系表** `entry_revision_attachments(revision_id, attachment_id, position)`——不用 `uuid[]`（要真实 FK 与顺序）。

**谁能创建条目，由题目说了算；该不该审，由这条事实的性质说了算——不是何时录**（裁决 §32.16，取代早先"按时间分流"的表述）。题目配置 `entrySource`：

- `student`：学生本人创建、编辑、提交、撤回自己的条目。**修改永远只有本人**——审核人发现填错走"驳回 + 修改建议"（下段）。**代录（source='proxy'）是一个原子动作 = 创建代理 Revision 并立即提交**（裁决 §32.20）：持 `assessment.entry.proxy` 的人（受 org-scope 管辖）替学生提交其本可自己提交的东西（漏报的教官证书），subject=学生、actor=录入人，学生端明示，**照常走完整审核链**。不存在"代理草稿"中间态——"班长提前造的 draft 归谁"在结构上不存在；原子动作完成后条目与学生自提完全同构（撤回/修订/重提都是学生自己的事，proxy actor 无任何后续特权）。proxy 自身作为受控码就是它的窗口（矩阵：预填报 ×、正式填报 ✓）；模板校验 lint："proxy ✓ 而 submit × 的 profile 语义存疑"。
- `administrative`：**只有持 `assessment.entry.record` 的人**能创建（source='record'，批量预留 'import'），学生完全无入口。承载组织以自身权威断言的事实：处分决定、职能部门定级名单、正式扣分、立功通报、低频特殊加分（三等功、合理化建议采纳、见义勇为定级）。**trusted：不建 ReviewInstance，创建即 confirmed fact**——让下级审核链去审上级的正式认定是层级倒置，录入方即裁定方。约束四条：`entry.record` 权限（org-scope、管理层级）；**依据必填**（文号/名单引用，可附文件），学生端显示"来源：学院录入 · 依据 XX 号文件"；SCHEDULED 冻结期照禁；救济 = 学生申诉轮或 staff 复查轮（终点=辅导员，恰合政策"更正需辅导员复核批准"）。由此"提审关闭后待审数单调递减"**无条件成立**：record 任何时段都不产生审核实例，proxy 与 submit 同受门控、收尾期本就关闭。

**驳回附修改建议**：审核人驳回时可以在学生已填的内容上直接改出一份**建议稿**（模态框内编辑，也可在学生上传的图片上圈画），连同必填的文字审核意见一起下发。建议**只是给学生看的参考**：学生端只读展示，**不提供一键套用、不提供复制**（裁决 §32.2——一键套用会让"谁填的"这个事实变得可疑，是合规风险）。学生自己改完重新提交，产生新 revision；建议文本随驳回决定事件留痕，**圈画图等附件挂 `review_event_attachments`**（§15——此前它没有 FK 落点）。

**绝不实现"以张三身份操作"**，也绝不替学生**修改**已填内容：`source='proxy'` 是 student 题目上的**原子代录**（见上），`record/import` 才是 administrative 路径；actor 与 subject 永远分别记录。

**source_claims（防重复）**：`tenant_id, namespace, scope_key, normalized_key, entry_id`，唯一 `(tenant_id, namespace, scope_key, normalized_key)`。namespace 如 `evidence:blood-donation`；scope_key 表达唯一域（题型配置 `none|batch|tenant`：batch 域填 batch uuid，tenant 域填常量 'tenant'）；normalized_key = trim+upper+去分隔符，**claim 行记 `normalizer: id@version`**——tenant 终身唯一域跨年生效，改变等价语义 = 显式迁移重算全 namespace 的 normalized_key（带冲突报告），禁止静默换算法绕过终身唯一（第三轮审计 P1）。提交时软提示（"该编号已有另一条待审申报"）；**审核通过的事务内占用**，冲突则通过失败。kernel 不硬编码"献血编码全国唯一"之类业务假设。

**claim 生命周期不变量**（第二轮审计 §十三）：entry approved → 占用；已通过的 entry 其后被 void/撤销（复查轮 reject）→ 释放；item 作废 → 释放其名下有效 claim；participant 被显式移出且其条目被管理员选择 void → 释放；**批次归档 → 不释放**——tenant 终身唯一域（献血）依赖它跨批次生效。claim 不是缓存，是"系统已正式认定使用过这个唯一事实"的 **durable ledger**。

## 14. Review 引擎：受限审核链，不是 BPMN

**一个 Item 只配置一条完整链 + normalTerminal**（普通流程天然是疑点链的前缀，不存在 normalFlow/doubtFlow 两张图）：

```jsonc
// item.review_policy
{
  "stages": [
    {
      "selector": {
        "kind": "roleAt",
        "nodeTypeId": "<uuid: class>",
        "roleIds": ["<uuid: 班长>", "<uuid: 学委>"],
      },
      "quorum": { "type": "any" },
    },
    {
      "selector": { "kind": "roleAt", "nodeTypeId": "<uuid: major>", "roleIds": ["<uuid>"] },
      "quorum": { "type": "any" },
    },
    {
      "selector": { "kind": "roleAt", "nodeTypeId": "<uuid: grade>", "roleIds": ["<uuid>"] },
      "quorum": { "type": "any" },
    },
    {
      "selector": { "kind": "nearestRole", "roleId": "<uuid: 辅导员>" }, // 仅真正有继承语义的角色
      "quorum": { "type": "any" },
    },
  ],
  "normalTerminal": 0, // 献血：班长批准即完成；科研类可设 2（到年级负责人）
}
```

- **RoleAt**：从冻结 anchor_lineage 向上找**最近的指定 nodeTypeId 节点**，只在该节点解析 roleIds 持有者（**锚点精确匹配**，裁决 §32.23——学院节点上误授的"班长"不会被找到，subtree coverage 不参与成员资格）。**NearestRole** 沿链找最近持有者，仅用于辅导员类角色。Quorum 三型 `any | all | atLeast(n)` 覆盖或签/会签/N-of-M；**禁止**任意 DAG / 条件表达式 / ScriptTask。
- **ReviewInstance（独立投影实体，不塞回 entries；同时是"轮"的载体，§15）**：`entry_id, revision_id(受审版本), round_no(同 entry 内递增), origin('initial'|'appeal'|'reopen'), initiator('participant'|'staff'), publication_id?(appeal 轮通常非空;S1 后新立事实的复议轮可空,§15), anchor_line_id?, reason?, re_entry_stage_index?, effective_chain(jsonb 快照: 各 stage 的 selector+解析节点+quorum+被跳过stage及原因+normalTerminal 映射), mode(normal|escalated), current_stage_index, state(active|blocked|completed), outcome?, current_role_ids(uuid[]), current_node_id(uuid), current_node_path(ltree)`。角色与节点一律 **uuid** 引用（裁决 §32.3 贯彻到实例列，路径列仅服务子树查询）。有效链在提交时按 ADR-4 计算并快照（含解释链路，写入首个事件）；普通节点**不保存具体 reviewer id**。**每次正式提审 = 一行新实例**，绝不复用旧实例。
- **收件箱 = 拉模型，成员资格 = 锚点精确匹配**（裁决 §32.23）：按 `(state='active', current_node_id, current_role_ids)` 与我的 RBAC 授予做**等值 join**——stage 成员 = 在该 (roleId, nodeId) 上**锚点恰为该节点**的授予；subtree coverage 只服务权限检查（canAt/管辖），**不参与 stage 成员资格**，否则学院上 subtree 授予的"班长"会从收件箱后门绕过"RoleAt 找不到误授"的承诺——两条路径必须一个口径。path 列（GiST）退居其他查询。keyset 分页。换届即时生效；`reassign` **v1 删除**——拉模型下它语义悬空，空缺的正道是补授角色 + 巡检双向自愈（§32.19，override 设计留档带触发条件）。**不转投递模型**（裁决 §32.9）：投递不解决空缺（分配那一刻同样可能无人可派），却新增换届迁移、逐 assignee 自审回避、"任务昨天属于 B 今天属于 C"的审计怪相；拉查询是索引 join，一所学校几万活跃实例毫无压力；通知定向在发送时刻现场解析接收人即可，不需要落库。
- **到站检查**（ADR 0007 强化）：条目**每次进入一个 stage**——提交、通过流转、上提——都当场解析该 stage 的审核人集合，为空立即 `state=blocked, reason=ASSIGNEE_NOT_FOUND` 并进管理告警。不只在提交时查。**自审冲突集 = {subject_id, 受审 revision.actor_id}**（第三轮审计 P1）——班长代录后不得自己审核自己录入的材料；quorum panel 剔除同规则。
- **监护巡检是唯一被信任的正确性机制，不做写路径钩子**（裁决 §32.9）：改变解析结果的来源太多（授予/撤销角色、组织树重构、锚点变更、review_policy 编辑、用户类型变化），钩子挂不全就是隐性卡死，挂全了等于把巡检碎片化撒进十个写路径；且依赖方向不允许——rbac 不该知道 assessment 的存在。巡检挂在调度 fiber 的五分钟档：把 active 实例按 `(roleId, nodeId)` 去重（成员资格已是锚点精确匹配，一个批次最多几十上百组），逐组重解析（quorum stage 按 §32.28 的可达性公式，不是简单"有没有人"）——原本有人现在空 → blocked + 告警；原本 blocked 现在有人 → **自动转回 active** + 事件。**双向自愈**：补任命一个班长，卡住的条目自己活过来，零迁移。幂等可重入；与人工操作的并发用条件更新守卫（`UPDATE … WHERE state='blocked'`），三方竞态无害。
- **告警是派生视图，不是实体**：告警面板 = `state='blocked'` 实例按 (batch, role, node, reason) 分组的投影，实例恢复即消失，不存在"删除告警"这个动作。即时性走读路径的显式动作：面板每张卡带"立即复查"按钮（对该组的 scoped 巡检）——管理员补完任命点一下秒级恢复，不点五分钟内也自愈。
- **滞留水位**（同一次巡检顺手做）：实例同 stage 停留超 N 天 → 不 block，进 batch-admin 审核异常面板（"软件2401 班长处 12 条滞留 5 天"）——运营上更常见的卡死不是没人，是有人不干活。preflight 的 BLOCKED 计数继续作公示前兜底。学生侧对这一切保持中性文案"等待审核中"——组织配置问题是管理员的事。
- **计票节点：快照 panel ∩ 当前精确持有者**（裁决 §32.28——统一的实时拉取会让新任者看到旧 panel、被撤者名存实亡，快照分母失效）：进入时快照 panel（review_stage_panels），投票入 review_votes（append-only）；**可行动集合 = panel ∩ 当前仍在该 (roleId, nodeId) 精确锚点持有角色者**；新任 holder **绝不自动进入**旧 panel；已投票即使其后撤角色**永久有效**。可达性 = 已有有效票数 + panel 内仍具资格的未投票者（够不到 quorum → BLOCKED 告警）。收件箱 SQL 相应分叉：single/any 走等值匹配，quorum stage 额外 join panel 过滤成员。**不可达的恢复路径，零新机制**：① 原成员恢复任职 → 交集回涨 → 巡检双向自愈自动解 BLOCKED（巡检对 quorum stage 的重解析即按此可达性公式）；② 仍具资格的任一成员 escalate 短路上行；③ 都不行走管理员终态裁决（void）。**panel 重组（重新快照成员）不做**——旧票是否计入新分母的语义等真实发生再设计，触发条件记 §27。**任一成员 escalate 即短路当前 stage**（保留已产生的意见），不许"2 人已同意、第 3 人有疑问"卡死会签。
- **动作与文案解耦**：底层 outcome 枚举 `APPROVE | REJECT | ESCALATE | RECOMMEND_APPROVE | RECOMMEND_REJECT | COMMENT`。普通模式 stage：approve/reject/escalate；escalated 模式中间 stage：comment/recommend_*/escalate，**仅 terminal 可 approve/reject**。前端文案（通过/驳回/不确定，向上提审）走 i18n message。**驳回票数已冻结（裁决 §32.15）：quorum 只管 APPROVE，普通模式下任一有效审核人 REJECT 即整体驳回**——驳回是低成本可恢复动作（修订重提开新轮、S1 后还有申诉窗），通过才是授益动作（计分、占用 claim），不对称门槛正当；现行政策也没有任何条款真正要求投票驳回。补三条使其完备：① 驳回即刻终结该 stage，已投的 approve 票作为事件保留（不伪造未投者立场），其余人收件箱随实例离开 active 自然清空；② escalate 与 reject 竞态无需仲裁——先落库者生效，事务序即答案；③ escalated 模式下终点若配了 panel，approve 照 quorum、reject 仍一票，同一条规则无特例。rejectionQuorum 留档为升级路径，触发条件："某学院细则明文要求驳回须多数决"——届时连同弃权与双阈值死锁规则一起设计。
- **审核决定不带分值**（裁决 §32.4）。全链任何人（含终点）只有 approve / reject（+建议）/ escalate 三个动作，decision 事件里没有分数字段。需要人定值的条款（见义勇为 1–6、三等功额外加分、建议采纳 1–2）一律是 **administrative 题目**：值由录入者写进条目 payload，按配置的 `[min,max]` 在**创建时**校验，越界当场拒绝。于是"审核只裁真伪、定价永远来自配置或录入事实"成为不变量，收件箱里也不再有数值输入框。
- **事件 + 投影，不做 Event Sourcing**：一个事务内 `validate guard → append review_events/votes → update ReviewInstance 投影`。事件服务审计/时间线/申诉回放；投影服务查询/索引/收件箱。**禁止** replay 重建当前态的架构（不承担 projection rebuild / event schema migration 成本）。

## 15. 申诉与复查：审核的后续"轮"，不是第二套系统

**概念仍分，存储统一**（裁决 §32.14，ADR 0005 修订段）。escalation 是审核员在一轮**内部**的
向上流转；申诉/复查是对**已定结果**发起的**新一轮**。独立的 AppealCase 被三个 phase 开关的
组合取代——申诉期 = 开放对终态条目的重新提审（resubmit，仅限被驳回与已通过的条目）+ 审核链
继续 + 关闭非链尾驳回。原分离设计的四条动机全部保留：锚定不可变对象（轮携带 publication 引用）、
词汇分离（按 origin 换文案）、仅终点可驳（phase 开关）、审计可分（按 initiator/origin 统计）。

- **表**：没有 appeal_cases / appeal_events / appeal_stage_panels / appeal_attachments，
  也没有 AppealPolicy 与 appeal.\* 权限点。轮就是一行新的 `review_instances`
  （round_no 递增，列见 §14），事件/panel/votes 复用同三张表；**轮的证据挂
  `review_event_attachments(review_event_id, attachment_id, position)`**（裁决 §32.21 配套）
  ——它同时是审核人驳回圈画图的落点（§13）。
- **同一 Entry 同时最多一个未终结轮**（DB 不变量）：部分唯一
  `UNIQUE(entry_id) WHERE state IN ('active','blocked')` + `UNIQUE(entry_id, round_no)`；
  开轮事务锁 entry 分配 round_no——学生连点两次 resubmit、两个管理员同时 reopen、
  participant 申诉与 staff 复查竞态，全部被数据库拒绝而不是靠事务顺序碰运气。
- **复审轮进行中，entry 保持上一轮已生效的终态**（裁决 §32.21，取代早先"分数悬置"说法）：
  approved + 轮 active 仍是 approved，实时预览照原事实计算——轮是对既有终态的
  reconsideration，不是撤销；status/decision/claim 只在轮终局事务里原子变更
  （更正→approved+占 claim / 维持→不动 / 撤销→rejected+释放 claim）。
  S2 preflight：**任何 active/blocked 复审轮 = blocker**。
- **修订权三分**（第三轮审计 §6）：`rejected` 的 student 条目——resubmit 原子产生本人新
  Revision 再开轮（改材料是他的权利，更正也需要新材料）；`approved` 条目与一切
  administrative 条目——复审轮**默认审原 Revision**，新增证据全走事件附件，
  `current_revision_id` 在轮中**绝不前移**（否则 scorer 面对"未批准的新版本"语义含糊）；
  行政事实本身要改 = record 权限人行政纠错（void 旧条 + 建新条），学生永不写行政 Revision。
- **锚定**（吸收 BreakdownLine provenance，§16）：学生从 S1 该行的 BreakdownLine 发起 →
  系统由 line 的 provenance 解析出 entry/revision/decision → 在该 entry 上开
  `origin='appeal'` 的轮，`publication_id + anchor_line_id` 落库。申诉指向不可变快照，
  绝不指向实时条目。
- **链**：有前轮快照的（student 条目）复用原链，越过 normalTerminal 继续爬
  （`re_entry_stage_index` 记入口）；**首轮无链的通则**（第三轮审计 §4）——record/import
  条目从未建过审核实例，第一次 appeal/reopen 开轮时，按该 EntryRevision 引用的
  `item_revision.review_policy` + participant 冻结 `anchor_lineage` **现场解析并快照进本轮**。
  推论：**administrative 题目必须配置 review_policy**（正常录入永不走它，它是救济链），
  配置校验强制。入口：participant 轮从 normalTerminal 之后第一个存活 stage 进入
  （normalTerminal 已是末位则直达 terminal），staff 轮直达 terminal。中间节点只能
  comment / recommend / escalate，仅终点可终局。
- **终局动作映射**：被驳回条目的申诉轮——终点 approve = **更正原决定**（entry 转 approved、
  占用 claim）、终点 reject = **维持原决定**；已通过条目的复查轮——终点 reject =
  **撤销原通过**（释放 claim）。前端文案按 origin 渲染"维持原决定 / 更正原决定 / 上提复核"。
- **origin 三值**（裁决 §32.32）：`initial`（首轮与驳回后修订重提的新轮）、`appeal`（participant
  异议，约束 initiator=participant）、`reopen`（staff 主动复查，约束 initiator=staff）——
  审核整理期的 reopen 不必再硬穿 appeal 词汇，前端文案按 origin 渲染。
- **发起权**：`assessment.entry.resubmit`（participant，受 phase 门控 + ResourcePolicy）；
  `assessment.review.reopen`（staff，工作组主动复查——政策"经过复查，确有错漏，经辅导员
  复核批准，予以更正或增补"本就不要求学生先申诉；staff 轮默认**直达链条终点**，恰好对应
  "辅导员复核批准"）。参与者集合冻结后的例外处置（申诉期内学生被开除等）也走 staff 复查轮，
  逐案审计。
- **S1 后新形成的不利终局，学生有一次复议权**（裁决 §32.31——本轮最隐蔽的救济缺口，含审计
  未扫到的孪生案）：两种事实在申诉窗关闭后才出生——S1 后新录的行政条目（处分迟到）、
  申诉处理期 staff 复查轮**撤销**了 S1 里的 approved（发现造假）。公示申诉窗约束的是
  **公示过的结果**，不能约束窗口关闭后才出生的事实。统一原则：**S1 冻结之后新形成的不利终局，
  在 final 输入冻结之前，赋予受影响 participant 一次锚定该事实的复议轮**（origin='appeal'，
  `publication_id/anchor_line_id = NULL`，锚定 revision_id + 触发事件 id；**每个触发事实限
  一轮**）。实现零新权限：resubmit 在申诉与申诉处理两阶段开放，ResourcePolicy 收窄——普通
  终态条目仅在申诉窗内且有 S1 锚时放行；S1 后新立不利终局（`source='record' ∧ created_at >
S1 冻结时刻`，或存在 S1 冻结后的撤销决定事件）额外放行。学生端入口 = 条目卡与成绩页行上的
  "对此认定提出异议"；文案区分承诺："对公示结果的申诉已截止；本条为公示后新增认定，可在最终
  公示前提出异议"。S2 preflight 的"任何 active 轮 = blocker"天然保证 final 前清账。
- **无条目的争议**（派生题分数、cap/floor 调整行、总分性异议——这些行没有 entry 可锚）：
  数据错误走事实域纠错（grades 修数 → 重算）；程序性异议走**内建"成绩异议"题**
  （第三轮审计 P1 的正式建模）：evidence 驱动实例、calculator `none@1`（贡献恒零）、
  terminal-only 救济链、payload 含 line 引用 + 理由 + 附件。它在申诉期可创建的机关：
  **phase_item_scopes 只约束创建族，申诉期默认模板 = create/submit ✓ 且
  item_scope = {成绩异议题}**；无 entry provenance 的行在 UI 上"对此行异议"直接路由到
  该题预填。
- **裁决进 S2**：轮的终局决定是替换/终版 ScoreRun 的输入；S1 永不修改，事后可完整解释
  "S1 82.3 → 献血复核 +1 → S2 83.3"。**管理员不补录学生 revision**（与 §32.1 一致，
  第二轮审计 §八）——更正只产生新的 decision；若产生了新的行政事实，建 administrative 条目。

## 16. Scoring：事实与规则分离

**数据库存事实，计分器存规则。** 不为"人人默认 8 分"预创建几千行记录——`calc(无评价事实) → 8` 是规则。`calcParticipant(participant, 规则配置@revision, 已确认事实, 外部事实版本) → Breakdown` 是**纯函数、全系统唯一实现**，服务实时预览、试算、正式 ScoreRun 三处；确定性、可回放。

- **数值精度（M4 冻结，裁决 §32.17）**："同输入同结果"在 JS float 上是空话（0.1+0.2≠0.3），权威计分路径**禁止 JS 浮点**。内部一律 **1e-4 定点整数**（0.8 存 8000；DB `numeric`，程序内整数/bigint）；舍入函数 **HALF_AWAY_FROM_ZERO**（正数即日常四舍五入；负数远离零：-0.125 → -0.13——扣分场景必须写明这半句），弃 HALF_EVEN 的理由：可解释性是立身之本（83.245 用手机计算器验算得 83.25，银行家舍入在校园语境是申诉制造机），且与旧 Excel 的 ROUND 连续；偏差对所有人同规则，不扭曲排名。**量化点在行级**：每个条目/调整行的最终贡献量化到百分位（2dp），之后组内求和、cap、floor、大项、总分全部是 2dp 精确算术，总分 = 各大项精确和，不再独立舍入——学生从任何层级手加明细，永远严丝合缝。属性测试不变量："breakdown 逐行相加恒等于各级小计与总分"。sandbox 的 custom 输出 1e-4 缩放整数或 decimal 字符串，宿主统一量化。**排名与 tie-break 一律用展示精度（2dp）的分数**——否则页面同分的两人排名不同没法解释，且全精度下"品德→学业→文体"tie-break 链形同虚设。
- **BreakdownLine 是正式证据链**（第二轮审计 P0）：`lineId(确定性), label(冻结的展示名), itemId, valueBeforeAdjustment, adjustment, valueAfterAdjustment, provenance{entryId?, entryRevisionId?, reviewDecisionEventId?, externalFactRef?, calculatorRef}`。**lineId 确定性生成，禁 uuidv7**（否则"同冻结输入逐字节一致"自毁）：`entry:{entryId}` / `item:{itemId}` / `grp:{groupId}:{cap|floor}` / `derived:{itemId}:{key}` / `custom:{itemId}:{idx}`。**label（题名/组路径名）随行冻结**——S1 展示永不回查 live 题名，管理员后来改题名不漂移历史。PublicationRow 把 provenance 一起冻结；调整行（cap 截断、floor 托底）同样有 lineId。**排除性锚定行**（裁决 §32.30——§4 的核心场景"对被驳回材料的行发起申诉"要求 rejected 条目在 S1 里**有行可锚**，而 scorer 只吃"已确认事实"会让它们凭空缺席）：快照冻结时处于 {rejected, voided} 且**曾正式提交过**的条目，每条生成一行 `value=0.00, kind='excluded-evidence'` 的 BreakdownLine，provenance = 受审 revision + 终局决定事件——这些行**完全不进入任何聚合器的输入**（sum/max/min/countTier 一律不吃，min 的扣分题不被 0 污染），行求和不变量以 +0.00 天然保持；实时预览同样渲染（学生公示前就能看到被驳回条目的位置与申诉入口）。两个边界：从未提交过的 draft 无行；`cancelled_item_voided` 的条目不生成行——题级"已作废不计分"行是锚，对作废本身的异议走成绩异议题或复查轮。申诉锚定 `(publication_id, participant_id, line_id)`，系统从冻结 line 反解当时的 revision 与 decision（§15）。
- **算法实现也要版本化**（第二轮审计 §二十一）：内置计算器/聚合器注册表按 **`id@version`** 键（`fixed@1`、`count-tier@1`……），破坏评分语义的修改铸 `@2`、保留 `@1`（纯函数体积小养得起）；ScoreRun 记 `scoringEngineVersion` 与装配指纹。对题型驱动只承诺**记录到可解释**，不承诺永久可执行旧驱动代码——历史纠错的正道是 retract + 重发，不是养代码博物馆。

- **内置计算器（M4）**：`fixed`（通过即 +3）、`lookup`（1–2 个枚举字段查配置矩阵：科研表）、`range`（值由 administrative 条目的 payload 携带，创建时按 [min,max] 校验；**不是审核人在审核时填**，见 §14）、`decrement`（名次递减：base − step×(名次−1)，集体减半；随竞赛实例落地）。计算器与聚合器经 core 的 registry ExtensionPoint **`assessment.calculator`** 解析（prepare 相编目录，core 自身贡献内置项）——为 M9 的 custom 计分器留出即插即用的缝，同时保证内置集合永久冻结在最小规模：一切校本逻辑走 custom，不往内核加计算器。
- **custom 计分器/聚合器（M9）**：管理员或 AI 生成的**纯函数**，由 `@qualy/plugin-sandbox` 提供的服务在 QuickJS-WASM 内执行（**交付主体是 sandbox 不是 formula**，增补 01 §8.1）。执行契约（缺一不可）：① 输入为单一 JSON（实例配置 + 该生该题的已确认 entries + 声明的外部事实快照 + run 冻结时间戳字段），输出为 JSON `{score, lines?: [{label, value}]}`（lines 并入 Breakdown，保住可解释性）；② 确定性——**`Date` 整体不可用**（不是只禁 `Date.now`：无参构造非确定，而"带参构造纯不纯"的甄别不值得做；材料日期以 epoch ms / ISO 字符串作为普通数据字段进 input）、无 `Math.random`、无网络/IO/异步/import，宿主零对象暴露；③ 中断句柄 + 内存上限 + 输出尺寸上限；④ TS 源码与编译后 JS 双存，**JS 工件的 sha256 进 ScoreRun input_manifest**——§16 不变量①对 custom 同样成立；⑤ **边界 = 单题内部**：不得跨题读数据、不得在函数内做组合封顶（ADR-5，组合永远归 ScoreGroup）；⑥ 失败语义：超时/越权/异常 → 整个 run FAILED 并定位到 (item, participant, input)，确定性保证可复现，**禁止静默给零分**。契约中 ②③ 的实施主体是 sandbox，①⑤⑥ 是 formula。
- **v1 聚合器**：`sum@1`、`max@1`、`min@1`、`countTier@1`（1 项 0.5 / 2 项 0.8 / 3 项 1）。**`min` 不是过度设计**（第三轮审计 §7 抓出的真 bug）："同一事项重复扣分只扣最高"在负数域是 `min(-1,-2)=-2`——用 `max` 恰好选出扣得最少的那条，§32.6 的映射据此改写。计算器另有 `none@1`（贡献恒零，内建"成绩异议"题用，§15）。
- **组树自底向上**：entry → item 聚合 → 子组 floor/cap → 父组 floor/cap → 总分（每级 `min(max(raw, floor), cap)`）。Breakdown 逐行保留截断与托底过程（"教官/国旗班组合封顶 −1.00"、"扣分后 −0.6 → 品德最低 0 分调整 +0.6 → 最终 0"）——学生必须能看懂"分是怎么来的"，这是砍申诉量最有效的投资。
- **计分不变量（修正版，属性测试必须按此实现）**——因存在负分事实（扣分条目），"撤销任一条目总分单调不增"这类全局单调不变量**不成立，禁止使用**。正确集合：① 相同冻结输入 → 逐字节相同 Breakdown；② 任何 group 终值 ≤ cap（cap 幂等）；③ 移除一条**正分**已确认事实，在无特殊规则时其对应原始贡献不得增加；④ 移除一条**负分**事实，其对应原始贡献不得进一步降低；⑤ countTier 若要求单调，先校验 tier 配置本身单调。不要写超出业务模型保证范围的 property test。
- **ScoreRun**（批次级；单个学生实时看分**直接现算**，几十行数据，不建缓存/MQ）：`purpose(trial|publication), status(pending|computing|ready|failed|superseded), input_manifest(+hash), started/completed`。启动时**事务内冻结输入清单**（participant 集、各 entry 的 revision_id 与终态 decision 集、items config_revision、外部事实版本），随后异步计算；期间后台数据变化不污染本 run。产物 `score_results(run_id, participant_id, breakdown, category_scores, total)`。

## 17. Publication：与 Phase 完全正交

Phase 回答"现在允许干什么"，Publication 回答"正式对外公布了哪个结果版本"。**没有公示期这种阶段**。Publication + PublicationRow 本身就是 immutable snapshot envelope，v1 不另建 ResultSnapshot 聚合。

**publications**：`batch_id, kind(preliminary|final), score_run_id, status(draft|ready|scheduled|published|**retracted**|cancelled|superseded), publish_at?(对学生承诺的生效时刻), published_at?(调度实际执行时刻), appeal_deadline?(仅 preliminary), visibility(jsonb), ranking_policy(jsonb), created_by`。RETRACTED 见 ADR 0009：S1 后发现评分语义配置错误的唯一出口——撤回（内容永久保留并标记）→ 修正 → 重算 → 重新发布可申诉的 preliminary。

- **谓词分裂**（裁决 §32.29，取代早先单一 effectivePublished——publishFinal 会把 S1 置 SUPERSEDED、retract 置 RETRACTED，单谓词下 S2 一发布 S1 反而"没发布过了"）：`wasReleased = status ∈ {PUBLISHED, SUPERSEDED, RETRACTED} ∨ (SCHEDULED ∧ now ≥ publish_at)`——历史可读性、归档打印、"S1 已撤回仍可查"挂它；`isEffective = 未被 supersede/retract 的 PUBLISHED（含 due-SCHEDULED 待物化）`——申诉锚定、评分语义冻结（"存在 isEffective 的 preliminary"）、惰性物化触发挂它。**RETRACTED / SUPERSEDED 永远可读、永远不可再锚新申诉**。状态转移补全：PUBLISHED → SUPERSEDED（publishFinal）、PUBLISHED → RETRACTED（retract）；cancel 与 retract 的分界 = publish_at（语义已发布的只能 retract）。**存在 isEffective 的 final 后禁止 retractPreliminary**——届时唯一出口是 §27 留档的 correctedFinal。调度 fiber 只负责**物化追认**；读路径（GET S1、发起申诉轮）发现 due-SCHEDULED 先幂等 `ensurePublicationMaterialized()` 再继续——调度器宕机，学生 09:03 打开页面立即 catch-up，业务生效时间仍是 09:00。SCHEDULED 公示即以其 publish_at 武装所绑阶段边界，队头武装模型（§10）免费吃下。**publication_rows 自包含物化**（READY 时从 ScoreRun 复制，此后不可改）：`participant_id, breakdown, category_scores, total, ranking_partition_key, rank?, source_score_run_id`——正式公示页不再实时调计分引擎。

**工作流（不许混成一个按钮；二段式 preflight——排名并列只有算完才知道，第三轮审计 §8）**：

```text
① Input Preflight 全绿（待审/BLOCKED/任务/配置/roster 完整性）
→ ② 事务内冻结 ScoreRun 输入 → ③ COMPUTING → ④ ScoreRun READY
→ ⑤ Output Validation（participant 覆盖率、breakdown 完整性、排名候选、unresolved ties、
     **新鲜度**：重算当前权威输入 hash 与 input_manifest.hash 比对，不一致 = "run 已过期"blocker）
→ ⑥ 管理员写 ranking_tie_resolutions（锚 score_run_id）→ Output 全绿
→ ⑦ 一次性物化 PublicationRows + rank → ⑧ Publication READY → 管理员预览
→ ⑨ schedulePreliminary：事务开头 **CAS 复验新鲜度**，通过才原子 READY → SCHEDULED
     （即"公示预告"）+ 冻结标记 + 武装所绑阶段边界 —— 不 advance phase
→ ⑩ 生效时刻（到点追认或读路径惰性物化）：SCHEDULED → PUBLISHED
     + 申诉期 actual_entry_at := publish_at、processed_at := now，同一事务
（立即发布 = 当场执行 ⑨⑩ 的后半段）
```

API 仍是一个 `/preflight`，前端两个 section；rows 物化必须在全部 tie 裁决之后一次完成——
READY 后 rows 不可改与"裁决并列"因此不再互相矛盾。

- **Input Preflight 项与出路**：待审/在途复审轮 n（审完 / 管理员裁决 void）、escalated 在途 n、BLOCKED n（补任命）、未完成 EvaluationTask n（M7：补录 / 转派 / 作废+理由）、题目/组树配置完整（引用驱动已装配、calculator 参数合法、**custom 计分器版本已发布且测试通过**、**administrative 题目配有救济 review_policy**）、roster 完整性问题（缺 anchor / 重复 / 未裁决的显式纳入）。**Output Validation 项**（ScoreRun READY 后）：participant 覆盖率、breakdown 完整性（逐行相加恒等）、排名候选与 unresolved ties 裁决（**仅当本 Publication 的 policy 要求物化 rank 才是 blocker**——S1 默认 rank:× 时不做并列裁决、rows.rank 落 NULL，裁决 §32.34）、**新鲜度**（裁决 §32.27：用与冻结时同一套 manifest 收集器重算当前权威输入 hash，与 `input_manifest.hash` 比对——冻结到 SCHEDULED 之间 record/reopen/裁决/void 都合法发生，run 算完那一刻可能已过期，出路只有重跑；不建增量计数器——计数器要求每条写路径记得 bump，与"记得查冻结"同类遗漏隐患，重算 hash 从数据派生。**SCHEDULED 之前的漂移 = 正常业务，禁止预告；之后的外部漂移才归 §32.18 照发 + CRITICAL**。既有"config_revision 落后 → 试算过期"泛化为全 manifest 判定，试算过期徽标同源）；**final 公示另加**："S1 后新增行政条目 n 条"作为**显式确认项**（非 blocker——公示后才下达的处分未经申诉窗直接进 S2，学生异议走复查轮，不受申诉窗限制）。**实时组织树 diff 不在其中**（§9）。blocker>0 不能生成可发布快照；管理员不是点"忽略错误继续"，而是把每个业务对象推进到明确终态。正式公示中**不允许出现"张三 83.2（复核中）"**。
- **SCHEDULED 即冻结**（集合精确化，裁决 §32.12）：批次打 `input_frozen_by_publication_id` 标记；**拒绝**——审核决定、提交送审、对非草稿条目追加 revision、题目配置修改（含作废）、roster 变更、申诉裁决；**放行纯草稿编辑**（从未提交过的 draft 不构成任何可见分歧，冻结它只是折磨学生）。错误码 `PUBLICATION_SCHEDULED_FROZEN`，提示"存在已预告公示，请先取消预告"。取消预告需 `publication.manage` + 理由，时间线回落"待定"；取消 = SCHEDULED→CANCELLED→修正→重算→重新准备。**发布时刻断言分裂**（裁决 §32.18，取代早先"不一致即中止"）：_外部漂移_（live 数据与 manifest 不符 = 冻结守卫被绕过）→ **照发 + CRITICAL 告警** + 事后调查、必要时 retract——冻结的 rows 就是管理员预览确认并预告出去的官方结果，到点不发才是被消灭过的失败模式；_快照内部损坏_（rows 与自身 manifest 对不上，如行数缺员）→ **中止 + 告警**——那不是守约，是发布残次品，且应在 READY 期就查死。**已向学生承诺 9:00 公布，就不允许 9:00 因后台复检失败而不公布**——复检发生在 SCHEDULED 之前，发布本身是纯机械动作。
- **发布编排（领域代码显式写死，两段式——裁决 §32.22，取代早先单事务版）**：guard 检查当前处于**公示创建期**（§10：先结账、再 preflight、再预告）。**schedule 段**：READY→SCHEDULED + 武装所绑 publication 边界 + 表单落 appeal_deadline（预填 publish_at+偏移，写入申诉处理期 planned；"+3 个工作日"辅助计算器纯前端，落库普通 timestamptz，**v1 不建 BusinessCalendar**）——**不 advance phase**（管理员 8.31 预告 9.10 的公示，8.31 绝不能就进申诉期）。**effective 段**（调度追认或读路径惰性物化）：SCHEDULED→PUBLISHED + 申诉期 `actual_entry_at := publish_at`、`processed_at := now`，同一事务——publish_at 与 actual_entry_at 是同一事实的两面，谁也不是谁的副本。立即发布 = 当场执行 effective 段。`publishFinal()` 同构（+ supersede S1 状态，内容永远可查）。**retract 编排**（ADR 0009 补全）：retract → 当前申诉期落边界 → 进入/保持"申诉处理"性质阶段（resubmit ×、review/reopen ✓）→ 清完在途轮 → 需学生补交则插 scoped 补充期 → **向后插入**新的公示创建期 → 新 S1（旧轮未清则新 S1 的 preflight 天然拦截）。绝不回退原 ordinal。不建设"任意事件 → 任意阶段"通用规则引擎。
- **排名只存在于正式 Publication**：ranking_policy = `{partitionNodeType?(年级/学院…，分区键**从冻结的 anchor_lineage 按 nodeTypeId 找祖先，禁查 live org**——否则类型漂移防线白建；缺省=整批次), tieBreak: 总分→品德→学业→文体, 纳入范围}`；仍并列 → 标记 unresolved tie 交学院裁决——裁决是**实体**不是裸 UPDATE：`ranking_tie_resolutions(score_run_id, partition_key, tied_participant_ids, resolved_order, reason, actor_id, created_at)`（锚 score_run，publication 派生），rank 由它导出，可审计；**禁止用 user_id/created_at 静默破除并列**。批次范围 ≠ 排名范围。填报期无任何实时排名。
- **可见性三权分立**：view_self（恒可）、view_peers（租户配置）、ranking.view。默认：S1 `{own:✓, peers:按配置, rank:×}`；S2 `{own:✓, peers:按配置, rank:✓}`。

## 18. 归档

Batch 终态。Gate：final Publication 已 PUBLISHED + **全部复审轮（reconsideration rounds）终态** + 无业务 blocker。之后禁止业务写入；学生仍可查看自己终版结果、允许的排名、**打印材料**——打印引用 final publication_rows 与对应 EntryRevision，不重算当前库。几年后重进批次，两次公示、当年材料版本、审核与复审过程完整可还原。final 发布后、归档前发现错误的纠错出口（correctedFinal supersedes）留触发条件于 §27。

## 19. Storage 插件

`@qualy/plugin-storage`（infra）。窄接口四个：`put / open(经 authorizer hook) / metadata / retire`。`attachments`：`tenant_id, owner_user_id, filename, mime, size, sha256, storage_key, status(**staged|bound|retired**), bound_at?`——上传即 staged，被 EntryRevision 引用时转 bound；孤儿清理（staged 且超过 N 天）留为后续廉价任务，字段现在就留（第二轮审计 §十八）。v1 仅本地文件系统 provider。**附件不可变**：改材料 = 传新附件 + 新 EntryRevision；附件只支持 retire 逻辑退役。**retire 的历史引用语义**（裁决 §32.34）：`retired = 禁止新增引用 + 普通入口隐藏`；已被不可变 Revision/Event/Publication 引用的**授权读取永久有效**，物理删除不属于 v1——否则 Archive 的"多年可回放"会被 storage 自己打破。授权：core 注册 authorizer——**bound 附件可读者 = entry 的 subject（学生看得到行政依据与代录材料）∪ 具审核/复查资格者 ∪ batch admin ∪ 归档打印读者；staged 附件仅上传者**（第三轮审计 P1——proxy 上传的 owner 是班长、record 依据的 owner 是辅导员，仅按 owner 授权会把学生锁在自己材料门外）。**内容安全基线**（不属于预防性建设，是 Web 基线）：下载一律 `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`，不信任上传方 MIME；SVG/HTML 等主动内容不在主站 origin inline；管理员 markdown（批次说明等）渲染前 sanitize 或禁 raw HTML。**不提前建设**预签名 URL / CDN / 缩略图 / S3 / 多副本。multipart 在 Effect v4 beta 的支持**必须实查 `repos/` 上游源码**。

**依赖如实声明**（第二轮审计 §十七）：core 拥有 `entry_revision_attachments` 且其 FK 指向 `attachments`——外键在哪，依赖就在哪。自 M2 起 `@qualy/plugin-assessment` 的 dependsOn **正式包含 storage**。

## 20. 插件边界

```text
packages/plugins/
├── assessment/ core | evidence | appraisal | formula     # 新分组
├── data/       grades | dormitory                        # 新分组
└── infra/      database | ui-registry | web | storage | sandbox | llm
```

**infra 成员资格**（增补 01 §10 成文，供未来机械判定）：一个包进 `plugins/infra/`
当且仅当同时满足**零业务语义、零自有业务数据、以装配与否作为部署级治理开关有独立意义**；
"存在跨领域消费路径"是加分项不是必要条件。据此 database/ui-registry/web/storage/
sandbox/llm ✓，formula ✗（有综测语义）、grades ✗（有自有业务数据）。**归置决策不适用
"复杂度由需求触发"元规则**——归置没有推迟收益，功能建设才有。

**何时新建 Plugin（满足其一）**：独立数据生命周期 / 可独立启停 / 是某 ExtensionPoint 的驱动。否则一律 assessment/core 内部 module（batch/ phase/ roster/ item/ entry/ review/ scoring/ publication/ archive/——复审轮归 review，没有独立 appeal 模块；index.ts 保持组合根 facade）。**不拆** eval-batch/flow/scoring/publication 四件套——共享实体、共享事务、生命周期同步、强外键耦合，拆开只制造 contract 仪式。批次的"耦合"是聚合的本质：publish 与 advancePhase 同事务、作废与终结审核释放 claim 同事务——这些事务边界就是插件边界不该穿过的地方（仓库先例：auth 的 users/user-types/sign-in/session/placement、rbac 的 roles/grants/diagnostics 都是单插件内部模块）。

**不抽通用工作流/时间线能力**：审核链引擎与 Phase 模型今天只有一个消费者，词汇（锚点、花名册、批次）全是综测的——现在抽成通用能力就是在造 §27 禁止的 BPMN。触发条件：第二个真实领域需要受限审核链时，先按 infra 四判据评估（届时它大概率仍不满足"零业务语义"）。Publication/打印/归档是纯综测语义，永不外抽。扩展缝已经够用：题型走 `assessment.item-type`，计分走 `assessment.calculator`，附件/沙箱/LLM 走 infra 服务。

**grades 集成方向（M6 届时定，两候选记录在此）**：assessment 不依赖 grades 插件不变；候选 A（倾向）——grades 暴露零依赖契约叶 `@qualy/grades-contract`（服务 key + `getStudentTermGrades` 类型），grades 插件提供服务，assessment core 的 derived 驱动经契约可选消费（配置引用了未装配能力 → 硬失败，复用既有规则），仿 auth 依赖 rbac-contract 而非 rbac 的先例；候选 B——grades 反向 dependsOn assessment 并贡献驱动。A 保住"grades 独立成立"，B 保住"core 零 grades 知识"，届时按谁的代价小定。

依赖：core → database / ui-registry / org / rbac / auth（M2 起 + storage；真实插件 id，"server" 不是插件）。**assessment 不依赖 grades/dormitory**——反向通过驱动/contract 消费；没有 grades 时纯材料型综测照常运行。题目实例引用了未装配能力（evidenceSource=dormitory 而插件未启用）→ 配置校验/装配期**硬失败**，由管理员显式改配置；**禁止静默降级为人工模式**。

| 插件                               | 职责                                                               | dependsOn                                            | 里程碑        |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- | ------------- |
| @qualy/plugin-assessment           | 综测 bounded context 全部核心 + item-type / calculator 扩展点      | database,ui-registry,org,rbac,auth（M2 起 +storage） | M1,M3–M5      |
| @qualy/plugin-storage              | 附件基础设施                                                       | database                                             | M2            |
| @qualy/plugin-assessment-evidence  | 通用举证题型驱动（献血/退役/教官/证书/竞赛/科研证明…全走实例配置） | assessment,storage                                   | M2–M4         |
| @qualy/plugin-grades               | 成绩事实域（即使没有综测也成立）                                   | database,ui-registry,org                             | M6            |
| @qualy/plugin-assessment-appraisal | 教师评价/学生互评（任务型 interaction，非 Entry Form）             | assessment                                           | M7            |
| @qualy/plugin-dormitory            | 寝室事实域（生命周期跨批次）                                       | database,ui-registry,org                             | M8            |
| @qualy/plugin-sandbox              | 确定性 JS 执行沙箱（**无表、无 API、无 UI、租户盲**）              | （无）                                               | M9a（可提前） |
| @qualy/plugin-llm                  | OpenAI 兼容端点接入（薄：一个 `Llm.chat`，无 provider 动物园）     | （无）                                               | M9b           |
| @qualy/plugin-assessment-formula   | custom 计分驱动 + AI 授权流水线（`assessment.calculator` 驱动）    | assessment,sandbox,llm                               | M9b           |

**dependsOn 写真实插件 id**：`database` = @qualy/plugin-database、`ui-registry` =
@qualy/plugin-ui-registry，依此类推；设计稿里的 "server" 不是插件——API 组经描述器
`Api.group` 上车，无需依赖项（裁决 §32.3）。

---

# 第三部分 · 施工规范

## 21. 表清单与 ownership（最终归属；按里程碑分批建，不一次建全）

- **assessment/core**：`assessment_batches`（daterange、timezone、current_phase_id、config_revision 计数）；`batch_scope_nodes`（scope 节点集合，**node_id 无外键**——删除出警告不阻塞，路径实时解析）；`batch_user_types`（batch 级用户类型集合，join 表）；`batch_phases`（(batch,ordinal) 唯一，actual_entry_at 不可回改）；`phase_events`（append-only，含 processed_at）；`phase_item_scopes` / `phase_participant_scopes`（补充期作用范围，空=不限）；`phase_templates`；`batch_participants`（(batch,user) 唯一、anchor_path ltree、**anchor_lineage jsonb**）；`batch_config_revisions`（append-only 配置事件日志）；`score_groups`（自引用，cap/floor）；`assessment_items`（轻量身份 + current_revision_id）；`assessment_item_revisions`（**不可变**，(item,revision_no) 唯一）；`entries`（轻量）；`entry_revisions`（不可变，(entry,revision_no) 唯一，**含 item_revision_id**）；`entry_revision_attachments`（关系表）；`source_claims`（(tenant,namespace,scope_key,normalized_key) 唯一，durable ledger）；`review_instances`（**含轮列** round_no/origin/initiator/publication_id/anchor_line_id；收件箱索引：(tenant,state,current_node_path) + GiST）；`review_stage_panels`；`review_votes`；`review_events`；`review_event_attachments`（轮证据与驳回圈画图）；`score_runs`（input_manifest 含各题 item_revision、engine 版本）；`score_results`；`publications`（含 retracted 态）；`publication_rows`（自包含物化，BreakdownLine 带 lineId+provenance，READY 后不可改）；`ranking_tie_resolutions`。**没有 appeal\_\* 表**（§15）。
- **storage**：`attachments`（status staged|bound|retired、bound_at）。grades / dormitory 的表在 M6/M8 设计时追加到本文档。
- 全表遵守仓库既有形态：uuidv7 主键库侧默认、timestamptz、复合租户外键 `(tenant_id, id)`、跨插件取表走 dependsOn + 实体闭包、迁移 `pnpm qualy generate`（destructive 走 drop-guard）。ltree/daterange 自定义类型仿 org 先例。

## 22. API 面

原则：第一段产品域 `assessment`；名词复数、无动作段（禁止 /doApprove /publishResult）；状态变化 `PUT …/status`；领域决定作为一等资源 `POST …/decisions`、`POST …/votes`；列表一律 keyset 分页；响应带 capabilities/manageable；**新增/改名与 `tools/tests/support/frozen-routes.ts` 同笔更新**。路由预案：

| 方法 路径                                                                                                     | 说明                                                                             |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET/POST `/assessment/batches`；GET/PATCH `/assessment/batches/{id}`                                          | 批次                                                                             |
| GET/PUT `…/{id}/phases`；PUT `…/{id}/phase`                                                                   | 阶段计划编辑；推进（manual/force 带 reason）                                     |
| GET `…/{id}/timeline`                                                                                         | 学生视角派生时间线                                                               |
| GET `…/{id}/participants`；GET `…/{id}/roster-diff`；PUT `…/participants/{pid}/status`                        | 花名册                                                                           |
| GET/POST `…/{id}/items`；GET/PATCH `/assessment/items/{id}`；GET/PUT `…/{id}/score-groups`                    | 题目与组树                                                                       |
| POST `/assessment/entries`；GET `…/{id}`；POST `…/{id}/revisions`；PUT `…/{id}/status`                        | 条目：新建/详情/追加修订(**仅本人**——代录是原子创建无后续修订权)/submit·withdraw |
| GET `/assessment/review/inbox`；POST `/assessment/review/instances/{id}/decisions`；POST `…/votes`            | 收件箱与审核                                                                     |
| GET `/assessment/batches/{id}/my-result`                                                                      | 实时预览（含 breakdown）                                                         |
| POST/GET `/assessment/batches/{id}/score-runs`                                                                | 试算                                                                             |
| POST `/assessment/publications`；GET `…/{id}`；GET `…/{id}/preflight`；PUT `…/{id}/status`；GET `…/{id}/rows` | 公示全流程（scheduled 时 body 带 publishAt+appealDeadline）                      |
| POST `/assessment/entries/{id}/rounds`（锚定 publication+line；resubmit/reopen 按权限分流）                   | 申诉/复查 = 对终态条目开新一轮；决定复用 review decisions                        |
| PUT `/assessment/batches/{id}/status`                                                                         | active / archived                                                                |

## 23. UI 页面与体验基准

| page id                          | path                           | visibility                   | 内容                                                                                                                                                                             |
| -------------------------------- | ------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| assessment/batches · batch-admin | /assessment/batches[/:id]      | permissionOf(batch.manage)   | 管理端：基本信息 / Phase 时间线 / Roster+Diff / 题目与组树 / 审核异常 / ScoreRun 试算 / **Preflight 面板（一等公民）** / Publication / 归档                                      |
| assessment/home                  | /assessment                    | AUTHENTICATED                | 学生填报中心：派生时间线 + 三大类分组的题目卡（题名 / 当前计入分 / 组上限 / 条目状态汇总 / 新增入口）                                                                            |
| assessment/item · entry-editor   | /assessment/items/:id 等       | AUTHENTICATED                | 条目列表 + schema 驱动表单；条目卡统一解剖：状态徽章 / Revision 摘要 / 分值 / 审核到哪级 / 附件 / 时间线 / 动作区                                                                |
| assessment/inbox                 | /assessment/inbox              | permissionOf(review.process) | 拉式收件箱（Item/Batch/状态/组织范围筛选）+ 详情（revision + 附件 + 有效链 + 事件 + 动作条）                                                                                     |
| assessment/my-result             | /assessment/batches/:id/result | AUTHENTICATED                | **核心产品页**：品德 13.2/15 → 教师评价 7.5、献血 +1、教官 +2、国旗班 +2、组合封顶 −1……逐行可解释；公示后切 S1/S2 视图。大量真实申诉源于"不知道为什么算成这样"，此页做透申诉减半 |
| assessment/appeals               | /assessment/appeals            | AUTHENTICATED                | 我的申诉/复查轮列表与发起入口（从成绩页 BreakdownLine 进入）                                                                                                                     |

体验红线：用户永远看到**业务流程**而非内部状态机——"第一次成绩公示：待定"而不是"管理员尚未创建公示"；管理员看到的是"审核状态 4231/4250 · 待处理 14 · 疑点 5 → [运行发布前检查]"这样的业务面板。管理员配置的一切文案（题名、说明、选项 label）i18n 上是 literal；系统文案（状态徽章、动作名）走插件 message catalog。

## 24. 测试重点（不变量优先于 CRUD 覆盖）

- **Phase**：PHASE_GATED fail closed（集合内缺席于 Profile 即拒，集合外恒放行）；scheduled transition 幂等；actual_entry_at 不可回改；PhaseGate 只能收窄 RBAC。**时间模型**：effectivePhase 按时钟精确到秒（调度停机不影响截止判定，物化只是追认）；队头武装——manual 边界之后的 scheduled 绝不自燃；硬计划越过未发生的 manual 边界被校验拒绝；偏移在事件时刻物化，早于上游 actual 被拒；scoped 阶段只放行范围内的创建族动作；review.process/reopen 不受两种 scope，resubmit 不受 item-scope 但受 participant-scope。
- **配置生命周期**：active 批次自由编辑落配置事件；config_revision 递增使旧 ScoreRun 过期（preflight 判"试算需重跑"）；作废终结在途实例、释放 source_claims、breakdown 留痕；恢复作废遇占用冲突失败；SCHEDULED 冻结集合逐项拒绝、纯草稿放行；发布时刻断言中止带病发布。
- **巡检**：双向自愈（撤角色 → blocked，补任命 → 自动 active）；与手工操作并发安全（条件更新）；"立即复查"scoped 生效；滞留进面板不 block；到站检查覆盖提交/流转/上提三个入口。
- **轮与驳回**：每次提审新实例（withdraw 取消回 draft、rejected 修订开新轮，round_no 递增）；申诉轮锚定 (publication, line) 且在原链上越过 normalTerminal；复查轮直达终点；一票驳回（已投 approve 票留事件、竞态先落库者生效、escalated 终点 panel 的 reject 仍一票）；record 条目任何时段不建实例（单调谓词无条件成立）。
- **精度**：行级 2dp 量化后逐行相加恒等于各级小计与总分；HALF_AWAY_FROM_ZERO 边界（83.245→83.25、-0.125→-0.13）；权威路径无 JS float；排名用展示精度。
- **S1 后**：普通途径改评分语义被拒；retract → 修正 → 重发新 preliminary 全流程；effectivePublished 时钟判定（调度停机不延迟公示可见与申诉窗）、取消预告仅限 publish_at 前。
- **Review**：普通路径恒为疑点链前缀；禁止自审；职位空缺不自动上浮；terminal 必须存在；voter panel 分母稳定；single 换届实时生效；escalate 短路会签。
- **Entry**：Revision append-only；审核锚定具体 revision；proxy 的 actor/subject 不混淆。
- **Scoring**：§16 修正版五条不变量；正负分场景分别按语义测试；**禁止**"撤销任一条目总分单调不增"这类错误全局不变量。
- **Publication**：READY/SCHEDULED/PUBLISHED 后 rows 不可改；SCHEDULED 冻结拒绝写入、CANCELLED 后恢复；S1 不因 S2 改变；Appeal target 恒指向不可变对象；publish_at（承诺）与 published_at（执行）分离，调度延迟不移动申诉截止。
- 全部经 `createTestContext()`（业务插件不得自持数据库），fixture 走 testkit `runSql`；关键页面（EntryForm、收件箱）浏览器测试自 M3 起。

## 25. 工程接口点（详规以 CLAUDE.md 为准）

实现前必读：CLAUDE.md → docs/effect-migration.md 相关节 → STATUS.md → 当前插件描述器实现 → rbac contract → org ltree 实现 → database 插件封装。描述器上车：表 `Db.entities`（+baselineDir 幂等片段装 extension/自定义类型）；权限 `Access.permissions`（纯 rbac 契约形状，**零扩展**；PHASE_GATED 门控白名单是 assessment 自有数据，与权限声明同文件，见 §11）；API `src/api.ts` HttpApiGroup + `Api.group`，域错误 `src/server/errors.ts` 入全局错误码门禁；页面 `Ui.page` / `Ui.react` / collection；扩展点按 plugin-kit ExtensionPoint（prepare 相）。**Effect v4 是 beta：HttpApi / multipart / Schedule / Fiber / Layer / Schema 一律实查 `repos/` 同版本源码，禁止凭 v3 记忆编码**；三处必查点：multipart 上传、fiber 定时扫描、daterange 类型映射。keyset 分页、租户纪律（tenantId 只来自 session/配置/服务端关联对象）、frozen-routes 与 error-codes 同笔更新——逐条适用。

---

# 第四部分 · 里程碑（垂直切片，每步端到端可演示）

**M1 — Batch + Phase + Roster + PhaseGate（运行时骨架）**
交付：§9–§11 全部（批次 CRUD、daterange、阶段序列/模板/phase_events(+processed_at)、**队列武装模型与三种时间形态、effectivePhase 时钟判定**、phase_item/participant_scopes 与插入阶段、配置事件日志、调度 fiber、花名册生成与 diff（转入转出对称）、permissions.ts（权限声明 + PHASE_GATED 同文件）、PhaseGate(+ctx)、结构化拒因、学生时间线（取值优先级）、batch-admin 基础页）。不做 Entry/附件/复杂审核/计分/公示。
验收：① 模板建批次，阶段编辑器只显示受控权限；② scheduled 到点自动切换且幂等（重扫无重复事件），actual 写 planned 值、processed_at 另记；③ 改未来 planned 成功并审计，改 actual 被拒；④ manual/force 切换落审计带 reason；⑤ 花名册单 SQL 生成；diff 三类差异可应用；excluded 不删数据、组织变化不使 roster 漂移；转入默认不纳入、纳入时双重参与警告；⑥ 权限矩阵逐格验证（预填报可 edit 不可 submit；审核整理关提交、review 继续；归档期写动作全 403）；⑦ createTestContext 覆盖 gate 判定与切换幂等；⑧ **队头武装**：manual 边界之后的 scheduled 到点不自燃，硬计划越过 manual 被拒；⑨ **effectivePhase**：物化延迟不影响 gate 判定（时钟说了算）；⑩ scoped 阶段：范围外 entry 动作拒绝且拒因可辨，review 不受限。

**M2 — Storage + Evidence 最小闭环（第一条可演示业务）**
交付：storage 四接口 + 本地 provider + authorizer；item-type 扩展点 + evidence 驱动（text/date/attachment）；Entry/Revision/关系表附件（含 item_revision_id 引用与 ItemRevision 实体）；题目的 `entrySource`（student | administrative）与行政认定路径（**record = trusted，不建审核实例**）；单 stage 审核 approve/reject；**驳回附修改建议**（建议稿 + 必填文字意见，学生端只读、不可套用/复制）；**最小 scorer 内核**（第三轮审计 §10——M2 的 +3 必须是真实竖切不是 mock，且"calcParticipant 全系统唯一实现"从第一天成立）：calcParticipant 骨架 + `fixed@1` + `sum@1` + 单层 ScoreGroup + 最小 Breakdown + provisional my-result；实例：退役复学（student）+ 一条扣分题（administrative）。
验收：学生传证明→草稿→提交→审核通过→"我的成绩"显示 +3；SUBMITTED 后 edit 被 ResourcePolicy 拒；**他人对 student 题目的写入一律 403**（不是权限不足，是这条路不存在）；行政录入的扣分条目 actor≠subject、学生端可见录入者与时间；驳回带建议 → 学生自己改 → 新 revision → 重提，建议随决定事件留痕；**作废**：激活后的题只能作废（必填理由）、在途实例以 cancelled_item_voided 终结、灰卡与横幅按有无条目区分、draft 批次只删不作废。**到此必须是可演示系统，不是基础设施。**

**M3 — Review 完整体（最难的人工审核问题）**
交付：§14 全部（完整链+normalTerminal、RoleAt/NearestRole、ADR-4 三分、quorum 三型+panel、一票驳回、escalation、拉式收件箱、事件+投影）；**代录**（entry.proxy，走完整链）；source_claims；event_pick/enum_with_other/pattern 字段。实例：献血。
验收：① 献血全链跑通；② 同编码第二条：提交软提示、审核通过被唯一约束拒绝；③ 班长换届收件箱即时增减；④ 专业直属生跳过 class stage 且事件含解释；⑤ class 有节点无班长 → BLOCKED 进管理告警；⑥ 班长提交自己的条目自审剔除生效；⑦ atLeast(2)：panel 快照、成员撤角色触发可达性告警、任一 escalate 短路、**一票驳回生效且已投 approve 票留事件**、escalated 模式仅 terminal 可 reject；⑧ **巡检双向自愈**：撤销唯一班长角色 → 五分钟档转 blocked + 告警，补任命 → 自动回 active，"立即复查"秒级生效；⑨ **到站检查**：流转/上提进入空 stage 当场 blocked；⑩ 作废释放 source_claims：作废重建后同编码可重报，恢复作废遇新占用失败；⑪ 滞留水位进审核异常面板。

**M4 — Scoring（从审核系统升级为综测系统）**
交付：§16 **扩展**（M2 已交付内核）：lookup/range/decrement 计算器、min/max/countTier 聚合器、嵌套组树 + cap/floor、完整精度包与属性测试、BreakdownLine provenance + 确定性 lineId + label 冻结、trial ScoreRun 输入冻结。实例：教官+国旗班。
验收：双题 + cap=3 组产出 2/2/3 三种组合；range 越界拒绝（创建期）；同冻结输入两次计算逐字节一致；正/负分移除语义分别通过；**精度**：行级量化后逐行相加恒等于小计与总分、HALF_AWAY_FROM_ZERO 边界用例（83.245→83.25、-0.125→-0.13）、权威路径无 float；floor 托底行进 breakdown。

**M5 — Publication + Appeal + Archive（完整可用于一个学期）**
交付：§15/§17/§18 全部（preflight、READY→SCHEDULED 冻结与错误码、effectivePublished 惰性物化、rows 自包含物化 + BreakdownLine provenance、publishPreliminary/publishFinal 同事务编排、**retractPreliminary**、+N 工作日辅助计算器（纯前端）、分区排名+tieBreak+ranking_tie_resolutions、可见性、**申诉/复查轮**（resubmit/reopen、锚定 line、原链续爬）、归档与打印源）。
验收：① 有待审条目无法生成可发布快照，每个 blocker 出路可操作（含 admin void）；② SCHEDULED 后冻结集合逐项被 `PUBLICATION_SCHEDULED_FROZEN` 拒、纯草稿编辑放行、取消后恢复且取消仅限 publish_at 前；②′ **发布断言分裂**：外部漂移 → 照发 + CRITICAL 告警，快照内部损坏 → 中止；②″ publishPreliminary 在非公示创建期被 guard 拒；申诉期显示时间取 publication.publish_at 单源；③ **effectivePublished**：调度器停机时 09:03 读 S1/发起申诉轮触发惰性物化，生效时间仍是 09:00；④ 从 S1 的 BreakdownLine 发起申诉轮 → provenance 反解 entry/revision/decision → 原链越过 normalTerminal → 终点更正/维持；staff 复查轮直达终点；⑤ S2 吸收更正、rank 冻结、tieBreak 品德→学业→文体、并列裁决经 ranking_tie_resolutions；⑥ S1 在 S2 后原样可查；**S1 后改计分语义被拒，retract → 修正 → 重发新 preliminary 跑通且 S1 标记"已撤回"仍可查**；⑦ 归档 gate + **PrintModel 业务数据与终版 canonical 数据一致**（不验 PDF 字节——生成时间/metadata/渲染器版本天然不同）；⑧ **轮期间终态不变**：approved 条目在申诉轮 active 时实时预览分数不动；⑨ **多轮串行化**：同一 entry 双开轮被部分唯一约束拒绝；⑩ **成绩异议题**全流程：从无 provenance 的 breakdown 行发起 → scoped create → terminal 裁决；⑪ **行政条目首轮**：record 条目被申诉时按 item_revision.review_policy + 冻结 lineage 现场解析快照，participant 轮入口在 normalTerminal 之后。
**M5 完成 = 纯材料型综测系统整体可投产**（学生填报→多级审核→计分→两次公示→申诉→归档），Grades/Appraisal/Dormitory 均为增量。

**M6 — Grades（成绩事实域 + 派生题型）**：grades 只存事实（term / course / course_nature(必修|必选|公选) / credit / grade_record(attempt 序, 首考标记) / import_batch / 错误行 / 修订历史），保留**课程行级**（规则要问"全部必修是否 ≥85""不及格几门"）；对外唯一窄接口 `getStudentTermGrades(studentId, termId)`。综测侧 `interaction:'derived'` 驱动实现：加权基础分×75%（剔公选、取首考）、全 85/80 加分、必修必选不及格扣分——**"值多少分"永远写在 assessment 侧**。重导入纠错 → 关联批次未发布的 ScoreRun 需重跑。实施前补详细设计到本文档。

**M7 — Appraisal（任务型）**：教师评价（default 模式=规则给 8 分零记录；evaluation 模式=建任务→指定范围与教师→逐生录入→完成；100/100 未点完成可自动 complete）。**未完成任务 = Publication blocker**，出路 = 补录/转派/显式作废（必填理由）；**绝不存在"漏 1 人作废 99 人"的自动行为**。100→8 换算与多师聚合方式配置化（§30，禁猜）。学生互评范围与防恶意策略实施前确认。**班委批量网格代录不做**（裁决 §32.1 取消了它的前提）；如果届时确有"逐生录入"的真实需求，它只可能出现在 administrative 题目上（如整班扣分名单），届时再评估，不预设。

**M8 — Dormitory（独立事实域，最后做）**：room / occupancy(daterange) / inspection_batch / inspection_score / dorm_leader_claim（多人自称→CONFLICT 人工裁决，**不做 first-write-wins**）。综测消费：管理员配置纳入哪些查寝批次（或按日期规则自动纳入），系统按 occupancy 区间自动判定——**学生不得自选批次或时点**（cherry-picking 封死），只能对数据发起异议；未入住/无成绩三态 `FULL | ZERO | NOT_APPLICABLE`（第三态对总分的影响由组规则配置）；口径（检查日在住/全期在住/区间加权）待政策确认（§30）。

**M9 — Formula：custom 计分沙箱 + AI 生成流水线（毕设主特性，两包分交付）**

三层分工（增补 01 §1）：**机制层** `plugins/infra/sandbox` 确定性 JS 执行（不知道什么是综测）→
**驱动层** `plugins/assessment/formula` custom 计分驱动 + AI 授权流水线 → **语义层**
`assessment/core` 的 `assessment.calculator` 注册表、ScoreRun、Breakdown（不变）。类比仓库既有形态：
sandbox 之于 formula，如 database 之于一切领域插件；formula 之于 `assessment.calculator`，
如 auth-local 之于 `Login.driver`。

**排程**：sandbox 零综测依赖，M1 之后任意时点可并行先行；formula 硬前置 = M4（registry 缝）+
sandbox + llm。整体建议排序：**M5 → M9 → M6–M8**——先保住完整学期流程的底盘，紧接着上主特性，
领域数据插件殿后。

**M9a — `@qualy/plugin-sandbox`**（server-only 最小包：无表、无 api.ts、无 client、无权限点、
无 TS→JS 转译、对 tenant/batch/item 零感知——**租户盲**，跨租户隔离由输入组装侧保证）
交付：`load(js, sha256) / run(handle, input, limits)` 两个方法；intrinsics 白名单、Date 整体移除、
`Math.random` 抛 ForbiddenApiError；中断句柄（默认 25ms，上限 200ms）+ 内存上限（64MB）+
输出尺寸上限（256KB）；sha256 → 编译产物 LRU；scoped Layer 管 wasm 生命周期，每次 run 独立 context。
**quickjs-emscripten 锁精确版本进 pnpm catalog，且 wasm 工件 hash/变体进 sandbox engine version**
（不只 npm 版本号）。三条技术断言按第三轮审计修正：① **64MB 内存上限是我们自己的验收不变量，
以敌意分配测试自证**——不以 `setMemoryLimit` 的库承诺为凭（上游 issue #255：prebuilt + memory
growth 下限制可被穿透直至宿主 OOM）；prebuilt 变体过不了就换固定 `WebAssembly.Memory`、禁
growth 的自建变体。② "Math.sin/pow 跨平台逐位一致"从选型理由降级为**待验证目标**：WASM 没有
超越函数指令，位级一致来自"同一 wasm 工件内嵌同一 libm"这一事实，决定性证据是双平台 golden
replay。③ 该库 <1.0、未经安全审计——**我们验证的是这个具体工件，不是信任库**；逃逸套件与
replay 是自证式验收，即使上游修掉 #255 也保留。**升级 = 计分内核变更**，升级前必须跑历史
ScoreRun 抽样重放逐字节对拍。
验收：① 本机与 CI Linux 两平台对同一 (js, hash, input, 冻结时钟) 输出逐字节一致，用例覆盖 libm 路径；
② 逃逸套件：`globalThis` 自有属性快照 = 白名单，Date（含构造）/ Math.random / import / require /
fetch / process 全部 ForbiddenApiError 或不存在；③ `while(true)` 被 deadline 中断 → TimeoutError，
大分配 → MemoryError，超大返回 → OutputTooLarge，三者携带 codeHash 且可离线复现；
④ 同 hash 二次 load 不重编译（计数断言）；⑤ 后台 fiber 连续执行 12000 次 ~2ms 调用期间，
health 端点延迟不劣化超过阈值（调用之间显式 yield 生效）；⑥ 作用域结束无 wasm 句柄泄漏。

**M9b — `@qualy/plugin-assessment-formula` + `@qualy/plugin-llm`**
交付：formula 向 `assessment.calculator` 贡献 custom 计算器/聚合器（组装 input → 调 Sandbox →
校验输出 shape 并入 Breakdown）；**分层 AI 生成流水线**：细则文本 →（经 `Llm.chat`）① 优先产
**内置计算器的声明式配置**（教务人员可人工复核，覆盖多数条款）→ ② 无法声明式表达时降级产
TS 纯函数 **+ 配套测试用例**（AI 从规则文本产出，含边界情形）→ 沙箱跑测试 → 抽样真实学生试算 diff →
**人工显式发布**；`formula_versions`（ts_source, js_artifact, sha256, tests, last_test_run,
status(draft|published), published_by/at），item config 以 version id 引用已发布版本，天然纳入
§9 配置冻结与 BatchConfigRevision；授权动作复用 `assessment.batch.manage`，**不新增权限点**。
`@qualy/plugin-llm` 刻意收窄：单一 OpenAI 兼容端点配置（baseUrl/apiKey/model/超时/重试）+ 一个
`Llm.chat` 服务，**不做** provider 动物园、不做流式、不做用量计费；模型切换是部署配置而非代码变更。
**隐私红线（冻结规则）**：llm 默认只允许接收规则文本、schema 与合成测试数据；**真实学生姓名/学号/
成绩/证书/申诉内容/附件不得进入 LLM 请求**——"真实学生试算 diff"只在本地 scorer/sandbox 执行，
不经过 LLM。未来审核辅助若要读真实材料，那是显式租户开关的另一个界面，不在默认里。
验收：① 同 hash 同冻结输入逐字节一致（不变量①对 custom 成立）；② 无限循环/超内存被中断，run FAILED
且带 (item, participant, input) 定位、可复现；③ 沙箱内 Date / Math.random / 网络访问全部抛错；
④ 未发布或测试未过的 custom 版本被 preflight 拦截；⑤ 回归基准：用 custom aggregator 复刻
"1项0.5/2项0.8/3项1"，与内置 countTier 逐字节一致；⑥ 已有提交的批次修改 custom 代码被强制走
BatchConfigRevision；⑦ 端到端演示：粘贴一条真实细则 → 产出配置或代码+测试 → 通过 → 发布 → 试算出分；
⑧ **装配治理**：qualy.yml 含 formula 但移除 sandbox → 装配在 dependsOn 解析时硬失败并指名缺失依赖；
两者都移除 → 装配正常，且配置了 custom 计分器的题目在配置校验硬失败（复用"不静默降级"规则）——
"本部署是否允许任意代码执行"因此是 qualy.yml / qualy.lock.json 层面的**可审计决策**，落在 ADR 0001
确立的"装配即信任边界"上；⑨ llm 端点不可达时生成流程给出明确错误，**不影响**已发布 custom 版本的
计分执行（执行路径不依赖 llm）。

---

# 第五部分 · 边界与纪律

## 27. 明确禁止的过度设计（无真实需求不得建设；触发即先更新本文档）

| 禁止项                                                                     | 何时解禁                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 万能 BPMN / DAG workflow / 通用规则表达式引擎                              | 永不（受限链 + 三 quorum 已覆盖政策全集）                                                            |
| 完整 Event Sourcing（replay 重建状态）                                     | 永不（事件=审计，投影=真相）                                                                         |
| BusinessCalendar                                                           | "+N 工作日"前端辅助计算器被证明不够时                                                                |
| ~~QuickJS/沙箱自定义公式~~ **已解禁**：作为通用产品需求与毕设主特性排入 M9 | 但沙箱内以下事项**永久禁止**：非确定性 API、网络/IO、跨题目数据访问、函数内做组级组合（见 §16 契约） |
| Score cache / Redis / BullMQ / 分布式调度锁                                | 单实例 fiber 扫描出现真实瓶颈或多副本部署                                                            |
| S3 provider / 预签名 URL / CDN / 缩略图                                    | 部署形态需要时                                                                                       |
| 跨学期补差 / 累计限额 / 月度结算                                           | 学院新版细则确认保留该机制（届时优先评估用 custom aggregator + 声明式外部事实表达，避免动内核）      |
| 通知中心（邮件/站内信体系）                                                | v1 = preflight 面板 + 收件箱角标 + BLOCKED 告警列表                                                  |
| 实时全员排名 / 动态正式公示                                                | 永不（ADR-1）                                                                                        |
| 月度考勤台账 UI / 学生自报扣分                                             | 本校无此流程；行政录入 + 负分已留口（§13）                                                           |
| worker 线程池执行沙箱                                                      | 实测发布延迟不可接受，或健康探针出现可观测阻塞                                                       |
| LLM 流式输出                                                               | 授权界面体验确有需要，且 HttpClient 能力经 `repos/` 实查支持                                         |
| 管理员在线 Excel 录入 / 批量网格视图                                       | **永不改学生已填内容**；批量行政导入的入口留 source=import（裁决 §32.16）                            |
| rejectionQuorum（驳回凑票）                                                | 某学院细则明文要求驳回须多数决（届时连同弃权/死锁规则一起设计）                                      |
| reviewer override（指定人审单一实例）                                      | 出现"不能正式授予角色、但需要此人审这一个实例"的真实场景                                             |
| AssessmentCampaign（多子批次统一编排）                                     | 学校真要统一管理多个不同细则的子批次时（One Batch = One Rule Set 不变）                              |
| 重新路由在途条目                                                           | 真实需求出现时，实现 = 取消旧实例 + 开新实例（绝不改已快照链）                                       |
| 范围外手工纳入（锚点不在任何 scope 子树内的借读/挂读生参评）               | 真实出现该需求时（lineage 审核链本可跑通，代价是污染"scope 内未纳入"的文案语义）                     |
| 漂移主动提醒（巡检摘要加 roster diff 计数）                                | 运营中确需主动提醒时（一行代码；v1 漂移检测 on-read 派生已足够）                                     |
| correctedFinal（final 后归档前的纠错出口）                                 | 真实发生 final 后错误时，按 retract 对称设计：旧 final 保留、corrected final supersedes              |
| panel 重组（重新快照计票成员）                                             | 真实批次出现 panel 不可达且原成员无法恢复任职（旧票是否计入新分母届时设计）                          |

## 28. 明确禁止的错误简化

Entry 内容直接 UPDATE；impersonate（"以张三身份操作"）、**替学生修改已填内容**、一键套用审核人的修改建议——原子代录（替学生创建并提交其本可自提的材料）**合法**（§13）；Publication 做成实时查询；审核任务永久绑定具体用户（single/any 必须实时解析）；组织变化自动删 Roster；dormitory 缺失静默转人工；学生自由挑查寝批次/时点；权限交集波及 auth.login 等全局权限（PHASE_GATED 白名单在结构上排除它们）；把 escalation 当 appeal；每条政策一个 plugin；用 user_id/created_at 静默破除排名并列；靠前端查询代替 source_claim 数据库唯一约束；AI 生成的计分代码未经测试与人工显式发布直接生效；custom 函数失败时静默给零分；S1 后经普通编辑修改评分语义（必须 retract 重发，ADR 0009）；真实学生数据进入 LLM 请求；裸 UPDATE rank（并列必须经 ranking_tie_resolutions）；权威计分路径使用 JS 浮点；以 PDF 字节比对作打印验收。

## 29. 施工时先问的五个问题

遇到新能力，按序自问：**① 事实还是规则？** 事实落库，规则进配置/scorer。**② 历史结构还是实时身份？** 结构快照，身份动态解析。**③ 正式结果还是当前预览？** 预览动态，正式 immutable。**④ 业务状态还是权限？** 资格→RBAC，时间开放→PhaseGate，对象能否操作→ResourcePolicy。**⑤ 独立领域还是 core 内部职责？** 独立生命周期→Plugin，强耦合→core module。绝大多数架构疑问会被这五问直接消解。

另有一条针对"要不要往基础插件加东西"的判据（裁决 §32.13）：**字段/查询归谁，看它的词汇属于谁。** holders 反查（"谁在节点 N 持有角色 R"）——role、node、grant 全是 rbac 自己的词汇，加在 rbac 是纯下行的只读 API，合法；`phaseControlled`——phase 是 assessment 的词汇，下层契约要理解自己的字段就得先理解上层概念，这是概念性循环依赖，哪怕 import 图上没有环。

## 30. 未冻结的业务问题（遇到必须问用户，禁止猜）

1. 教师评价 100 分制 → 8 分基础分的换算公式（政策未写明；建议任务级 config，候选线性 score/100×8，须确认）。
2. 多教师评同一学生的聚合方式（平均/加权/取高）。
3. 学生互评的范围界定与防恶意（去极值等）规则。
4. 献血编码的实际唯一域（本文档示例按 tenant 终身，可改配置）。
5. 两次公示 view-peers 的默认策略（政策"向年级全体同学公示"倾向可见他人，待租户确认）。
6. ~~all / atLeast(n) 节点的 reject 投票语义~~ **已裁决**（§32.15：一票驳回，quorum 只管 APPROVE）。
7. 学院新版细则是否仍保留跨学期补差 / 消息报道类累计限额。
8. Dormitory 计分口径：检查日在住 / 全期在住 / 区间加权，取哪种。

## 31. 设计总纲

Qualy Assessment 的核心不是"把 Excel 搬上网页"，而是：**把原本依赖班委手工 Excel、口头审核和人工复核的综测流程，转换成一个以 Batch 为边界、以 Phase 表达时间、以 Roster 固定人员语境、以 Revision 保留事实历史、以受限审核链处理责任流转、以纯函数评分解释成绩、以 immutable Publication 固定正式结果、以 Appeal 处理争议的可配置审计系统。**

第一版的目标不是最通用的综测平台，而是：**让一个真实学院完整跑完一次"填报 → 审核 → 第一次公示 → 申诉 → 第二次公示 → 归档"的学期流程，且每一个分数、每一次修改、每一个审核决定都可解释、可追溯。** 所有进一步抽象，由真实出现的第二个需求推动，而不是提前建设。

## 32. 已裁决的偏离（本文与设计稿 v2.1 不同之处，逐条记录来源）

设计稿写于这些裁决之前，落库时按用户裁决改写。**读到 v2.1 或增补 01 里与本节冲突的文字，
以本节为准。**

**32.1 只有自己能改自己的材料**（用户裁决，两轮；适用范围经 §32.16 精确化：禁止的是**修改**——代录作为"替学生提交其本可自提材料"的**创建**路径在 §32.16 回归，走完整审核链）。取消班委代改（proxy amendment）、
取消管理员在线 Excel 录入、取消 M7 的班委批量网格视图。学生材料的唯一写入者是学生本人；
审核人发现问题走"驳回附修改建议"。**行政事实是另一条路径**：扣分（考勤/处分/欠费/漏寝，
凭职能部门送来的名单）与低频特殊加分（三等功额外加分、合理化建议采纳、见义勇为定级）由持
`assessment.entry.record` 的人在 `entrySource: administrative` 的题目上录入，学生无入口、
也不需要同意——救济渠道是申诉。`entries.source` 的 `import` 枚举值保留但 v1 无任何入口
（未来真出现批量来源时不用改约束）。

**32.2 修改建议是参考，不是替换**（用户裁决）。驳回时审核人可在学生已填内容上改出建议稿
（模态框内编辑，可在学生上传的图片上圈画），与必填的文字审核意见一并下发；学生端**只读展示，
不提供一键套用、不提供复制**——一键套用会让"这份材料是谁填的"变得可疑，是合规风险。
因此不存在"待学生确认修改"状态，也不需要为它建定时器或通知。

**32.3 与仓库现实的接口修正**：权限码段内用连字符（`force-advance`/`view-self`/`view-peers`），
与既有 `iam.tenant-role.bind` 一致；dependsOn 写真实插件 id（`@qualy/plugin-database` 等），
设计稿里的 "server" 不是插件；审核链 selector 引用角色与节点类型**用 uuid**（管理 UI 下拉选择，
模板在租户内复制天然成立），跨租户模板成为真需求时再加稳定 key 列；`packages/plugins/assessment/*`
与 `data/*` 两个新分组被现有 workspace glob `packages/plugins/*/*` 天然覆盖，零配置改动。
**PhaseGate 只能活在批次上下文内**（assessment 自己的服务层），不进全局 authorizer 或 manifest
投影——phase 是每批次的，而同一学生可能同时处于多个 active 批次（保研综测 + 学期综测规则不同，
可以并行），页面可见性没有唯一的"当前阶段"可依；页面保持 `AUTHENTICATED`/`permissionOf`，
页内动作可用性走响应里的 capabilities。

**32.4 审核不定分**（用户裁决）。全链任何人只有 approve / reject（+建议）/ escalate，
decision 事件不携带分值。需要人定值的条款一律是 administrative 题目，值写进条目 payload，
创建时按 `[min,max]` 校验。**配置校验规则**：`range` 计算器只允许挂在 administrative 题目上——
防止未来误配出"学生给自己定分"的题。

**32.5 花名册与批次**：批次的用户类型集合是**batch 级配置**（建批次时选择），不建租户级
"学生类型"全局标记。同一学生同时在多个 active 批次是合法场景，学生首页按批次分组展示。

**32.6 政策文件压出来的口径**：大项被扣分后 **floor 到 0**（政策未写，可配置）——不允许负值向
总分传导；"同一事项重复扣分只扣最高"（第四条 3）= 同一事项的多条扣分记录挂同一 item/组用
**`min` 聚合**（负数域取最小才是"扣最高"，第三轮审计修正早先的 max 映射）；**一票否决与弄虚作假不建模为资格标记**——即使被一票否决
的学生也要有一个综测成绩，"取消评奖评优资格"属于奖学金评定系统（与综测并列的另一套，v1 不做）；
弄虚作假扣 5 分就是一条普通的行政扣分条目。第九条的"月度小结 + 学期平均"不做，其等价能力是
"预填报期可以提前一个学期开"（Phase 模型天然支持，把 `planned_entry_at` 设早即可，零新机制）。

**32.7 花名册与锚点**（M1 细节裁决，2026-08-09）。转入与转出对称走 diff 面板，**不自动纳入**——双重参与（同一学期两个批次同时算分公示）必须由人协调；"填报截止前自动纳入"开关默认关且加"他批次无 active 记录"守卫。锚点两列保留，但理由修正：在途条目的稳定靠链快照（钉节点、实时解析人），roster 锚点服务**此后**的路由/排名分区/行政管辖与管理员控制杆；anchor_path 防组织树重构；糖开关"首次提交前锚点变更自动同步"。

**32.8 配置生命周期与题目作废**（M1 细节裁决）。"出现提交后冻结"废除，改为分级：draft 自由、active 自由+配置事件+影响确认对话框、SCHEDULED 冻结、归档只读。理由必填**按操作类型**挂（作废；active 批次计分语义变更），不按阶段挂。激活后只作废不删、draft 只删不作废；作废终结在途审核（cancelled_item_voided）、**事务内释放 source_claims**、breakdown 留"不计分"行；零条目作废题学生端隐藏；"作废并替换"克隆配置不迁条目。BatchConfigRevision 降级为 append-only 事件日志 + 单调计数；可重算由 input_manifest 含 config_revision 免费保证。

**32.9 卡死发现**（M1 细节裁决）。拉模型保留，不转投递（投递不解决空缺，新增迁移/回避/审计成本）；**巡检是唯一正确性机制，不做写路径钩子**（挂不全=隐性卡死，挂全=碎片化；rbac 不该知道 assessment）；告警是派生视图非实体，没有"删除告警"；即时性走面板"立即复查"按钮（scoped 巡检）；滞留水位管"有人不干活"；学生侧中性文案"等待审核中"。

**32.10 时间模型**（M1 细节裁决）。actual_entry_at 保留且定义为**语义生效时刻**（scheduled 边界写 planned 值；机器执行时刻另记 phase_events.processed_at，与 publish_at/published_at 同模式）；PhaseGate 按 effectivePhase(now) 时钟判定，物化只是追认；**时间线是队列，只武装队头**——manual 边界之后的 scheduled 绝不触发；下游时间三形态：硬计划（只许在队头到首个未发生 manual 边界的前缀上）/ 偏移量（事件发生时物化）/ 预计（纯展示）；物化早于上游 actual 拒绝。边界二分：承诺型到点必然生效，里程碑型 guard 优先于时钟。

**32.11 审核期结束与公示创建期**（M1 细节裁决）。一个 manual 边界三个旋钮：手动按钮（默认，待审归零点亮，未归零变强制结束）+ SLA 计划时间（只告警不自动切）+ 归零自动切开关（骑巡检的硬编码领域条件）；提审关闭后待审数单调递减是稳定谓词。默认模板新增**公示创建期**，publishPreliminary 的 guard 检查处于该阶段；申诉期显示时间单源取 publication.publish_at，不复制进 planned。scoped 补充期用 phase_item_scopes / phase_participant_scopes 两张 join 表，只限 entry 动作族，review.process/reopen 不受限。

**32.12 SCHEDULED 冻结集合**（M1 细节裁决）。精确拒绝集：审核决定、提交送审、非草稿条目追加 revision、题目配置修改（含作废）、roster 变更、申诉裁决；纯草稿编辑放行。发布时刻断言 manifest 一致（断言语义后经 §32.18 分裂：外部漂移照发 + CRITICAL，快照内部损坏才中止）；取消预告需 publication.manage + 理由。

**32.13 rbac 零改动，PHASE_GATED 归 assessment**（2026-08-09，用户分层反对推出的修正——取代"权限目录加 phaseControlled 加法元数据"的早先结论）。理由链：被门控的权限百分之百是 `assessment.*` 自己的码，"哪些码受门控"是门的属性不是权限定义的属性；`PermissionDefinition` 契约注释明文"刻意不放别人的关切"，往里加上层旗标违反契约自己的原则；下层契约要理解自己的字段就得先理解上层概念 = 概念性循环依赖。落点：assessment 的 `src/permissions.ts` 同文件承载权限声明与 `PHASE_GATED` 白名单（成员 = §11 表 ✓ 列），启动断言集合 ⊆ 自声明码；结构性安全升级——全局权限在结构上进不了阶段编辑器，无需校验去拦。**升级路径写档不建**：当 rbac 自身或跨域工具必须统一承载多个域的权限元数据时（如未来的跨域权限治理页），`PermissionDefinition` 加 opaque `meta?: Readonly<Record<string, unknown>>`，键强制命名空间化（`assessment:phase-gated`），rbac 只存不读不解释。附带判据（进 §29）：**字段/查询归谁，看它的词汇属于谁**——holders 反查是 rbac 词汇的只读下行 API，合法；驱动新增受门控权限的槽位是 `ItemTypeDriver.gatedPermissions?`，与题型注册同机制，现在不建。注意：该轮对话的示例代码含裁决前词汇（entry.proxy、view_peers、review.escalate 等目录外码），**以 §11 冻结目录为准**，PHASE_GATED 成员即 ✓ 列。

**32.14 申诉统一为"轮"**（2026-08-09 拍板）。概念仍分、存储统一：申诉/复查 = review_instances 的新一轮（round_no/origin/initiator/publication_id/anchor_line_id/re_entry_stage_index），appeal 四表与 AppealPolicy、appeal.\* 权限点取消；申诉窗 = 三个 phase 开关的组合（开放终态条目 resubmit + 链继续 + 关闭非链尾驳回）；申诉轮在同一条已快照链上越过 normalTerminal 继续；终局映射（更正/维持/撤销原通过并释放 claim）；发起权 entry.resubmit（participant）与 review.reopen（staff 直达终点）；无条目争议走事实域纠错或手工"成绩异议"题。ADR 0005 加修订段，原则四条动机全部保留。

**32.15 一票驳回**（2026-08-09 拍板）。quorum 只管 APPROVE；普通模式任一有效审核人 REJECT 即整体驳回（驳回低成本可恢复、通过是授益动作，不对称门槛正当；政策亦无投票驳回条款）。补全：驳回即刻终结 stage 且已投 approve 票留事件；escalate/reject 竞态先落库者生效；escalated 终点带 panel 时 approve 照 quorum、reject 仍一票。rejectionQuorum 留档，触发条件见 §27。

**32.16 行政条目按性质分流，代录回归**（2026-08-09 拍板，撤回早先"按时间分流"合成案）。该不该审取决于事实性质而非录入时间：`proxy` 代录 = 替学生提交其本可自提的材料（subject=学生，走完整审核链，受窗口门控）；`record/import` 行政认定 = 组织以自身权威断言的事实（处分/名单/正式扣分/立功），trusted 不建审核实例，四条约束（record 权限 org-scope、依据必填并向学生展示、SCHEDULED 照禁、救济=申诉轮或复查轮）。单调谓词由此无条件成立。政策毛边：S1 后新录行政事实进 S2 前经 preflight 显式确认（非 blocker），学生异议走复查轮不受申诉窗限制。source 枚举变为 self|proxy|record|import|system。

**32.17 数值精度**（2026-08-09 拍板）。内部 1e-4 定点整数（DB numeric、程序内整数/bigint，权威路径禁 JS float）；舍入 HALF_AWAY_FROM_ZERO（负数远离零，-0.125→-0.13 必须写明；弃 HALF_EVEN：可解释性优先 + 与旧 Excel ROUND 连续）；**量化点在行级**（每条目/调整行 2dp，之后全程 2dp 精确算术，总分=大项精确和）；属性不变量"逐行相加恒等于各级小计与总分"；sandbox 输出缩放整数或 decimal 字符串统一量化；排名与 tie-break 用展示精度。

**32.18 S1 后评分语义冻结 + RETRACTED**（2026-08-09，ADR 0009）。S1 后 calculator/aggregator/组树/题目计分配置/参与者集合不可普通修改，纠错唯一出口 retractPreliminary（S1 保留标记"已撤回"）→ 修正 → 重算 → 重发可申诉的 preliminary；S1 后开补充期强制走 retract。发布断言分裂：外部漂移照发 + CRITICAL（必要时 retract），快照内部损坏中止。retract 时申诉期落边界、在途轮继续。

**32.19 第二轮审计其余采纳汇总**（2026-08-09）。ItemRevision 不可变版本实体（EntryRevision 记 item_revision_id、ScoreRun 精确引用）；anchor_lineage jsonb 冻结逐级 (nodeId, nodeTypeId)；effectivePublished 惰性物化、取消预告仅限 publish_at 前；BreakdownLine 稳定 lineId + provenance 全冻结，申诉锚 (publication, participant, line)；claim 生命周期全表（归档不释放，durable ledger）；reassign v1 删除（override 留档）；core dependsOn storage（M2 起）；附件 staged|bound|retired + 内容安全基线 + markdown sanitize；ranking_tie_resolutions 实体；selector 与实例列统一 uuid（current_node_id 必加）；内置计算器 id@version、ScoreRun 记 engine 版本（驱动只承诺记录到可解释）；LLM 隐私红线；One Batch = One Rule Set（Campaign 留触发条件）；batch_user_types 表；diff 加用户类型变更类；打印验收 = PrintModel 与终版 canonical 数据一致；M7 标题去网格；公示创建期矩阵全 ×；删除"管理员补录学生 revision"。

**32.20 原子代录**（2026-08-09，第三轮）。proxy = 一个原子动作 = 创建代理 Revision 并立即提交，不存在代理草稿中间态；完成后条目与学生自提完全同构，proxy actor 无后续特权；proxy 自身即窗口（矩阵预填报 ×、正式填报 ✓），模板 lint 提示"proxy ✓ 而 submit ×"存疑。~~"受提审窗口门控"的双码合取表述~~与~~预填报 proxy ✓~~作废。四处叠层矛盾（§13 revision 段、§13 末句、§28 禁令、矩阵）逐句清除。

**32.21 复审轮期间终态保持 + 单开轮约束 + 证据挂事件**（2026-08-09，第三轮）。轮进行中 entry 保持上一轮已生效终态（approved 照常计分，轮是 reconsideration 不是撤销）——~~"分数悬置/暂不计入"~~作废；status/decision/claim 只在轮终局事务原子变更；同 entry 同时最多一个未终结轮（部分唯一 `UNIQUE(entry_id) WHERE state IN ('active','blocked')`）；轮证据与驳回圈画图挂 `review_event_attachments`——~~"申诉补充证明走该轮新 EntryRevision"~~作废；修订权三分（rejected student 条目可 resubmit 新 revision；approved 与 administrative 条目审原 revision、current_revision_id 轮中不前移；行政事实纠错走 record 权限人 void+新建）。

**32.22 两段式发布 + 时间形态落列**（2026-08-09，第三轮）。~~publishPreliminary 单事务"publish + advancePhase"~~作废：schedule 段（READY→SCHEDULED + 武装边界，不 advance）与 effective 段（SCHEDULED→PUBLISHED + 申诉期 actual := publish_at，同事务，可惰性物化）分离。batch_phases 增 entry_trigger='publication'、entry_offset jsonb、estimated_entry_at、opens_publication_id 四个落点（受限领域联合非规则引擎）；武装前缀 = 队头起穿过 scheduled 与已绑 SCHEDULED 公示的 publication 边界，止于首个未武装边界；retract/cancel 清空下游已物化 planned。retract 编排：落边界 → 申诉处理性质阶段清轮 → 可插补充期 → 向后插新公示创建期 → 新 S1；冻结绑定于"存在未被 retract 的 preliminary"。

**32.23 stage 成员资格 = 锚点精确匹配**（2026-08-09，第三轮）。RoleAt 与收件箱一个口径：成员 = 该 (roleId, nodeId) 上锚点恰为该节点的授予；subtree coverage 只服务权限检查（canAt/管辖），不参与成员资格——~~收件箱 subtree `<@` join~~ 作废，改等值匹配；否则学院上 subtree 授予的"班长"从收件箱后门绕过"RoleAt 找不到误授"的承诺。自审冲突集扩为 {subject_id, 受审 revision.actor_id}，quorum 剔除同规则。

**32.24 floor 默认 null + min 聚合器**（2026-08-09，第三轮，两个真 bug）。~~ScoreGroup floor 默认 0~~ 作废：默认 null 不托底，仅品德/学业/文体大项显式 0（否则中间纯扣分子组的负值提前蒸发）；~~"同一事项只扣最高 = max 聚合"~~ 作废：负数域是 `min`（max 恰好选出扣得最少的），v1 聚合器为 sum/max/min/countTier，计算器另有 none（成绩异议题）。

**32.25 第三轮审计其余采纳汇总**（2026-08-09）。行政条目首轮链通则（item_revision.review_policy + 冻结 lineage 现场解析快照；administrative 题必须配救济链，preflight 校验）；二段式 preflight（Input → 冻结 → 算 → Output Validation → tie 裁决锚 score_run_id → 一次性物化 rows）；M2 最小 scorer 内核前移（fixed@1/sum@1/单层组/最小 Breakdown/provisional my-result，M4 只做扩展）；成绩异议题（evidence + none@1 + terminal-only，申诉期 scoped create）；lineId 确定性方案 + label 冻结快照；"重新路由在途条目"开关删除；normalizer id@version 入 claim 行；storage authorizer 补 subject（bound 四方可读、staged 仅上传者）；M9a 三条技术断言修正（敌意分配自证、golden replay 决定性、工件 hash 入 engine version）；correctedFinal 留触发条件；§18/§14/§23 术语清扫（Appeal → 复审轮）。

**32.26 publication 边界的绑定生命周期**（2026-08-09，第四轮）。~~"trigger='publication' 时 opens_publication_id 必填"~~作废（把武装时刻的约束写成了创建时约束）：创建时 NULL = 未武装态合法；schedulePreliminary 绑定并武装；未进入前可重绑（CANCELLED 释放）；actual 产生后永久不可改。M1 落 nullable 列无 FK，M5 补。

**32.27 ScoreRun 新鲜度门禁**（2026-08-09，第四轮）。冻结输入到 SCHEDULED 之间 record/reopen/裁决/void 都合法发生，run 算完可能已过期：Output Validation 增新鲜度项（同一 manifest 收集器重算当前 hash 比对，不一致=过期 blocker，出路重跑；不建增量计数器）；schedulePreliminary 事务开头 CAS 复验。**SCHEDULED 前漂移=正常业务禁止预告；后漂移才归 §32.18 照发+CRITICAL**。"config_revision 落后→试算过期"泛化为全 manifest 判定。

**32.28 panel 交集与恢复路径**（2026-08-09，第四轮）。quorum stage 可行动集合 = 快照 panel ∩ 当前该 (roleId,nodeId) 精确锚点持有者；新任者不自动入旧 panel；已投票永久有效；可达性 = 有效票数 + panel 内仍具资格的未投票者。收件箱 SQL 分叉（single/any 等值、quorum 加 join panel）。恢复三路：恢复任职→巡检自愈、具资格成员 escalate、管理员 void。panel 重组不做（§27 触发条件）。

**32.29 谓词分裂 + retract 禁令**（2026-08-09，第四轮）。~~单一 effectivePublished~~作废：`wasReleased`（含 SUPERSEDED/RETRACTED，历史可读）与 `isEffective`（申诉锚定与冻结绑定）分裂；RETRACTED/SUPERSEDED 永远可读、永不再锚新申诉；状态表补 PUBLISHED→SUPERSEDED/RETRACTED 两转移；cancel/retract 分界=publish_at；**存在 isEffective final 后禁 retractPreliminary**（唯一出口 correctedFinal）。

**32.30 排除性锚定行**（2026-08-09，第四轮）。快照冻结时 {rejected, voided} 且曾正式提交的条目生成 `0.00, kind='excluded-evidence'` 行（provenance=受审 revision+终局事件），**完全不进任何聚合器输入**（min 扣分题不被 0 污染），行求和以 +0.00 保持；实时预览同渲染。从未提交的 draft 无行；cancelled_item_voided 条目不生成行（题级"已作废"行是锚）。

**32.31 S1 后新立不利终局的复议权**（2026-08-09，第四轮，含审计未扫到的孪生案）。S1 后新录行政条目与复查撤销原通过，同属"申诉窗关闭后才出生的不利事实"——final 输入冻结前赋予受影响 participant 一次锚定该事实的复议轮（origin='appeal'，publication/line 可空，锚 revision+触发事件，每事实限一轮）；resubmit 在申诉处理期 ✓ 但 ResourcePolicy 收窄到该谓词；入口=条目卡/成绩页行按钮；S2 preflight 清账。

**32.32 origin 三值**（2026-08-09，第四轮）。`initial | appeal | reopen`；约束 appeal→participant、reopen→staff；驳回重提是 initial 新轮；审核整理期 reopen 不再硬穿 appeal 词汇。

**32.33 ItemRevision 消费不变量**（2026-08-09，第四轮）。payload 永远按自身 item_revision 的 form_config 解码（渲染/导出/打印/审核详情）；ScoreRun 按选定 scoring ItemRevision；保存新配置实测 {in_review, approved} 条目 current revision，消费不了拒绝并引导作废+替换；draft/rejected 经新表单重入。不建 schema 兼容引擎。

**32.35 batch scope 升级为节点集合，导入模式否决**（2026-08-09，用户提问后裁决）。~~"scope 为单一子树，v1 不做不连续多 scope"~~作废：scope = `batch_scope_nodes` 节点集合（"只许 1/2/3 班"= 三个节点），只存 node_id、路径实时解析，~~batch 上的 scope_node_id + scope_path 快照列~~取消——**scope 是人群的定义（intent），roster 是人群的事实**，要冻结的是后者。"改成导入模式"否决：导入后系统不再存人群定义，**新迁入检测失明**（转入生无行可 diff、无定义可判），而定义落库才使"新迁入 = 任一 scope 子树内 ∧ 类型匹配 ∧ 不在 roster"可计算，并承载管辖判定（manage reach 覆盖每个节点）与"你尚未被纳入"定向文案。node_id 刻意无外键：节点删除 → scope 完整性警告（diff 面板新类），生成与检测跳过，roster 靠 lineage 不受影响。校验：同租户、拒绝嵌套选择、集合非空；draft 可改 active 锁。范围外手工纳入与巡检 diff 计数留 §27。漂移检测 on-read 派生，不做每分钟扫描（漂移有请求驱动的天然发现路径且不阻塞在途）。三层冻结梯度成文：实时层（树结构、角色持有人）/批次层（roster：位置+谱系冻结）/轮层（链快照，管理员应用锚点变更也不动）——位置冻结、人员实时、类型冻结。

**32.36 模板分立为时间线与阶段预设两 kind**（2026-08-09，用户对 batch-admin 首版评审后裁决）。§14 的单一 PhaseTemplate 拆成同表两 kind：**timeline** = 完整阶段序列（原语义不变，应用 = 草稿期整体替换 + 复制 + source_template_id/version 溯源）；**phase** = 单阶段预设，只描述"一个阶段的名称与权限选项"（§14 早有伏笔："权限 profile 可直接套用模板段"），**不携带任何时间与 trigger 语义**（存储惯例：单条目、manual、时间全空，服务端 `phase-template-shape` 拒因把关），应用 = 编辑器内把名称与 profile 复制进目标行（客户端起点填充，无溯源——它不是计划的来源，只是打字的捷径）。两个选择器各查各的 kind（listTemplates ?kind=）；`fromTemplateId` 只接受 timeline（`template-not-a-timeline` 拒因）。**模板在任何一层都不是必经之路**：批次可从零逐个添加阶段、可套时间线、加完阶段后可再对单行套预设，三者独立。

**32.37 进行中批次允许向末尾追加阶段**（2026-08-10，用户实测踩陷阱后裁决）。~~引擎的 `insert-after-terminal` 拒因（"末位阶段之后不能再插"）~~删除：它是实现自造的位置规则，本文只裁决过"插入只能在当前阶段之后"（§14），且"末位 = 收尾"是纯位置推定——phaseKey 无语义标记，用户从未选择过收尾阶段。陷阱形态：单阶段计划激活并进入后，"当前"与"末位"重合，两条位置规则把可插位置挤成空集，计划永久冻结，本文钦点的工作流（插补充填报期 §9、插审核整理阶段 §十、retract 向后插公示创建期 §32.22）全部不可达。裁决：末尾追加合法；"收尾必须是人的决定"的落点是**归档 status 变更及其 gate**（必须已走到末位阶段、归档后只读），不是末位序号；"末阶段必须 manual"（`terminal-must-be-manual`）保持现作用域——模板与整计划评审（草稿保存/激活），增量插入不复检，搭建期计划暂以 scheduled 收尾无害（时钟触发后批次停在末阶段等人归档）。

**32.34 第四轮其余采纳汇总**（2026-08-09）。排名两口径（ties 仅在要求物化 rank 时 blocker、S1 默认 rank NULL；partition 祖先查冻结 lineage 禁查 live）；retire 历史引用语义（禁新增引用+入口隐藏，已引用读取永久有效，物理删除非 v1）；时间语义统一（锚的语义时刻一旦确定即可物化——SCHEDULED 的 publish_at 在 schedule 时确定；公示边界 SCHEDULED 前是 guard 里程碑、后转承诺型）；**source/actor 全部服务端推导**（安全不变量，客户端永不提交 source）；残留清扫（§6/§9 提示语/§20 依赖与模块表/§22 revisions 仅本人/§24 scoped 措辞/M5 两段式措辞/(roleId,nodeId) 去重）；作废条目终态 voided(reason=item_voided)；巡检 quorum 按可达性公式。

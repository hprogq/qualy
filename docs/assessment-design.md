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
- **批次生命周期只有四步，且没有"激活"这个动作**（裁决 §32.43）：`草稿 →(为首阶段排期/直接开始) 待开始 →(首阶段实际进入) 进行中 →(末阶段进行中 + 管理员归档) 已归档 →(凭事由重新开启 + 新阶段) 进行中`。存储仍是 `draft|active|archived` 三值,**「待开始」是派生的**（`active` 且 `current_phase_id is null`),中文一律说草稿/待开始/进行中/已归档,**不出现"激活"**。可逆性边界:**任一 phase 曾 `actual_entry_at != null`,批次永不回草稿**;取消首阶段排期(且无任何实际进入)= 释放尚未兑现的承诺,回草稿并丢弃名单快照;**删除只针对从未开始的草稿**(配置而已,不是任何人的历史),已跑过的一律归档不删除;**归档普通流程不可逆**,要继续只能**向前重新开启**。「有没有用户访问过」不作为删除判据——访问不是可靠的领域事实,判据是**有没有产生业务事实**。
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

- **创建批次时**同步生成（裁决 §32.45 再次提前；单条 `INSERT…SELECT`，EXISTS 于 scope 节点集合的并集 + 用户类型过滤，事务内完成，不上队列；嵌套选择已在写入时拒绝，子树两两不相交）——与访问授权基线同一个事务：草稿期两者都可检查，改动 scope 或人员类型则重新绘制；首次排期只校验与推进状态，不再初始化任何东西（裁决 §32.45 取代 §32.43 的「首次排期冻结」）。
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

**两种授权来源，不是一种**（§32.46）：**RBAC 权限目录**（`./permissions`，`Access.permissions` 上车）只收「因职责被委托去操作别人或共享资源」的能力；**参评人操作码**（`PARTICIPANT_ACTION_CODES`，不进目录、不可被任何角色授予）是「对自己的东西做什么」，资格来自在花名册里。两者共用一套 code 命名，因为阶段开关（`permissionProfile`）管的是「此刻开放哪些业务操作」，它不关心某个操作的资格来自角色还是花名册。

**权限目录**（`./permissions` 纯常量，`Access.permissions` 上车）：

| code                           | phaseControlled | 说明                                                                    |
| ------------------------------ | --------------- | ----------------------------------------------------------------------- |
| assessment.batch.manage        | ×               | 批次/阶段/题目/花名册管理（org-scope）                                  |
| assessment.batch.force-advance | ×               | 强制切换阶段（必填理由）                                                |
| assessment.publication.manage  | ×               | 公示全生命周期（含 retract，理由必填）                                  |
| assessment.entry.proxy         | ✓               | **代录**：替学生提交其本可自提的材料（subject=学生，走正常审核链，§13） |
| assessment.entry.record        | ✓               | **行政认定**：扣分与特殊加分，trusted 直接生效不走审核（§13）           |
| assessment.entry.resubmit      | ✓               | 对**终态条目**发起新一轮（申诉窗内即申诉轮，§15）                       |
| assessment.review.process      | ✓               | 审核链动作（approve/reject/escalate/投票）                              |
| assessment.review.reopen       | ✓               | 工作组主动复查：对已定结果开 staff 轮，直达链条终点（§15）              |
| assessment.result.view-peers   | ✓               | 看他人公示（≠ 看排名）                                                  |
| assessment.ranking.view        | ✓               | 看排名                                                                  |

**参评人操作码**（不在上表，也不在 RBAC 目录里）：`assessment.entry.create / edit / submit / withdraw` 与 `assessment.result.view-self`。
前四个受阶段开关控制，`result.view-self` 不受控（任何阶段都可进成绩页，页面内容随状态变化：预览→S1→S2）。

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

## 23. 导航、URL 与页面（2026-08-11 定案）

### 23.1 全站导航(2026-08-12 修订,裁决 §32.44)

~~左侧一根常驻侧边栏~~作废。顶部一排**应用**,进入一个批次才出现工作区:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Qualy   测评   工作台   资源库   组织与权限              🔔   张三   │
└──────────────────────────────────────────────────────────────────────┘
```

| 应用       | 路径            | 里面                                                            |
| ---------- | --------------- | --------------------------------------------------------------- |
| 测评       | `/assessment`   | 有权访问的批次列表,进入某个批次即进入工作区                     |
| 工作台     | `/workbench`    | 跨批次的「我现在有什么事」:待我审核、我的待办、通知(未建)       |
| 资源库     | `/resources`    | 政策 / 题型 / 阶段模板 / 时间线模板——创建一次、多批次复用(未建) |
| 组织与权限 | `/organization` | 组织架构 / 用户管理 / 角色管理 / 用户类型                       |

应用下面一行是**该应用的分区**(小字横排,只在多于一个分区时出现);**没有常驻侧边栏**。
「资源库」而不是「配置中心」:政策、题型、模板都是**可下放权限的业务资产**,不是系统配置;
「组织与权限」独立成应用,因为它是平台身份与授权基础设施,与业务资产不是一回事。
真正的系统设置(站点、邮件、认证、存储、插件)进头像菜单,不占一级 Tab。

**进入批次后切换为工作区**:同一排应用不动,下面出现上下文栏与导航栏——

```
← 全部测评   2026—2027 学年综合素质测评   进行中          [归档]
─────────────┬────────────────────────────────────────────────
概览         │
个人         │              页面内容
  我的填报   │
  结果公示   │
  我的申诉   │
工作         │
  填报进度   │
  审核工作   │
管理         │
  阶段安排   │
  参评名单   │
  公示管理   │
  批次设置   │
```

三层职责不重叠:**顶栏 = 我在哪个应用;上下文栏 = 我在操作哪个批次;导航栏 = 这个批次能做什么**。
按权限整组消失:学生只有「概览 + 个人」,审核员多一条「审核工作」,管理员才看见「管理」。
**已建**:管理 → 阶段安排、参评名单;其余不预留占位。

### 23.2 URL

批次进入后不占用左侧三级导航,改用页面内的批次子导航:

| 路径                                           | 状态 | 内容                              |
| ---------------------------------------------- | ---- | --------------------------------- |
| `/assessment/batches`                          | 已建 | 批次列表                          |
| `/assessment/batches/:batchId`                 | 已建 | 重定向到第一个分区(现为 phases)   |
| `/assessment/batches/:batchId/overview`        | 未建 | 概览(将成为重定向目标)            |
| `/assessment/batches/:batchId/phases`          | 已建 | 阶段安排                          |
| `/assessment/batches/:batchId/participants`    | 已建 | 参评人员(名单,偏静态)             |
| `/assessment/batches/:batchId/publications`    | 未建 | 公示管理                          |
| `/assessment/batches/:batchId/settings`        | 未建 | 批次设置                          |
| `/assessment/templates/phases`                 | 未建 | 阶段模板                          |
| `/assessment/templates/timelines`              | 未建 | 时间线模板                        |
| `/assessment/submissions`                      | 未建 | 填报管理(按权限自动限定范围)      |
| `/assessment/submissions/:submissionId`        | 未建 | 某人的填报(代填也在这里,按权限)   |
| `/assessment/reviews`                          | 未建 | 审核工作台(填报审核 + 申诉审核)   |
| `/assessment/reviews/:reviewId`                | 未建 | 单条审核,页面结构统一、动作按类型 |
| `/assessment/my/submissions[/:batchId]`        | 未建 | 我的填报                          |
| `/assessment/my/publications[/:publicationId]` | 未建 | 结果公示                          |
| `/assessment/my/appeals[/:appealId]`           | 未建 | 我的申诉                          |

**participants 与 submissions 不得混**:前者配置「哪些人属于这个批次」,后者管理「这些人实际填到什么状态」。

**页面宽度分三档**(`PageContainer` size):`default` 读与填(表单、摘要)、`wide` 横向对比
(表格、计划、队列)、`full` 占满(树、画布、分栏)。壳不替页面决定宽度——1600px 的表单读不回行首,
1100px 的名单白白折行。

**审核工作台不拆两个入口**:普通审核与申诉审核在同一页,用顶部筛选区分(`?kind=`),
页面主体高度复用,业务类型只决定可用动作。

### 23.3 什么进 URL

> 值得刷新后恢复、值得复制给别人、值得后退键恢复的状态,才进 URL。

- **path** = 我在哪个资源 / 哪个功能里(批次、分区、单条审核)
- **query** = 我怎么看这个资源(搜索、筛选、排序、分页、跨页跳转带的 `?batch=`)
- **不进 URL** = 编辑模式、排期对话框、开放操作抽屉——它们是未提交的本地事务,
  刷新后草稿已经不在,恢复一个 `editing=true` 毫无意义

批次概览里的「填报完成率 82% [查看填报情况]」直接跳 `/assessment/submissions?batch=:batchId`,
「待审核 37 [处理审核]」直接跳 `/assessment/reviews?batch=:batchId`——跨入口跳转靠 query 带批次,
不靠再复制一层路径层级。

### 23.4 页面内容基准

| 页面         | 内容                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 批次概览     | 审核状态 4231/4250 · 待处理 14 · 疑点 5 → [运行发布前检查];填报完成率与待审数各自可跳转                                                                                       |
| 学生填报中心 | 派生时间线 + 三大类分组的题目卡(题名 / 当前计入分 / 组上限 / 条目状态汇总 / 新增入口)                                                                                         |
| 条目编辑     | 条目列表 + schema 驱动表单;条目卡统一解剖:状态徽章 / Revision 摘要 / 分值 / 审核到哪级 / 附件 / 时间线 / 动作区                                                               |
| 审核详情     | 左:原始材料与当前结果;右:申请人、流程、历史;底部动作条按类型给出(填报审核 通过/驳回/补充,申诉审核 维持/修改/补充)                                                             |
| 我的结果     | **核心产品页**:品德 13.2/15 → 教师评价 7.5、献血 +1、教官 +2、国旗班 +2、组合封顶 −1……逐行可解释;公示后切 S1/S2 视图。大量真实申诉源于"不知道为什么算成这样",此页做透申诉减半 |

体验红线:用户永远看到**业务流程**而非内部状态机——"第一次成绩公示:待定"而不是"管理员尚未创建公示"。
管理员配置的一切文案(题名、说明、选项 label)i18n 上是 literal;系统文案(状态徽章、动作名)走插件 message catalog。

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

**M1 — Batch + Phase + Roster + 三层授权（运行时骨架）**

交付：§9–§11 全部,按 §32 的后续裁决为准 —— 批次 CRUD 与 daterange;阶段序列/模板/`phase_events`(+`processed_at`);**队列武装模型与 effectivePhase 时钟判定**(时间形态已按 §32.34 收敛为「有时间 / 没有时间」两态,`entry_trigger` 与 offset/estimated 三列不落地);`phase_item_scopes` / `phase_participant_scopes` 与插入阶段;配置事件日志;调度 fiber;**创建批次即生成花名册与接受边界**(§32.45,取代「首次排期时冻结」与 diff 面板);`permissions.ts`(RBAC 权限声明 + `PARTICIPANT_ACTION_CODES` + `PHASE_GATED` 同文件,§32.46);三层授权 `authorizeEntryAction`(权威 → 阶段闸门 → 资源策略,资源策略在 M1 是空槽);结构化拒因;只读业务时间线(§32.50);批次工作区页(总览/阶段安排/参评名单/人员权限/批次设置)。不做 Entry/附件/复杂审核/计分/公示。

验收:① 模板建批次,阶段编辑器只显示受控权限;② scheduled 到点自动切换且幂等(重扫无重复事件),actual 写 planned 值、`processed_at` 另记;③ 改未来 planned 成功并审计,改 actual 被拒;④ manual/force 切换落审计带 reason;⑤ 创建批次单 SQL 生成花名册;草稿期可增删改名单并从 0 人补到可启动;移出不删数据(§32.47),重新加入恢复同一行并刷新锚点,`batch_participant_events` 留下 included/excluded/readmitted 三态历史;组织变化不使 roster 漂移;⑥ 权限矩阵逐格验证(预填报可 edit 不可 submit;审核整理关提交、review 继续;**归档期所有 PHASE_GATED 写动作全拒**,且归档会清空 current phase 投影、为未来日期重开的批次在新阶段真正进入前无任何阶段生效);⑦ `createTestContext` 覆盖 gate 判定与切换幂等;⑧ **队头武装**:manual 边界之后的 scheduled 到点不自燃,硬计划越过 manual 被拒;⑨ **effectivePhase**:物化延迟不影响 gate 判定(时钟说了算);⑩ scoped 阶段:范围外 entry 动作拒绝且拒因可辨,review 不受限。

**M1 的敌意验收**(全部有回归测试,§32.52):⑪ 被移出名单的人五个参评动作全部在**权威层**拒(`not-participant`),重新加入后恢复;⑫ 直接调 `addStaff` 用「只允许老师」的角色给学生、把「只允许班级」的角色挂在学院、使用 `assignable=false` 的角色,三者全拒;⑬ 空花名册的批次对无 `assessment.batch.manage` 的人不可见、不可读;⑭ 已排期但尚未真正进入首个阶段的批次,参评人看不到;⑮ 被撤销/过期的工作人员分配立即失去批次可见性(接受记录仍在,读取权不在)。

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

**32.38 编辑模型与存储模型分离：段视图 + 共享边界**（2026-08-10，用户对时间线编辑器填写体验批评后裁决，两轮外部审计意见收敛）。存储模型（阶段只存入口、区间派生、下一阶段的 entry 即上一阶段的 end——空隙与重叠结构性不可表达）**保持不动**；错的是 s6 编辑器把它原样端给了管理员——想表达"填报期 9 月 5 日截止"必须去"审核期"里填"9 月 5 日开始"，想表达"审核期截止待定"必须心算出"创建一个手动开始的下一阶段"。裁决三条：① **编辑层以"段 + 共享边界"为规范**：段=阶段自身（名称、开放操作、范围），边界=同一个切换点，同时是上一段的结束与下一段的开始。**共享是编辑约束，不是显示约束**（首版把边界只渲染在两卡之间，导致读一个阶段的起止要上下找、且信息与控件交织）：每张段卡**并排显示自己的开始与结束**（外加持续时长与开放项数），两个单元格指向同一个切换点、同时高亮；编辑一律在右栏检查器里发生，左栏只读——检查器另有独立滚动，二十余条权限不再顶掉整个计划视图。词汇表用管理员语言四选一——定时 / 顺延 / 人工确认 / 随成绩公示（原 trigger 三态 × 时间两模式收敛为四种切换方式），"待定"由此消灭了跳脱思维。② **投影是纯函数、且是两层之间唯一通道**（src/client/plan-model.ts，往返恒等有测试钉死）：boundaryViewOf / withBoundary 双向翻译，编辑器永不直接触碰 entryTrigger/plannedEntryAt/entryOffset/estimatedEntryAt；不加 end_at 列，不产生双源真相。③ **草稿改为整线本地编辑、一次保存**：putPhases 本就是整案替换/外科 diff，前端此前"单段侧板逐个提交"是保存粒度与编辑粒度错位；现在增删段、改边界、改权限全部本地，粘性保存条一次提交，服务端 refusals 按 phaseId/index 下沉到对应段卡旁；进行中批次的锁定（已入口边界锁死、已有阶段切换方式不可变、只能在当前之后插入）画成不可改而非提交后才被拒。时间线模板仍是服务端整案应用（本地填充会丢 source_template_id 溯源，见 §14"应用=复制并记录"）；拖拽与按比例时间轴明确不做（时间形态混合 absolute/offset/manual/publication，不存在稳定的像素→时间映射），触发条件记 §27。

**32.39 编辑层规范收敛为"行三元组 + 结束规则"**（2026-08-10，用户提出单栏行式设计并附两份外部审计，逐条裁决后落地）。§32.38 的段视图保留但形态改单栏：**每行 = 阶段名 + [开始][时长][结束]**，三格中**只有"结束规则"是被编写的**，另两格是投影——首行的"开始"是全线唯一独立字段，其余行的"开始"= 上一行的"结束"（同一切换点，点任一格打开同一面板，面板开在两行之间）；"时长"仅当结束规则为"持续时长"时可编（此时它才是权威），否则是两端相减的算术。**结束规则四选一显式声明**（固定时间 / 持续时长 / 手动结束 / 随成绩公示），~~改时长即静默把 fixed 改写为 offset~~否决：**存的是承诺语义而非当前可算出的结果**——"9月6日截止"上游怎么动都不动（fixed），"申诉期 3 天"随发布时刻漂移（offset），二者业务含义不同，切换必须是显式动作。四规则 ↔ 存储映射（`plan-model.ts` 独家持有）：固定时间→下一阶段 scheduled+planned；持续时长→下一阶段 scheduled+entryOffset；手动结束→下一阶段 manual；随成绩公示→下一阶段 publication。**~~"缩短结束时间制造暂态空隙、要求插入新阶段"~~否决**（用户原设想）：空隙可表达则重叠亦可表达，草稿的非法状态空间翻倍且需两套消解动作，与存储层"空隙结构性不可表达"的哲学相悖；改为**常驻插入缝**（每两行之间，hover 显现"+ 在此插入阶段"），新阶段带 `[未设置]` 是**未完成的表单**而非非法结构。**~~保存按钮抖动/变 X/Sonner 报错~~否决**：抖动只能表达"有问题"不能表达"哪里有问题"，且与 prefers-reduced-motion 冲突；改为**错误锚定字段**——客户端便宜校验（名称空、定时结束未设时间）不发请求、展开出问题的那一行、该格红边、行内出句子、保存条改说"暂时无法保存：还有 N 项需要处理"。存储/engine/api/scheduler 依旧零改动。

**32.41 Phase 退回三职责：删除 offset / trigger / 公示绑定，排期形成连续前缀**（2026-08-11，用户提出后与审计定案，docs/phase-redesign.md 全文）。Phase 只负责「批次当前处于什么业务状态、这个状态允许做什么、何时进入下一个状态」，不再充当所有领域事件的中央编排器。四条删除：① **`entry_offset` 整体移除**——没有「学校工作日历」这个一等领域对象，"+3 个工作日"只是看起来自动化，遇到国庆/寒暑假/调休必然错；法规上的"公示后 3 个工作日内申诉"记在业务配置里，本批次的实际截止由管理员排成明确 datetime。② **`entry_trigger` 移除**——`planned_entry_at != null` 即已排期、`null` 即待排期，没有第三种答案；"实际为什么进入"是事实记录（phase_events）不是配置。③ **`opens_publication_id` 与 publication trigger 移除**——语义方向反了：真实世界是"公示生效 → 系统因此进入申诉阶段"，不是"申诉阶段等一个 publication 打开自己"；将来由 Publication 侧可选地指向目标 Phase（`PhaseScheduling` capability，ownership metadata 存在排期记录里，Batch Core 不认识 Publication），Publication 的可读性归 Publication 自己，Phase 只管当前允许什么动作。④ **`estimated_entry_at` 移除**，改为 **`description`**（阶段说明，纯文本，面向管理员与参与者，驱动任何逻辑均否）。**核心不变量（连续排期前缀）**：任意时刻计划都是「已进入前缀 + 已排期前缀 + 未排期后缀」；只能给第一个未排期阶段排期（`schedule-out-of-order`），只能从最后一个已排期阶段收回（`unschedule-not-from-tail`），已排期阶段的结构冻结（`scheduled-phase-immutable`），未排期后缀可自由增删改序。**"结束时间"彻底离开模型**：`endOf(phase[i]) = startOf(phase[i+1])` 只是展示投影，不可编辑，前端的 duration/end 互推编辑器整体删除。**模板**：阶段模板只存名称/说明/开放操作，时间线模板只存有序的阶段序列；应用 = **追加到计划末尾**（不再整体替换、不碰已有阶段），文案从"应用时间线模板"改为"从模板添加"。**激活不再校验时间**：结构齐备即可激活，排期在激活之后逐个进行；`current_phase_id` 为空的批次对参与者不可见（归档后的可见性另由 history policy 决定，不用 `currentPhase == null` 永久裁决）。API 新增 `PUT /assessment/batches/{batchId}/phases/{phaseId}/schedule`（幂等子资源，`plannedEntryAt: iso | null`），`putPhases` 收敛为纯结构写。~~`phase_schedules` 独立表与 owner metadata~~ 留待 Publication 插件落地时一并建（数据层冻结规则：复杂度必须由已发生的问题证明其存在，当前没有任何外部 owner）。

**32.34 第四轮其余采纳汇总**（2026-08-09）。排名两口径（ties 仅在要求物化 rank 时 blocker、S1 默认 rank NULL；partition 祖先查冻结 lineage 禁查 live）；retire 历史引用语义（禁新增引用+入口隐藏，已引用读取永久有效，物理删除非 v1）；时间语义统一（锚的语义时刻一旦确定即可物化——SCHEDULED 的 publish_at 在 schedule 时确定；公示边界 SCHEDULED 前是 guard 里程碑、后转承诺型）；**source/actor 全部服务端推导**（安全不变量，客户端永不提交 source）；残留清扫（§6/§9 提示语/§20 依赖与模块表/§22 revisions 仅本人/§24 scoped 措辞/M5 两段式措辞/(roleId,nodeId) 去重）；作废条目终态 voided(reason=item_voided)；巡检 quorum 按可达性公式。

**32.42 导航收敛为四个二级入口,批次分区改子路由**(2026-08-11,用户提出后与审计定案,§23 全文)。左侧一级只有「综合测评」,二级四个:**测评管理**(批次管理 / 阶段模板 / 时间线模板)、**填报管理**、**审核工作台**、**我的测评**(我的填报 / 结果公示 / 我的申诉),二级带图标、三级是纯链接。三条命名裁决:①「审核工作台」而非「审核工作」;②**普通审核与申诉审核合并为一个入口**,顶部筛选区分,页面结构统一、业务类型只决定可用动作;③「填报管理」(我负责范围内大家填得怎么样)与批次内「参评人员」(哪些人属于这个批次)是两件事,不得混。**公示管理不进左侧**——它天然属于某个批次,从批次内进入。**批次分区改 path 子路由**:~~`?batch=<id>` + Tabs 本地 state~~作废,改为 `/assessment/batches/:batchId/{overview,phases,participants,publications,settings}`,裸 id 重定向到第一个分区(overview 未建前为 phases);分区是批次的子资源页面,不是「Tab 状态写进 URL」。**URL 分工**:path = 我在哪个资源/功能里,query = 我怎么看这个资源(搜索、筛选、排序、分页,以及跨入口跳转带的 `?batch=`);**编辑模式、排期对话框、开放操作抽屉不进 URL**——未提交的本地事务,刷新后草稿已不在,恢复一个 `editing=true` 毫无意义。**不预留占位入口**:未建的页面不声明导航项,一条通向空页的链接比没有链接更糟;新页面落地时再各自向对应导航位与批次子路由贡献。

**32.43 批次生命周期简化:删除"激活"动作,首次排期即承诺,归档可凭事由重新开启**(2026-08-11,用户提问后与审计定案)。新 Phase 模型落地后,独立的「激活批次」已然多余——**它承担的校验与冻结语义整体并入「首次排期」**:给第一个阶段排期(或直接「立即开始」)时,同一事务里校验人员类型非空、计划非空,冻结 roster,批次转 `active`。管理员的心智因此从「先激活、再排期」两步收敛为一句「我把这个批次安排在 9 月 1 日开始」。**产品语言里删除"激活/未激活"**:`active` 作为存储值保留(不做无谓迁移),但中文一律说 **草稿 / 待开始 / 进行中 / 已归档**——"激活"是账号与许可证的词,不是综测批次的词;**「待开始」是派生态**(`active` 且 `current_phase_id is null`),不占数据库状态位。**可逆性边界三条**:① **取消首阶段排期 = 回草稿**(前提:任何 phase 都未曾 `actual_entry_at`),并丢弃尚未兑现的 roster 快照——不提供通用的"禁用"动作,真正的业务操作是"取消排期";② **任一 phase 曾实际进入,批次永不回草稿**(已产生历史事实);③ **删除只针对从未开始的草稿**——阶段、名称、说明、权限、套过的模板都只是配置,删掉不留垃圾历史;已跑过的一律归档而非删除。~~"有没有用户访问过"作为删除判据~~否决:访问不是可靠的领域事实(管理员预览/API GET/bot/加载失败/缓存都算吗),判据是**有没有产生业务事实**;何况没有当前阶段的批次对普通用户本就不可见。**归档 = 为末阶段划下终点**:`Phase[i] = [actual(i), actual(i+1))`,末阶段没有后继,所以 `[actual(last), archivedAt)` —— 因此**只有末阶段"已实际进入"才允许归档**(不是"已排期"),`archived_at` 由此成为区间的右端点而非一个可置空的旗标。**归档后可"重新开启"而非"取消归档"**:后者会诱导实现成 `archived_at = null`,从而抹掉"批次曾关闭两周"这段真实历史,并让末阶段被解释成一直运行至今;所以它是**一次新的生命周期事件**——新建 `batch_lifecycle_events(kind archived|reopened, occurred_at, actor_id, reason)`,append-only、无 actor 外键(记录活得比账号久),`reopened` 的 reason 由数据库 check 强制非空。**重新开启不复活旧阶段**:一律在时间线末尾**追加新阶段**(如"补充填报期"),与"阶段只向前追加"的模型一致,审计上也说得清"第一次填报与补充填报不是同一个业务时期";**重新开启不使旧结果失效**——旧公示与旧 ScoreRun 是当时真实发布过的历史版本,新流程可能产出修正版,但绝不回滚。**缓建**(触发条件记 §27):`BatchArchiveGuard` / `BatchReopenGuard` 贡献点(Publication「仍有待处理公示」、Appeal「仍有未结束申诉」各自贡献拒因,Core 聚合)——现在没有任何插件能贡献,按数据层冻结规则不做预防性建设;归档/重开的**当前**判据只有 Core 自己的那几条。API:`PUT /assessment/batches/{batchId}/status` 收敛为「归档」与「重新开启」两种载荷(后者必带 reason 与新阶段),新增 `DELETE /assessment/batches/{batchId}`;~~`PUT .../status {status:'active'}` 作为"激活"~~不再存在。

**32.44 壳按停留时长分成两个:应用壳与工作区壳**(2026-08-12,用户与审计长谈后定案,docs/ui-redesign.md 全文;§23.1 为结论)。~~单一 `admin-shell/v1` + 一根常驻左侧栏~~作废。它把两个不同的问题塞进同一根栏:「产品有哪些应用」与「我正在做的这件事能做什么」;后果是学生一路背着一根自己打不开任何页面的空侧栏,而管理员的批次功能与全局功能挤在同一层级里互相抢位置。改为按**停留时长**分:①**`app-shell/v1`**——顶部一排应用(测评 / 工作台 / 资源库 / 组织与权限),下面一行是当前应用的分区(小字横排,只在多于一个时出现),**没有常驻侧边栏**:三四个页面的应用不值得为它常年占一列;②**`workspace-shell/v1`**——同一排应用不动,下面是上下文栏(正在操作哪个批次)与导航栏(对它能做什么),进入批次才出现、离开就消失。三层职责因此不重叠:顶栏 = 我在哪个应用,上下文栏 = 我在操作哪个对象,导航栏 = 这个对象能做什么。**契约改名**:`admin-shell/v1` → `app-shell/v1`(连同它的 collection 与 slot 键)——学生读自己的成绩与管理员改配置在同一个壳里,叫 admin 是在悄悄替产品决定它是给谁用的。**两条新机制**(ui-composition.md 同步扩展):① workspace 导航条目的 path 带参数,由壳用当前路由的 params 填充,**填不出来的条目不渲染**(宁可缺,不可指向字面量 `:batchId`);② 上下文栏是 slot `workspace-shell/context`(cardinality one),壳不认识批次,由知道的插件贡献组件、组件自己从路由读参数。导航解析随之从「只认 primaryNavigation」推广为认 `navigationCollections` 列出的每一个导航面。**IA 定案**:四个应用;「资源库」取代「配置中心」(政策、题型、模板是可下放权限的业务资产,不是系统配置),「组织与权限」独立(平台身份与授权基础设施);真正的系统设置进头像菜单,不占一级 Tab。**URL 随之搬家**:`/admin/org|users|user-types|roles` → `/organization/tree|users|user-types|roles`。**页面宽度分三档**(`PageContainer`:default / wide / full),壳不替页面决定宽度。**未建的一律不建入口**:工作台、资源库、批次概览 / 公示管理 / 批次设置、个人与工作两组导航都只写在本文档里,等页面落地再各自贡献——一条通向空页的链接比没有链接更糟(§32.42 同则)。

**32.45 批次授权 = 接受边界:RBAC 通用资源范围 + 批次 Access Baseline**(2026-08-12,用户与审计定案,docs/batch-redesign.md 全文;取代同日早些时候的 direct-grant 草案)。**不做「批次角色」**:角色与角色分配始终是租户/组织层的通用 RBAC 概念,批次只维护自己「接受过什么」。三条链路:①**RBAC 增加通用资源范围**——`role_grants` 加 `resource_namespace/type/id` + `valid_from/valid_until/revoked_at`,插件可把一次分配限定在某个不透明对象(`assessment / batch / <uuid>`)上;RBAC **不认识批次**,没有 batchId 外键、没有 assessment 代码;**带资源范围的分配不参与任何通用判定**(`held` CTE 里 `resource_id is null`),否则「某批次的临时审核员」会变成全租户审核员;分配的 scope 不可原地修改(改 = 撤销 + 新建),否则把「2024级」改成「软件学院」会让旧批次静默扩权。②**Assessment 建 Access Baseline 三表**:`batch_access_sources`(接受了哪条分配,origin inherited|explicit)、`batch_access_source_permissions`(接受时的权限上限,一行一码)、`batch_access_denies`(**subject 级**,不是 source 级——一个人同时是辅导员与年级负责人时,管理员点「禁用审核」的预期就是两条来源都禁用)。③**有效权限**:`(分配当前仍携带的 ∩ 批次接受过的) − 批次 deny`,再 `∪ 花名册赋予参评人的`,再对 `PHASE_GATED` 的码 `∩ 当前阶段开放集`,最后过资源守卫。由此得到本轮最重要的安全性质:**租户收权实时生效,扩权必须显式同步**——撤角色、撤分配、撤权限立刻在所有批次生效;给角色新增权限、给人新分配角色,都**不会**进入已存在的批次,必须在批次里点「同步组织权限」并确认(preview 分三段:新增人员 / 新增权限 / 已失效——已失效只是告知,它早已生效)。**~~batch_direct_grants~~ 不做**:临时工作人员就是一条**限定在本批次的普通 RBAC 分配**,创建时同事务写入 baseline(origin=explicit)并快照当时的权限上限——即使是临时分配也要过接受边界,否则日后有人给共享的「审核员」角色加了公示管理,这个临时人员会突然获得。**委派防提权**:只能授出自己在该节点上持有的权限(`canAt`)、只能在自己管得到的节点上授权,且角色携带的权限必须**全部**属于批次可委派集合(`STAFF_CODES`),否则整条角色不可用——不静默丢弃越权的那几条。**物化时机整体提前到创建批次**(取代 §32.43 的「首次排期时冻结名单」):创建的同一个事务里生成花名册与 baseline,失败则整个批次不存在;草稿期两者都可检查,改动 scope 或人员类型则**重新绘制**;首次排期只做校验与状态推进,「立即开始」因此不再顺手初始化任何东西。**参评人不进 RBAC**:五百人乘五个权限就是两千五百行在重复同一件事,参评能力来自「在花名册里 + 人员类型」,同样受 PhaseGate 约束。词汇上批次内**不出现「角色」**:批次说的是「人员权限」与「接受」。

**32.46 参评人的操作不是 RBAC 权限**(2026-08-12,用户提出「角色设置里还能勾 entry.create,但勾了也没用」,长谈后定案)。~~给用户类型加权限表 `user_type_permissions`~~否决,~~把租户管理员从角色搬到用户类型~~否决:用户类型说的是「这个人是什么人」(学生/老师/临时用户),角色说的是「组织额外委托他承担什么职责」(租户管理员/辅导员/审核员/年级负责人/专业负责人/班长/学委),两者都不该再长出第三套权限聚合器;「管理员」显然是职责不是人的类型,一旦搬进类型,「某老师临时当管理员」「管理员还是不是老师」立刻无解。真正的病因是**把参评人自己的业务能力建模成了 RBAC 权限来源**:`assessment.entry.create` 挂在目录里,于是角色编辑器把它列出来、`setRolePermissions` 允许勾上、租户管理员按 `permission_mode='all-active'` 定义还自动持有——而 `authorizeEntryAction` 对这些码**根本不查角色**,只查「你在不在这个批次的花名册里」。同一个码被 RBAC 宣称「可以授予」,业务层却不承认这种授予来源,这是模型里的两种语义在打架。**裁决:这五个码离开 RBAC 目录**(`entry.create/edit/submit/withdraw`、`result.view-self`),改名 `PARTICIPANT_ACTION_CODES`,`Access.permissions` 不再收它们;角色编辑器因此自然不再列出(它本来就只渲染 `listPermissions()` 的目录),服务端 `setRolePermissions` 也自然拒绝——**不是前端藏起来而 API 仍可偷偷授予**。~~给 `PermissionDefinition` 加 `roleAssignable: false`~~否决:为五个码去污染整个 RBAC 契约,还要顺带处理 all-active、`hasPermission`、`getProfile`、角色完整性检查,不划算。**`PHASE_GATED_CODES` 原样保留**(横跨两类):阶段开关表达的是「此刻开放哪些操作」,与资格来源正交;阶段永远只能**关闭或开放一个主体本来就有资格做的动作,不能凭空赋权**——审核阶段写 `review.process` 不等于全租户都能审核。因此最终关系是 `有效动作 = (参评资格 ∪ 工作人员职责) ∩ 阶段开放集 ∩ 资源守卫`,与「并集后再与阶段求交」的直觉一致,只是参评那一半不再来自一个人为造出来的「学生角色」——五千名学生可以一个 RoleAssignment 都没有,系统照常运转。**拒因分层同步改名**:`ActionDecision.layer` 的 `'rbac'` → `'authority'`,参评人不在名单返回 `not-participant`,工作人员无权返回 `permission-not-held`——把花名册失败伪装成 RBAC 拒绝,会让读它的人去找一条永远不会存在的授权。**数据残留必须清**:迁移 `20260811225407_drop-participant-action-permissions.sql` 删掉 `role_permissions` 里引用这五个码的行与 `permissions` 里的码本身——留着不只是脏数据,`permission_mode='all-active'` 的租户管理员**按定义持有目录里的每一条**,不删就等于它仍在授权;附升级测试(建旧库形态、角色勾上该码、跑迁移、断言只剩该留的)。**产品语言**:`permissionProfile` 字段名与 DTO 暂不改(改名要动 migration/API/前端/测试而没有收益),但界面上说「开放操作」而非「权限」。

**32.47 移出不删数据;重新加入是同一段成员关系的恢复**(2026-08-12,用户提出「重新移入是否要清空数据」并附方案,采纳)。移出只是「这个人当前不再参与本批次」,不等于「这个人从未参与过」;把「移出」和「清数据」绑在一起,会让临时排除、误操作修正、等材料确认这些完全正常的动作变成不可逆。所以移出只做一件事:`batch_participants.status` 转 `excluded` 并记 `excluded_at / excluded_by / exclusion_reason`,条目、修订、审核、计分、公示一律原样保留;参评资格随之失效,他不能再新增或提交,但历史可查可审计。**重新加入恢复的是同一行**,不是新建一行——原实现只跳过 `status='active'` 的人,于是重新加入会撞上 `(tenant, batch, user)` 唯一索引直接失败;现在走 `on conflict ... do update ... where status <> 'active'`,同时把锚点快照刷新为此刻所在(重新接纳也是接纳,本轮从此刻起为他所站的位置负责)。**「重新开始填报」暂不实现**:它的正确语义是把旧条目作废/封存(voided/superseded,注明「参评人重新加入后重新填报」)而**不是 DELETE**,且要按数据成熟度分级——仅草稿可直接重来;已提交未终局须管理员操作并填写理由;已审核/已计分/已进入公示不提供普通重来,只能走撤销决定、补充填报、重开阶段等正式流程;已归档更不能清。条目表尚未落地(M3),现在建这套作废机制是为一张不存在的表建仓库。落地时的不变量先写在这里:**成员关系可以失效与恢复,业务事实不可物理抹除;所谓「重置」只能产生新的当前状态,不能删除旧状态**。UI 侧现在的承诺与此一致:移出前确认框明说「已填报的内容全部保留,日后可以重新加入」。
**32.48 失效是一次可以放下的消息,不是一条永久告示**(2026-08-12,用户报「组织侧撤销后,页面提示永远关不掉,模态框里也选不中」,当场定案)。批次接受边界记的是「本批次同意从这条分配里拿多少」(`batch_access_source_permissions` 的天花板);组织侧撤销后,有效权限按 `分配当前仍携带 ∩ 已接受` 立刻归零——**撤销确实早已生效**,但那张记着已经不存在的码的天花板还在,于是每次比对都重新算出一条 `lapsed`,提示条永远亮着,而它按设计又不可勾选(批准一件已经发生且不由自己决定的事是假的)。**裁决:同步操作顺手收回失效的天花板**——`applyAccessSync` 在同一个事务里删掉 lapsed 那几行 `batch_access_source_permissions`,天花板空掉的 source 行随之删除,返回 `{merged, cleared}`。这既让提示可以被放下,也让数据说真话:天花板留着意味着**日后组织侧把同一条权限再发回来时会不经确认自动流入**,而批次当初同意的是一条此后被收回的授权,再发一次是新的消息,应当重新确认——正是接受边界存在的理由。UI 上,当比对里只剩失效项时,模态框的主按钮从「接受变更」变成「清除失效记录」(空 accept 提交),toast 说「已清除失效记录」;既有待确认项时,收回是接受动作的附带效果,不额外问。回归测试断言同步后 `previewAccessSync` 的 `lapsedTotal` 归零。

**32.49 批次工作区侧栏的目标结构**(2026-08-12,用户给定,直接采纳)。批次内的侧栏按**读者的身份问的问题**分三段,而不是按功能模块分:

```
概览                    (不属于任何分段,batch 打开即落在这里)
个人   我的填报 / 结果公示 / 我的申诉
工作   填报进度 / 审核工作
管理   阶段安排 / 参评名单 / 人员权限 / 公示管理 / 批次设置
```

分段标题是**小字一级标题**(不可点击、不可折叠),条目是**带 icon 的二级标题**;暂不设三级标题,层级需求出现时再议。「概览」不进分段:它是批次打开时的落点,参评人、审核员与管理员都从这里进入,归入任何一段都会对另外两类人说错话。

**已实现的只有「概览」与「管理」段的四项**(阶段安排 `calendar-clock`、参评名单 `users`、人员权限 `shield-check`、批次设置 `settings`,概览 `layout-dashboard`);「个人」「工作」两段与「公示管理」尚无页面,**不预留空分段、不放占位条目** —— 空分段在 WorkspaceShell 里本来就会被过滤掉,占位条目则是对读者承诺一个不存在的地方。上表是这些页面落地时的归属表,不是当前界面。

icon 走**名字而不是组件**:导航条目声明 `icon: '<name>'`(契约里早有此字段,此前无人渲染),名字由布局插件的 `client/icons.tsx` 解析成 lucide 组件,未知名字画不出东西但条目照常可用。理由与 manifest 是数据这件事一致:条目要能在浏览器加载任何插件代码之前被画出来,而且整条侧栏应当是同一套图形,而不是各插件各自依赖的图标库的拼盘。

**32.50 流程的三种露出:概览一份完整只读时间线,业务页一条上下文,管理页一份可编辑计划**(2026-08-12,用户给定方案,采纳)。同一份阶段计划在三个地方以三种密度出现,职责不重叠:①**概览**——完整、只读、面向所有身份的业务时间线,位置在批次基本信息之后、统计卡片之前;②**阶段安排**——完整且可管理的计划(既有页面);③**其余业务页**(我的填报/审核工作/结果公示…)——顶部一条很薄的**阶段上下文条**,只回答「我此刻为什么能/不能做这件事」:当前阶段 + 本阶段何时让位 + 剩余时间 + 一个「查看完整流程」。业务页**不重复整条时间线**,完整流程按需从侧板打开。

**只读处不出现管理词汇**:没有排期的阶段就只显示名字,不写「未排期」;不出现 external owner、锁定、模板来源之类的字眼——那些是说给安排阶段的人听的,写在参评人面前只会让他去找一个不属于他的操作。「本阶段何时结束」取**下一阶段的开始时刻**(领域里阶段没有独立的结束时间,见 §7),因此最后一个阶段只说「进行中」。

**响应式是两种呈现而不是一种呈现转向**:≥1024px 主内容 + 右侧约 19rem 的**纵向时间线**(`sticky`,自身可滚动,阶段再多也不撑高页面);<1024px 改为顶部**横向 compact 时间线**(`overflow-x-auto` + `snap`,首屏自动把当前阶段滚到视口中央,当前节点更宽并带关键时间,其余只有名字与状态点)。断点按**布局能力**切(两栏还放不放得下),不按设备类型,iPad 竖屏因此走横向那一套。桌面的纵向条与手机的横向条是两个组件(`BatchFlow` / `BatchFlowStrip`),不是同一个组件旋转方向——前者信息完整、后者以当前阶段为中心。

**「查看完整流程」用 Sheet 不引入 Drawer**:交互形态与用户设想一致(桌面右侧拉出、手机底部弹出,均为临时查看而非常驻第三栏),但仓库已有基于 radix Dialog 的 Sheet 且支持 `side`,vaul 的 Drawer 只多买到拖拽关闭与顶部握把,代价是为一个面板引入第二套遮罩与焦点栈。要那个手感时再单独裁决。

**页面命名用「概览」而非「总览」**:这一页回答「此刻怎么样、我能做什么」,是一眼可读的当下切片;「总览」听起来像把全部内容汇总在一处,与它旁边就有「阶段安排」「参评名单」等分页的事实相矛盾。

**32.51 `entry_note`:阶段在等什么,只在它还没有时间的时候说**(2026-08-12,用户提出,采纳)。`batch_phases` 新增 `entry_note varchar(200) not null default ''`(迁移 `20260812123827_phase-entry-note.sql`),与既有的 `description` 分工不同:`description` 是「这个阶段是干什么的」,任何时候都成立;`entry_note` 是「为什么它现在还没有时间」(如「待学院审批名单后确定」),**一旦这个阶段被排上时间,后端就不再下发它**(`deriveTimeline` 里 `entry.kind === 'pending'` 才带上)——时间本身已经回答了那个问题,继续显示会让计划在解释一个它已经做完的决定。编辑入口在阶段详情面板(名称、用途之下),提示语明说「在本阶段确定时间之前,所有人都会看到这句话」。引擎侧新增 `note-entry` 编辑动作,与 `describe` 一样永远可编辑。

**只读时间线的呈现**(承 §32.50):纵向条目铺满右栏(名称一行、时间或等待说明一行,当前阶段有底色),节点悬停用 HoverCard 展示详情(状态、时刻、用途说明);移动端不再是一排卡片,而是**同一条时间线转 90°**——横线穿过节点标记,名字在标记下方居中,只有当前阶段多一行时间,横向滚动并 snap,首屏自动把当前阶段滚到中央。两端是同一套画法(线 + 标记 + 文字),不是两种控件。

**32.52 M1 收口的安全加固**(2026-08-13,外部源码审计逐条提出,全部采纳)。六处授权/生命周期缺口在 M1 收口时修掉,均补敌意回归测试:

① **参评资格只由 active 成员关系构成**。`participantByUser` 改名 `activeParticipantByUser` 并只返回 `status='active'` 的行:被移出的人在阶段开放 `entry.*` 时仍被权威层放行,与 §32.47「移出即失去参评资格、历史数据保留」直接冲突。历史查询是花名册的事,不是授权的事。

② **`createScopedAssignment` 执行与普通授权一致的结构性不变量**。资源范围只说明「授权在哪儿生效」,不改变「谁可以持有这个角色」:此前它只检查角色存在且 active,于是绕过 UI 直接调 `addStaff` 可以把「只允许老师」的角色给学生、把「只允许班级」的角色挂到年级、使用 owner 已下架(`assignable=false`)的角色。判定复用 grants 模块的 `eligible`(经 `assertEligible` 暴露),Assessment 继续负责「这个批次是否允许委派该角色」与「调用人是否有权委派到该范围」。

③ **归档关闭闸门,并且不会被重开复活**。`gateView` 从「draft 无闸门、archived 仍用末阶段 profile」改为**只有 active 批次有生效阶段**;归档同时把 `current_phase_id` 置空;为未来日期重开的批次,在新阶段真正进入前处于「阶段之间」——由 `lastArchivedAt` 与阶段的生效时刻比较判定,因为重开会保留归档前所有阶段的 actual 时刻,单看计划仍会算出旧阶段。重开新建的阶段现在走 `reviewInsertion` 与「计划时间必须在未来」的校验,不再直接 INSERT。

④ **批次可见性拆成三条独立路径**。原先一条谓词里「不存在超出我管辖范围的 active 参评人」对空花名册恒真,于是任何登录用户都能看到并被投影为 `manageable` 的空草稿批次;现在管理路径先要求调用人在该权限上确有权威(`tenantWide || anchors.length > 0`)。工作人员路径改为 join `role_grants` 复核授权仍然有效(未撤销、未过期)——接受记录按设计比分配活得久(§32.48),但读取权不该。参评人路径要求批次 active **且已真正进入某个阶段**:日程上写了日期不等于这一轮开始了。

⑤ **草稿期的花名册可以管理**。§32.45 把名单前移到创建批次的同一个事务,正是为了让人在首次排期前核对;而 guard 仍停留在旧模型「draft 无花名册」,导致创建出来的草稿只能看不能改,导入 0 人的批次除了删除没有出路。现在 draft 与 active 都允许,archived 只读(SCHEDULED 冻结留给 M5)。

⑥ **成员关系历史落表**。`batch_participant_events`(append-only,`included|excluded|readmitted` + actor + reason + occurredAt)记录进出;参评行本身仍是当前状态的唯一真相,不搞事件溯源。同时把「恢复」收敛到唯一的接纳路径:`setParticipantStatus(active)` 现在走 `insertParticipants` 的 upsert,与「添加人员」一样刷新锚点与用户类型快照(重新接纳也是接纳),不能被接纳的人(停用、无站位)不予恢复。

另有两处按 §32.14 与 §32.50 归位:`assessment.entry.resubmit` 从 RBAC 目录与 `STAFF_CODES` 移入 `PARTICIPANT_ACTION_CODES`(申请复议是参评人的动作,工作人员主动复查走 `review.reopen`);`deriveTimeline` 接受「是否在服务中」,归档的批次不再把末阶段标成 current。

**未纳入本轮**:`authorizeEntryAction` 的资源策略仍是空槽,这在 M1 是允许的(还没有 Entry);进入 M2 的第一件事是接上归属、Entry 状态与工作人员的组织范围——`entry.record/proxy` 必须校验目标参评人的冻结锚点落在提供该权限的分配范围内,否则「有 A 班权限的人可以操作 B 班学生」。

**32.53 M1 收口第二轮:管理边界与语义状态**(2026-08-13,第二次源码审计提出,全部采纳)。

① **批次拥有自己的管理边界**(`batch_management_anchors`,创建时从初始组织选择冻结)。上一轮只堵住了「完全没有 `assessment.batch.manage` 的人能看到空批次」,漏了**跨组织接管**:`withinReach` 与 `requireRosterReach` 在花名册为空时都退化成「在任意地方持有该权限」(`hasPermission` 的语义就是 tenantWide 或至少一个 anchor),于是 B 学院管理员可以拿走 A 学院的空草稿并往里加自己的人;全员被移出后同样复现。**不恢复 participant scope**(那会重造双重真相):锚点只回答「这一轮归谁管」,花名册仍是参与者的唯一真相;授权要求调用人**同时**覆盖管理锚点与当前花名册。迁移带数据步骤,从 `roster_imports` 里最早那条导入的 `org_node_ids` 回填(已删除的节点跳过——边界要对活节点判定,引用一个不存在的单位会把整轮锁死给所有人)。两者皆空的旧批次(理论上不存在)退回原来的「持有权限即可」,并在代码里写明这是历史形态的兜底。

② **一个语义状态,三处共用**。`effectivePhaseIndex(tenant, batch, plan, now)` 返回「当前阶段序号或 null」,gate、时间线与可见性都读它:draft 未开始、archived 已结束、为未来日期重开的批次在新阶段到达前**处于阶段之间**。相应地 `deriveTimeline` 的第三个参数从 boolean 改为 `number | null`——上一轮传 `running=false` 会把「下周才开始的新阶段」也标成 `ended`,而它显然还没发生;现在 null 表示「无当前」,已进入的算 ended、其余算 future。**参评人可见性改按时钟判定**(`coalesce(actual_entry_at, planned_entry_at) <= now()`,且晚于最近一次归档),不再读 `current_phase_id` 投影:投影由扫描器物化,09:00 到点而扫描器未跑的窗口里,阶段动作在语义上已经开放而批次却不可见,这正违反 M1 自己「物化延迟不改变 effectivePhase 语义」的不变量。**归档不再等于不可见**:归档是停止工作,不是收回「你参加过」——参评人对已归档批次保留读权(§18 要求多年后仍可还原历史)。

③ **`assessment.entry.resubmit` 的升级迁移补齐**(`20260812183000_drop-resubmit-permission.sql`)。它比其他参评动作晚一版离开 RBAC 目录,而 `20260811225407` 不含它;已提交的迁移不改,新增一条前向迁移,连同 `role_permissions`、`permissions`、以及批次已接受的 `batch_access_source_permissions` / `batch_access_denies` 一并清理。补「从上一形态升级」的测试(建旧库形态 → 跑迁移 → 断言四张表都干净)。

④ **工作人员的可见性即工作人员的权威**。`isStaff` 改为复用与 `BatchAuthority` 相同的算术:分配仍然有效(未撤销、未过期)、角色仍 active、**接受的天花板与角色当前携带的权限仍有交集**、且未被批次 deny。此前只检查「分配看起来还活着」,于是角色被摘光权限的人仍能读取批次元数据与时间线。

⑤ **scoped assignment 进入与普通授权相同的临界区**。上一轮补的 `assertEligible` 堵住了绕过,但检查与 INSERT 分处两次调用,理论上可与「停用角色 / 改 eligibility / 改用户类型」并发交错。现在整段收进 grants 模块的 `scoped()`,由同一个 `write()`(先锁租户再检查再写)串行化,与 `grant()` 同一条路。

回归测试:A/B 两个年级管理员争抢空批次(看不到、开不了、加不了人,本人可以);到点未物化时参评人可见且与 gate 一致;归档后参评人仍可读历史;未来日期重开的时间线是「旧 ended + 新 future + 无 current」;角色被摘光权限或被停用后工作人员失去可见性、恢复后回来。

**32.54 M1.1:接纳的唯一路径与两处一致性**(2026-08-13,第三份审计;其中三条已由 §32.53 覆盖,此处记未覆盖的部分)。

① **重新加入必须重新校验接纳者此刻的范围**(P0)。`addParticipants` 一直是对的(读当前站位 → `canAt(MANAGE, 站位)`),但 `setParticipantStatus(active)` 直接调 `insertParticipants`,而后者会从 `users.primary_org_node_id` 重新取位置并刷新冻结锚点——于是「A 班管理员移出某学生 → 学生转到 B 班 → A 班管理员点恢复」会把该学生按 B 班锚点重新接纳,而 A 班管理员对 B 班没有任何权限。**裁决:接纳只有一条路径** `admit(tenantId, batchId, userIds, as, reason?)`:逐人读当前站位、校验 enabled 与 `canAt`、写入、记事件,添加与恢复共用。并且**把授权过的位置写进 SQL**:`insertParticipants` 现在按 `(user_id, node_id)` 对 join `unnest(...)`,人若在检查与写入之间被移走,那一行根本不会落库——这也顺带关掉了审计指出的 check-then-use 窗口(锁批次锁不住 users 表)。

② **列表与详情必须给出同一个时间线状态**。`Assessment.timeline` 已按 §32.53 用 `effectivePhaseIndex`,而 `listBatches` 当时仍按 `row.status === 'active'` 传参,于是「归档后重开、新阶段排在下周」的批次在详情里是「旧 ended + 新 future」,在列表里旧阶段却仍是 current;草稿有计划时列表还会把它们标成 ended。现在列表额外取一次 `lastArchivedFor`(整页一条查询)并调用同一份判定 `effectiveIndexOf`;`deriveTimeline` 的第三参数从哨兵值改成 `number | null | undefined`(undefined = 问时钟,null = 无当前)。

③ **参评人分页游标的指纹漏了 `orgScope`**。`subtree` 查询发出的游标可以拿去继续 `self` 查询,导致漏行或重复。指纹补齐,STATUS 的旧描述随之作数。

④ **非法时刻在边界上被拒**。`setBatchStatus` 与 `addStaff` 原先直接 `Date.parse`,非法串变成 `NaN` 往下走;现在与 `schedulePhase` 一样走 `parseInstant`,两个端点的错误联合补上 `BadRequest`。(`isoDate` 只验形状、`2026-02-31` 这类不存在的日期仍能通过 schema——它落到 `daterange` 的构造上由数据库拒绝,视为已有防线,不额外加。)

⑤ **删除失效引用**:`db.ts` 里指向已删表 `batch_scope_nodes` 的 `inScope()` 与那段描述 diff 面板的注释、`errors.ts` 里 `batch_user_types` / `assessment_batches.scope_node_id` 的约束翻译。

**未采纳**:审计建议为 `current_phase_id`、`phase_participant_scopes`、`batch_participant_events` 补「两端属于同一批次」的复合外键。按 CLAUDE.md 的数据层冻结规则,新增机制必须由已发生的事故或需求触发,而跨批次引用从未发生过,写入路径也只有一条。此条记入触发表:M2 的 Entry/Revision 关系表若出现第二条写入路径,或一旦真的出现跨批次引用,即按此加固。

**32.55 M1.1 收尾:边界只认创建时那次,没有边界就 fail closed**(2026-08-13,第四份审计;其中「roster 写入的 TOCTOU」已由 §32.54 的「授权过的位置写进 SQL」关闭,此处记其余四条)。

① **管理锚点的回填只取最早一次导入**(新增 `20260813090000_management-anchors-from-first-import.sql`)。上一条回填读了批次的**全部** `roster_imports`,而那张表不只在创建时写——之后每次「从组织导入」都会再写一行。于是「为 A 学院创建、一个月后从 B 学院补导过人」的旧批次,升级后边界变成 A+B,而且因为边界是冻结的,B 的人全部移出后仍要求管理员同时握有 B 的权限。已提交的迁移不改,新增一条按 `distinct on (tenant_id, batch_id) order by occurred_at, id` 重建;创建后才存在的批次本来就在同一事务里写了自己的锚点,而它们最早的导入正是那次创建,所以重建对它们是恒等的。补升级测试(旧批次两条导入 A→B,升级后只剩 A)。

② **既无锚点又无花名册时 fail closed**。上一版退回 `hasPermission(MANAGE)`,而 org-node 权限的这个语义正是「在租户任意位置持有」,于是跨组织接管又回来了。裁决:这种「谁的都不是」的历史批次**只对租户级(tenantWide)权威开放**,scoped 管理员一律拒绝;可见性 SQL 同步加上「必须有锚点或有在册的人」的存在性条件。这不是理论状态——回填会跳过已被删除的节点,真实历史数据可以产生没有锚点的批次,所以它需要一条修复入口,而那条入口只能是租户管理员。

③ **删除组织节点对任何插件的外键都答 409**。`batch_management_anchors` 对 `org_nodes` 是 restrict,而 org 的 `nodeConstraints` 只认得 base 层那几个约束名,未知约束会变成 defect → 500。让 org 去硬编码 assessment 的约束名会把依赖方向倒过来,所以改成:**只在 `deleteNode` 这一处**,把「仍被引用」的 sqlstate 泛化为 `ORG_NODE_IN_USE`——`23001`(RESTRICT)与 `23503`(NO ACTION)两个都认(实测 RESTRICT 报的是 23001)。判定读的是整棵 cause 树(`failedWith`),因为未命名约束到这里时已经是 defect。测试在 org 套件里现建一张「上层插件的表」引用节点,断言删除答 409 而不是 500。**产品政策明确**:只要历史批次还在,它的管理锚点所指的组织节点就不能删除;这是有意的(边界必须指向活节点,§32.53),要让节点可退役需要改成存 path 快照,不在 M1 范围。

④ **「待开始 / 进行中」不再读物化投影**。服务端已按语义状态判定可见性与闸门,但 DTO 仍下发 `current_phase_id` 这一列,前端 `standingOf` 据此着色——于是 09:00 已到、扫描器未跑的窗口里,学生能看到批次、能执行开放的动作,列表却把它标成「待开始」。裁决:`readDetail` 与 `listBatches` 都改为**下发派生出来的当前阶段**(`effectivePhaseIndex` / `effectiveIndexOf`),`current_phase_id` 列继续只做投影、永不出服务端。前端不动,因为它读的字段现在说的是真话。

**32.56 资格与历史读取是两件事;日期在边界上就要是真日期**(2026-08-13,第四份审计的两条低优先项,均采纳)。

① **`excluded` 收回的是资格,不是「你参加过」这件事**。此前 `isParticipant` 要求 `status = 'active'`,于是被移出的人连自己参加过、已归档的那一轮都读不到。§32.47 只说过移出不删数据,没有明说本人还能不能读,这里补齐裁决:**成员关系行的存在 = 曾经参加,`active` = 此刻的资格**。可见性按前者,`authorizeEntryAction` 的权威层按后者(`activeParticipantByUser`)。因此被移出的人仍能打开那一轮、看到自己当时的材料与结论,但任何写动作在权威层被拒(`not-participant`)。这条现在就定,不留给 M2 写 Entry ACL 时隐式决定:M2 的资源策略只需在此基础上加「这条 Entry 是不是他的」,而不必重新回答「他还算不算这一轮的人」。

② **`isoDate` 校验真实日期**。原来只验形状(`^\d{4}-\d{2}-\d{2}$`),`2026-02-31` 一路走到 postgres,由数据库以 `QueryFailed` 拒绝——那是 500,而它显然是 400。现在加一条往返校验(`new Date(...).toISOString().slice(0,10)` 必须等于原串),闰年也一并管住(`2024-02-29` 通过,`2025-02-29` 拒绝)。契约测试直接解码 schema,不写 HTTP 用例——请求会先被鉴权挡下,响应说明不了 schema 的事。

**32.61 一个批次一张卷:最外层分组就是卷面,它的封顶就是满分**(2026-08-15,按设计稿裁决)。

原先分组树允许多个顶层分组,「本轮满分」无处安放——只能由「各顶层封顶之和」隐式推出,而这个和
既非约束也无人校验。现在:

- **批次与卷面一一对应**:`parentGroupId = null` 的分组有且只有一个,即卷面本身;
  `replaceScoreGroups` 拒绝第二个(`one-paper-only`)。所有分段与题目都在它内部,层数不限。
- **满分 = 卷面的 cap**,保底 = 卷面的 floor,名称 = 卷面的 name。计分语义完全不变(§32.59 的
  `raw / final / total` 照旧),只是 `total` 现在等于卷面这一个根的 `final`,内部各分段的封顶
  之和是否等于满分成为**可核对的事实**而非隐含约定。
- **卷面不自动创建**:新批次的题目配置页先给出「起一张卷」的空态(命名 + 满分,或先不定满分),
  建好之后才有结构可编排。已有批次若存在多个顶层分组,读取照常,但下一次保存会被拒绝,需先把
  它们收进同一张卷。
- 配套的界面裁决:左侧树删除,结构改为**单张表**(编号 1 / 1.1 / 2.2.1 + 缩进 + 层级引导线,
  任意层数同构);题目详情从侧栏改为**整页**(基本信息 / 填报字段 / 计分 / 审核链条竖排,
  右栏为参评人员界面预览)。

**32.60 题目有发布态:生于 draft,发布才被问出口,发布后只作废不删除**(2026-08-15,用户裁决)。

原先题目一经创建即 `active`,于是管理员在配置页按下「新增题目」的那一刻,一道尚未配置任何字段、
分值与审核链的题就已经出现在参评人员的填报页上。用户判定这不可接受。

- `assessment_items.status` 由两态扩为三态:**`draft` → `active` → `voided`**,列默认改为 `draft`
  (迁移 `20260814224400_item-draft-status.sql`);`chk_assessment_items_void_state_shape` 的
  非作废分支相应改写为 `status <> 'voided'`(既覆盖草稿,又避开 IN 列表在内省往返里被渲染成
  畸形 `ARRAY[...][]` 的上游缺陷)。
- **发布 = `draft → active`**,与「作废后恢复」共用同一个幂等子资源 `PUT /assessment/items/{id}/status`
  (§API 纪律:状态用幂等子资源替换,禁止动作段);`setItemLifecycle` 的 CAS 由单一 from 值改为
  from 集合(`voided` 只能来自 `active`;`active` 可来自 `draft` 或 `voided`),两种来源在审计里
  分别记为 `publishedItem` 与 `restoredItem`。
- **草稿对参评人员不存在**:`listItems` 对无管理权的读者过滤掉草稿;填报、编辑、提交与附件上传
  本就要求 `status = 'active'`,自动继承;**计分器整条跳过草稿**——从未问出口的题不是「记 0 分」,
  而是根本不在账目里(与作废题不同,后者对有历史的人显示为 0 分行)。
- **删除规则从批次移到题目**:未发布的题在任何批次里都可删除(它没有产生过任何事实);已发布的题
  永远只能作废,拒绝码由 `batch-not-draft` 改为 `item-published`。原「draft 批次只删不作废」的
  affordance 保留(草稿批次里的已发布题仍可删,前提是零条目),因此这条是**增量放开而非收紧**。

**32.59 ScoreGroup 是树,结构真相只有 `parentGroupId`;封顶自内向外结算**(2026-08-13,用户裁决)。

真实校规是分层封顶(体育 ≤4 在文体 ≤10 之内),平级分组表达不了,这是模型缺口而非界面问题。定案:

- **结构真相唯一**:`score_groups.parent_group_id`(adjacency list),**不引入 ltree**。org 树的访问
  模式是大量祖先/子树查询,ltree 合适;分数树是**节点极少、整体读进内存、频繁编辑与移动**的小树,
  一次拖拽在 parentId 下是改一行、在 materialized path 下是重写整棵子树。不并存两套权威结构。
- **数据库保证**:批次内复合外键 `(tenant_id, batch_id, parent_group_id) → (tenant_id, batch_id, id)`
  - `unique (tenant_id, batch_id, id)`(对话 2 已建),`on delete restrict`——删除有子组的分组必须
    由业务层先要求移走,不做隐式级联。
- **环由服务层拒绝**(FK 不管环):替换写入时整棵提交树内校验(父在本批次、父非自身、无环),
  scorer 另有一道防线,遇环按 defect 抛出而不是算出一个数。
- **item 只能直属一个分组**;分组可以**同时**有直属 item 与子分组。
- **递归语义冻结**:`raw(group) = Σ 直属 item 分 + Σ child.final`,`final = clamp(raw, floor, cap)`,
  `total = Σ root.final`。封顶自内向外结算——顺序反了会静默丢掉一层限制。Breakdown 逐组给出
  `itemsTotal / childrenTotal / raw / final` 与 `parentGroupId / depth`,不做递归 wire 类型
  (客户端一行重建树,而递归 schema 不是一行)。
- 层数不设硬上限(已被"一层不够"打过脸),但 UI 建议不超过三四层。

**32.64 那条路线叫升级（escalation），不叫疑点**（2026-08-16，用户裁决）。

命名裁决，语义不变。「疑点」把这件事说成「发现了当事人的问题」，带调查取证意味；「上报」又像行政层级汇报。
实际语义是：**当前审核人无法作出判断，于是把事项交给另一个决策机制**——工作流领域里这就是 escalation。

- **中文 UI**：提请复核 / 复核流程（与「常规审核」并列的短标签用「复核」）。
- **英文 UI**：Escalate for review / Escalation route。
- **代码与存储**：`escalation`。`ReviewRoute = 'normal' | 'escalation'`，
  `ReviewDecision` 的 `raise-doubt` → `escalate`，事件 kind `doubt-raised` → `escalated`
  （**与拆分之前的历史事件同名，两者本来就是同一件事**），
  阶段动作码 `assessment.review.raise-doubt` → `assessment.review.escalate`。
- **迁移只改被查询读的值**：`review_instances.current_route`、`review_events.route`、
  `review_events.kind`、`batch_phases.permission_profile` 与 `phase_templates.phases` 里的动作码。
  **不改** `review_instances.effective_chain` 与 item revision 的 `reviewPolicy`——它们按规矩不可变，
  读取侧同时认 `doubt` 与 `escalation`，用的正是已经在读「一张单子加一个 marker」那版的同一个接缝。
- 顺带取消 `doubt` 与 `escalated` 两个事件 kind 并存的局面:此后只有 `escalated`。

三个概念此后不要混为一谈（现在只实现第一个，其余出现真实需求再说）：
材料看不明白、无法判断 → **复核**；材料可能不真实或前后不一致 → 核查；
多人对规则解释有分歧 → 裁定。

**32.63 申诉是一轮走疑点链、只有链尾能驳回的审核；阶段开关是四个独立动作**（2026-08-16，用户裁决）。

不做两套审核状态机。同一个 Review 引擎、三类独立动作、两种 ReviewInstance 行为模式。

一、**阶段控制四个动作，任意组合，不引入「阶段类型」枚举**。
`assessment.entry.submit`（普通提交）、`assessment.entry.resubmit`（界面叫「申诉」）、
`assessment.review.process`（处理审核）、`assessment.review.raise-doubt`（**新增**，审核人把拿不准的
转入疑点审核）。补报期可以同时开普通提交与申诉；申诉期通常只开申诉与处理审核。
`raise-doubt` **不是 RBAC 权限**：谁有资格处理当前节点已经由 `review.process` + 节点/角色决定了，
再加一条可授予的权限等于让管理员给每个审核角色维护两份几乎相同的勾选，且「可授予」会暗示它能
让不是审核人的人变成审核人。它与参评动作同类——只有当事人才有资格做，但阶段可以临时关闭。

二、**中途驳回归阶段动作管，`rejectPolicy` 从领域模型移除**（2026-08-20 重裁，替代本条原文；
**同日再裁并作废**：`assessment.review.reject-intermediate` 阶段动作整体撤销，中途驳回改由复核链
自身的裁决语义承载——中间节点的「退回」是随轮上提的意见而非终局，终局否定只属链尾，见 §32.66）。
本条保留仅作沿革：`review_instances.reject_policy` 列已随迁移删除
（20260820095421_drop-reject-policy.sql）。

三、**普通提交与申诉是两个接口、两个 domain command，底层共用一套开轮逻辑**。

```
submitEntry  ──┐
               ├─→ 同一套开轮：解析策略、冻结路线、arrival check、写事件
appealReview ──┘
```

普通提交固定 `origin='initial' / route='normal'`；申诉固定 `origin='appeal' / route='doubt'`。
**这两组不给管理员配**：能配出「叫申诉但第一级就能打回」或「普通提交却只有链尾能驳回」的组合，
是在制造本业务没有定义的流程。

四、**申诉锚定被申诉的那次审核结果，不是锚定 Entry**。
`POST /assessment/review/instances/:instanceId/appeals`，要求目标轮次 `completed` 且
`outcome ∈ {approved, rejected}`。一个 Entry 可能有好几轮已结束的审核，「我不服」必须说清不服哪一次。
新轮 `revisionId` 与被申诉轮相同（**申诉的是结论，不是材料**），并记 `appealedInstanceId`。
（此列本可以延后，但端点存在的理由就是把「不服哪次」写下来，不存等于白要这个参数。）

五、**同一 Entry 同时只能有一轮开着**。阶段同时开放普通提交与申诉 ≠ 同一条申报能两路并行。
数据库的 partial unique index 本来就这么约束（`active`/`blocked` 都算 open），保留。
被驳回后用户二选一：**改材料重新提交**（走 normal），或**不改材料申诉这次结论**（走 doubt）。
界面给两个按钮，不给一个「重新提交」让系统猜。

六、**疑点链是一条真正的审核链，取消 recommend/forward 词汇**。
中间节点「通过」就等于「本级无异议，转下一节点」，不必再发明第二套词。
决策集合收敛为：

```
normal：approve / reject / comment（+ raise-doubt，若阶段开着且疑点链有可进入的步骤）
doubt + any-stage：   approve / reject / comment
doubt + terminal-only：中间 approve / comment；链尾 approve / reject / comment
```

`ReviewDecision` 因此只剩 `approve | reject | raise-doubt | comment`。

七、**提出疑点仍在同一轮里**，不新开 round：那还是「同一次审核中换处理路线」，
不是对已成结论的复查。`Round #2` 留给申诉、重新提交、管理员复查这类正式新一轮。

八、**不设疑点次数硬上限**。「每天最多 10 条」是很差的审核规则：它逼审核员在第 11 条上
要么替自己不确定的事做决定、要么等明天，并制造「今天名额不多，这条算了」的博弈——
在一个决定奖学金的系统里这是错误的激励。治理靠三条：
①**提出疑点必须写理由**（现有「除 approve 外都必填 comment」已覆盖）；
②**一轮最多转一次疑点**（状态机天然保证：进入 doubt 后就没有 raise-doubt 这个动作）；
③**统计与异常提示**——「王某 审核 112 条、疑点 8 条、7.1%；李某 审核 93 条、疑点 41 条、44.1% ⚠」。
真正要问的不是「他提了多少条」，而是「相对他处理的量，他是不是异常地把责任往上推」。
软阈值（如处理满 20 条后疑点率 >30% 告警）与真出问题后的
`per-reviewer-per-phase` 上限（**不是每日**，窗口要与业务周期一致，且超限走「管理员确认」
而不是 403）都留到有实际事故再说，触发表见 notes/data-layer-retrospective.md 的元规则。

**32.62 配置改了，已有条目怎么办由管理员当场决定；疑点链与普通链彻底分家**（2026-08-15，用户裁决）。

推翻两处原有语义。**第一处**：此前「配置版本不可变、旧提交引用旧版本」是全部答案——管理员改完题目，
在途与已通过的条目一律沿用旧配置，管理员没有任何手段作用于它们。方向不变（历史永远按旧版本解释），
缺的是**配置变更如何作用于既有业务对象**这一层显式迁移机制。**第二处**：§14 把疑点链定义为普通链在
`normalTerminal` 之后的后缀，现在改为两条互不重叠的链。

一、**三个版本引用分开**。`AssessmentItemRevision` 一张表不拆，继续同时保存 form/scoring/review 三份配置；
分开的是谁引用它：`EntryRevision.itemRevisionId` =「这个人当时按什么表单填的」；
`ReviewInstance.policyRevisionId` =「这一轮按哪版审核政策走」；`AssessmentItem.currentRevisionId` =
「现在新填、新开的审核轮该用哪版」。**新开一轮审核取当前策略版本，不取被审 EntryRevision 当年那版**——
内容没变就没有理由强迫内容换版本，而管理员改审核链正是为了让新的轮次走新链。

二、**字段与审核步骤都有永久身份**。字段 = `id`（不变、不复用）+ `key`（payload 槽位，同样不可改）；
改类型视为删旧字段 + 建新字段（新 id 新 key）。审核步骤 `PolicyStage.id` 同理。身份不变 = 修改，
身份不同 = 替换——这是在途审核能否自动迁到新链的唯一判据，**禁止按数组下标迁移**。
写在旧版本里、没有身份的字段与步骤，以它们当时的标识（字段的 key、步骤的下标）确定性派生身份，
**不回写历史**：item revision 不可变，一段后来长出字段的历史不是历史。

三、**保存不再硬拒绝，改为影响分析 + 显式传播**。`issuesOf()` 拿新表单直接 decode 旧 payload、
一条不兼容就禁止保存的做法取消。读旧 payload 前先按字段身份**投影**到新表单（驱动的 `projectPayload`），
于是删字段、换顺序、改 label、加可选字段一律无影响；只有真正读不通的才进影响报告。
保存分两次同一个 PATCH：第一次不带 `effects`，安全就直接存，需要决定就 409 带影响报告返回；
第二次带上管理员的选择与 `impactToken`（第一次分析结果的哈希，期间有条目状态变化就重新报告）。
`expectedRevisionId` 一并引入（Item 此前没有乐观并发，score group 有）。
**表单与审核链是两个独立选择，不得合并成一个「应用新配置」。**
表单：在途/已通过各自「继续」或「打回」；审核链：「仅新轮次」/「仅迁移 BLOCKED」/「迁移全部在途」。
同一条条目两者都命中时，**打回优先于迁移**（既然要重填，新提交自然走新链）。
`scoringConfig` 不进这套选项——它仍是当前规则的全局计分语义（要 reason，不打回、不迁移），
正式 ScoreRun 时再单独定义计分快照，否则这次改动会从审核治理扩成计分版本治理。

四、**打回不是驳回**。新增条目状态 `needs_revision`（界面「待补充材料」）与 `EntryEvent`
（`revision-required` 等，记 old/new item revision 与配置变更 id）。理由：`approved → needs_revision`
时已经没有 open ReviewInstance，只 UPDATE 状态会在历史里留一段无法解释的变化；而把它记成 `rejected`
会让「驳回率」统计吃进管理员的配置调整。

五、**在途审核的迁移是新开一轮，不是覆盖快照**。旧实例 `outcome='superseded'` 收尾，新实例
`origin='reroute'`、`supersedesInstanceId` 指回去、`revisionId` 不变、`policyRevisionId` 指新版本。
当前 stage 的 id 在新策略里仍在就从同一步继续（正是「这一级没人所以回来改这一级」的场景）；
id 不在了**不许猜**，影响报告点名，管理员在「保持旧链」与「从新链起点重来」之间选。
`UPDATE review_instances SET effective_chain = ...` 是被禁止的写法——它毁掉「当时为什么走到这里」。

六、**疑点链独立**。`reviewPolicy` 升为 `{version: 2, normal: {stages}, doubt: {stages}}`，
`normalTerminal` 删除。普通审核任一级可「提交疑点」（`escalate` 更名 `raise-doubt`），
路线切到 `doubt[0]`；疑点链中间级只建议、链尾作最终决定（这条约束不变）。
**申诉直接新开一轮、只走疑点链**（`origin='appeal'`、`route='doubt'`、`policyRevisionId` 取当前版本），
不再「越过 normalTerminal 沿同一条链继续」。ADR-2「审核中的不确定」与「学生申诉」概念分立由此回到实现：
**存储仍统一为 review round（§15 不变），路线分离**。
`ReviewInstance` 随之改为 `effectivePolicy`（同一份冻结 lineage 一次解析出 normal + doubt 两条）
\+ `currentRoute` + `currentStageId`，去掉 `mode` / `currentStageIndex` / `effectiveChain`；
`ReviewEvent` 补 `route` / `stageId`，否则 reroute 之后「哪一级审过」无从回答。

七、**BLOCKED 是运行态，不是终态**（已实现）。`cancelReviewInstance` 只认 `active`，导致
「本级暂无审核人，等待中」的条目学生撤不回、也没有审核人能推进——死锁。开放集合与
`uq_review_instances_open`（`active`/`blocked` 都算 open）对齐。
管理员另有独立的干预口（`return-for-revision` / `reroute`，权限用 `assessment.batch.manage`），
**不得让管理员冒充审核人点驳回**——`decideReview()` 要求调用者真是当前 stage 的审核人，这条保留。

八、**`nearestRole` 找不到持有人必须 BLOCKED，不能跳过**。`resolveChain` 现在把它记成
`skipped: 'no-holder'`，而 `stageAt()` 跳过一切 `nodeId === null` 的步骤，与 ADR 0007「职位空缺应
BLOCKED」冲突。解析结果改为三态：`resolved` / `skip('no-such-level')` / `blocked('no-holder')`，
只有前者之外的 `no-such-level` 可跳过。（依赖 `current_node_id` 可空，随 Review v2 一起改。）

九、**巡检与配置迁移分工不混**：换届、离职、改任命 → patrol 自动 `active ↔ blocked`，不动 policy；
「应该由什么节点审」变了 → 显式 policy reroute。

施工顺序（每步可独立测试）：BLOCKED 撤回 → 字段/步骤永久身份 → ReviewPolicy v2 →
`ReviewInstance.policyRevisionId`/`currentStageId` → 提交取当前策略 → 影响分析器 →
`needs_revision`/`EntryEvent` → reroute 传播 → 编辑器影响弹窗。进度见 STATUS.md。

**32.58 成员资格看锚点,不看 coverage;`nearestRole` 才是"上级管下级"的表达**(2026-08-13,用户裁决)。

§14 与 §32.23 的"锚点精确匹配"曾被实现成 `org_node_id = 该节点 AND coverage = 'self'`。澄清:
**成员资格的判据只有锚点**——授权锚在解析出的那个节点上即为成员,coverage 取何值都不影响。§14
那句"subtree coverage 不参与成员资格"约束的是**向下延伸**(学院上的授予不因 subtree 而成为班级
stage 的成员),而"锚点相等"这一条本身已经挡住了它;多余的 `self` 条件只排除了"恰好锚在本节点、
但按默认值写成 subtree"的授予——那正是授权表单的默认值,等于让 stage 几乎无法配齐人。

需要"上级管下级"的场景由 **`nearestRole` selector** 表达(§14 明列,辅导员类角色):沿冻结 lineage
自下而上找第一个持有该角色的人,锚点在谁身上就落在哪一级,与 ltree 的子树语义一致。配置界面据此
提供两种步骤类型,不要求管理员理解 coverage。

**32.57 计分读的是"生效事实",不是"学生说了什么";M2 里两者暂时同一**(2026-08-13,第五份审计随对话 5 收口冻结;只记裁决,不建表、不加接口)。

概念链定案为四段:**学生声明(EntryRevision.payload)→ 审核认定 → 生效事实(effective facts)→ scorer**。"修改永远只有本人"(§7 / 上文 §13 交互)管的是**声明**——审核人永远不改学生写了什么,驳回附建议稿仍是唯一路径;它不应也不曾承诺"计分只能读声明原文"。将来落地 ReviewAdjudication(审核认定层:同一份声明,审核在通过时可附带"按认定口径计入"的结构化认定,例如日期口径、次数认定)时,改动**只发生在输入收集这一段**:`collectParticipantScoreInput()` 从"approved 声明原文"换成"approved 声明 ∘ 认定覆盖"后仍产出同形状的 effective facts;`calcParticipant(input) → Breakdown` 这个全系统唯一 scorer(§18)一行不动。

M2 当前的简化随之显式化:**effective facts = approved EntryRevision.payload,逐字**——没有认定层,通过即按原文计入,审核人对内容的一切意见走驳回。这条现在写下,是因为对话 6 就要开 scorer:输入收集与计分之间的这条边界(`collectParticipantScoreInput → calcParticipant → Breakdown`)在 M2 冻结,后续任何"审核认定/口径覆盖"都不得越过它去改 scorer 本体或往 calculator 里塞审核知识(审核决定不携带分值的禁令照旧,§7)。

**32.65 被驳回不是死路:原样重交、修改重交、放弃三条路;能力三态下发**(2026-08-16,用户与审计共同裁决)。

- **rejected 可原样重新提交**(同一 revision,新普通轮):驳回说的是「就这份材料,不行」,参评人有权答「请再看一次」。**needs_revision 不可原样重交**——那一轮要的就是不同的材料,只有新版本算回答(界面 blocked + 原因,不静默)。
- **放弃申报(abandon)**:draft / rejected / needs_revision 可由本人置 voided(EntryEvent `abandoned-by-submitter`),名额立即释放,历史(版本、轮次、意见)全部保留。~~in_review 须先撤回;approved 是已认定的计分事实,本人不得单方面撤销。放弃不受阶段门控~~(**已被 §32.69 取代**:in_review 与 approved 均可直接放弃,放弃改受阶段门控)。
- **能力三态**:entry 的 edit/submit/withdraw/appeal/abandon 一律下发 `{state: available|blocked|hidden, reason}`;hidden=此人此态无此动作,blocked=有此动作但此刻不开(界面 disabled+tooltip,reason 用刷新拒绝同一词表)。发现与判定同门:能力读取问的就是 act 要过的那道 phase gate,按钮亮=调用通。
- **驳回后修改 = draft(数据库真相),界面呈现「待重新提交」**(draft 且 currentReviewInstanceId 非空即是,不加新状态)。
- **maxEntries 语义不变**:它限制"同时持有多少件申报事实"(非 voided 计数),与"计几条分"无关。
- **历史按版本讲**:一轮审核属于它所判的那个版本;round 视图携带 `origin/supersedesInstanceId/appealedInstanceId`,rerouted/superseded/appealed/abandoned 各有人话,空说明不占行。

**已裁决**(①—⑥ 已实现,⑦ 待触发):①聚合器可解释化(`AggregationResult` 逐条 included/reason)+ `max@1`(学生干部"最高职务计分",terms.md 明文)+ `top-n-sum@1`;②"基础分"不做 ScoreGroup.base,建模为 `derived` Item(constant driver,scorer 增加非 Entry 的 ScoreContribution,带 provenance);③ reviewPolicy 增加显式 `mode:'none'`(无需审核,提交即 approved,严禁用空 stages 暗示);④ declaration 轻题型(零字段一键申报);⑤补件机制 `ReviewSupplementRequest/Response`(受限 requirement builder:仅文字+文件;ReviewInstance 增 `awaiting_supplement`;申诉与普通审核共用;原 revision 永不因补件改动;开放的补件请求本身即回答能力,不受后续阶段变化锁死);⑥ `assessment.entry.resubmit` 更名为申诉语义的代码(migration + 码表同步);⑦申诉收紧到首次公示后 + 申诉可配置补证策略(`reason-only|allow-supplement`)。边界一句话:**改"申报了什么"走退回修改;只补"凭什么信"走补件;申诉冻结原材料,只挑战结论**。

⑤ 落地口径(2026-08-16):`awaiting_supplement` 是**开放态**——占 entry 的唯一开放轮次槽位,进 hasOpenRound / 影响分析 / cancelReviewInstance 的开放集,但不进审核队列(inbox 只取 active),补件期间 decideReview 一律拒绝(`awaiting-supplement`)。一轮同时只有一个 open 请求(部分唯一索引),暂停轮次的状态翻转即并发闸门。**可回答性 = 请求 open ∧ 轮次仍在 awaiting_supplement**:轮次被撤回/重路由/作废时请求按定义随之失效,不需要任何清扫;回答只验"本人 + 请求开放 + 批次未归档",刻意不过阶段门。requirement key 由服务端按位次派发(`f1..fn`,≤8 项),文字 ≤2000 字、文件 ≤10 个;回答的附件绑定沿用申报的信任规则(自己的 staged 文件,或本 entry 故事——含历次 revision 与历次补件——已引用过的文件),附件读取授权把补件引用并入 citing 集。请求/取消归当前 stage 的任意审核人(与 decide 同一 mayReview 谓词、同一阶段门),事件 `supplement-requested / supplement-submitted / supplement-cancelled` 记在轮次上,请求说明以 comment 随事件入 trail。路径:`POST …/instances/{id}/supplement-requests`、`PUT …/supplement-requests/{id}/status`、`POST …/supplement-requests/{id}/responses`。

**32.66 复核链是逐级裁决链：任一环节可径直通过，终局否定只在链尾；同轮跨环节回避；合议席位冻结；环节命名**（2026-08-20，用户裁决）。

一、**两条路线是两台不同的机器**。普通链保持逐级确认语义不变。复核链重定义为**逐级裁决链**（用户原话：「复核链条里的任何节点都是有资格直接通过条目审核的，如果某个节点不通过，才沿链条往下走」，类比阅卷的问题卷→三审→专家组）。单人（`any`）环节的裁决表：

```
普通链  中间：approve→下一环节｜reject→终局驳回｜escalate→进入复核链（阶段门控）
普通链  末端：approve→终局通过｜reject→终局驳回｜escalate 同上
复核链  中间：approve→整轮终局通过｜reject→意见随轮上提（事件 opinion-rejected，非终局）｜escalate→上提
复核链  末端：approve/reject→终局；escalate 不可用（reason: route-end）
```

审核员的四个词（通过/退回/补材料/提复核）表达的是**个人判断**（reviewer disposition），系统把它映射为流转（workflow transition），审核员无须理解身处哪种机器。`assessment.review.reject-intermediate` 阶段动作撤销（§32.63 二作废）：「复核中间能否终局驳回」不再存在——中间的否定一律上提；若某校确需「中间一致否定即终局驳回」，将来作为**节点级政策**显式开放，触发再建。复核链内部的上提不受 `assessment.review.escalate` 阶段门控（该门只管普通链进入复核链）；申诉期即使关闭 escalate，申诉轮的中间环节仍可上提。ReviewActionView 的 reason 词表收敛为 `no-route | route-closed | phase-closed | route-end`。

二、**同轮跨环节回避（仅约束复核环节）**。同一 ReviewInstance 一旦进入复核，其每个复核环节不得由本轮先前已作出正式判断者担任（判定来源：本轮 events 中 kind ∈ approved/rejected/escalated/opinion-rejected 的 actor，加上本轮非 superseded panel 的 vote 投票人；一条 SQL 谓词并入 mayReview 组合，收件箱/详情/决定/巡检同源）。普通链**不回避**（保留现状：同一人可先后出现在普通链多个环节）。申诉与重路由是**新轮**，不继承上一轮的回避集——被申诉决定的作出者可以再任申诉裁决人（用户明确撤回了「不能终裁」的旧默认；「他此时是在什么审核职责下作出什么决定」才是问题，`route+stageId+actorId` 已足以区分两次判断）。自审回避（subject/revision actor）不变。

三、**到达裁决（enterStage/resolveArrival）**：进入复核环节时先问成员资格（members，组织占位+批次接纳），再问回避后余量（eligible）。members=0 是真实缺员——**永不跳过**，落位 blocked（`no-assignee`）；members>0 且 eligible=0 是回避规则生效——中间环节**跳过**（事件 `stage-skipped`，链视图标 `reviewer-conflict`），末端落位 blocked（`no-independent-reviewer`）。`review_instances.blocked_reason` 新列（`no-assignee | no-independent-reviewer | panel-seat-unfilled`，CHECK 与 state 同形），管理员告警按原因分行；审核员与学生永远看不到 BLOCKED 概念。appealReview 的入链走同一 resolver（补上了 ADR 0007 一直缺的自审跳过）。巡检升级为 panel-aware，继续双向自愈并维护 blocked_reason。

四、**合议（quorum `all`，仅限复核链非末端环节；校验 reason `policy-quorum-all-normal` / `policy-quorum-all-terminal`；`atLeast` 继续拒绝）**。到达即以当时的 eligible 集为席位快照（`review_panels/review_panel_assignments/review_votes` 三表，部分唯一索引守并发）：3 人被回避 1 即 2 人合议——**成立前资格冲突改变人数，成立后席位数永久冻结**。裁决规则 v1 由位置推导不落配置：全员同意 ⇒ 整轮通过（事件 `approved`，actor 为空，轮次自己的声音）；否则（含全员否定）⇒ 上提（事件 `escalated`，actor 空）。成员 escalate ⇒ 立即短路上提（未投的票作废）；成员 supplement ⇒ 整轮暂停，**取消**恢复原 panel 原票，**答复**（证据变更）则 supersede 旧 panel、按当下 eligible 重组、旧票留档不计。席位规则：未投票成员失权 ⇒ 席位空缺（`eligibility-lost`），新合格者**投票时原子补位**（不做系统指派）；已投的票**不因事后撤权失效**（权限回答「现在能否新作为」，不回答「过去合法作为还算不算」）；无空缺时新增角色持有者不入本案。投票在同席结论前对所有人保密（votes 不写事件，open panel 不入 DTO）；resolved panel 的逐人意见经 chain.stage.opinions 交给后续裁决人（辅导员读到两造意见）。decisionsToday = 正式事件 + 本人 votes（合议票无逐票事件，不能让上午审了三十件的人被问候「已处理 0」）。

五、**环节命名**。PolicyStage 增可选 `label`（非空 ≤50，校验 reason `policy-label-invalid`），编辑器必填（如「班委初审」「辅导员终审」），链视图以 label 为主、单位/角色组合为兜底与小字；旧策略无名仍可读。

六、**审核员 UX 原则（验收标准）**：任何新审核功能若要求普通审核员学习第五个流程概念，先认定设计有问题。合议/补位/席位/BLOCKED 只存在于引擎、审计与负责人诊断；审核员只见四个词与「出现在待审=需要你审」。复核模式用环境而非说明表达：工作台顶部细警示带（amber 斜纹）+「复核」徽标全宽度可见；申诉轮 banner 直接展示申诉理由（appealed 事件 comment——该给的是「为什么需要重判」这一业务事实，不是 origin 字段）。「本轮经过」用业务语言（含 stage-skipped、panel 结论的无主语句式）；panel 生命周期细节（谁补位、何时失权）只在数据表/审计层。

七、**明知并接受的边界**：①普通链自审冲突仍落 blocked 不跳过（ADR 0007 的中间跳过只在复核链落地；普通链等触发再议）；②合议限复核中间环节，末端与普通链不开（末端须一个终局声音）；③ `atLeast(n)` 与「最低有效复核人数」未建；④独立复核覆盖率预检（配置期提示「N 个专业复核人员与普通审核完全重合」）未建；⑤ blocked→active 依赖巡检分钟级收敛（实时校验保写路径正确，巡检保状态收敛）。以上各项按数据层冻结规则，事故或需求触发再建。

**32.67 填报的两道早拒:文件大小在选中那一刻拒,题目版本在写入之前比**(2026-08-21,用户裁决)。

原则一句话:**前端应尽早阻止一个已知不可能成功或语义已经过期的操作;服务端仍负责最终权威判断**。这一条同时管住两件此前都拖到「保存」才报错的事。

一、**附件大小/格式/数量在选中即拒**。管理员配置的 `maxFileBytes` 一直存在于 formConfig 并随 item 下发,只是浏览器侧 `EvidenceFieldSpec` 漏声明,于是「类型与数量前端拦、大小完全不拦」——超限文件会被完整上传,直到保存时由 bind 阶段以 `attachment-too-large` 拒绝,白白耗掉上行流量并让填报人多填一屏才知道。现在三层各司其职:①Dropzone primitive 拿到 `maxSize` 并新增结构化拒绝通道(`onRejected`,reason ∈ `too-large | type | too-many`,**只给 File 与理由码,不给句子**,primitive 保持零文案);②`take()` 在发 prepare 之前按 `maxFileBytes` 与剩余名额再核一次——UI 组件怎么实现不该成为「绝不会错误上传」的唯一保证,并顺带消灭 `files.slice(0, room)` 的静默截断(未添加的文件逐个点名);③上传区在选文件之前就写明支持格式(mime 归一为扩展名)、单文件上限与剩余数量。**服务端 bind 阶段的大小/类型校验原样保留**——浏览器给的 `file.size`/`declaredMime` 与 prepare 请求里的 size 都是客户端声明,权威判断只能在读 storage 真实 metadata 的那一层。`prepareAttachmentUpload` **暂不接收 fieldKey**:它不新增安全边界(bind 仍权威),诚实客户端的浪费已被第一层消灭,storage 自己还有部署级单文件上限与配额;真出现「靠反复上传大文件打存储」再加,那时可与 `expectedItemRevisionId` 一并传入,不存在「按哪个版本判断」的模糊。

二、**填报写入携带 `expectedItemRevisionId`,冲突即拒且不动用户已填内容**。此前 create/revise/setEntryStatus 都不告诉服务端「我填这份 payload 时看到的是哪一版题目」,服务端一律用**此刻最新** revision 解释 payload:管理员在填写期间加了必填字段,填报人会收到「获奖级别为必填项」而屏幕上根本没有这个字段;改了字段语义而结构不变时,更是不报任何错——**旧答案被当成新问题的回答**。锚点用已有的 ItemRevision,不新造 formVersion/schemaVersion 概念。三个写入端点各加可选 `expectedItemRevisionId`,服务端在 **decode payload 之前**比较,不一致即 `ASSESSMENT_ITEM_REVISION_CONFLICT`(409,带 `itemId` 与 `currentRevisionId`);**顺序是重点**——否则报出来的仍是「新字段未填写」而不是「你填写期间要求变了」。提交(setEntryStatus)也带,且带的是**页面当时展示的题目版本**而非草稿写入时的版本:去年 A 版存的草稿今天在 B 版页面上提交,expected 就是 B;若两个请求之间管理员又发了 C,才是真竞态。已有的「旧草稿提交时 projectPayload 到 live 再 decode」保护不变,它回答的是另一个问题(昨天的草稿今天还能不能提交)。**粒度先严格按 ItemRevision ID 比较**,即使只改了 reviewPolicy 也冲突——申报页展示的不只是表单字段,还有每条计多少分与审核流程,整个 ItemRevision 才是「用户作出这次填报决定时看到的规则快照」;真出现「只改后台审核链导致大量填写者冲突」再把令牌收窄成 participant-facing 指纹。

三、**冲突的界面是就地提示,不是刷新、不是自动迁移**。禁止 `location.reload()`,禁止后台把 payload 悄悄搬到新表单再继续保存。对话框**不关闭、不清空 state**,表单字段来自打开时的**题目快照**(页面在底下继续 refetch 也不会让表单在人答题时自己变形);冲突时就地出现一块提示(标题「填报要求已更新」/正文说明已填内容会保留/一个「查看最新要求」按钮),**位置在已填内容之上、不遮挡**,并滚动到视野内;两个保存键在读过之前禁用。按下「查看最新要求」才推进快照,按 field identity(`id ?? key`)迁移答案:同 identity 同 type 的照搬(键改名也跟着走),类型变了的不搬(同样的字符在日期与句子里不是一回事),新字段留空,旧字段不再问。代录页与我的申报抽屉的提交路径同样携带令牌;撤回与放弃不带——它们不是关于今天规则的决定。

**32.68 实时是失效通知,不是数据同步:SSE + PG LISTEN/NOTIFY + 进程内 PubSub,不引入 Redis**(2026-08-21,用户裁决)。

审核员正在认真写意见时条目被他人抢先裁决/被撤回/被改道,学生只能靠刷新得知审核进展——已到「该加实时」的程度。但不上 WebSocket:通信模型是纯单向(操作走既有 HTTP,服务端只需说「某处变了」),SSE 足够且与 TanStack Query 的 invalidate 模型天然契合。

一、**四层分工,权威不动**。①写入方在**同一事务内** `pg_notify`(PostgreSQL 在 COMMIT 后才投递、ROLLBACK 即丢弃——「先推送后提交读到旧数据」这类竞态从机制上不存在);②每进程**一条**专用 LISTEN 会话连接(LISTEN 是 session-scoped,严禁经池连接注册),经进程内 sliding PubSub 扇出给所有 SSE 连接——宁丢一个唤醒,不让慢消费者反压业务事务;③SSE 用 Effect v4 `HttpApiSchema.StreamSse` 的 typed 端点(`GET /assessment/batches/{batchId}/events`,Authenticated,浏览器经同一 typed client 得到 `Effect<Stream>`);④浏览器收到唤醒只做定向 invalidate,经既有授权端点重读权威状态。**事件不携带任何业务数据与资源 id**——纯 kind(sync/heartbeat/review-inbox-changed/review-instance-changed/entries-changed/item-changed/result-changed),不可能成为第二套 read model,也不可能泄露持有者本无权问到的东西;工作台收到 instance-changed 一律重读自己正开着的那条,他人条目的动静最多引起一次无害重读。

二、**依赖方向**:`plugin-database` 只出传输(`pgNotify` 骑事务连接的自由函数 + `DatabaseNotifications.listen` 专用会话流),不知道事件是什么;assessment 自有事件 schema、在自己的写入点 announce、自己过滤自己推;`web-runtime` 出通用 `useApiStream`(Effect 仍只在 runtime 运行,页面只构造)。**Redis 不引入**:它解决的是本方案没有的问题(持久回放、presence、跨 region),而事务耦合恰是 PG NOTIFY 比它强的地方;触发条件(PgBouncer 事务池化挡住 LISTEN、真实高扇出)记录于此,发生再议。

三、**best-effort 即正确**:连接建立先发 `sync`(LISTEN 注册与状态读取存在竞窗,重连期间丢失的一律用「重读」补偿,不做 Last-Event-ID/outbox/回放);25s 心跳防中间层掐线;断线降级为原轮询节奏(收件箱 30s、详情 15s,连上时放宽到 60s/关闭),窗口聚焦重读是全局兜底。反向代理需对 `text/event-stream` 关闭缓冲(typed 端点不发 no-transform 头,部署层职责)。

四、**实时绝不覆盖正在输入的东西**(产品红线)。审核工作台:详情从「成功」转为 `REVIEW_NOT_FOUND/REVIEW_CONFLICT` 且非本人刚裁决时,判定为「任务已易手」——**工作台原样保留**(绝不渲染成 404 空态),顶端琥珀横幅说明三种可能并给「前往下一条/返回待审核」,决定栏关闭,已写内容原地不动;5 秒撤回窗内的 pending 决定当场 `undo()` 并说明,不让它 5 秒后撞一个注定的 conflict。申报侧沿用 §32.67:表单持题目快照,实时刷新只作用于父页面查询,冲突提示仍由用户主动推进。「我的申报」工具栏加常驻手动刷新键——escape hatch,不是机制。

五、**连接期粗粒度授权**:开流时 `assertVisible` + `capabilitiesFor`(粗站位,刻意不随阶段抖动),按 review/personal/subjectUserId 过滤 kind;中途失权者在重连前只会继续听到裸唤醒,而每次唤醒触发的读取各自完整鉴权。巡检(patrol)v1 不发事件,由收件箱轮询兜底。

**32.69 撤回止于审核开始,放弃贯穿申报一生:两个动作、两条关闭时刻线**(2026-08-21,用户裁决)。

一、**「撤回审核」重定义**。withdraw = 把正在审核的申报拿回来继续修改(in_review → draft,取消当前轮)。它的窗口在**审核真正开始**的那一刻关闭——正式审核行为 = 本轮及其 `supersedes_instance_id` 承接谱系上的任一 `approved / rejected / escalated / opinion-rejected / supplement-requested` 事件,或任何 panel 投票(合议未出结论时票还没有事件,必须查票表);reroute 承接轮**不清零**该标志。以下不算开始:submitted、暂无审核人、系统跳过环节、单纯打开审核页。「提交即生成 ReviewInstance」不构成禁止条件——那等于提交后永不可撤。判定单源:`withdrawStandingsOf`(递归 CTE 沿承接谱系),capability 与写入路径同一条 SQL。**申诉轮一律不可 withdraw**:generic withdraw 会把已 approved/rejected 的条目经申诉轮洗成 draft(P0 域漏洞,已堵);「撤回申诉」应恢复被诉结论,是另一个未建的动作,建前申诉轮不提供撤回(capability hidden,写入 `appeal-not-withdrawable`)。

二、**「放弃申报」重裁(废 §32.65 三条旧句)**。approved 是审核结论,不是不可撤销的所有权锁:「学校认定它成立」与「本人本学期仍使用它」是两个事实。abandon 对 draft / rejected / needs_revision / **in_review / approved** 全开放:in_review 先把当前轮关成 cancelled(事件 `cancelled-by-submitter`)再置 voided;**approved 放弃绝不回改审核轮**——round 保持 completed/approved,entry 置 voided,计分层因「生效事实 = approved ∧ entry 未 voided」自然停止计入(封顶 4 分留材料到下学期是正当业务)。历史忠实并存:「审核通过了」与「后来放弃了」不矛盾。

三、**abandon 成为第七个 participant action code 并纳入阶段门控**:`assessment.entry.abandon` 进 `PARTICIPANT_ACTION_CODES` 与 `PHASE_GATED_CODES`(**不进** RBAC permission 目录——能否操作自己的申报来自参评身份,不是角色授予),creation family 同步(item/participant scope 约束它)。旧「放弃不受阶段门控」原则废弃:首次公示通常仍开放放弃(公示正是发现重复/超封顶/放错学期的整理窗口),最终公示关闭——用阶段配置表达,不写死阶段名。capability 三态照旧:资源态允许 ∧ 阶段开放 = available;阶段关闭 = blocked(`phase-closed`),按钮禁用而非消失。

四、**工作台失效语义从 gone(读不到)改为 lostTurn(不再是我的任务)**。旧判定漏掉管理员:轮次结束后管理员仍读得到,refetch 成功、页面静默刷成「已结束」。新判定 = 「本会话里它曾 `canDecide`」∧ 非本人刚裁决 ∧(refetch 转 NOT_FOUND/CONFLICT,或数据转终态且 canDecide 失去)。触发时:sonner 各按可知原因说话(outcome cancelled → 申报人已撤回;superseded → 流程已调整;其余 completed → 已由他人处理;读不到 → 泛化句),页内横幅常驻(对话框可能盖住 toast 也盖不住横幅),pending 决定当场 `undo()`;`may()` 与 stage 函数统一被 lostTurn 拦截(不靠服务器撞墙)。出路唯一且由人按:run 内有下一条 → 「继续审核下一条」,没有 → 「结束审核」;**不自动跳转**(审核员可能还有没提交的字),不跨项目乱跳。

五、**配套收口**:`expectedItemRevisionId` 校验收窄到 submit(管理员改配置不得让人连撤回/放弃都做不了);一键声明补传 revision token;`live` 只证明浏览器到进程这一跳,详情在 live 时仍保留 60s 轮询兜底(LISTEN 掉线期间丢失的唤醒靠轮询收敛);申报页四个查询按 live 降级轮询;EntryDialog 在父页面拿到新 revision 时立即标 stale(仍绝不热替换);历史里补充材料只由结构化问答卡讲一遍(`supplement-requested/submitted/cancelled` 三事件在展示层过滤);「第 X 轮审核完成」改「第 X 轮审核结束」(outcome 含 cancelled,"完成"读作有了结论)。

**32.70 审核环节是共享任务池;补件请求在等待期间只归发起人**(2026-08-21,用户裁决)。

普通审核阶段维持 pull/shared queue,不引入任务分配(`assignedReviewerId` 之类一概不建)。真正存在归属的不是 ReviewInstance,而是**这一次 SupplementRequest**——`requested_by` 列本就存在,零迁移。规则冻结为一句话:**审核环节采用共享任务池,不固定分配给个人;审核员发起补件后,该补件请求在等待期间仅由发起人负责——其他同级审核员不再持有该任务、不得撤销该请求、也不以 reviewer 身份读取该轮;申报人完成补件后,审核任务重新回到当前环节的共享任务池,由所有当时符合条件的审核员继续处理。批次管理员可按管理权限只读查看,但管理查看不产生任何审核操作能力。**

三个概念自此分立,不再共用一个 `mayActOn`:①stage membership(谁有资格从共享池拿);②supplement request ownership(等待期间谁负责这一问,`requestedBy` 单源,capability 与写入路径同查);③batch administrative visibility(`rosterReach` 管理查看,预期设计保留——排障/审计/reroute 需要它,但绝不携带审核能力)。落点:`awaitingPage` 的 open 分支只给发起人(answered 分支照旧给全池);`mayRead` 在 `awaiting_supplement` 态只承认发起人(同级同事的 refetch 转 `REVIEW_NOT_FOUND`,前端既有 lostTurn 机制自然接住并提示);`cancelSupplement` 先验 `requestedBy === userId`(拒绝码 `not-requester`)再验 `requireJudge`(两道都要:历史请求人失去审核资格后也不得再撤);管理员若需强制取消错误补件,那是未来带理由的管理干预,不复用审核员的撤销。工作台对无任何可执行动作的读者(管理查看、阶段关闭)显示一行只读说明,不再是无按钮之谜。SSE 事件流结束在访问日志降为 Debug(时长是连接寿命不是延迟)。

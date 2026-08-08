# Qualy 综合素质测评域 · 完整设计与实施规范

> 版本 2.1（合并定稿 + Formula 沙箱增补）· 2026-08-08 · 状态：**核心架构冻结，可按里程碑施工**
> 读者：在本仓库工作的 Claude Code。
> 本文档合并并取代此前两份综测设计文档；建议入库路径 `docs/assessment-design.md`，§7 的五条原则另抄一份进 `docs/adr/`。

该版本有部分纰漏，补充文档见 `docs/p2-tutorial-a-supplement-1.md`，请阅读本文件后阅读补充文件。

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
| 班长 / 学习委员 | 班级节点              | 大多数材料的第一级审核（normalTerminal）；代录代改本班条目              |
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
正式填报期      学生提交；班委代录；第一级审核并行进行
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
6. 第一次公示 S1 发布：张三 83.25。他对另一条**被驳回**的条目不服 → 对 S1 中该行发起 **AppealCase**（申诉指向不可变快照，不是实时条目）→ 走独立申诉链 → 辅导员 **CORRECT（更正原决定）**。
7. 第二次公示 S2：84.25，含年级排名。S1 原样保留——管理员可以解释"第一次 83.25 → 申诉更正 +1 → 第二次 84.25"。
8. 归档。三年后重新打印，看到的仍是当年的 Revision、审核事件与 S2，不重算。

## 5. 我们从哪里来：旧 Excel

此系统之前，整个流程靠一张班委手填的 Excel 横表：行 = 学生，列 = 各题字段，公式自动算总分；"避免重复加分"靠班委人工翻既往学期的旧表核对；填错格式靠"打回"。旧表教给我们的，分三类处理：

- **保留的便宜能力**：字段正则校验（活动名必须含届次/年份/"校赛"——直接消灭大半"打回"）、`enum_with_other`（佐证材料类型 A–G + 手动输入）、`event_pick`、班委代录（proxy）、管理员批量导入（import）、规范化 source_key（重复核对从人肉变成唯一约束）。
- **改变的交互**：学生自填为主，班委代录降级为兜底（M7 提供致敬旧表的批量网格视图）。
- **明确推迟的旧机制**：跨学期补录补差、累计限额、月度小结平均、自定义公式沙箱——旧表里存在 ≠ 新细则需要，等真实需求触发（§27）。

## 6. 为什么不能做成普通 CRUD

八个决定架构的业务特征：① 校规统一但院系细则不同（驱动+配置）；② 不同材料审核路线完全不同（受限审核链）；③ 审核人取决于学生的组织位置（锚点解析）；④ 材料会被本人/班委/管理员修改，必须完整审计（不可变 Revision）；⑤ 第一次公示后允许申诉，公示结果必须永久可追溯（不可变 Publication）；⑥ 分数有分组、封顶、取最高、查表、计数分档（纯函数计分 + ScoreGroup 树）；⑦ 数据来源混合：学生填报 / 教师评价 / 成绩库 / 寝室系统（interaction: entry|task|derived）；⑧ 批次持续数周，期间换届、转组织，历史业务不能漂移（快照结构 + 实时身份）。

核心问题一句话：**把一个长周期、多角色、多规则、可申诉、必须可审计的评价流程，建模成稳定的业务系统**——既不能退化成 CRUD，也不许膨胀成 BPMN / 低代码平台 / 万能规则引擎。

---

# 第二部分 · 冻结的架构决策

## 7. 五条 ADR（写入 docs/adr）

**ADR-1 正式公示永远是不可变快照。** 系统只有两类成绩：实时预览（provisional，随审核/撤回/评分/更正不断变化）与正式公示（released，immutable）。学生申诉必须能指着"第一次公示中的这一行"；因此 S1 永不原地改成 S2，申诉更正产生新输入、生成 S2，S1 原样保留。只有完整、通过 preflight、由 READY 的 ScoreRun 支撑的快照才可进入 SCHEDULED；SCHEDULED 存续期间一切影响其输入的写操作被拒绝（先取消预告）。不存在"动态正式公示"。

**ADR-2 审核中的"不确定"与学生"申诉"是两个工作流。** 审核员点"不确定，向上提审"= Review Escalation，走主链的疑点延伸段，动作词汇是 通过/驳回/上提；学生对已公示结果或既有决定的异议 = Appeal，独立 AppealCase 与 AppealPolicy，终局动作词汇是 **维持原决定 / 更正原决定 / 上提复核**。数据库、状态机、权限点全部分开，绝不因"看起来都是向上走"而混成一套。

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
├── Publication(preliminary) ── AppealCase[]（指向 S1 的行/决定）
├── Publication(final)
└── Archive（引用终版，只读打印）
```

## 9. Batch 与 Roster

**AssessmentBatch**：`name, description_md, scope_node(+path 快照), material_range(daterange), timezone(默认 'Asia/Shanghai'), status(draft|active|archived), config_revision, current_phase_id(投影)`。

- **材料日期用 `daterange` 左闭右开**（`[2026-03-01, 2026-09-01)`）：证书只有日期没有时间，彻底避开 23:59:59.999 与时区噪音。daterange 自定义类型**仿照 org 插件 `src/db/ltree.ts` 先例**实现。题型可继续缩窄：合法日期 = `batch.material_range ∩ item.dateConstraint`。阶段等流程时间一律 `timestamptz`，按 batch.timezone 展示。
- scope 为单一子树；v1 不做不连续多 scope。description_md 是管理员业务数据，i18n 上属 **literal**，不进 message catalog。
- **配置冻结规则**（服务层强制）：无提交时题目/审核链/计分/组树自由改；出现提交后冻结，修改必须走 `BatchConfigRevision`（revision+1、理由、影响面确认：受影响学生数、需重算），审计留痕；阶段计划时间与说明文本任何时候可改但审计；材料范围修改前做 impact check（列出将越界的既有条目）。

**BatchParticipant**：`batch_id, user_id(唯一对), assessment_anchor_node_id, anchor_path(ltree 快照), user_type_id, status(active|excluded), included_at, excluded_at?`。

- 批次激活时**同步生成**（单条 `INSERT…SELECT` 按 scope 子树 + 用户类型过滤，事务内完成，不上队列）。
- **锚点是一切审核解析的唯一起点**；不从用户实时全部 membership 推断。本系统单归属，无多锚裁决；未来出现双学位等歧义在 enrollment 层解决，禁止改 org 全局约束。
- **永不自动增删**：组织树变化后提供差异面板（新迁入/已迁出/锚点变更），管理员决定是否应用；"填报截止前自动纳入新迁入"可作低风险开关。已迁出者置 `excluded` 保留全部历史（Entry/Review/Score/Publication/Appeal 的业务归属不能悬空）；显式移出时管理员当场决定其条目去向。锚点变更只影响此后新提交条目的路由，在途条目保持已快照的链。
- **实时组织树与 roster 的差异不是公示 blocker**——快照的意义就是隔离漂移。只有真正的 roster 完整性问题才 block：participant 缺 anchor、重复行、管理员已明确要求纳入但未裁决的新生。
- 花名册是一切的分母：计分迭代对象、评价任务完整性基准、公示覆盖范围。无任何提交的学生也在计分与公示中（基础分由规则给出，**不为默认分预创建记录**——事实落表、规则进引擎）。

## 10. Phase：时间管理的主模型

管理员思考的是"现在什么阶段、这个阶段能干什么"，不是一堆能力窗口的集合运算——所以 **Phase = 有名称的业务状态 + 权限 Profile + 进入方式**，是配置与用户认知的主模型。公示不是阶段（§17）。

**batch_phases**：`batch_id, ordinal(唯一对), phase_key(kind), display_name, entry_trigger(scheduled|manual), planned_entry_at?, actual_entry_at?, permission_profile(jsonb: code[]), source_template_id?, source_template_version?`。

- **不存 start/end**。区间 = `[本阶段 actual_entry_at, 下一阶段 actual_entry_at)`，天然无重叠无隐式空洞；末阶段 `[start, ∞)`。批次冗余 current_phase_id 作查询投影。
- **planned 与 actual 分离，历史永不改写**：未发生的 planned_entry_at 可改（审计 + 可选通知学生"截止延长至…"）；`actual_entry_at` 一旦产生**永久不可修改**。要"重开填报"就在序列中**插入新阶段**（补充填报期，套用与正式填报期相同的模板）——历史于是能被准确讲述：9.1–9.5 正式填报、9.5–9.7 审核整理、9.7–9.9 补充填报。
- 触发只有 `scheduled | manual` 两种。**禁止**建设 condition / expression / event rule / cron 通用引擎；公示驱动的两次切换是领域代码里显式编排的 manual transition（§17）。
- **phase_events**（append-only）：计划修改与实际切换全部落审计事件（kind, phase_id, planned_at/actual_at, actor, reason）。
- **调度器**：core layer 内 fork 一根 Effect fiber，每分钟幂等扫描 ① `entry_trigger='scheduled' AND planned_entry_at<=now() AND actual_entry_at IS NULL` 的下一边界 → advance；② due 的 SCHEDULED publication → publish。单实例假设（与迁移器同款表述），动作幂等可重入。**不引入 Redis/BullMQ/分布式锁**。
- **PhaseTemplate**：租户级预设（阶段名/顺序/权限 Profile/时间偏移/trigger）。应用 = **复制**并记 source_template_id/version（仅审计溯源），绝不运行时继承；改模板不影响既有批次。
- 手动切换 `advancePhase(to, reason?)` 走 `assessment.batch.manage`；跳过 guard 的强制切换要求 `assessment.batch.force_advance` + 必填理由。

**默认阶段序列**：`预填报(scheduled) → 正式填报(scheduled) → 审核整理 →[publishPreliminary] 申诉(结束边界 scheduled=申诉截止) → 申诉处理 →[publishFinal] 结果确认 → 归档(terminal)`。**没有"公示期"**。审核整理期的存在理由：提交截止 ≠ 审核截止；申诉处理期同理：申诉截止 = 不受理新申诉，存量申诉继续裁决。

## 11. 三层授权

```text
authorize(principal, code, resource) =
  RBAC.can(principal, code, resource.scope)            # 身份与组织授权（既有 rbac，不动）
  ∧ PhaseGate.allows(currentPhase, code)               # 时间开放上限（只减不加）
  ∧ ResourcePolicy.allows(resource.state, action)      # 对象状态机 guard
```

**PhaseGate**：权限目录元数据增加 `phaseControlled?: boolean`（对 rbac 契约的**加法**修改，默认 false，向后兼容）。判定：`!phaseControlled → true；否则 code ∈ currentPhase.permission_profile`，**fail closed**——未来新增的受控权限在旧 Profile 中缺席即拒绝。阶段编辑器只展示 phaseControlled=true 的权限；`auth.login / org.* / iam.* / assessment.batch.manage` 永远不出现在阶段配置里。PhaseGate 只限制、绝不授予：阶段开放 review.process 不会让无审核 RBAC 的学生获得审核权。

**ResourcePolicy** 即条目/申诉状态机的动作 guard：正式填报期 + RBAC 允许 entry.edit，但条目 IN_REVIEW → 仍拒绝。

**权限目录**（`./permissions` 纯常量，`Access.permissions` 上车）：

| code                                               | phaseControlled | 说明                                                                   |
| -------------------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| assessment.batch.manage                            | ×               | 批次/阶段/题目/花名册管理（org-scope）                                 |
| assessment.batch.force_advance                     | ×               | 强制切换阶段（必填理由）                                               |
| assessment.publication.manage                      | ×               | 公示全生命周期                                                         |
| assessment.review.reassign                         | ×               | 管理员转派                                                             |
| assessment.result.view_self                        | ×               | 看自己成绩——**任何阶段可进入成绩页**，页面内容随状态变化（预览→S1→S2） |
| assessment.entry.create / edit / submit / withdraw | ✓               | 学生填报动作                                                           |
| assessment.entry.proxy                             | ✓               | 班委代录代改（受 org-scope 管辖）                                      |
| assessment.review.process                          | ✓               | 主链审核                                                               |
| assessment.appeal.create / process                 | ✓               | 申诉发起 / 处理                                                        |
| assessment.result.view_peers                       | ✓               | 看他人公示（≠ 看排名）                                                 |
| assessment.ranking.view                            | ✓               | 看排名                                                                 |

**默认阶段权限矩阵**（全是 permission_profile 配置，零特判代码）：

| Phase    | create/edit | submit | proxy | review | appeal.create | appeal.process | view_peers | ranking |
| -------- | ----------- | ------ | ----- | ------ | ------------- | -------------- | ---------- | ------- |
| 预填报   | ✓           | ×      | ✓     | ×      | ×             | ×              | ×          | ×       |
| 正式填报 | ✓           | ✓      | ✓     | ✓      | ×             | ×              | ×          | ×       |
| 审核整理 | ×           | ×      | ×     | ✓      | ×             | ×              | ×          | ×       |
| 申诉     | ×           | ×      | ×     | ✓      | ✓             | ✓              | 按配置     | ×       |
| 申诉处理 | ×           | ×      | ×     | 按需   | ×             | ✓              | 按配置     | ×       |
| 结果确认 | ×           | ×      | ×     | ×      | ×             | ×              | 按配置     | ✓       |
| 归档     | ×           | ×      | ×     | ×      | ×             | ×              | ×          | ×       |

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

**AssessmentItem（实例）**：`batch_id, item_type, title, description, config(jsonb, 驱动校验), score_group_id, review_policy(jsonb), appeal_policy(jsonb?), max_entries, sort_order, status, config_revision`。**ScoreGroup**：`batch_id, parent_group_id?, name, cap?, sort_order`，树形嵌套；默认树 = 品德(15) / 学业(75) / 文体(10)，文体下 基础(3)/干部(3)/活动(4)；教官与国旗班两题挂 cap=3 子组（ADR-5 示范）。

**多条目是统一形态**：一切题型天然多条目，`max_entries=1` 只是配置。允许超出组上限继续填报（撤销缓冲 + "不确定哪张证书能过全交上去"）；封顶只作用于计分层，UI 明示"已通过 5.5 → 按上限 4 计入"。

**evidence 驱动字段 DSL（v1 只做真实需要的，不做低代码表单平台）**：`text(pattern?)、number(min/max)、date(∈materialRange, 可再缩窄)、enum、enum_with_other、event_pick、attachment(required/maxCount/accept)、boolean`。其中 `event_pick` 专治献血类：管理员维护 `[{date, location, label}]` 整体选项（"2026-03-31 · XX爱心献血屋"），用户整体单选，杜绝"3.31 + B献血车"这种隐式非法组合；可配 allowOther。

**首发三实例**（seed/fixtures）：① 退役复学（hello world）：attachment ×1，fixed(3)，max_entries=1，M2 用单 stage 链、M3 换四段默认链；② 献血（M3 验收件）：event_pick + 编码 text(pattern) + attachment，fixed(1)，uniqueness=tenant，多条不限；③ 教官 / 国旗班（M4 验收件）：两个独立题各 fixed(2)，同 cap=3 组。

## 13. Entry · Revision · SourceClaim

**entries（轻量业务身份）**：`batch_id, item_id, participant_id, current_revision_id, current_review_instance_id?, status(draft|in_review|approved|rejected|withdrawn|voided), source(self|proxy|import|system), created/updated`。工作流投影**不塞回 entries**，归 ReviewInstance（§14）。状态机：

```text
draft ──submit──▶ in_review ──approve@normalTerminal──▶ approved
  ▲                   │ └─escalate─▶ (escalated mode, 下一 stage)
  └──withdraw─────────┘ └─reject──▶ rejected ──编辑产生新 revision──▶ draft(重提)
任意 ──admin void(必填理由)──▶ voided        blocked 由 ReviewInstance 承载（可恢复）
```

**entry_revisions（不可变）**：`entry_id, revision_no(唯一对), payload(jsonb), actor_id, subject_id, source, note?, created_at`。学生自改、班委代改、驳回重提、申诉更正、管理员补录——**一律追加，禁止 UPDATE 内容**。审核决定、公示行、申诉全部锚定具体 `revision_id`，杜绝"公示按旧材料算、点开看到新材料"。附件走**关系表** `entry_revision_attachments(revision_id, attachment_id, position)`——不用 `uuid[]`（要真实 FK 与顺序）。

**代录是 amendment 不是 impersonation**：`actor ≠ subject` + `source='proxy'`，学生端明示"由李四于 2026-09-03 代为修改"。需要 `assessment.entry.proxy` + 阶段开放 + 对该生锚点的 RBAC 管辖。**绝不实现"以张三身份操作"。**

**source_claims（防重复）**：`tenant_id, namespace, scope_key, normalized_key, entry_id`，唯一 `(tenant_id, namespace, scope_key, normalized_key)`。namespace 如 `evidence:blood-donation`；scope_key 表达唯一域（题型配置 `none|batch|tenant`：batch 域填 batch uuid，tenant 域填常量 'tenant'）；normalized_key = trim+upper+去分隔符。提交时软提示（"该编号已有另一条待审申报"）；**审核通过的事务内占用**，冲突则通过失败。kernel 不硬编码"献血编码全国唯一"之类业务假设。

## 14. Review 引擎：受限审核链，不是 BPMN

**一个 Item 只配置一条完整链 + normalTerminal**（普通流程天然是疑点链的前缀，不存在 normalFlow/doubtFlow 两张图）：

```jsonc
// item.review_policy
{
  "stages": [
    {
      "selector": {
        "kind": "roleAt",
        "nodeTypeKey": "class",
        "roleKeys": ["class-monitor", "study-committee"],
      }, // 班长或学委
      "quorum": { "type": "any" },
    },
    {
      "selector": { "kind": "roleAt", "nodeTypeKey": "major", "roleKeys": ["major-reviewer"] },
      "quorum": { "type": "any" },
    },
    {
      "selector": { "kind": "roleAt", "nodeTypeKey": "grade", "roleKeys": ["grade-reviewer"] },
      "quorum": { "type": "any" },
    },
    {
      "selector": { "kind": "nearestRole", "roleKey": "counselor" }, // 仅真正有继承语义的角色
      "quorum": { "type": "any" },
    },
  ],
  "normalTerminal": 0, // 献血：班长批准即完成；科研类可设 2（到年级负责人）
}
```

- **RoleAt**：从冻结锚点向上找**最近的指定 nodeType 节点**，只在该节点解析 roleKeys 持有者——学院节点上误授的"班长"不会被找到。**NearestRole** 沿链找最近持有者，仅用于辅导员类角色。Quorum 三型 `any | all | atLeast(n)` 覆盖或签/会签/N-of-M；**禁止**任意 DAG / 条件表达式 / ScriptTask。
- **ReviewInstance（独立投影实体，不塞回 entries）**：`entry_id, revision_id(受审版本), effective_chain(jsonb 快照: 各 stage 的 selector+解析节点+quorum+被跳过stage及原因+normalTerminal 映射), mode(normal|escalated), current_stage_index, state(active|blocked|completed), outcome?, current_role_keys(text[]), current_node_path(ltree)`。有效链在提交时按 ADR-4 计算并快照（含解释链路，写入首个事件）；普通节点**不保存具体 reviewer id**。
- **收件箱 = 拉模型**：按 `(state='active', current_node_path, current_role_keys)` 与我的 RBAC 授予（含 subtree coverage，ltree `<@`，GiST 索引）实时 join，keyset 分页。换届即时生效；`reassign` 保留给管理员（事件留痕），通常不需要。
- **计票节点**：进入时快照 panel（review_stage_panels），投票入 review_votes（append-only）；成员角色变更触发可达性重校验，不可达 → BLOCKED 告警。**任一成员 escalate 即短路当前 stage**（保留已产生的意见），不许"2 人已同意、第 3 人有疑问"卡死会签。
- **动作与文案解耦**：底层 outcome 枚举 `APPROVE | REJECT | ESCALATE | RECOMMEND_APPROVE | RECOMMEND_REJECT | COMMENT`。普通模式 stage：approve/reject/escalate；escalated 模式中间 stage：comment/recommend_*/escalate，**仅 terminal 可 approve/reject**。前端文案（通过/驳回/不确定，向上提审）走 i18n message。N-of-M 场景下"几票 reject 算驳回"**没有冻结规则，禁止自行发明**（§30）。
- **审核人限内改分**：range 计分器（"视影响 1–6 分"）与学院指定参与分/特殊分由审核人在配置边界内填值，写入 decision 事件 payload，越界拒绝。
- **事件 + 投影，不做 Event Sourcing**：一个事务内 `validate guard → append review_events/votes → update ReviewInstance 投影`。事件服务审计/时间线/申诉回放；投影服务查询/索引/收件箱。**禁止** replay 重建当前态的架构（不承担 projection rebuild / event schema migration 成本）。

## 15. Appeal

**appeal_cases**：`batch_id, publication_id, participant_id, target_kind(snapshot_row|entry_decision|total), target_ref(jsonb), reason, status, mode, current_stage_index?, current_role_keys?, current_node_path?, outcome?(upheld|corrected|withdrawn)`；配套 appeal_stage_panels / appeal_events / appeal_attachments（关系表）。

- 申诉**必须锚定不可变对象**：S1 的 publication_row 或其中的既有审核决定，绝不指向实时 Entry。发起/处理窗口由 Phase 的 appeal.create / appeal.process 控制。
- **AppealPolicy 独立配置**（缺省 = 主链从某 stage 起的**后缀之复制**，不运行时引用主链）：中间 stage 只能 comment/recommend/escalate，terminal 动作 `UPHOLD | CORRECT | ESCALATE`。"申诉中间负责人不能驳回"是 AppealPolicy 属性，**不做 phase overlay**——阶段切换不改变某条申诉内部的合法动作。
- CORRECT 的产物：新的 decision 事件（必要时管理员补录新 revision），成为 S2 计算输入；S1 永不修改，事后可完整解释"S1 82.3 → 献血复核 +1 → S2 83.3"。

## 16. Scoring：事实与规则分离

**数据库存事实，计分器存规则。** 不为"人人默认 8 分"预创建几千行记录——`calc(无评价事实) → 8` 是规则。`calcParticipant(participant, 规则配置@revision, 已确认事实, 外部事实版本) → Breakdown` 是**纯函数、全系统唯一实现**，服务实时预览、试算、正式 ScoreRun 三处；确定性、可回放。

- **内置计算器（M4）**：`fixed`（通过即 +3）、`lookup`（1–2 个枚举字段查配置矩阵：科研表）、`range`（审核人在 [min,max] 内定值）、`decrement`（名次递减：base − step×(名次−1)，集体减半；随竞赛实例落地）。计算器与聚合器经 core 的 registry ExtensionPoint **`assessment.calculator`** 解析（prepare 相编目录，core 自身贡献内置项）——为 M9 的 custom 计分器留出即插即用的缝，同时保证内置集合永久冻结在最小规模：一切校本逻辑走 custom，不往内核加计算器。
- **custom 计分器/聚合器（Formula 插件，M9）**：管理员或 AI 生成的**纯函数**在 QuickJS-WASM 沙箱内执行。执行契约（缺一不可）：① 输入为单一 JSON（实例配置 + 该生该题的已确认 entries + 声明的外部事实快照），输出为 JSON `{score, lines?: [{label, value}]}`（lines 并入 Breakdown，保住可解释性）；② 确定性——无 `Date.now`（时间源冻结为 run 时间戳）、无 `Math.random`、无网络/IO/异步/import，宿主零对象暴露；③ 中断句柄 + 内存上限 + 输出尺寸上限；④ TS 源码与编译后 JS 双存，**JS 工件的 sha256 进 ScoreRun input_manifest**——§16 不变量①对 custom 同样成立；⑤ **边界 = 单题内部**：不得跨题读数据、不得在函数内做组合封顶（ADR-5，组合永远归 ScoreGroup）；⑥ 失败语义：超时/越权/异常 → 整个 run FAILED 并定位到 (item, participant, input)，确定性保证可复现，**禁止静默给零分**。
- **v1 聚合器**：`sum`、`max`、`countTier`（1 项 0.5 / 2 项 0.8 / 3 项 1）。
- **组树自底向上**：entry → item 聚合 → 子组 cap → 父组 cap → 总分。Breakdown 逐行保留截断过程（"教官/国旗班组合封顶 −1.00"）——学生必须能看懂"分是怎么来的"，这是砍申诉量最有效的投资。
- **计分不变量（修正版，属性测试必须按此实现）**——因存在负分事实（扣分条目），"撤销任一条目总分单调不增"这类全局单调不变量**不成立，禁止使用**。正确集合：① 相同冻结输入 → 逐字节相同 Breakdown；② 任何 group 终值 ≤ cap（cap 幂等）；③ 移除一条**正分**已确认事实，在无特殊规则时其对应原始贡献不得增加；④ 移除一条**负分**事实，其对应原始贡献不得进一步降低；⑤ countTier 若要求单调，先校验 tier 配置本身单调。不要写超出业务模型保证范围的 property test。
- **ScoreRun**（批次级；单个学生实时看分**直接现算**，几十行数据，不建缓存/MQ）：`purpose(trial|publication), status(pending|computing|ready|failed|superseded), input_manifest(+hash), started/completed`。启动时**事务内冻结输入清单**（participant 集、各 entry 的 revision_id 与终态 decision 集、items config_revision、外部事实版本），随后异步计算；期间后台数据变化不污染本 run。产物 `score_results(run_id, participant_id, breakdown, category_scores, total)`。

## 17. Publication：与 Phase 完全正交

Phase 回答"现在允许干什么"，Publication 回答"正式对外公布了哪个结果版本"。**没有公示期这种阶段**。Publication + PublicationRow 本身就是 immutable snapshot envelope，v1 不另建 ResultSnapshot 聚合。

**publications**：`batch_id, kind(preliminary|final), score_run_id, status(draft|ready|scheduled|published|cancelled|superseded), publish_at?(对学生承诺的生效时刻), published_at?(调度实际执行时刻), appeal_deadline?(仅 preliminary), visibility(jsonb), ranking_policy(jsonb), created_by`。**publication_rows 自包含物化**（READY 时从 ScoreRun 复制，此后不可改）：`participant_id, breakdown, category_scores, total, ranking_partition_key, rank?, source_score_run_id`——正式公示页不再实时调计分引擎。

**工作流（不许混成一个按钮）**：

```text
① Preflight 全绿 → ② 事务内冻结 ScoreRun 输入 → ③ COMPUTING → ④ ScoreRun READY
→ ⑤ 物化 PublicationRows → ⑥ Publication READY → ⑦ 管理员预览
→ ⑧ 立即发布 或 设 publish_at 进入 SCHEDULED（即"公示预告"，无需新实体）
→ ⑨ 到点 PUBLISHED（记录 published_at；调度晚几十秒不移动 appeal_deadline）
```

- **Preflight 项与出路**：待审 primary n（审完 / 管理员裁决 void）、escalated 在途 n、BLOCKED n（补任命 / 转派）、未完成 EvaluationTask n（M7：补录 / 转派 / 作废+理由）、ScoreRun 覆盖全部 active participant、题目/组树配置完整（引用驱动已装配、calculator 参数合法、**custom 计分器版本已发布且测试通过**）、roster 完整性问题（缺 anchor / 重复 / 未裁决的显式纳入）。**实时组织树 diff 不在其中**（§9）。blocker>0 不能生成可发布快照；管理员不是点"忽略错误继续"，而是把每个业务对象推进到明确终态。正式公示中**不允许出现"张三 83.2（复核中）"**。
- **SCHEDULED 即冻结**：批次打 `input_frozen_by_publication_id` 标记；修改审核决定、新增有效 revision、改计分配置、改申诉裁决等一切影响该快照的写路径检查标记并拒绝（错误码 `PUBLICATION_SCHEDULED_FROZEN`，提示"存在已预告公示，请先取消预告"）。取消 = SCHEDULED→CANCELLED→修正→重算→重新准备。**已向学生承诺 9:00 公布，就不允许 9:00 因后台复检失败而不公布**——所以复检发生在 SCHEDULED 之前，发布本身是纯机械动作。
- **发布编排（领域代码显式写死）**：`publishPreliminary() = publish(S1) + advancePhase(申诉期) + 申诉期结束边界 planned_at := 表单所填 appeal_deadline`（发布表单按实际发布时刻提供 "+3 个工作日" 辅助计算器，落库仍是普通 timestamptz，管理员可手改；**v1 不建 BusinessCalendar**）。`publishFinal() = publish(S2) + advancePhase(结果确认) + supersede(S1 状态)`（S1 内容永远可查）。同一事务完成。不建设 "任意事件 → 任意阶段" 通用规则引擎。
- **排名只存在于正式 Publication**：ranking_policy = `{partitionNodeType?(年级/学院…，分区键取 participant.anchor_path 对应祖先；缺省=整批次), tieBreak: 总分→品德→学业→文体, 纳入范围}`；仍并列 → 标记 unresolved tie 交学院裁决并记录原因，**禁止用 user_id/created_at 静默破除并列**。批次范围 ≠ 排名范围。填报期无任何实时排名。
- **可见性三权分立**：view_self（恒可）、view_peers（租户配置）、ranking.view。默认：S1 `{own:✓, peers:按配置, rank:×}`；S2 `{own:✓, peers:按配置, rank:✓}`。

## 18. 归档

Batch 终态。Gate：final Publication 已 PUBLISHED + 全部 Appeal 终态 + 无业务 blocker。之后禁止业务写入；学生仍可查看自己终版结果、允许的排名、**打印材料**——打印引用 final publication_rows 与对应 EntryRevision，不重算当前库。几年后重进批次，两次公示、当年材料版本、审核与申诉过程完整可还原。

## 19. Storage 插件

`@qualy/plugin-storage`（infra）。窄接口四个：`put / open(经 authorizer hook) / metadata / retire`。`attachments`：`tenant_id, owner_user_id, filename, mime, size, sha256, storage_key, status(active|retired)`。v1 仅本地文件系统 provider。**附件不可变**：改材料 = 传新附件 + 新 EntryRevision；附件只支持 retire 逻辑退役。授权：core 注册 authorizer（拥有者本人，或对所属 entry 具有 review/appeal 处理资格者可读）。**不提前建设**预签名 URL / CDN / 缩略图 / S3 / 多副本。multipart 在 Effect v4 beta 的支持**必须实查 `repos/` 上游源码**。

## 20. 插件边界

```text
packages/plugins/
├── assessment/ core | evidence | appraisal | formula
├── data/       grades | dormitory
└── infra/      storage
```

**何时新建 Plugin（满足其一）**：独立数据生命周期 / 可独立启停 / 是某 ExtensionPoint 的驱动。否则一律 assessment/core 内部 module（batch/ phase/ roster/ item/ entry/ review/ appeal/ scoring/ publication/ archive/；index.ts 保持组合根 facade）。**不拆** eval-batch/flow/scoring/publication 四件套——共享实体、共享事务、生命周期同步、强外键耦合，拆开只制造 contract 仪式。

依赖：core → db/server/ui/org/rbac/auth（+M2 storage）。**assessment 不依赖 grades/dormitory**——反向通过驱动/contract 消费；没有 grades 时纯材料型综测照常运行。题目实例引用了未装配能力（evidenceSource=dormitory 而插件未启用）→ 配置校验/装配期**硬失败**，由管理员显式改配置；**禁止静默降级为人工模式**。

| 插件                               | 职责                                                               | dependsOn                  | 里程碑   |
| ---------------------------------- | ------------------------------------------------------------------ | -------------------------- | -------- |
| @qualy/plugin-assessment           | 综测 bounded context 全部核心 + item-type 扩展点                   | db,server,ui,org,rbac,auth | M1,M3–M5 |
| @qualy/plugin-storage              | 附件基础设施                                                       | db,server                  | M2       |
| @qualy/plugin-assessment-evidence  | 通用举证题型驱动（献血/退役/教官/证书/竞赛/科研证明…全走实例配置） | assessment,storage         | M2–M4    |
| @qualy/plugin-grades               | 成绩事实域（即使没有综测也成立）                                   | db,server,ui,org           | M6       |
| @qualy/plugin-assessment-appraisal | 教师评价/学生互评（任务型 interaction，非 Entry Form）             | assessment                 | M7       |
| @qualy/plugin-dormitory            | 寝室事实域（生命周期跨批次）                                       | db,server,ui,org           | M8       |
| @qualy/plugin-assessment-formula   | custom 计分沙箱 + AI 生成流水线（`assessment.calculator` 驱动）    | assessment                 | M9       |

---

# 第三部分 · 施工规范

## 21. 表清单与 ownership（最终归属；按里程碑分批建，不一次建全）

- **assessment/core**：`assessment_batches`（daterange、timezone、current_phase_id）；`batch_phases`（(batch,ordinal) 唯一，actual_entry_at 不可回改）；`phase_events`（append-only：计划修改+实际切换）；`phase_templates`；`batch_participants`（(batch,user) 唯一、anchor_path ltree）；`batch_config_revisions`；`score_groups`（自引用）；`assessment_items`；`entries`（轻量）；`entry_revisions`（不可变，(entry,revision_no) 唯一）；`entry_revision_attachments`（关系表）；`source_claims`（(tenant,namespace,scope_key,normalized_key) 唯一）；`review_instances`（收件箱索引：(tenant,state,current_node_path) + GiST）；`review_stage_panels`；`review_votes`；`review_events`；`appeal_cases` / `appeal_stage_panels` / `appeal_events` / `appeal_attachments`；`score_runs`；`score_results`；`publications`；`publication_rows`（自包含物化，READY 后不可改）。
- **storage**：`attachments`。grades / dormitory 的表在 M6/M8 设计时追加到本文档。
- 全表遵守仓库既有形态：uuidv7 主键库侧默认、timestamptz、复合租户外键 `(tenant_id, id)`、跨插件取表走 dependsOn + 实体闭包、迁移 `pnpm qualy generate`（destructive 走 drop-guard）。ltree/daterange 自定义类型仿 org 先例。

## 22. API 面

原则：第一段产品域 `assessment`；名词复数、无动作段（禁止 /doApprove /publishResult）；状态变化 `PUT …/status`；领域决定作为一等资源 `POST …/decisions`、`POST …/votes`；列表一律 keyset 分页；响应带 capabilities/manageable；**新增/改名与 `tools/tests/support/frozen-routes.ts` 同笔更新**。路由预案：

| 方法 路径                                                                                                     | 说明                                                        |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GET/POST `/assessment/batches`；GET/PATCH `/assessment/batches/{id}`                                          | 批次                                                        |
| GET/PUT `…/{id}/phases`；PUT `…/{id}/phase`                                                                   | 阶段计划编辑；推进（manual/force 带 reason）                |
| GET `…/{id}/timeline`                                                                                         | 学生视角派生时间线                                          |
| GET `…/{id}/participants`；GET `…/{id}/roster-diff`；PUT `…/participants/{pid}/status`                        | 花名册                                                      |
| GET/POST `…/{id}/items`；GET/PATCH `/assessment/items/{id}`；GET/PUT `…/{id}/score-groups`                    | 题目与组树                                                  |
| POST `/assessment/entries`；GET `…/{id}`；POST `…/{id}/revisions`；PUT `…/{id}/status`                        | 条目：新建/详情/追加修订(本人或 proxy)/submit·withdraw      |
| GET `/assessment/review/inbox`；POST `/assessment/review/instances/{id}/decisions`；POST `…/votes`            | 收件箱与审核                                                |
| GET `/assessment/batches/{id}/my-result`                                                                      | 实时预览（含 breakdown）                                    |
| POST/GET `/assessment/batches/{id}/score-runs`                                                                | 试算                                                        |
| POST `/assessment/publications`；GET `…/{id}`；GET `…/{id}/preflight`；PUT `…/{id}/status`；GET `…/{id}/rows` | 公示全流程（scheduled 时 body 带 publishAt+appealDeadline） |
| POST/GET `/assessment/appeals`；POST `/assessment/appeals/{id}/decisions`                                     | 申诉                                                        |
| PUT `/assessment/batches/{id}/status`                                                                         | active / archived                                           |

## 23. UI 页面与体验基准

| page id                          | path                           | visibility                   | 内容                                                                                                                                                                             |
| -------------------------------- | ------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| assessment/batches · batch-admin | /assessment/batches[/:id]      | permissionOf(batch.manage)   | 管理端：基本信息 / Phase 时间线 / Roster+Diff / 题目与组树 / 审核异常 / ScoreRun 试算 / **Preflight 面板（一等公民）** / Publication / 归档                                      |
| assessment/home                  | /assessment                    | AUTHENTICATED                | 学生填报中心：派生时间线 + 三大类分组的题目卡（题名 / 当前计入分 / 组上限 / 条目状态汇总 / 新增入口）                                                                            |
| assessment/item · entry-editor   | /assessment/items/:id 等       | AUTHENTICATED                | 条目列表 + schema 驱动表单；条目卡统一解剖：状态徽章 / Revision 摘要 / 分值 / 审核到哪级 / 附件 / 时间线 / 动作区                                                                |
| assessment/inbox                 | /assessment/inbox              | permissionOf(review.process) | 拉式收件箱（Item/Batch/状态/组织范围筛选）+ 详情（revision + 附件 + 有效链 + 事件 + 动作条）                                                                                     |
| assessment/my-result             | /assessment/batches/:id/result | AUTHENTICATED                | **核心产品页**：品德 13.2/15 → 教师评价 7.5、献血 +1、教官 +2、国旗班 +2、组合封顶 −1……逐行可解释；公示后切 S1/S2 视图。大量真实申诉源于"不知道为什么算成这样"，此页做透申诉减半 |
| assessment/appeals               | /assessment/appeals            | AUTHENTICATED                | 我的申诉 / 处理入口                                                                                                                                                              |

体验红线：用户永远看到**业务流程**而非内部状态机——"第一次成绩公示：待定"而不是"管理员尚未创建公示"；管理员看到的是"审核状态 4231/4250 · 待处理 14 · 疑点 5 → [运行发布前检查]"这样的业务面板。管理员配置的一切文案（题名、说明、选项 label）i18n 上是 literal；系统文案（状态徽章、动作名）走插件 message catalog。

## 24. 测试重点（不变量优先于 CRUD 覆盖）

- **Phase**：phaseControlled fail closed；scheduled transition 幂等；actual_entry_at 不可回改；PhaseGate 只能收窄 RBAC。
- **Review**：普通路径恒为疑点链前缀；禁止自审；职位空缺不自动上浮；terminal 必须存在；voter panel 分母稳定；single 换届实时生效；escalate 短路会签。
- **Entry**：Revision append-only；审核锚定具体 revision；proxy 的 actor/subject 不混淆。
- **Scoring**：§16 修正版五条不变量；正负分场景分别按语义测试；**禁止**"撤销任一条目总分单调不增"这类错误全局不变量。
- **Publication**：READY/SCHEDULED/PUBLISHED 后 rows 不可改；SCHEDULED 冻结拒绝写入、CANCELLED 后恢复；S1 不因 S2 改变；Appeal target 恒指向不可变对象；publish_at（承诺）与 published_at（执行）分离，调度延迟不移动申诉截止。
- 全部经 `createTestContext()`（业务插件不得自持数据库），fixture 走 testkit `runSql`；关键页面（EntryForm、收件箱）浏览器测试自 M3 起。

## 25. 工程接口点（详规以 CLAUDE.md 为准）

实现前必读：CLAUDE.md → docs/effect-migration.md 相关节 → STATUS.md → 当前插件描述器实现 → rbac contract → org ltree 实现 → database 插件封装。描述器上车：表 `Db.entities`（+baselineDir 幂等片段装 extension/自定义类型）；权限 `Access.permissions`（phaseControlled 为**加法**元数据，落 rbac 契约包，默认 false）；API `src/api.ts` HttpApiGroup + `Api.group`，域错误 `src/server/errors.ts` 入全局错误码门禁；页面 `Ui.page` / `Ui.react` / collection；扩展点按 plugin-kit ExtensionPoint（prepare 相）。**Effect v4 是 beta：HttpApi / multipart / Schedule / Fiber / Layer / Schema 一律实查 `repos/` 同版本源码，禁止凭 v3 记忆编码**；三处必查点：multipart 上传、fiber 定时扫描、daterange 类型映射。keyset 分页、租户纪律（tenantId 只来自 session/配置/服务端关联对象）、frozen-routes 与 error-codes 同笔更新——逐条适用。

---

# 第四部分 · 里程碑（垂直切片，每步端到端可演示）

**M1 — Batch + Phase + Roster + PhaseGate（运行时骨架）**
交付：§9–§11 全部（批次 CRUD、daterange、阶段序列/模板/phase_events、调度 fiber、花名册生成与 diff、phaseControlled 元数据、PhaseGate、学生时间线、batch-admin 基础页）。不做 Entry/附件/复杂审核/计分/公示。
验收：① 模板建批次，阶段编辑器只显示受控权限；② scheduled 到点自动切换且幂等（重扫无重复事件）；③ 改未来 planned 成功并审计，改 actual 被拒；④ manual/force 切换落审计带 reason；⑤ 花名册单 SQL 生成；diff 三类差异可应用；excluded 不删数据、组织变化不使 roster 漂移；⑥ 权限矩阵逐格验证（预填报可 edit 不可 submit；审核整理关提交、review 继续；归档期写动作全 403）；⑦ createTestContext 覆盖 gate 判定与切换幂等。

**M2 — Storage + Evidence 最小闭环（第一条可演示业务）**
交付：storage 四接口 + 本地 provider + authorizer；item-type 扩展点 + evidence 驱动（text/date/attachment）；Entry/Revision/关系表附件；单 stage 审核 approve/reject；proxy amendment；实例：退役复学。
验收：学生传证明→草稿→提交→审核通过→"我的成绩"显示 +3；SUBMITTED 后 edit 被 ResourcePolicy 拒；班委代改产生 actor≠subject 新 revision 且学生可见；驳回→新 revision→重提。**到此必须是可演示系统，不是基础设施。**

**M3 — Review 完整体（最难的人工审核问题）**
交付：§14 全部（完整链+normalTerminal、RoleAt/NearestRole、ADR-4 三分、quorum 三型+panel、escalation、拉式收件箱、reassign、事件+投影）；source_claims；event_pick/enum_with_other/pattern 字段。实例：献血。
验收：① 献血全链跑通；② 同编码第二条：提交软提示、审核通过被唯一约束拒绝；③ 班长换届收件箱即时增减；④ 专业直属生跳过 class stage 且事件含解释；⑤ class 有节点无班长 → BLOCKED 进管理告警；⑥ 班长提交自己的条目自审剔除生效；⑦ atLeast(2)：panel 快照、成员撤角色触发可达性告警、任一 escalate 短路、仅 terminal 可 reject。

**M4 — Scoring（从审核系统升级为综测系统）**
交付：§16 全部（calcParticipant、fixed/lookup/range/decrement、sum/max/countTier、组树嵌套 cap、Breakdown、my-result 实时预览、trial ScoreRun 输入冻结、修正版不变量属性测试）。实例：教官+国旗班。
验收：双题 + cap=3 组产出 2/2/3 三种组合；range 越界拒绝；同冻结输入两次计算逐字节一致；正/负分移除语义分别通过。

**M5 — Publication + Appeal + Archive（完整可用于一个学期）**
交付：§15/§17/§18 全部（preflight、READY→SCHEDULED 冻结与错误码、rows 自包含物化、publishPreliminary/publishFinal 同事务编排、+N 工作日辅助计算器（纯前端）、分区排名+tieBreak+unresolved tie、可见性、AppealPolicy 后缀默认、归档与打印源）。
验收：① 有待审条目无法生成可发布快照，每个 blocker 出路可操作（含 admin void）；② SCHEDULED 后对批次输入写被 `PUBLICATION_SCHEDULED_FROZEN` 拒、取消后恢复；③ 到点自动 PUBLISHED、published_at 落库、同事务入申诉期、申诉截止=表单值且不随调度抖动移动；④ 对 S1 行申诉→中间节点仅 escalate→terminal CORRECT→产生新输入；⑤ S2 吸收更正、rank 冻结、tieBreak 品德→学业→文体、并列标 unresolved；⑥ S1 在 S2 后原样可查；⑦ 归档 gate + 打印与 S2 逐字节一致。
**M5 完成 = 纯材料型综测系统整体可投产**（学生填报→多级审核→计分→两次公示→申诉→归档），Grades/Appraisal/Dormitory 均为增量。

**M6 — Grades（成绩事实域 + 派生题型）**：grades 只存事实（term / course / course_nature(必修|必选|公选) / credit / grade_record(attempt 序, 首考标记) / import_batch / 错误行 / 修订历史），保留**课程行级**（规则要问"全部必修是否 ≥85""不及格几门"）；对外唯一窄接口 `getStudentTermGrades(studentId, termId)`。综测侧 `interaction:'derived'` 驱动实现：加权基础分×75%（剔公选、取首考）、全 85/80 加分、必修必选不及格扣分——**"值多少分"永远写在 assessment 侧**。重导入纠错 → 关联批次未发布的 ScoreRun 需重跑。实施前补详细设计到本文档。

**M7 — Appraisal（任务型）+ 班委网格**：教师评价（default 模式=规则给 8 分零记录；evaluation 模式=建任务→指定范围与教师→逐生录入→完成；100/100 未点完成可自动 complete）。**未完成任务 = Publication blocker**，出路 = 补录/转派/显式作废（必填理由）；**绝不存在"漏 1 人作废 99 人"的自动行为**。100→8 换算与多师聚合方式配置化（§30，禁猜）。学生互评范围与防恶意策略实施前确认。班委批量网格代录视图（行=学生、列=字段，致敬旧 Excel，产 proxy 条目）。

**M8 — Dormitory（独立事实域，最后做）**：room / occupancy(daterange) / inspection_batch / inspection_score / dorm_leader_claim（多人自称→CONFLICT 人工裁决，**不做 first-write-wins**）。综测消费：管理员配置纳入哪些查寝批次（或按日期规则自动纳入），系统按 occupancy 区间自动判定——**学生不得自选批次或时点**（cherry-picking 封死），只能对数据发起异议；未入住/无成绩三态 `FULL | ZERO | NOT_APPLICABLE`（第三态对总分的影响由组规则配置）；口径（检查日在住/全期在住/区间加权）待政策确认（§30）。

**M9 — Formula 插件（custom 计分沙箱 + AI 生成流水线；毕设主特性）**：硬前置仅 M4（registry 缝）；**建议排序 M5 → M9 → M6–M8**——先保住完整学期流程的底盘，紧接着上主特性，领域数据插件殿后。
交付：`@qualy/plugin-assessment-formula` 向 `assessment.calculator` 贡献 custom 计算器与聚合器；**quickjs-emscripten** 运行时（纯 WASM 零原生依赖、中断句柄 + 内存上限、冻结时间源、禁 random/网络/IO/异步、宿主零暴露、按代码 hash 缓存编译产物）；TS 源 + 编译 JS + sha256 双存；**分层 AI 生成流水线**：细则文本 → ① 优先生成**内置计算器的声明式配置**（教务人员可人工复核，覆盖多数条款）→ ② 无法声明式表达时降级生成 TS 纯函数 **+ 配套测试用例**（AI 从规则文本产出，含边界情形）→ 沙箱跑测试 → 抽样真实学生试算 diff → **人工显式发布**（进入 item config，自动受 §9 配置冻结与 BatchConfigRevision 约束）。
验收：① 同 hash 同冻结输入逐字节一致（不变量①对 custom 成立）；② 无限循环/超内存被中断，run FAILED 且带 (item, participant, input) 定位、可复现；③ 沙箱内访问 Date.now / Math.random / 网络全部抛错；④ 未发布或测试未过的 custom 版本被 preflight 拦截；⑤ 回归基准：用 custom aggregator 复刻"1项0.5/2项0.8/3项1"，与内置 countTier 结果逐字节一致；⑥ 已有提交的批次修改 custom 代码被强制走 BatchConfigRevision；⑦ 端到端演示：粘贴一条真实细则 → 产出配置或代码+测试 → 通过 → 发布 → 试算出分。

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
| 月度考勤台账 UI / 学生自报扣分                                             | 本校无此流程；source=import + 负分已留口                                                             |

## 28. 明确禁止的错误简化

Entry 内容直接 UPDATE；班委 impersonate 学生；Publication 做成实时查询；审核任务永久绑定具体用户（single/any 必须实时解析）；组织变化自动删 Roster；dormitory 缺失静默转人工；学生自由挑查寝批次/时点；权限交集波及 auth.login 等全局权限（必须 phaseControlled 白名单）；把 escalation 当 appeal；每条政策一个 plugin；用 user_id/created_at 静默破除排名并列；靠前端查询代替 source_claim 数据库唯一约束；AI 生成的计分代码未经测试与人工显式发布直接生效；custom 函数失败时静默给零分。

## 29. 施工时先问的五个问题

遇到新能力，按序自问：**① 事实还是规则？** 事实落库，规则进配置/scorer。**② 历史结构还是实时身份？** 结构快照，身份动态解析。**③ 正式结果还是当前预览？** 预览动态，正式 immutable。**④ 业务状态还是权限？** 资格→RBAC，时间开放→PhaseGate，对象能否操作→ResourcePolicy。**⑤ 独立领域还是 core 内部职责？** 独立生命周期→Plugin，强耦合→core module。绝大多数架构疑问会被这五问直接消解。

## 30. 未冻结的业务问题（遇到必须问用户，禁止猜）

1. 教师评价 100 分制 → 8 分基础分的换算公式（政策未写明；建议任务级 config，候选线性 score/100×8，须确认）。
2. 多教师评同一学生的聚合方式（平均/加权/取高）。
3. 学生互评的范围界定与防恶意（去极值等）规则。
4. 献血编码的实际唯一域（本文档示例按 tenant 终身，可改配置）。
5. 两次公示 view_peers 的默认策略（政策"向年级全体同学公示"倾向可见他人，待租户确认）。
6. all / atLeast(n) 节点的 reject 投票语义（几票 reject 算驳回）。
7. 学院新版细则是否仍保留跨学期补差 / 消息报道类累计限额。
8. Dormitory 计分口径：检查日在住 / 全期在住 / 区间加权，取哪种。

## 31. 设计总纲

Qualy Assessment 的核心不是"把 Excel 搬上网页"，而是：**把原本依赖班委手工 Excel、口头审核和人工复核的综测流程，转换成一个以 Batch 为边界、以 Phase 表达时间、以 Roster 固定人员语境、以 Revision 保留事实历史、以受限审核链处理责任流转、以纯函数评分解释成绩、以 immutable Publication 固定正式结果、以 Appeal 处理争议的可配置审计系统。**

第一版的目标不是最通用的综测平台，而是：**让一个真实学院完整跑完一次"填报 → 审核 → 第一次公示 → 申诉 → 第二次公示 → 归档"的学期流程，且每一个分数、每一次修改、每一个审核决定都可解释、可追溯。** 所有进一步抽象，由真实出现的第二个需求推动，而不是提前建设。

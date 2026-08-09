M1 里真正的新发明只有一个（时间引擎），其余全是抄 org/auth/rbac 的既有形态，所以拆出来是 7 个会话，每个都以"门禁全绿 + STATUS 摘录 + 提交"收口（编号接着 STATUS 现有序列走，开工前照 P1 先例打一个入场基线 tag）。

**s1 · 骨架与全部表**——目标：装配成功的空插件 + M1 全部 schema。`pnpm plugin:add` 建 `@qualy/plugin-assessment`；`permissions.ts`（权限声明 + `PHASE_GATED` 同文件 + 启动断言集合⊆自声明码）；daterange 自定义类型（实查 repos/ 的 MikroORM 7 custom type + org `ltree.ts` 先例）；实体与首个迁移：batches、batch_user_types、batch_phases（entry_trigger 三值、entry_offset jsonb、estimated_entry_at、**opens_publication_id 裸 uuid 无 FK**——§32.26 先例，M5 补约束；phase_item_scopes 的 item 列同法，M2 补 FK）、phase_events(+processed_at)、phase_templates、phase_participant_scopes、batch_participants（anchor_path + anchor_lineage jsonb）、batch_config_revisions。出口：assembly resolve、迁移应用、一条 createTestContext 实体往返测试。风险点就一个：custom type，别的全是抄。

**s2 · 纯函数时间引擎（M1 的心脏，零 IO）**——目标：把全部时间语义钉死在最便宜的层。`src/phase/engine/` 纯模块：effectivePhase(now)、武装前缀计算（穿 scheduled 与已绑 SCHEDULED 公示的边界、止于 manual/未绑）、偏移物化（"锚的语义时刻一旦确定即可物化"，早于上游 actual 拒绝）、插入阶段与 ordinal 重排、七条编辑校验器（归档收尾、公示边界绑定生命周期、硬计划不越 manual、已结束仅名称、actual 不可改、边界只许未来、proxy/submit lint）、时间线派生（actual > planned > publish_at > 预计 > 待定）。红绿测试直接照 §24 时间条目写。**这是最可能超时的会话**：真撑不住就在"判定类（effectivePhase/武装）"与"编辑类（校验/物化/插入）"之间一切为二，绝不把引擎写进 service 层赶进度。

**s3 · 服务层 + API + PhaseGate**——目标：给引擎接电。批次 CRUD（含 batch_user_types、config_revision 计数与配置事件）、阶段计划编辑（改 planned/插入/模板 CRUD 与 apply=复制+溯源）、advancePhase（manual/force+reason→phase_events）、**激活=单条 INSERT…SELECT 生成花名册 + lineage 冻结**（生成归激活语义，diff 归 s5）、PhaseGate(+ctx) 与 authorize facade（rbac ∧ gate ∧ ResourcePolicy 桩位）、结构化拒因枚举、API（batches/phases/phase/timeline，keyset）+ frozen-routes 与 error-codes **同笔**。验收 ③④⑥⑦⑩ 在此退役（⑩注意：M1 无 entry 动作实体，在 gate 层用合成 code+ctx 测，端到端留 M2——这半句写进 STATUS 免得下个会话误判漏做）。

**s4 · 调度 fiber**——目标小而独立：Assembled barrier 上 fork 每分钟扫描，只做一件事——推进武装前缀内到点的 scheduled 边界（actual:=planned、processed_at:=now、幂等可重入、单实例声明照迁移器抄）。集成测试用时钟控制验 ②⑧⑨（物化延迟不影响 gate 判定、manual 之后不自燃）。实查点：Effect v4 的 fiber/Schedule/Layer 作用域。它依赖 s2+s3 但与 s5 完全无关，顺利的话半个会话，也可并进 s3 尾部——但宁可独立，fiber 的生命周期接线是 M1 里第二容易踩坑的地方。

**s5 · 花名册 diff 与对称转入转出**——目标：roster 的管理面。四类差异计算（新迁入未纳入/已迁出仍在册/锚点变更/用户类型变更）、纳入动作（双重参与警告=查他批次 active 记录、当场校验新锚点链——M1 无审核链，校验降级为"新 lineage 上目标 nodeType 是否有人持角色"的预检并注明 M3 接全）、显式移出与 excluded、锚点变更应用、"首提前自动同步"开关落配置位（M2 才生效）。API + service 测试，验收 ⑤ 退役。

**s6 · batch-admin 页**——M1 最重的前端会话：批次表单（用户类型选择、daterange）、**阶段时间线编辑器**（三种时间形态、七条校验的错误反馈、插入阶段、模板应用）、权限矩阵编辑器（数据源=PHASE_GATED，只可能列出 assessment 码）、roster+diff 面板。Ui.page + i18n catalog + 浏览器测试（harness 在 apps/web/tests/support）。验收 ① 退役。如果超时，切分线在"阶段编辑器"与"roster 面板"之间。

**s7 · 学生时间线页 + 全量验收收口**——学生侧时间线（取值优先级渲染、"待定"文案红线）、拒因到 UI 文案的映射、然后把 ①–⑩ **全部真跑一遍**（含前面会话已退役项的回归），输出摘录进 STATUS，M1 收口提交。

三条会话间纪律：每个会话的开场白固定为"读 CLAUDE.md → 设计文档相关节（只读本会话涉及的 §）→ STATUS 最新两条"，并把该会话的交付清单原文贴给 Claude Code，**清单外的事不做**（尤其禁止在 s3-s5 提前写 UI、在 s2 碰数据库）；每个会话至多引入一次迁移，迁移绝不跨会话半途；s2 产出的引擎测试从此是规格锚点，后续会话只许消费不许重开。依赖关系上 s5 与 s4 可换序、s6 与 s7 的前端工作可按你状态并；但 s1→s2→s3 的次序不动——它保证最险的东西（时间语义）在最便宜的层（纯函数）被最早钉死。

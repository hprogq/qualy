# ORM 选型外部评审归档(2026-07-28 至 2026-08-01)

> 本文归档数据层定案前的两轮外部评审对话要点与最终指令,以及逐条处置对照。
> 完整机制文档见 docs/architecture/database.md,实验证据见 docs/notes/drizzle.md。

## 第一轮:问题提出与 Orchid 巡视(2026-07-31)

起点是两个真实问题:

1. 用户移除插件时,数据库表是否应该删除?(当时的中心 codegen 下,下一次 generate 会自动产出 DROP)
2. 完全走 generate 流程时,手工 SQL(function、trigger)难以落地。

巡视了 Orchid ORM(orchid-orm + rake-db)方案:BaseTable 内核包 + snakeCase/zod schemaConfig、每插件独立迁移账本(migrationsTable/migrationsPath)、可逆迁移 change(db, up)、Adapter 一等封装共享连接。**判决性实验**(双插件模拟):库里预置 org_units(模拟他插件已迁移的表),gradebook 侧跑 rake-db 生成器,交互提示出现 `~ org_units => course_scores` 改名候选——schema-diff 生成器把「库里有、代码里无」的外来表视为待处置对象,且配置面(RakeDbCliConfigInputBase)无任何表级/前缀/schema 范围过滤。对照 Drizzle 已实测的「快照 = 导出集合,外来表在 diff 视野之外」,插件自治生成这条生死线一过一落。

判决:**Drizzle,维持原判**。trigger/function 两家都无 schema 内一等定义(平局,裸 SQL 迁移是共同答案);语料税之争以「本仓 notes 私有文档已覆盖 v1 官方文档缺口」对冲。翻案条件:rake-db 引入 diff 范围过滤后复刻双插件实验。

第一轮的直接产物(commit 7da7ac0,后并入 a7ee5bd):超集聚合(停用不删表)+ `db:custom` 手工 SQL 通道。

## 第二轮:数据层完整定案指令(2026-08-01)

外部评审收敛为唯一权威指令,核心内容:

- **〇 三集合模型**:available / installed(依赖闭包,lock 文件权威)/ active(cordis.yml);表是数据、停用永不删;行为对象由迁移创建、运行时开关只控消费者;结构裁决中心化、行为书写插件化。
- **A 切断 cordis.yml → installed → DROP 危险链**:installed.lock.json、qualy 声明字段(废除 hasExport 探测,fail-open 是事故源)、--init-empty、四类硬失败、active 不变式。
- **B 装配层**:assembly.gen.ts 路径数组直供 Kit、schema.entry.ts 直接命名导出、assembly.lock.json、cordis_meta 账本。
- **C 宿主迁移职责**:autoMigrate、advisory lock、checksum 拒启、审计旁挂、register 归属注册表。
- **D 行为层**:编号片段只增不改、behavior.lock、db:gen 单一编排(pre/post/manual 三相)、幂等纪律、drop-guard、分支纪律。
- **E dirty/projection**:DDL 与语义现在定死(合并型 dirty set、worker 读源态、reconcile 定义升级),实现随 P3。
- **F CI 最小集**、**G 工程收尾**(mise 钉死、docs 入库、PURGE 文档化、RC 风控)、**H 文档**。

## 逐条处置对照

| 指令 | 处置 | 落点 |
|---|---|---|
| A1-A5 | 已实现 | installed.lock.json、scripts/lib/installed.ts、scripts/plugin-add.ts、gen 硬失败、CI 不变式测试(scripts/tests/invariants.test.ts);commit "installed lock as schema authority"(amend 原 7da7ac0) |
| B6-B8 | 已实现 | generated/db/assembly.gen.ts、各插件 schema.entry.ts、assembly.lock.json、drizzle.config migrations 配置;commit "assembly manifest with per-plugin schema entries" |
| C9-C10 | 已实现 | packages/plugins/infra/database(Service.init 全序列、checksum 拒启实测、migration_audit、register + ping 示范);commit "migration execution with checksum verification and object registry" |
| D11-D15 | 已实现 | scripts/lib/behavior.ts、scripts/db-gen.ts、scripts/drop-guard.ts、CLAUDE.md 纪律条款;片段编译/免疫/回滚全部实测;commit "behavior fragment lane with orchestrated generation and drop guard" |
| E16-E18 | 文档定案(实现随 P3) | docs/architecture/database.md §6 |
| F19-F20 | 已实现 | .github/workflows/ci.yml、vitest 4.1.10;commit "ci gate, vitest, pinned toolchain and tracked docs" |
| G21-G25 | 已实现/已确认 | mise.toml 钉死 24.18.0/11.8.0、docs 解除忽略入库、PURGE 文档化(architecture §7)、RC 风控入 CLAUDE、既有实现确认保留 |
| H26-H27 | 本批文档 | notes/drizzle.md 扩写、本文、architecture/database.md、CLAUDE/STATUS 更新 |

审计基线:第一轮产物 commit 7da7ac0(经 A 组 amend 为新哈希);第二轮六个 commit 见 git log(feat(db)×4 + chore(repo) + docs(db))。

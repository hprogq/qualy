# drizzle v1(1.0.0-rc.4)实查结论(2026-07-28)

版本:drizzle-orm 与 drizzle-kit **成对**锁 `1.0.0-rc.4`(npm `rc` 标签);pg 8.22.0、@types/pg 8.20.0。网上 v0 与 v1 教程混杂程度比 oRPC 还凶,任何陌生 API 先跑导出探针(`node -e "import('drizzle-orm/pg-core').then(...)"`)再信。

## casing-rework:定义期 casing,配置项已死

- v1 把 casing 从运行时/配置项迁进 schema 定义:`snakeCase.table` = `pgTableWithCasing('snake_case')`,TS camelCase 属性在**定义期**烘成 snake_case 列名(实测:`createdAt` 属性 → 迁移 SQL 里的 `created_at`)。同族还有 `snakeCase.view/materializedView/schema`。
- 质变而非等价替换:表对象携带最终列名,插件的 /schema 导出**自包含**,不再依赖消费方配置;"kit 与运行时两边 casing 要一致"的纪律性约束结构性消失。
- `drizzle({ casing })` 已从 DrizzleConfig 移除;kit 的 `casing` 只剩 introspect 用途('camel'|'preserve')。**两处都禁止写**(已入 CLAUDE.md)。

## RQB v2:pg 驱动的 `schema` 选项已移除

- `DrizzlePgConfig = Omit<DrizzleConfig, 'schema'> & { codecs? }`,`NodePgDatabase<TRelations>` 泛型改为 relations(v0 的 `drizzle({ client, schema })` 在 v1 编译不过)。
- 本项目用 RQB v2:需要 `db.query.*` 的插件用 `defineRelations(schema, r => ...)` 构建 relations,经 `ctx.db.withRelations(relations)` 拿类型化视图(同一连接池上的多实例,官方支持且廉价,WeakMap 缓存)。
- 列级类型安全来自静态 import 的表对象,与实例泛型无关:`db.insert(pingLogs).values(...)` 在裸 `NodePgDatabase` 上全程严格。db 服务保持 schema 无知(L0 不得依赖业务表定义)。
- 跨插件取表约定:import 对方包 `/schema` 子导出(类型与表对象) + inject 对方服务(运行时保证已装载、表已迁移)。

## 迁移:v3 目录结构与命名纪律

- v1 迁移产物是**每迁移一个文件夹**(`<时间戳>_<名>/migration.sql` + snapshot),journal.json 已删除,`drizzle-kit drop` 已移除。
- **生成迁移必须命名**:`pnpm db:generate --name <名>`(pnpm 会把尾参透传给链尾的 drizzle-kit generate);不命名会得到 `misty_ezekiel_stane` 之类随机名。
- `drizzle-kit generate --explain` 可干跑预览;`check` 做跨分支迁移冲突检测。
- drizzle.config.ts 用 `defineConfig`,顶部 `try { process.loadEnvFile() } catch {}`(kit 不经过 dev 脚本的 --env-file),DATABASE_URL 缺失时 warn 后兜底本地串。

## 迁移策略定案:停用不删表 + 手工 SQL 通道(2026-07-31,三组实验)

- **风险实证**:schema.gen.ts 若按启用集过滤,停用 ping 后 `drizzle-kit generate --explain` 直接计划 `DROP TABLE "ping_logs"`——generate 的 diff 语义就是"聚合物里没有 = 该删"。
- **定案 1:gen-schema 恒按超集聚合**(含 disabled 条目)。停用插件 = 路由/界面消失但**表与数据保留**(实测:停用 ping 后 generate 报 "No schema changes");从 cordis.yml **彻底删除条目**才是显式的删表动作,下次 generate 产出 DROP 迁移,须人工审阅后提交。schema.gen.ts 的唯一消费者是 drizzle-kit,运行时无人 import 它,恒超集无副作用。
- **定案 2:手工 SQL(function/trigger/view/索引优化等)走 `pnpm db:custom --name <插件>-<描述>`**(drizzle-kit v1 的 `generate --custom`,产出带 banner 的空 migration.sql,实测可用)。与表迁移同目录同账本,按时间戳参与顺序执行;命名带插件前缀保留出处。两家 ORM 都没有 schema 内一等 trigger/function 定义,裸 SQL 迁移是共同答案,不构成选型差异。

## 备选巡视:Orchid ORM(2026-07-31 终审结案,维持 Drizzle)

- 动因:每插件独立迁移账本(rake-db `migrationsTable`/`migrationsPath`)、可逆迁移(rollback 自动反推)、查询人体工学、zod 一体化(schemaConfig)、`createExtension/createEnum` 等类型化助手——甜头真实但均为舒适性收益。
- **致命实验**(双插件模拟):库里预置 org_units(模拟他插件已迁移的表),gradebook 侧跑 rake-db 生成器,交互提示出现 `~ org_units => course_scores` 改名候选——生成器把「库里有、代码里无」的**外来表**纳入处置空间(改名或删除),且 RakeDbCliConfigInputBase 无任何表级/前缀/schema 范围过滤字段。二十余插件下无人值守生成不可能,答错一次即改名/删除他人表。
- 对照:Drizzle 快照 = schema 文件导出集合,外来表在 diff 视野之外,非交互、确定性——「插件自治/分域生成」这条线上一过一落。
- 附带澄清:Orchid 需要共享内核包 @qualy/db-base(BaseTable 配 snakeCase/schemaConfig),是 Drizzle 没有的内部耦合点;文档质量 Orchid 确实更好,但本仓的 notes 私有文档已覆盖 drizzle v1 官方文档缺口。
- **翻案条件**:rake-db 引入 diff 范围过滤(表清单/前缀/schema 白名单)→ 复刻上述双插件实验通过后重新上桌。

## 主键定案:UUIDv7,数据库侧生成

- `uuid().primaryKey().default(sql\`uuidv7()\`)`:PG18 原生函数,默认值进 DDL,psql 修数、ETL、任何裸 SQL 写入都自动拿到 ID(实测:插入返回版本位为 7 的 id)。
- rc.4 无 v7 专用 builder(只有 `defaultRandom()` 对应 v4),走 `sql` 模板。
- `$defaultFn` 的正确场景是"插入前就要拿到 ID"(先入队再落库、乐观 UI):届时在该表**叠加** `$defaultFn`(与 sql 默认并存,应用预生成 + DDL 兜底),不是二选一。
- 时间戳列统一 `createdAt/updatedAt` 命名 + `withTimezone: true`。

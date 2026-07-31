# drizzle v1(1.0.0-rc.4)实查与定案笔记

版本纪律:drizzle-orm 与 drizzle-kit **成对**锁 `1.0.0-rc.4`(npm `rc` 标签);pg 8.22.0、@types/pg 8.20.0。网上 v0 与 v1 教程混杂程度比 oRPC 还凶,任何陌生 API 先跑导出探针(`node -e "import('drizzle-orm/pg-core').then(...)"`)再信。禁止 import 任何内部路径;正式版发布后不追随升级,走契约矩阵重放再决策。

## casing-rework:定义期 casing,配置项已死

- v1 把 casing 从运行时/配置项迁进 schema 定义:`snakeCase.table` = `pgTableWithCasing('snake_case')`,TS camelCase 属性在**定义期**烘成 snake_case 列名(实测:`createdAt` 属性 → 迁移 SQL 里的 `created_at`)。同族 `snakeCase.view/materializedView/schema`。
- 质变而非等价替换:表对象携带最终列名,插件的 schema 导出**自包含**,不依赖消费方配置;"kit 与运行时两边 casing 要一致"的纪律性约束结构性消失。
- `drizzle({ casing })` 已从 DrizzleConfig 移除;kit 的 `casing` 只剩 introspect 用途。**两处都禁止写**(已入 CLAUDE.md)。

## RQB v2:pg 驱动的 `schema` 选项已移除

- `DrizzlePgConfig = Omit<DrizzleConfig, 'schema'> & { codecs? }`,`NodePgDatabase<TRelations>` 泛型改为 relations(v0 的 `drizzle({ client, schema })` 在 v1 编译不过)。
- 本项目用 RQB v2:需要 `db.query.*` 的插件用 `defineRelations` 构建 relations,经 `ctx.db.withRelations(relations)` 拿类型化视图(同一连接池上的多实例,WeakMap 缓存,随 pool disposal 一起清空)。
- 列级类型安全来自静态 import 的表对象,与实例泛型无关。db 服务保持 schema 无知(L0 不得依赖业务表定义)。
- 跨插件取表约定:import 对方包 `/schema` 子导出 + inject 对方服务 + qualy.dependsOn 声明(installed 闭包)。

## 迁移执行:migrator 实查(rc.4 源码)

- `readMigrationFiles({ migrationsFolder })` 公开导出(`drizzle-orm/migrator`):按文件夹名排序读取,**hash = migration.sql 全文 sha256**——与账本里存的 hash 同源,这是宿主启动期校验"已应用迁移被篡改"的依据(实测:改一字节即拒启)。
- `migrate(db, { migrationsFolder, migrationsTable?, migrationsSchema? })` 在 `drizzle-orm/node-postgres/migrator`。**待应用迁移在单个事务里执行**(源码:`db.transaction` 内循环 `tx.execute` + 逐条写账本行),一批迁移原子生效。
- 账本 DDL(实测 `\d cordis_meta.schema_migrations`):`id serial PK / hash text not null / created_at bigint / name text / applied_at timestamptz default now()`。v1 相比 v0 增加 name 与 applied_at。
- 本仓配置:`drizzle.config.ts` 的 `migrations: { schema: 'cordis_meta', table: 'schema_migrations' }`,CLI 与运行时 migrate 同参数,账本唯一。
- 审计落点定案:**不改写 Kit/migrator 的账本表**,旁挂 `cordis_meta.migration_audit`(name/hash/assembly_sha256/applied_by/applied_at),宿主在 autoMigrate 应用后写入。
- 宿主迁移全程持 PostgreSQL advisory lock(session 级,专用 client 持有),多宿主并发安全;autoMigrate=false 且有 pending 时抛错,依赖方保持 pending。

## Kit 快照 = 导出集合:diff 范围原理与实证

- generate 的 diff 空间 = 「schema 输入的导出集合」vs「本地快照」。**聚合物里没有 = 该删**:实证是把聚合物换成 `export {}` 后 `generate --explain` 直接计划 `DROP TABLE "ping_logs"`。
- 反过来,不在导出集合里的外来表(其他插件的表、手工建的表)完全不进 diff 视野,产物只含本集合 + 正确外键——非交互、确定性。这是 ORM 终审里战胜 rake-db 的那条生死线(rake-db 把库里的外来表提名为 rename/删除候选)。
- 由此推出装配纪律:schema 输入永远是 installed 集的完整导出(installed.lock.json 驱动,active/disabled 不可见),空集只有 `--init-empty` 显式放行。
- CI 哨兵原理(P5 落两层):**generate 比对 snapshot**(抓"代码 vs lineage"漂移,已在 CI 以 no-op generate + git diff --exit-code 落地);**push --explain 比对真实 catalog**(抓"库 vs lineage"漂移,只读,生产禁 push)。行为对象的 catalog 校验用 `pg_get_functiondef/pg_get_triggerdef` 规范化 hash 与 register 注册表比对。

## kit 程序化 API(实测)

`drizzle-kit/api-postgres` 导出:`generateDrizzleJson / generateMigration / pushSchema / startStudioServer / up`。golden cases(P5 起建)与未来工具链可直接程序化调用,无需 CLI。

## 行为层纪律(function/trigger)

- 两家 ORM 都没有 schema 内一等 trigger/function 定义,裸 SQL 迁移是共同答案;本仓的家 = 插件 `db/behavior/NNNN_name.sql` 编号片段(只增不改,behavior.lock.json 登记 sha256),由 `pnpm db:gen` 编译进中心迁移 lineage(带 plugin/source-sha256/assembly-sha256 确定性头部)。
- `CREATE OR REPLACE FUNCTION` **不能改签名**(参数/返回类型变化 = 新对象),签名变化走 `_v2` 新建→切换引用→显式 `DROP ... RESTRICT`。
- migrate 单事务背景下,同事务内 REPLACE 触发器/函数会持相应对象锁直到提交,大迁移批次注意锁面;`CREATE OR REPLACE TRIGGER` PG18 可用。
- 触发器函数一律 schema-qualified、`SECURITY INVOKER`、`SET search_path = pg_catalog, pg_temp`(SECURITY DEFINER 若不锁 search_path 是提权漏洞的经典源头)。
- **运行时自动化边界 = 无歧义加法**:宿主启动期只自动执行"确定无歧义的加法"(应用尚未应用的迁移);一切裁决类操作(改名/删除/签名变化)归 db:gen 生成期与人工审阅。
- 生命周期原则:表是数据,停用永不删;触发器等行为对象由**迁移**创建,运行时开关只控制消费者(worker 停了,dirty 还在积累,恢复后续消)。

## 迁移策略定案:停用不删表 + 显式 PURGE

- schema 聚合由 installed.lock.json 驱动(见 architecture/database.md 三集合模型),cordis.yml 的启停对聚合物不可见(CI 有不变式测试)。停用插件 = 功能下线、表与数据保留。
- 插件退出 installed 仅通过显式 PURGE 流程(文档化于 architecture/database.md,DROP 一律 RESTRICT,禁 CASCADE);drop-guard 拦截生成物里的 DROP TABLE/COLUMN,`ALLOW_DESTRUCTIVE=1` 或迁移内 `-- destructive: approved` 才放行。

## 主键定案:UUIDv7,数据库侧生成

- `uuid().primaryKey().default(sql\`uuidv7()\`)`:PG18 原生函数,默认值进 DDL,psql 修数、ETL、任何裸 SQL 写入都自动拿到 ID(实测:插入返回版本位为 7 的 id)。rc.4 无 v7 专用 builder(只有 `defaultRandom()`对应 v4),走`sql` 模板。
- `$defaultFn` 的正确场景是"插入前就要拿到 ID"(先入队再落库、乐观 UI):届时在该表**叠加** `$defaultFn`(应用预生成 + DDL 兜底),不是二选一。
- 时间戳列统一 `createdAt/updatedAt` + `withTimezone: true`。

## 备选巡视(终审证据与后备)

- **Orchid ORM(2026-07-31 终审结案,维持 Drizzle)**:动因是每插件独立迁移账本(rake-db migrationsTable/migrationsPath)、可逆迁移、查询人体工学、zod 一体化。致命实验(双插件模拟):库里预置 org_units 后,gradebook 侧 rake-db 生成器交互提示 `~ org_units => course_scores` 改名候选——生成器把「库里有、代码里无」的**外来表**纳入处置空间,且 RakeDbCliConfigInputBase 无任何范围过滤字段;二十余插件下无人值守生成不可能。另有内核耦合包(BaseTable)代价。翻案条件:rake-db 引入 diff 范围过滤后复刻双插件实验。
- **rake-db `recurrentPath` prior art**:每次迁移后重复执行的 SQL 目录(函数/触发器惯用),是"行为片段"思路的先例;与本仓不可变 lineage 的差异在于它是"每次重放",不留按次审计。
- **Kysely 三口径**:`drizzle-orm/kysely` 子路径 **v1 已移除**(实测 ERR_PACKAGE_PATH_NOT_EXPORTED);Kysely 作为查询层替补无必要(RQB v2 够用);作为**迁移层后备**保留——若 rc 期 Kit 生成器出现无法锁版本规避的快照语义破坏,退路是保留 drizzle 表定义 + Kysely/裸 SQL 手写迁移层(迁移 SQL 本就要求可脱离 Drizzle 执行)。

结案:**"Drizzle v1,2026-07 终审,三轮对比两轮实验,证据在案,不再重开。"**

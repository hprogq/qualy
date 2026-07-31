# 数据层架构

> 本文是数据层的规范文档:三集合模型、装配、迁移、行为层、dirty/projection 与 PURGE。
> 决策论证与实验证据见 docs/notes/drizzle.md 与 docs/notes/orm-review.md,此处只陈述形态。

## 1. 三集合模型与所有权

| 集合 | 含义 | 权威 |
|---|---|---|
| available | 包可被发现(workspace 里存在) | 文件系统 |
| installed | 数据库对象必须存在;**依赖闭包** | `installed.lock.json`(提交入库) |
| active | 业务入口与 worker 运行中 | `cordis.yml` |

- cordis.yml 只决定 active。**active 的任何变化(含 disabled)不得改变 installed 驱动的任何生成物**(CI 不变式测试守护)。
- 仅显式 PURGE 流程(§7)可使插件退出 installed。
- 所有权划分:插件拥有 schema entry、behavior 片段、依赖声明、projection worker、全量重建实现;平台拥有 installed lock、装配生成、中心迁移史、片段不可变检查、迁移执行与审计、dirty 基础设施、生命周期状态机、PURGE 依赖检查。
- 核心原则:表是数据,停用永不删;触发器等行为对象由**迁移**创建,运行时开关只控制消费者;结构变更的裁决需要全局视野(中心生成),行为书写归属插件(片段,中心编译入迁移史)。

## 2. 声明与安装

- 插件的数据库能力靠 package.json `qualy` 字段**声明**,禁止探测:

```jsonc
{
  "qualy": {
    "database": {
      "schemaEntry": "./src/db/schema.entry.ts",
      "behaviorDir": "./db/behavior"
    },
    "dependsOn": ["@qualy/plugin-database"]
  }
}
```

- 已安装插件声明了 schemaEntry 但解析失败 = **硬失败**;未声明 = 明确无数据库能力。
- 安装用 `pnpm plugin:add <name>`:一次完成根 workspace 依赖 + installed.lock 条目 + cordis.yml 条目 + 依赖闭包校验。普通开发禁止手删 installed 条目。
- 聚合硬失败清单:重复插件 id、重复 entry 文件、dependsOn 循环、installed 非依赖闭包。聚合顺序 = 依赖拓扑序。
- 空 installed 集不得自然产出空 schema:仅显式 `--init-empty` 放行。

## 3. 装配层

- `pnpm gen` 产出 `generated/db/assembly.gen.ts`(installed 集拓扑序的 schemaEntries 路径数组,gitignore)与 **提交入库** 的 `assembly.lock.json`(每插件 id/version/schemaEntry/schemaHash/behaviorHash/dependsOn + assemblySha256)。
- `drizzle.config.ts` 的 `schema` 直接消费 schemaEntries;迁移账本配置 `migrations: { schema: 'cordis_meta', table: 'schema_migrations' }`。
- 每插件 `src/db/schema.entry.ts` **只做直接命名导出**(`export { pingLogs } from './schema.ts'`),禁止嵌套对象包装、多层 re-export、条件导出。运行时给 `drizzle()` 的对象可另行组装,不必与 Kit 输入同形。
- 中心迁移文件头部带 `-- assembly-sha256:` 注释;禁止改写 Kit 的 snapshot 内部制品。

## 4. 宿主迁移职责(database 插件)

init 顺序(全部实测):建池 + `pool.on('error')` → `select 1` 探活 → 取 advisory lock(session 级,专用 client)→ 校验全部已应用迁移的 sha256(账本 hash = migration.sql 全文 sha256;被改即拒绝启动)→ `autoMigrate`(默认 true)则单事务应用 pending,为假且有 pending 则抛错(依赖方保持 pending)→ 写旁挂审计表 `cordis_meta.migration_audit` → 释放锁 → 构造 drizzle 实例 → `yield` 清理(重置视图缓存 → `pool.end()`)。

`register(ns, schema, meta?)`(effect 托管)维护 `cordis_meta.plugin_objects` 表→插件归属注册表(object_kind/schema_name/object_name/identity_arguments/parent_relation/source_hash/installed_migration/on_remove);`meta.onRemove: 'keep'|'drop'` 仅供 PURGE 流程读取,任何情况不自动删数据。注册时校验对象在 information_schema 存在,缺失 warn 指引 `pnpm db:gen`。

## 5. 行为层(trigger/function)

- 片段:插件 `db/behavior/NNNN_name.sql`,**只增不改**;`behavior.lock.json`(提交)登记 sha256 与产出迁移。已登记片段变更或消失 = 构建失败。
- 片段可声明 `-- phase: pre-structure|post-structure|manual`(默认 post);manual 产出的迁移带 `-- manual-review: pending` 标记,须人工完成并审阅。
- `pnpm db:gen` 是**单一编排命令**(自带文件锁):装配 → pre-structure 片段(`generate --custom` 骨架 + 确定性头部)→ Kit 结构 diff(必须 `--name`)→ post-structure 片段 → drop-guard → lock 更新。禁止分段手跑、禁止跨迁移重排历史。
- 幂等纪律:首建严格 CREATE;函数体升级 `CREATE OR REPLACE FUNCTION`;触发器升级 `CREATE OR REPLACE TRIGGER`(PG18);**签名变化**走 `_v2` 新建→切换引用→显式 `DROP ... RESTRICT`;`IF [NOT] EXISTS` 仅限标注的补偿迁移。
- drop-guard:新产出迁移含 `DROP TABLE`/`DROP COLUMN` 即整体回滚,`ALLOW_DESTRUCTIVE=1` 放行;已审阅的 PURGE 迁移用 `-- destructive: approved` 标记。
- 分支纪律:迁移目录与三个 lock 禁止机械合并,分叉后基于最新主线重新生成。

## 6. dirty queue 与 projection(DDL 与语义定案;实现随 P3)

平台 schema `qualy_core`:

```sql
create table qualy_core.projection_dirty (
  plugin_id     text not null,
  projection_id text not null,
  dirty_key     text not null,
  first_dirty_at timestamptz not null default now(),
  last_dirty_at  timestamptz not null default now(),
  last_op        text not null,          -- diagnostics only, never decision input
  revision       bigint not null default 1,
  primary key (plugin_id, projection_id, dirty_key)
);
create index projection_dirty_poll
  on qualy_core.projection_dirty (plugin_id, projection_id, first_dirty_at);

create table qualy_core.projection_state (
  plugin_id     text not null,
  projection_id text not null,
  desired_definition_hash      text not null,
  materialized_definition_hash text,
  state         text not null,           -- ACTIVE | RECONCILING | ERROR
  last_success_at      timestamptz,
  last_full_rebuild_at timestamptz,
  last_error    text,
  primary key (plugin_id, projection_id)
);
```

- **合并型 dirty set,非事件日志**:插件常开触发器(behavior 片段)upsert(`ON CONFLICT ... revision+1`);触发器函数 schema-qualified、`SECURITY INVOKER`、`SET search_path = pg_catalog, pg_temp`。
- worker 模板:短事务 `FOR UPDATE SKIP LOCKED LIMIT n` 按 first_dirty_at 取批 → **读源数据当前状态**(存在则重算、不存在则删派生行,绝不按 last_op 决策)→ upsert 投影 → 删 dirty 行 → 提交。慢计算(AI/分钟级)用 lease:认领→提交→计算→确认 revision 未变→写回。大批量导入热点的 statement-level + transition table 方案列为 P5 备选。
- 语义定案:**dirty queue 负责增量一致性,reconcile 负责定义升级与故障恢复**。插件启动:两 hash 一致→续消 dirty;不一致→RECONCILING→插件全量重建→校验→更新 hash→ACTIVE。

## 7. PURGE 流程(文档化,本阶段不实现)

RETIRED(active 移除,表保留)→ 禁新写入 → 清消费任务 → 依赖检查(`pg_constraint` 入站外键、`pg_depend`、manifest 引用、projection_state)→ 显式 PURGE 迁移(`DROP ... RESTRICT`,迁移内标注 `-- destructive: approved`,ALLOW_DESTRUCTIVE 生成)→ tombstone 记录 → 从 installed/assembly 两个 lock 移除 → PURGED。

**禁止 `DROP SCHEMA ... CASCADE`**;`plugin_objects.on_remove='keep'` 的对象在 PURGE 中保留并转为孤儿登记。

## 8. 运行时自动化边界

宿主启动期只自动执行**无歧义加法**(应用尚未应用的迁移);一切裁决类操作(改名、删除、签名变化、集合缩减)只发生在 db:gen 生成期并经人工审阅提交。灾备路径:迁移 SQL 可脱离 Drizzle 执行(PG18 + SQL 顺序执行 + 记 hash 的纯 migrator)。

# 数据库与迁移

本文描述当前数据层。2026 年 8 月回退的 governance v3 方案已从现行文档移除；重新引入复杂机制必须满足[数据层回顾](../notes/data-layer-retrospective.md)记录的真实触发条件。

## 职责边界

`@qualy/assembly` 不理解表、迁移或 PostgreSQL。数据库语义由 `@qualy/plugin-database` 的装配能力解释：业务插件通过描述器贡献实体、复合外键和可选 baseline 片段，database provider 在解析、生成、部署和运行期执行对应职责。

实体使用 MikroORM 7 定义，查询默认通过 `kyselyOf(em)` 使用 Kysely Query Builder。原生 SQL 只用于 PostgreSQL 特有表达，并以尽可能小的 typed fragment 嵌入查询。跨插件访问表需要声明插件依赖，并把对方实体纳入自己的实体闭包。

## 一条中央迁移历史

整个产品只有 `db/migrations` 一条提交的 SQL 历史，不按插件拆 migration stream。文件名为 `YYYYMMDDHHmmss[_name].sql`，迁移可以脱离 ORM 顺序执行。

```text
实体 + 复合外键 + baseline 片段
                 │
                 │ pnpm qualy generate（仅开发者）
                 ▼
          db/migrations/*.sql
                 │ review + commit
                 ▼
      CI verify / production deploy
```

生成时使用两个 scratch 数据库比较“已提交迁移重放后的结构”和“当前声明的应然结构”，不 introspect 开发或生产目标库。生成结果必须人工审阅；CI 和镜像构建只验证，不生成迁移。

已提交迁移只在末尾增长：不修改、不删除、不改名，也不回填早于当前 head 的时间戳。数据搬迁、回填和清理直接写进迁移，并用“旧形态 → 执行迁移 → 断言结果”的升级测试承重。已部署迁移只能 fix-forward。

## Baseline 片段

插件可以通过 `Db.entities(..., { baselineDir })` 提供 `NNNN_*.sql`。生成器把片段编入中央迁移，并记录来源和哈希。片段描述应然状态，必须幂等；一旦编入迁移就不能修改，后续变化新增片段或中央迁移。

Baseline 适合扩展、函数和静态种子等声明性基础；一次性业务数据步骤属于中央迁移。手工 custom migration 的首行声明 owner，但所有文件仍属于同一产品 lineage。

## Build、Deploy、Start

- **Build**：只打包当前源码、已提交 lock 和已提交迁移；不读取部署状态，不生成或应用迁移。
- **Deploy**：迁移器取得数据库级 advisory lock，按 ledger 应用镜像内待执行迁移。每条迁移在事务中，失败不记成功。
- **Start**：验证数据库已经达到镜像要求；生产默认 `QUALY_MIGRATIONS=off`，不会 resolve、generate 或 apply。

蓝绿部署会让两个 release 短时间同时连接一个数据库，因此迁移必须遵守 expand/contract。新增迁移用 `-- rollout: expand|maintenance` 声明能否在旧 release 仍服务时执行；非 expand 迁移要求维护模式。镜像回滚不等于 schema 回滚。

## 连接与事务

应用连接池有获取连接、statement、lock 和 idle-in-transaction 等上限；部署迁移器不继承应用超时。数据库暂不可用的失败由 database 插件标为 unavailable，再由 API 平台统一编码为安全的 503。

授权相关写入必须在同一数据库事务和同一连接内重读权限。结构性写入先取得租户行锁，再使用调用方连接复核授权；禁止持锁后另开池连接。生产 service、repo 和 handler 不自行 `Effect.run*`，事务和连接生命周期由 Effect scope 管理。

## 开发流程和门禁

修改实体、baseline 或迁移前：

1. 阅读本页、[数据层回顾](../notes/data-layer-retrospective.md)和相关实体／迁移测试。
2. 只有开发者工作流运行 `pnpm qualy generate`；检查生成 SQL 的 rollout、所有权和破坏性操作。
3. 运行相关升级测试、database check、drop guard 和 `pnpm qualy database verify`。
4. 提交 SQL 和代码；不要在 CI、build 或应用启动时补生成。

`pnpm db:reset` 会删除开发 Compose 数据卷，不属于常规验证命令。`qualy.lock.json`、已应用迁移和已编译 baseline 不手改。

MikroORM 上游缺陷、版本状态和本地守卫见[上游问题索引](../upstream/README.md)与 [MikroORM 实测笔记](../notes/mikro-orm.md)。

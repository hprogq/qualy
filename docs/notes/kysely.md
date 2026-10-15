# Kysely 查询实查笔记

## 裸 SQL 收敛（2026-10-15）

`docs/architecture/database.md` 的规则是查询默认用 Kysely Query Builder，原生 SQL 只保留 PostgreSQL 特有表达。2026-10-15 盘点（扫描服务端 `src` 下全部 `sql` 模板，不含 client）：

|                                       | 改写前 | 改写后                         |
| ------------------------------------- | ------ | ------------------------------ |
| `sql` 模板片段                        | 506    | 369                            |
| 内嵌整段语句的片段（不含 epoch 换算） | 约 110 | 30                             |
| 蛇形裸引用 `sql.ref('alias.snake')`   | 101    | 7                              |
| `sql.raw` 拼接                        | 7      | 0                              |
| 谓词参数 `RawBuilder<unknown>`        | 21     | 0（剩 1 处是排序表达式的类型） |

剩下的 30 处都只承担 PostgreSQL 自己的语法：ltree 包含与子树迁移、jsonb 祖先链展开与组装、站位指纹（`sha256`、有序 `string_agg`）、`pg_advisory_xact_lock`、`uuidv7()`、`generate_series`、`pg_notify`、`pg_timezone_names`、`ctid` 批量删除、带 `FROM` 的 `UPDATE`、可写 CTE（结束轮次的三处写入）。保留下来的零散片段是时间换算（`extract(epoch …)`、`to_char … at time zone`、`date_trunc`、`make_interval`、`to_timestamp`）与类型转换（`::uuid[]`、`::ltree`、`::jsonb`）。

做法：

- 谓词（`staffReachOver`、`mayActOn`、`withinReach`、`visibleTo` 等）用 `expressionBuilder<Schema>()` 在查询之外构造子查询，参数是带类型的 `Expression`，调用处传 `eb.ref('alias.property')`。改写前它们收 `RawBuilder<unknown>`，调用处写 `sql.ref('alias.snake_name')`，列名拼错也能编译。
- 结果行类型从查询推导，不再手写 `sql<{ snake_case: … }>`；仍保留的手写行类型（如 `PlacementRow`、`MyActionRow`、`UserActivityRow`）成了对构建器输出的检查。
- 区间、列表一律绑定为参数，不再用 `sql.raw` 拼字符串。
- `distinct on`、递归 CTE、`union all`、lateral join、`jsonArrayFrom` 都有构建器写法，不构成保留裸 SQL 的理由。

两类代码有意保留裸 SQL：

- `@qualy/rbac-contract` 的 `scopeCoverage`：契约包不认识任何插件的实体，只能对 `org_nodes` 写语句；它接收的已是 `Expression`，调用处不需要 `as never`。
- 升级回填（`scoring/backfill.ts`）：它面对的是某条迁移之后的历史表结构，实体元数据描述的是最新结构；升级测试也以无实体元数据的上下文运行它，构建器写法在那里直接找不到表。

## MikroORM 实体命名插件的边界（2026-10-15，实测）

`kyselyOf(em)` 用 `tableNamingStrategy: 'entity'`、`columnNamingStrategy: 'property'`，由 `@mikro-orm/sql` 的 Kysely 插件（`plugin/transformer.js`）在发出前把实体名和属性名改写成表名和列名，结果行再改回属性名。两种写法会让它对不上，类型检查都发现不了，只在执行时报 `column … does not exist`：

1. **带别名的更新目标不改写列名。** `updateTable('ReviewPanelAssignment as pa')` 下 `pa.tenantId` 原样发出。更新与删除的目标表不加别名，用实体名限定（`ReviewPanelAssignment.tenantId`）。
2. **派生表被当作它第一个 FROM 的实体。** `transformer.js` 的 `processFromItem` 把子查询别名记到源实体上，外层引用凡是与该实体某个属性同名，就按那个属性改写成蛇形列名；未加别名的内层选列则以蛇形列名输出。因此派生表的每一列都要显式起别名，且别名不能与源实体的属性同名（`participantPlacements` 里 `reconciledOrgStateHash` 改叫 `reconciledHash`）。

派生表、CTE 与 lateral 子查询都适用第 2 条：申报动态的 union 输出列改名为 `claimId`、`questionId`、`byId`、`sortAt`，撤回谱系的递归 CTE 用 `rootId`，lateral 子查询里的 `u.displayName` 起别名 `speakerName`。

这些失败都由现有测试抓到（合议座位、名册站位、申报动态、升级回填），修正后对应套件通过。

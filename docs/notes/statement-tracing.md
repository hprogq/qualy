# 语句级追踪（2026-10-15）

## 为什么

APM 里数据库只有 `db.query` 一种 span，它包着整个回调。收件箱一个回调跑 7 条授权查询，巡检每分钟跑约 270 条 `reviewersAt`，在 APM 上都只是若干个 `db.query`，查不出"同一条语句跑了几次、每次多久"。那次是靠恢复演示基线、打开 `log_min_duration_statement` 才定位到规划耗时（`docs/notes/kysely.md`）。

原设计（`docs/archive/designs/opentelemetry-implementation-plan.md` §12.3）不采集 SQL，是因为数据库边界只看到一个不透明的 Promise，不是隐私裁决；同一份设计写明"参数化 SQL text 可接受，bind values 与结果禁止"。

## 现行做法

- **采集点**：连接池每个连接的 `client.query`（`packages/plugins/infra/database/src/server/statements.ts`）。Kysely 的 `PostgresConnection` 以 `client.query(sql, parameters)` 发送，MikroORM 7 的 ORM 查询与事务控制也走同一个 Kysely 客户端（`repos/mikro-orm/packages/sql/src/AbstractSqlConnection.ts`）。一条实际语句一个 client span。
- **归属**：`query` 与 `transaction` 把交给驱动的那一刻 fiber 的 span、Tracer、Clock 放进 AsyncLocalStorage，在调用时读取一次，不在语句结束时回头读 fiber。没有这层上下文的语句不建 span：迁移、schema 对比、监听器的独立连接，都没有所属操作。
- **层级**：`db.query`、`db.transaction` 改为 INTERNAL，不带 `db.*` 属性，只作分组；BEGIN、`set transaction`、COMMIT/ROLLBACK 在 `db.transaction` 下，回调里的语句在 `db.query` 下。
- **属性**：`db.system.name`、`db.namespace`、`server.address`、`server.port`、`db.operation.name`（固定动词表，其余为 OTHER）、`db.query.summary`（动词 + 第一张表，也是 span 名）、`db.query.text`（驱动发送的文本，值的位置是 `$n`）。
- **指标**：`db.client.operation.duration` 改为每条语句一次，属性加 `db.operation.name`，失败带 `error.type`（SQLSTATE 或固定类名）与 `db.response.status_code`。原先回调级的 `Interrupted` 不再存在：调用方被取消时，语句照常完成，记作成功。
- **失败**：语句 span 只带失败类别（`a database statement failed (22P02)`），不带服务端 message。

## 隐私怎么保证

1. **文本里没有值**：值走参数绑定。`tools/tests/sql-text.test.ts` 用 TypeScript 6 解析全部生产源码，拒绝以下写法：非字面量的 `sql.raw`/`sql.lit`、`sql` 的别名/解构/下标、交给 `execute`/`query`/`raw` 的拼接文本、`CompiledQuery.raw`、`executeQuery`、MikroORM 的 `raw`/`sql`/`ref`，以及数据库插件以外直接导入 `pg`。例外有两条，写明理由：`set transaction ${mode}`（取值来自字面量联合），`listen ${quoteIdentifier(channel)}`（独立连接，不追踪，频道名为常量）。用变量命名标识符的写法（`sql.ref(column)` 等）按文件计数，新增即失败、需审阅。门禁自带反例，证明这些写法确实会被找到。
2. **导出时去掉驱动原文**：PostgreSQL 的 message 可能引用被拒绝的值（`invalid input syntax for type uuid: "…"`）。Effect 的 OTLP 导出器会把失败的 message 和含 cause 链的堆栈写进每个以同一 cause 结束的 span 和日志。`@qualy/telemetry/redaction` 包装导出用的 tracer 与 OTLP logger：带 `exportMessage` 标记的错误（`QueryFailed` 只标 SQLSTATE 或固定类名）导出时只剩这句话和它自己的栈帧，其下的 cause 不再导出；它上层的错误保留自己的文字。stdout 日志、原始错误对象和业务处理都不变。access-log 原先把 `Cause.pretty` 拼进日志正文，改为把 Cause 本身交给日志。
3. **测试看整个导出内容**：`packages/plugins/infra/database/tests/tracing.test.ts` 用真实 OTLP 导出器发到本地接收端，在全部收到的字节里查找成功查询与失败查询所用的参数值；`packages/core/telemetry/tests/telemetry.test.ts` 覆盖 span、`die`、日志的 cause 与日志正文。

已知的非参数文本：MikroORM 首次连接时执行 `select 1 from pg_database where datname = '<库名>'`，库名来自部署配置。

## 演示基线上的对比

10-08 基线，本地 PG18，记录型 tracer：

| 场景                  | 改造前能看到的                                             | 改造后能看到的                                                                                                |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 辅导员收件箱（50 条） | 一个 `db.transaction` 63.6 ms，内含一个 `db.query` 62.3 ms | 28 条语句：授权 `select "ri"."id"` 2 次共 29.6 ms，计数 3 次 13.5 ms，页面、事项选项、单位选项各一次约 4–5 ms |
| 巡检                  | 181 个 `db.query`，每个约 0.4–2 ms                         | `role_grants` 成员查询 109 次共 209 ms；合议席位与合议庭查询各 35 次约 13 ms                                  |

开销：巡检单次 310–377 ms，与接入前（312–340 ms）一致。

## 验证

- 一个回调多条 SQL、事务控制与 JOIN-EXISTING、两个并发调用不串父级（确认两者确有重叠）、失败查询（调用方拿到的仍是原错误）、关闭追踪与 tracer 抛错不影响结果。
- 中断、连接释放、超时等原有数据库测试未改语义，全部通过；只有中断指标的断言按新口径改为"不记失败"。
- 反向验证：去掉 `QueryFailed` 的导出描述，导出测试失败；语句 span 改用原始错误，失败查询测试失败；去掉 tracer 或 logger 的清理，遥测测试失败。

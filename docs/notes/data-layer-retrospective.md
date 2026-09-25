# 数据层回退记录(2026-08-01)

## 回退动因

数据层治理栈(v3:installed/assembly/behavior 三 lock、db:gen 编排器、宿主 checksum 拒启、advisory lock、对象 registry)在两轮外部评审推动下一次性建成,但**机制超前于问题规模**:单人开发、两个插件、零多副本部署、零第三方分发,治理面向的事故(lock 漂移、并发迁移、历史篡改、无人值守批量生成)一个都尚未发生。维护这套栈的认知与摩擦成本是当下真实的,它防护的风险是假设性的。按元规则裁决:**复杂度必须由已发生的问题证明其存在**——回退。

## 归档

完整治理栈归档于 tag **`archive/data-governance-v3`**(commit 2c6e8dc,已推送远程),含全部实现、实测记录与文档,可整体找回,无需重新设计。

## 删除清单

- 三个 lock:`installed.lock.json`、`assembly.lock.json`、`behavior.lock.json`
- 编排与库:`scripts/db-gen.ts`、`scripts/lib/installed.ts`、`scripts/lib/assembly.ts`、`scripts/lib/behavior.ts`、`scripts/gen-schema.ts`、`generated/`
- database 插件:verifyAndMigrate、迁移 checksum 校验、advisory lock、`migration_audit`、`plugin_objects`、`register` API、`autoMigrate` 配置

## 保留清单

- 声明式聚合(零生成物):qualy.yml 全量条目 + `qualy.database.schemaEntry` → `resolveSchemaEntries()`,停用不改变聚合(不变式测试);声明了解析失败 = 硬失败
- `drop-guard`(接在 `pnpm db:generate` 后,拦 DROP TABLE/COLUMN/SCHEMA...CASCADE)
- `cordis_meta.schema_migrations` 账本配置;先 migrate 后 start 的启动顺序
- schema 三规范(`snakeCase.*`、uuidv7 DDL 默认主键、`createdAt/updatedAt` + withTimezone)、跨插件真外键(onDelete 基线 restrict)、卫星表约定、`Service.init` 异步初始化模式、PGlite 测试路径
- 全部 docs/notes 归档与 ORM 终审结论

## 约束性触发表

数据层重新引入下列机制,**必须**由对应条件实际发生触发;条件未发生前禁止预防性重建:

| 机制                          | 触发条件                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| installed.lock(三集合模型)    | 出现在线安装或多实例装配需求                                                                   |
| ~~behavior 片段编译器~~       | ~~多插件大量 trigger 且手工 custom 迁移频繁出错~~ **已于 2026-08-04 触发并落地**(见下)         |
| advisory lock(迁移互斥)       | 真实多副本部署                                                                                 |
| checksum 拒启                 | 实际发生历史迁移被篡改且 CI 未拦                                                               |
| 对象 registry 与 PURGE 自动化 | 决定实现自动卸载                                                                               |
| dirty/projection 基础设施     | P3 第一个真实派生数据场景                                                                      |
| 迁移 mode verify(校验不执行)  | 应用容器无 DDL 权限的生产部署真实出现                                                          |
| 插件自带 migration 序列       | 出现需独立发版的外部插件生态(版本 DAG/多 ledger)                                               |
| ~~池连接账本(checkout 归属)~~ | ~~关闭时池连接不归还且计数说不出是谁~~ **已于 2026-09-02 触发并落地**(见下)                    |
| ~~数据库等待上限与 503~~      | ~~锁排队占满连接池、库失联时请求与 ready 探针无期限挂起~~ **已于 2026-09-25 触发并落地**(见下) |

## 冻结规则

**数据层新增任何机制,必须由触发表中实际发生的事故或需求触发,禁止预防性建设。**

元规则:**复杂度必须由已发生的问题证明其存在,外部评审意见按此过滤。**

## 2026-08-04:baseline 片段编译器已触发

原触发条件写的是「多插件大量 trigger 且手工 custom 迁移频繁出错」,**条件写窄了**。实际触发它的是另一件事,而且已经在仓库里坏着:

clean-room 测试(挑一组插件、清空迁移目录、从零生成 lineage、部署到空库)对**每一种组合都失败**,包括当前默认组合,报 `type "ltree" does not exist`。原因是 `drizzle-kit generate` 只复现表,而 `CREATE EXTENSION ltree` 只存在于宿主手写迁移 `20260801222248_org-ltree` 里——那条迁移的注释已经写着 `-- owner: @qualy/plugin-org`,归属早就声明了,只是没有承载入口。也就是说:**org 插件不自包含,它依赖一段只活在宿主历史里的 SQL**,任何人换一组插件从零装配都装不起来。

所以正确的触发条件应表述为:**插件需要携带 Drizzle 表达不了的 SQL,且安装者不应手改宿主迁移**。这条与 trigger 数量无关,零个 trigger 时它就已经成立。

落地范围刻意保持窄:`baselineDir` 片段编译 + `dependsOn` 解析期校验 + clean-room 回归测试。**未恢复** installed/assembly/behavior 三 lock、对象 registry、自动 PURGE、运行时 DDL 注册、每插件独立 ledger。

## 2026-09-02:池连接账本已触发

触发它的是 `apps/server/tests/effect-api.test.ts` 在 CI 上偶发的 teardown 挂死(最近一次
run 33481203308):`@qualy/plugin-database` 的 release 不返回,池计数只能说「一条连接在外、无人排队」,
说不出是谁、在哪个后端、服务端认为它在做什么。orm.ts 里原先的注释把「包住 acquire 路径」保留为
§12.1 的重新评估触发点;这次事故正是那个触发。

落地范围刻意保持窄:

- `checkouts.ts`:一份 `AsyncLocalStorage` 把 `transaction`/`query` 的发起者(fiber、父 span、
  `source` 注解)带进池的 acquire;给驱动交出的 `pg.Pool` 包一层 `connect`,给**返回的 client**
  打标(不用 `'acquire'` 事件:实测排队等待者的 acquire 事件在释放者的异步上下文里触发,饱和时会
  张冠李戴);`'release'`/`'remove'` 事件消账。
- 关闭时的报告改成**每次实时读**池计数(原先是一次性快照,那 30 秒不变的 `total: 3, idle: 2`
  是构造时捕获的对象被重复打印),附账本里每条在外连接的持有者;首轮报告后用独立会话读一次
  `pg_stat_activity`(state / wait_event / 事务年龄 / 阻塞者 / 最后一句),两腿都有超时。
- 顺手证明并修掉一条真实泄漏:COMMIT 被拒后连接永不归还(见 notes/mikro-orm.md)。

**未做**:acquire 等待时间指标、按持有时长的告警、任何缩短等待的超时——放弃等待会把泄漏变成静默成功。

## 2026-09-17:transition(插件自带一次性数据步骤)已触发

触发它的是构建/装配/部署重构(`docs/osi.md`,P3/P4):迁移 lineage 从仓库 `db/migrations` 搬进**每个实例**的
Deployment State(`<state>/database/migrations`),全新安装自己生成 initial,不再继承仓库的开发历史。
这样一来,22 条带 `-- owner:` 的手写迁移(19 条含 UPDATE/INSERT/DELETE 数据步骤,四个插件各有 `migration-upgrade.test.ts`)
所依赖的「共享 lineage 文件」不复存在:结构 diff 推不出「先把列里的值搬进新表再删列」,而 `qualy database custom`
只写进本机实例。也就是说,**不是**多副本或第三方生态触发了它,而是数据步骤失去了跨实例的承载入口——
与 2026-08-04 baseline 的触发同型:归属早就声明在插件里,只缺承载。

落地范围刻意保持窄:`Db.entities(entities, { transitionsDir })` + 复用 baseline 的 marker/collect/pending/compile
基础设施(`fragments.ts`)+ 「空 lineage 只记 `satisfied` 不执行」+ expand/contract 两次发布约定 + 五条测试。
**未做**:transition 的条件执行 DSL、跨插件 transition 依赖图、每插件独立 ledger、自动把历史手写迁移改写成 transition
(它们是 legacy lineage 的历史,原样保留)。

顺带修掉一处潜伏缺陷:同一秒内两次 generate 生成同名迁移,后一次 rename 覆盖前一次(此前 generate 是人手敲的命令,
从未在一秒内跑两次;deploy 内置 generate 之后会)。现在 stamp 取「当前时刻」与「lineage 最新一条 + 1 秒」的较大者。

触发表里「advisory lock(迁移互斥)」**仍未触发**:`docs/osi.md` §29 写的是「最好有」,而其「最低要求」——
同一 state 目录同一时间只允许一个 deployment job——已由 `@qualy/deployment-state` 的文件锁满足。

## 2026-09-17(同日):transition 撤回,advisory lock 触发

产品定位当天重新明确(P4.5 架构收敛):Qualy 是单一代码库、单一产品、单一发布物,不以客户任意拼装 Product 为目标。
于是「lineage 归实例」不再成立,lineage 回到仓库 `db/migrations` 并提交;**transition 机制随之撤回**——迁移文件本身
就是数据步骤的最终表达,不需要第二种载体。当天早先那一节的触发理由(数据步骤失去跨实例载体)前提已消失。
保留下来的:`nextStamp`(同秒两次 generate 不再互相覆盖)、`QUALY_GENERATION_DATABASE_URL`(开发/CI 的 scratch 服务器)、
`qualy database verify`(CI 不生成只比对)。

**advisory lock(迁移互斥)已触发**:不是多副本部署,而是产品要求「migration/deploy 的 single-writer 保护」放在真正产生
副作用的数据库迁移层(P7 验收第 7 条),取代原先文件锁 + deployed lock 的 state 目录。落地:`migrator.ts` 的
`withMigrationLock`(固定 key 的阻塞式 `pg_advisory_lock` + `lock_timeout`,第二个写者排队,等待超过
`QUALY_MIGRATION_LOCK_TIMEOUT_MS`(默认 120s)才拒绝并点名目标——「立即拒绝」的第一版让同一 scratch 库上并发建层的 31 条
测试全红,开发态 boot 撞上 deploy 也该排队而不是失败;`runMigrations` 与 `adoptMigrations` 持有,只读的 `pendingMigrations`
不持有),`tests/migrator.test.ts` 三条(排队后执行 + 超时拒绝 + 失败不记账)。

同时撤回的 P3 机制:`@qualy/deployment-state`(state 目录、deployed.lock、target/applied 比对、atomic promotion、文件锁)。
审计依据:当前分支只有 database capability 有 deploy 副作用,PostgreSQL ledger 已是实例的 applied state。

## 2026-09-17:generate 把外键排在它引用的唯一索引之前(记录,不建机制)

行政认定导入补外键时,新增的 `uq_entries_tenant_id_participant`(entries 上的三列唯一索引)与引用它的
`fk_administrative_entry_import_rows_entry` 同时出现在一次 diff 里,`qualy generate` 输出的顺序是先 drop/add 外键、最后才建索引。
这份文件在任何库上都执行不了:`qualy database verify` 重放时报 `there is no unique constraint matching given keys for referenced table "entries"`
(已实测,把生成原序放回去即复现)。按开发流程人工把 `create unique index` 挪到最前,`verify` 零漂移通过
(`db/migrations/20260916230042_administrative-import-references.sql` 顶部注释写明了原因)。

**不建机制**:生成物本来就要人工审查,CI 的 `database verify` 与本地同一命令已经能在提交前拦住这类文件,没有漏到任何库上。
触发条件记在这里:若同类顺序错误再次出现,或某一次没有被 `verify` 拦住,再考虑在 generate 里把「被外键引用的唯一索引」前置。

## 2026-09-25:数据库等待上限与 503 已触发

触发它的是 2026-09-25 上线前审查的 V11-platform#1.5(已确认)与随后的用户裁决(审查裁决 #4)。应用连接池没有任何上限:
pg-pool 取连接无期限排队(`connectionTimeoutMillis` 为 0),会话没有 `statement_timeout` / `lock_timeout` /
`idle_in_transaction_session_timeout`,`/health/ready` 的探针也不设期限。一次持批次行锁的整院行政认定,就能让同批次十几个并发写请求
各占一条连接等锁;池满之后登录、manifest、ready 探针全部排队。库失联时,请求挂到 TCP 重传超时(分钟级)才报错,而不是快速失败。
2026-09-02 一节「未做:任何缩短等待的超时」说的是关停时 `pool.end()` 的等待,这次不改它:关停仍然等在外的连接归还。

落地范围刻意保持窄:

- `DATABASE_TIMEOUTS`(`src/defaults.ts`):取连接 / 建连 5s、`statement_timeout` 30s、`lock_timeout` 10s、
  `idle_in_transaction_session_timeout` 60s,作为应用连接池的 driver 选项(三个 PostgreSQL 参数随启动报文下发)。
  `DATABASE_URL` 上的同名参数覆盖后三项(0 为关闭),不新增环境变量。迁移器(deploy job 与开发态 apply)用自己的会话,不继承这些上限。
  起初「不继承」只是没给迁移器的会话传这组 driver 选项,URL 上的同名参数照样随启动报文到了迁移锁连接与 `withMigrator` 的连接
  (`migrate` 与 server 共用一份 `.env`,照文档放宽请求上限就会让长回填、排在运行中 server 锁后的 DDL 被取消,等待迁移锁也按 57014 失败);
  库侧的 `ALTER ROLE / DATABASE … SET` 同理。现在迁移器每开一个会话,第一条语句就把 `statement_timeout`、`lock_timeout`、
  `idle_in_transaction_session_timeout`、`idle_session_timeout` 设为 0(迁移锁连接的 `lock_timeout` 设为自己的等待上限),
  `tests/migrator.test.ts` 两条(URL 带上限、库侧默认值带上限)守住。
- 分类归 database 插件:`QueryFailed` 构造时判断失败是否表示「数据库暂时无法服务」——取连接超时、连接断开、
  57014 / 55P03 / 25P03 / 57P01-03 / 57P05 / 53300 / 08 类,以及没有 SQLSTATE 的驱动断线消息——是则带上 api-kit 的 `unavailable` 标记。
  `transaction` 的 begin 与 commit 失败也改为以 `QueryFailed` 抛出,同样会被标记。
- 映射归 HTTP 边界:api-kit 的全局路由中间件 `unavailableDependencies` 把带标记的 defect 答成 503 `SERVICE_UNAVAILABLE`
  (公共码,浏览器集中翻译)。约束冲突与领域错误照旧;访问日志按 5xx 规则以 Error 记下原因。api-kit 不认识 PostgreSQL,只读标记。
- `/health/ready` 每个探针 4s 硬上限:探针在自己的 fiber 上跑,到期只停止等待,不等它中断完——`query` 的中断会等语句结束。
- 测试:`packages/plugins/infra/database/tests/timeouts.test.ts`(在真实库上逐项触发四种上限;约束冲突不被标记;会话参数与 URL 覆盖;
  HTTP 边界 503 / 500)、`packages/core/api-kit/tests/unavailable.test.ts`、`apps/server/tests/effect-shell.test.ts` 与
  `access-log-endpoint.test.ts` 的新增用例、`packages/web/runtime/tests/transport.test.ts` 的 503 用例。

**未做**:请求中断时对仍在执行的语句发 `pg_cancel_backend`(中断仍等语句在服务端上限内结束);按请求的整体超时;TCP keepalive 与
`query_timeout` 客户端读超时(库成为黑洞时,已发出的语句仍要等到 TCP 重传超时);连接池上限的环境变量;浏览器遇 503 自动重试。

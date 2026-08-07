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

| 机制                          | 触发条件                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| installed.lock(三集合模型)    | 出现在线安装或多实例装配需求                                                           |
| ~~behavior 片段编译器~~       | ~~多插件大量 trigger 且手工 custom 迁移频繁出错~~ **已于 2026-08-04 触发并落地**(见下) |
| advisory lock(迁移互斥)       | 真实多副本部署                                                                         |
| checksum 拒启                 | 实际发生历史迁移被篡改且 CI 未拦                                                       |
| 对象 registry 与 PURGE 自动化 | 决定实现自动卸载                                                                       |
| dirty/projection 基础设施     | P3 第一个真实派生数据场景                                                              |
| 迁移 mode verify(校验不执行)  | 应用容器无 DDL 权限的生产部署真实出现                                                  |
| 插件自带 migration 序列       | 出现需独立发版的外部插件生态(版本 DAG/多 ledger)                                       |

## 冻结规则

**数据层新增任何机制,必须由触发表中实际发生的事故或需求触发,禁止预防性建设。**

元规则:**复杂度必须由已发生的问题证明其存在,外部评审意见按此过滤。**

## 2026-08-04:baseline 片段编译器已触发

原触发条件写的是「多插件大量 trigger 且手工 custom 迁移频繁出错」,**条件写窄了**。实际触发它的是另一件事,而且已经在仓库里坏着:

clean-room 测试(挑一组插件、清空迁移目录、从零生成 lineage、部署到空库)对**每一种组合都失败**,包括当前默认组合,报 `type "ltree" does not exist`。原因是 `drizzle-kit generate` 只复现表,而 `CREATE EXTENSION ltree` 只存在于宿主手写迁移 `20260801222248_org-ltree` 里——那条迁移的注释已经写着 `-- owner: @qualy/plugin-org`,归属早就声明了,只是没有承载入口。也就是说:**org 插件不自包含,它依赖一段只活在宿主历史里的 SQL**,任何人换一组插件从零装配都装不起来。

所以正确的触发条件应表述为:**插件需要携带 Drizzle 表达不了的 SQL,且安装者不应手改宿主迁移**。这条与 trigger 数量无关,零个 trigger 时它就已经成立。

落地范围刻意保持窄:`baselineDir` 片段编译 + `dependsOn` 解析期校验 + clean-room 回归测试。**未恢复** installed/assembly/behavior 三 lock、对象 registry、自动 PURGE、运行时 DDL 注册、每插件独立 ledger。

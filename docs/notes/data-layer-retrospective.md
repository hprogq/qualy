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

- 声明式聚合(零生成物):cordis.yml 全量条目 + `qualy.database.schemaEntry` → `resolveSchemaEntries()`,停用不改变聚合(不变式测试);声明了解析失败 = 硬失败
- `drop-guard`(接在 `pnpm db:generate` 后,拦 DROP TABLE/COLUMN/SCHEMA...CASCADE)
- `cordis_meta.schema_migrations` 账本配置;先 migrate 后 start 的启动顺序
- schema 三规范(`snakeCase.*`、uuidv7 DDL 默认主键、`createdAt/updatedAt` + withTimezone)、跨插件真外键(onDelete 基线 restrict)、卫星表约定、`Service.init` 异步初始化模式、PGlite 测试路径
- 全部 docs/notes 归档与 ORM 终审结论

## 约束性触发表

数据层重新引入下列机制,**必须**由对应条件实际发生触发;条件未发生前禁止预防性重建:

| 机制 | 触发条件 |
|---|---|
| installed.lock(三集合模型) | 出现在线安装或多实例装配需求 |
| behavior 片段编译器 | 多插件大量 trigger 且手工 custom 迁移频繁出错 |
| advisory lock(迁移互斥) | 真实多副本部署 |
| checksum 拒启 | 实际发生历史迁移被篡改且 CI 未拦 |
| 对象 registry 与 PURGE 自动化 | 决定实现自动卸载 |
| dirty/projection 基础设施 | P3 第一个真实派生数据场景 |

## 冻结规则

**数据层新增任何机制,必须由触发表中实际发生的事故或需求触发,禁止预防性建设。**

元规则:**复杂度必须由已发生的问题证明其存在,外部评审意见按此过滤。**

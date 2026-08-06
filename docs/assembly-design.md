# Qualy 可组合插件装配系统设计说明

## 0. 文档状态

本文定义 Qualy 从“源码仓库内的插件聚合”演进为“用户可自由选配、可持续升级、可部署和可恢复的插件化产品”所需的完整装配体系。

实施起点：

- 基于本地提交 `247dd19` 继续；
- 已完成的 `baselineDir`、`database.dependsOn` 解析校验和 clean-room 测试必须保留；
- 已修复的 readiness 装配门和数据库 migration 落后拒启逻辑必须保留；
- 不恢复旧 data-governance v3 的三个 lock、对象 registry、运行时 DDL 注册和多迁移账本；
- 新方案使用一个装配清单、一个装配 lock、一条 assembly 中央迁移 lineage。

---

# 1. 产品目标

最终用户应能通过 CLI 或未来的图形界面：

1. 选择需要的插件；
2. 自动补齐插件依赖；
3. 回答必要的初始化问题；
4. 生成属于当前插件组合的确定性装配；
5. 从空数据库完成部署；
6. 后续增加、停用、移除、升级插件；
7. 在数据库状态不匹配时拒绝启动，而不是带病运行；
8. 在误改配置、误删包或 lock 损坏时得到明确诊断和恢复路径。

用户不应手动：

- 编辑 `migration.sql`；
- 复制 trigger/function SQL 到宿主；
- 推算插件加载顺序；
- 手工组织 seed 顺序；
- 把数据库 UUID 写入配置；
- 记忆一串 pnpm、Drizzle 和 seed 命令；
- 通过删除文件来猜测插件卸载语义。

---

# 2. 核心原则

## 2.1 三层权威

系统必须区分三个不同层面的状态。

### `qualy.yml`

人类维护的期望装配：

- 需要哪些插件；
- 哪些插件启用；
- 插件运行配置；
- 非敏感初始化配置；
- secret 引用。

### `qualy.lock.json`

机器生成的精确装配：

- 最终插件集合；
- 精确插件版本和完整性；
- 直接依赖和传递依赖；
- active、disabled、detached 状态；
- 数据库 revision；
- schema、baseline、upgrade、provision 内容哈希；
- 依赖图和确定性执行顺序；
- 生成产物哈希。

### PostgreSQL 元数据

某个具体数据库的实际状态：

- 哪些 migration 已执行；
- 当前部署的是哪个 assembly artifact；
- provision 最近成功到哪个 revision；
- 当前数据库是否满足待启动应用。

不得用 `qualy.lock.json` 记录数据库实际执行进度。一个 lock 可能同时部署到开发、测试和生产数据库，各环境进度不同。

---

## 2.2 普通启动只验证，不修改

`qualy start` 不得：

- 安装包；
- 修改 `qualy.yml`；
- 重写 lock；
- 调用 Drizzle Kit；
- 生成 migration；
- 执行 migration；
- 提问；
- 自动 seed；
- 自动 purge。

启动只能：

1. 读取 manifest 和 lock；
2. 校验两者一致；
3. 校验包和生成产物；
4. 校验数据库 migration 和 provision 状态；
5. 状态全部满足后加载业务插件；
6. 装配完成后开放 readiness。

数据库落后时必须拒绝启动，并输出明确修复命令。

---

## 2.3 删除配置不等于删除数据

从 `qualy.yml` 删除插件，默认语义为 detach：

- 不再加载插件运行时；
- 保留插件表；
- 保留函数、trigger、view；
- 保留默认数据和业务数据；
- 保留插件包；
- 允许以后重新启用并复用原数据。

永久删除数据库对象必须执行显式 purge。

---

## 2.4 数据库变更采用前向演进

不要求每条 migration 提供通用 `down`。

原因：

- 删除的数据不可自动恢复；
- 列拆分和数据转换不可简单逆转；
- 函数签名升级可能与旧应用不兼容；
- 跨插件依赖无法可靠逆序回滚；
- 已写入新格式的数据不一定能还原。

规则：

- 未提交 migration 失败：事务回滚；
- 已部署 migration 有缺陷：fix-forward；
- 永久卸载插件：生成专门的 purge forward migration；
- 恢复业务数据：依赖备份，不依赖通用 down。

---

# 3. 装配文件设计

## 3.1 `qualy.yml`

`qualy.yml` 改为 Qualy 产品层 manifest，不再要求直接符合 Cordis Include 格式。

建议格式：

```yaml
version: 1

plugins:
  '@qualy/plugin-org':
    enabled: true
    config: {}

  '@qualy/plugin-auth':
    enabled: true
    config: {}

  '@qualy/plugin-auth-local':
    enabled: true
    config:
      sessionDays: 7

  '@qualy/plugin-rbac':
    enabled: true
    config: {}

setup:
  tenant:
    slug: default
    name: 大连外国语大学

  '@qualy/plugin-auth-local':
    adminUsername: admin
    adminPassword: '${secret:QUALY_ADMIN_PASSWORD}'
```

要求：

- 顶层必须包含格式版本；
- 插件以插件 ID 为 key，避免数组中重复声明；
- 文件排列顺序不表示依赖顺序；
- 允许手工编辑；
- CLI 和未来 Web 装配器也修改同一个文件；
- secret 只能保存引用，不能保存真实值；
- 不保存数据库 UUID。

## 3.2 手工修改语义

用户可以手工增删改 `qualy.yml`。

### 手工增加已安装插件

`qualy resolve` 正常解析。

### 手工增加未安装插件

`qualy resolve` 失败并提示：

```text
@qualy/plugin-x is requested but its package is not installed.
Run: qualy plugin add @qualy/plugin-x
```

普通 `start` 不得自动联网安装。

### 手工删除插件

下次 resolve 将它从 active 或 disabled 转为 detached，不生成 DROP。

### 手工修改配置

resolve 重新计算 manifest hash；需要 setup 校验的配置由 configure 阶段处理。

---

# 4. `qualy.lock.json`

## 4.1 定位

`qualy.lock.json` 类似 `pnpm-lock.yaml`，但锁定的是 Qualy 装配语义，而不是普通 npm 依赖树。

建议提交到版本控制。

不得手工维护。

## 4.2 示例结构

```json
{
  "lockfileVersion": 1,
  "manifestHash": "sha256:...",
  "resolutionHash": "sha256:...",
  "artifactHash": "sha256:...",
  "plugins": {
    "@qualy/plugin-org": {
      "version": "1.2.3",
      "integrity": "sha512:...",
      "requested": true,
      "state": "active",
      "installEpoch": 1,
      "runtimeDependsOn": ["@qualy/plugin-database"],
      "databaseDependsOn": [],
      "database": {
        "revision": 2,
        "schemaEntry": {
          "path": "src/db/schema.ts",
          "hash": "sha256:..."
        },
        "baselineDir": {
          "path": "db/baseline",
          "hash": "sha256:..."
        },
        "upgradesDir": {
          "path": "db/upgrades",
          "hash": "sha256:..."
        },
        "provisionEntry": {
          "path": "src/db/provision.ts",
          "revision": 3,
          "hash": "sha256:..."
        }
      }
    }
  },
  "plans": {
    "runtimeOrder": [],
    "databaseOrder": [],
    "provisionOrder": [],
    "migrationHead": "20260804150000_example",
    "migrationBundleHash": "sha256:..."
  }
}
```

## 4.3 Lock 中必须保存

- manifest hash；
- 精确包版本；
- 包完整性；
- requested 与传递依赖关系；
- active、disabled、detached、purged 状态；
- install epoch；
- runtime 和 database 依赖；
- database revision；
- schema、baseline、upgrade、provision 哈希；
- 确定性拓扑顺序；
- migration head 和 bundle hash；
- codegen artifact hash。

## 4.4 Lock 中禁止保存

- 密码和 token；
- secret 明文；
- 数据库 UUID；
- migration 是否实际执行；
- 某个数据库的 provision 状态；
- 环境专属连接参数。

## 4.5 用户修改 lock

### 开发模式

运行：

```bash
qualy resolve
```

根据 `qualy.yml`、包 metadata、pnpm lock 和上一个合法 lock 重新生成并覆盖。

### Frozen 模式

以下命令遇到不一致必须失败：

```bash
qualy deploy --frozen-lockfile
qualy start --frozen-lockfile
```

启动时不得自动修复 lock。

## 4.6 Lock 删除后的恢复

### 空库或新 assembly

允许重新 `qualy resolve`。

### 已部署数据库

必须优先：

```bash
qualy lock recover --from-database
```

从数据库最后一次成功部署记录中恢复 assembly snapshot，再根据当前 manifest 解析变化。

这样可保留 detached 插件历史。

---

# 5. 插件生命周期

插件状态：

```text
active
disabled
detached
purged
```

## 5.1 active

- 存在于 manifest；
- `enabled: true`；
- 参与运行时；
- 参与数据库 retained set；
- 参与 provision。

## 5.2 disabled

- 存在于 manifest；
- `enabled: false`；
- 不加载运行时；
- 继续贡献数据库 schema 和 baseline；
- 保留数据；
- 默认不运行其业务型 provision，但可运行数据库必要校验。

## 5.3 detached

- 上一个 lock 中存在；
- 当前 manifest 中不存在；
- 不加载运行时；
- 继续贡献数据库结构；
- 保留包和数据；
- 可重新加入 manifest 恢复 active。

## 5.4 purged

- 经过显式 destructive migration；
- 数据库对象已删除；
- 可从 package dependencies 中移除；
- 以后重新安装时 `installEpoch + 1`。

## 5.5 状态转换

```text
absent → active             plugin add
active → disabled           plugin disable
disabled → active           plugin enable
active/disabled → detached  plugin remove 或手工删条目
detached → active           重新加入 manifest
detached → purged           plugin purge
purged → active             再安装，installEpoch 增加
```

---

# 6. 插件 metadata

建议统一为：

```json
{
  "qualy": {
    "runtime": {
      "dependsOn": ["@qualy/plugin-database"]
    },
    "database": {
      "revision": 2,
      "schemaEntry": "src/db/schema.ts",
      "baselineDir": "db/baseline",
      "upgradesDir": "db/upgrades",
      "purgeEntry": "db/purge.sql",
      "dependsOn": ["@qualy/plugin-org", "@qualy/plugin-auth"]
    },
    "provision": {
      "entry": "src/db/provision.ts"
    },
    "setup": {
      "entry": "src/setup.ts"
    }
  }
}
```

字段职责：

| 字段                 | 作用                                       |
| -------------------- | ------------------------------------------ |
| `runtime.dependsOn`  | 服务运行依赖                               |
| `database.dependsOn` | 数据库对象与迁移依赖                       |
| `database.revision`  | 插件数据库模型版本                         |
| `schemaEntry`        | Drizzle 表、索引、约束、外键               |
| `baselineDir`        | 当前版本全新安装所需的非 Drizzle SQL       |
| `upgradesDir`        | 已有 assembly 升级到新 revision 的前向步骤 |
| `purgeEntry`         | 当前版本的显式卸载清理逻辑                 |
| `provision.entry`    | 可重复执行的状态收敛步骤                   |
| `setup.entry`        | 配置问题和输入 schema                      |

---

# 7. 数据库 SQL 模型

## 7.1 Drizzle schema

负责：

- 表；
- 列；
- 普通索引；
- unique；
- check；
- foreign key；
- Drizzle 能可靠表达的约束。

## 7.2 Baseline

`baselineDir` 描述插件当前版本在全新安装时所需的最终数据库状态。

适合包含：

- `CREATE EXTENSION IF NOT EXISTS`；
- function；
- trigger；
- view；
- PostgreSQL 特殊对象；
- 安装期不可编辑的基线数据；
- `ON CONFLICT DO NOTHING` 的系统保留记录。

目录：

```text
db/baseline/
  0010_extensions.sql
  0020_functions.sql
  0030_required_data.sql
  0040_triggers.sql
```

片段头：

```sql
-- phase: pre-structure
```

支持 phase：

```text
pre-structure
post-structure
```

默认 `post-structure`。

扩展、类型等必须在表创建前存在的对象使用 `pre-structure`。

trigger 等依赖表的对象使用 `post-structure`。

## 7.3 Baseline 幂等要求

Baseline 必须尽可能可重复执行：

```sql
CREATE EXTENSION IF NOT EXISTS ltree;
```

```sql
CREATE OR REPLACE FUNCTION ...;
```

```sql
DROP TRIGGER IF EXISTS ...;
CREATE TRIGGER ...;
```

```sql
INSERT INTO ...
ON CONFLICT (...) DO NOTHING;
```

但幂等不替代 migration history。

## 7.4 Baseline 不可静默修改

一旦某个 baseline 片段已进入一条 assembly migration：

- 同一插件版本和 revision 下修改其内容必须硬失败；
- 必须增加数据库 revision；
- 已有 assembly 通过 upgrade fragment 演进；
- 全新 assembly 使用新版本 baseline。

片段标记：

```sql
-- qualy-fragment:
-- plugin: @qualy/plugin-org
-- install-epoch: 1
-- database-revision: 2
-- source: db/baseline/0010_extensions.sql
-- sha256: ...
-- phase: pre-structure
```

## 7.5 Upgrade fragments

Baseline 只能解决全新安装，不能表达已有数据库的历史转换。

目录：

```text
db/upgrades/
  0002/
    pre.sql
    post.sql
  0003/
    pre.sql
    post.sql
```

定义：

- `0002` 表示从 revision 1 升到 revision 2；
- `0003` 表示从 revision 2 升到 revision 3；
- revision 不允许跳号；
- 缺少中间升级步骤时 resolve 或 generate 必须失败。

升级流程：

```text
插件 upgrade pre
→ Drizzle 聚合 schema diff
→ 插件 upgrade post
→ 当前 baseline 验证或幂等收敛
→ provision
```

适合放在 pre：

- 数据预检查；
- 删除旧 trigger；
- 创建迁移辅助函数；
- 在 schema diff 前准备数据。

适合放在 post：

- 回填新关系；
- 建立新 trigger；
- 删除迁移辅助对象；
- 将旧数据转换到最终状态。

## 7.6 安装期数据与 provision 的边界

安装期数据进入 baseline 或 upgrade：

- 整库只有一份；
- 不依赖租户；
- 用户不应修改；
- 与数据库对象共同版本化。

租户默认数据进入 provision：

- 每个租户一份；
- 新租户以后仍需要；
- 用户可能修改展示字段；
- 需要环境输入；
- 需要重复执行和漂移检查。

---

# 8. 每个 assembly 独立迁移 lineage

插件包不维护各自独立 migration ledger。

每个 assembly workspace 维护自己的中央 lineage：

```text
assembly/
  qualy.yml
  qualy.lock.json
  pnpm-lock.yaml
  db/
    migrations/
```

插件包只提供：

- schema；
- baseline；
- upgrade；
- provision；
- setup metadata。

CLI 将这些能力聚合成当前装配的中央迁移。

示例：

```text
用户 A:
  org + auth + rbac
  → lineage A

用户 B:
  org + dict + assessment
  → lineage B
```

用户 A 后续增加 assessment：

```text
lineage A
→ 生成新的增量 migration
```

---

# 9. Resolve 与 Planner

## 9.1 依赖图

至少建立四张图：

```text
package/runtime graph
database graph
provision step graph
setup graph
```

## 9.2 Database graph

来源：

```json
"database": {
  "dependsOn": [
    "@qualy/plugin-auth"
  ]
}
```

规则：

- 依赖未安装：硬失败；
- 依赖未包含在 assembly：硬失败；
- 出现环：硬失败并输出完整环路径；
- 同一拓扑层按插件 ID 字典序排序；
- `qualy.yml` 文件顺序不参与排序。

错误示例：

```text
incomplete assembly:
  @qualy/plugin-rbac needs @qualy/plugin-auth,
  but this assembly does not include it
```

## 9.3 Resolve 流程

```text
读取 qualy.yml
→ 校验格式
→ 读取上一个合法 lock
→ 解析直接插件
→ 解析传递依赖
→ 验证包存在和版本
→ 读取插件 metadata
→ 构建依赖图
→ 检测缺失依赖和环
→ 当前条目映射为 active/disabled
→ 上一 lock 中缺失条目映射为 detached
→ 计算 retained database set
→ 确定拓扑顺序
→ 计算全部内容 hash
→ 生成 lock.tmp
→ fsync
→ 原子 rename 为 qualy.lock.json
```

Resolve 不连接数据库，不执行 SQL。

---

# 10. Generate

## 10.1 Retained database set

普通 generate 的数据库集合：

```text
active + disabled + detached
```

只有 purged 插件被排除。

因此手工从 `qualy.yml` 删除插件不会让 Drizzle 看见表消失。

## 10.2 Clean-room baseline generation

当 assembly 没有 migration lineage 时：

```text
最终聚合 Drizzle schema
+ 所有插件当前 baseline pre
+ 结构 SQL
+ 所有插件当前 baseline post
```

生成第一条 baseline migration。

不得机械重放插件所有历史 upgrade fragment。

## 10.3 Existing lineage generation

存在旧 lock 和旧 migration 时：

1. 比较旧 lock 与新 lock；
2. 确定插件新增、升级、disable、detach；
3. 收集所需 upgrade fragment；
4. 生成 Drizzle schema diff；
5. 合并 pre、structure、post；
6. 注入 source 与 hash 标记；
7. 运行 destructive guard；
8. 原子写入 migration；
9. 更新 lock 中 migration head 和 bundle hash。

## 10.4 Drop guard

普通 generate 禁止：

- `DROP TABLE`；
- `DROP COLUMN`；
- `DROP SCHEMA`；
- 未授权的 `CASCADE`；
- 删除 detached 插件对象。

发现删除 SQL 时失败并输出：

```text
destructive migration blocked:
  DROP TABLE plugin_x_records

The plugin is detached, not purged.
Use: qualy plugin purge @qualy/plugin-x
```

## 10.5 Generate 原子性

应先在临时目录生成并验证：

```text
.qualy/tmp/generate-<id>/
```

只有：

- Drizzle 成功；
- fragment 编译成功；
- hash 校验成功；
- drop guard 通过；
- migration 测试解析通过；

才移动到正式 `db/migrations`。

失败不得留下半条 migration。

---

# 11. Provision

## 11.1 语义

Provision 不是一次性 seed ledger，而是当前状态收敛。

要求：

- 可重复执行；
- 第一次创建缺失状态；
- 第二次通常 no-op；
- 稳定平台语义漂移时硬失败；
- 用户可编辑字段不覆盖；
- 禁止不可事务化的外部副作用。

不得在 provision 内：

- 发邮件；
- 调 HTTP；
- 扣费；
- 发布无法和 PostgreSQL 原子提交的外部消息；
- 读取 stdin 提问。

## 11.2 Provision step API

```ts
defineProvision({
  id: 'org.root',
  revision: 2,
  scope: 'tenant',
  requires: ['org.types'],
  provides: ['org.root'],

  async run(ctx) {
    const root = await ensureRoot(ctx.db, ctx.tenantId)
    ctx.provide('org.root', root)
  },
})
```

字段：

```text
id
revision
scope: global | tenant
requires
provides
run
```

## 11.3 依赖资源

后续步骤通过资源 key 获取前置结果：

```ts
const root = ctx.require<{ id: string }>('org.root')
```

数据库 UUID 只存在于本轮运行上下文或通过稳定业务标识重新查询，绝不进入 manifest 或 lock。

## 11.4 跨插件初始化

示例 DAG：

```text
org.types
→ org.root
→ auth.system-account-type
→ host.initial-admin
→ rbac.tenant-admin
```

## 11.5 双向依赖

禁止 provision step DAG 成环。

如果 A 和 B 互相依赖，拆成：

```text
A.prepare
B.prepare
A.link-B
B.link-A
verify
```

必要时使用可延迟外键，但事务提交前必须完成验证。

## 11.6 Composition provisioner

横跨多个领域的初始化由宿主 composition root 协调，例如：

- 默认租户；
- 根组织节点；
- 初始管理员；
- 本地认证身份；
- tenant-admin 授权。

各领域插件只负责自己的数据。

## 11.7 事务边界

Global provision：

```text
一个事务
所有 global steps
global verify
```

Tenant provision：

```text
每个 tenant 一个事务
所有 tenant steps
tenant verify
```

某个租户失败只回滚该租户本轮 provision。

## 11.8 Provision 状态表

```sql
CREATE TABLE cordis_meta.provision_state (
  plugin_id text NOT NULL,
  step_id text NOT NULL,
  scope_kind text NOT NULL,
  scope_key text NOT NULL,
  revision integer NOT NULL,
  last_success_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, step_id, scope_kind, scope_key)
);
```

该表用于：

- readiness；
- 诊断；
- 记录最近成功 revision；
- 判断 assembly 是否部署完成。

它不是“相同 revision 永久跳过”的依据。默认仍应运行幂等步骤并校验状态。

---

# 12. Setup 与交互输入

## 12.1 问题声明与提问分离

插件不得在 seed/provision 内直接调用 prompt。

插件通过纯声明暴露配置需求：

```ts
export default defineSetup({
  schema: z.object({
    adminUsername: z.string().min(1).default('admin'),
    adminPassword: z.string().min(12),
  }),

  fields: {
    adminUsername: {
      label: '初始管理员账号',
      storage: 'manifest',
    },

    adminPassword: {
      label: '初始管理员密码',
      input: 'password',
      storage: 'secret',
    },
  },
})
```

## 12.2 包划分

```text
@qualy/setup-contract
  类型、schema、字段 metadata

@qualy/setup-cli
  终端询问适配器

未来 Web Configurator
  图形界面适配器
```

## 12.3 存储类型

### manifest

非敏感长期配置，写入 `qualy.yml`。

### secret

`qualy.yml` 只保存引用：

```yaml
adminPassword: '${secret:QUALY_ADMIN_PASSWORD}'
```

真实值由：

- 环境变量；
- Docker Secret；
- Kubernetes Secret；
- 后续 secret provider；

提供。

### ephemeral

一次性操作参数，不写入 manifest，例如：

- 是否重置已有管理员密码；
- 是否导入演示数据；
- destructive 操作确认。

## 12.4 阶段顺序

所有提问必须在任何数据库事务之前完成：

```text
resolve
→ configure
→ generate
→ deploy
```

`qualy install` 可以把这些阶段包装成一次交互流程，但内部边界不能消失。

---

# 13. 自定义 Assembly Loader

## 13.1 原因

现有 Include loader 没有可靠的 settled 信号，已经造成 readiness 在装配完成前开放的问题。

因此需要自定义 Qualy assembly loader，但继续使用 Cordis 的 Context、plugin、service 和 dispose 生命周期。

不重写 Cordis，只替换插件发现与装配调度层。

## 13.2 固定 bootstrap

以下组件不由用户 manifest 任意删除：

```text
logger
database transport
server/health
assembly loader
database gate
```

## 13.3 加载流程

```text
读取 qualy.yml
→ frozen 校验 qualy.lock.json
→ 校验包版本和 hash
→ 初始化基础设施
→ 验证数据库 migration/provision
→ 按 runtime DAG 加载 active 插件
→ 等待所有插件初始化完成
→ 注册最终 probes
→ markAssemblyComplete
→ readiness = ready
```

## 13.4 中央数据库门

业务插件激活前必须统一验证：

- 数据库可连接；
- migration head 一致；
- migration bundle hash 一致；
- assembly artifact hash 一致；
- provision state 满足要求。

不得让每个插件分别检查 migration。

---

# 14. PostgreSQL 装配状态

建议增加：

```sql
CREATE TABLE cordis_meta.assembly_deployments (
  artifact_hash text PRIMARY KEY,
  resolution_hash text NOT NULL,
  migration_head text NOT NULL,
  lock_payload jsonb NOT NULL,
  deployed_at timestamptz NOT NULL DEFAULT now()
);
```

`lock_payload` 必须去除 secret。

用途：

- start 校验当前数据库是否对应当前 assembly；
- lock 丢失恢复；
- 审计；
- 识别数据库落后或运行包不匹配。

部署只有在：

- migration 成功；
- global provision 成功；
- tenant provision 成功；
- invariant verification 成功；

后才能登记 assembly deployment。

---

# 15. CLI

## 15.1 命令列表

```bash
qualy init

qualy plugin add <id>
qualy plugin enable <id>
qualy plugin disable <id>
qualy plugin remove <id>
qualy plugin purge <id>
qualy plugin prune <id>

qualy resolve
qualy plan
qualy configure
qualy generate
qualy deploy
qualy start
qualy up

qualy doctor
qualy repair
qualy database status
qualy lock recover --from-database
```

## 15.2 命令语义

### `qualy init`

- 交互选择插件；
- 写入初始 `qualy.yml`；
- 执行 resolve；
- 执行 configure；
- 可选择继续 generate/deploy。

### `qualy plugin add`

- 安装 package；
- 写入 manifest；
- resolve；
- 不自动修改数据库。

### `qualy plugin disable`

- 写 `enabled: false`；
- resolve；
- 数据保留。

### `qualy plugin remove`

- 从 manifest 删除；
- resolve 后状态变 detached；
- 不移除 package；
- 不删除数据。

### `qualy plugin purge`

- 必须显式执行；
- 做依赖和 destructive 检查；
- 生成 purge migration；
- 默认只生成 plan，不直接删除；
- 应用成功后状态变 purged。

### `qualy plugin prune`

- 只允许对 purged 插件执行；
- 从 package dependencies 移除。

### `qualy resolve`

```text
qualy.yml → qualy.lock.json
```

不连接数据库。

### `qualy plan`

无写入，展示：

```text
plugins:
  + @qualy/plugin-x
  - @qualy/plugin-y (detach)
  ~ @qualy/plugin-z revision 2 → 3

database:
  + 3 tables
  + 1 extension
  + 2 functions
  + 4 triggers
  no destructive changes

provision:
  + org.root revision 2
  + rbac.permissions revision 4

setup:
  missing secret QUALY_ADMIN_PASSWORD
```

### `qualy configure`

- 收集缺失配置；
- 写 manifest 配置；
- 写 secret 引用；
- 不连接数据库。

### `qualy generate`

- codegen；
- migration generation；
- fragment 编译；
- drop guard；
- 不修改数据库。

### `qualy deploy`

```text
校验 frozen lock
→ 获取数据库部署锁
→ migrate
→ provision
→ verify
→ 写 assembly deployment
```

### `qualy start`

只验证和启动，不写入。

### `qualy up`

开发和单机部署便利命令：

```text
resolve
→ configure
→ generate
→ deploy
→ start
```

生产环境不使用自动交互的 `up`。

---

# 16. 并发与部署锁

`qualy deploy` 必须使用 PostgreSQL advisory lock，避免：

- 两个实例同时 migrate；
- migration 和 provision 交错；
- 同一数据库被两个 assembly 同时部署。

锁 key 必须与数据库和 Qualy 产品绑定，例如：

```text
qualy:assembly-deploy
```

应用副本只运行 `qualy start`，不得自行 migrate。

---

# 17. Purge

## 17.1 Purge 前置条件

- 目标插件必须 disabled 或 detached；
- 不得有 active、disabled 或 detached 插件依赖它；
- 必须展示将删除的数据库对象；
- 必须通过 destructive confirmation；
- 推荐要求备份确认。

## 17.2 Purge 内容

插件可声明：

```text
db/purge.sql
```

按阶段：

```text
pre-structure
structure
post-structure
```

pre：

- 删除挂在共享表上的 trigger；
- 删除依赖插件表的 view/function；
- 清理插件写入共享 registry 的数据。

structure：

- Drizzle 对排除目标插件后的 retained set 生成 DROP。

post：

- 清理剩余 schema、function 和辅助对象。

## 17.3 Install epoch

Purge 后重新安装相同插件：

```text
installEpoch + 1
```

片段唯一身份：

```text
plugin ID
+ install epoch
+ database revision
+ source path
+ hash
```

避免系统错误地认为新安装周期的 baseline 已在旧周期执行。

---

# 18. 数据库级不变量

应系统性检查 Org、Auth、RBAC 中哪些不变量必须由数据库兜底。

优先顺序：

```text
NOT NULL
CHECK
UNIQUE
FOREIGN KEY
EXCLUDE
constraint trigger
ordinary trigger
```

不得为了使用 PostgreSQL 而制造不必要的 trigger。

适合数据库 trigger 的候选：

- 任意事务结束后至少保留一个可登录的 tenant administrator；
- 用户所属组织必须符合 user type placement policy；
- role grant 必须满足角色 eligibility；
- 组织节点改类型或移动后不能让现有用户或授权失效；
- 跨表状态不能被裸 SQL、导入脚本或未来插件破坏。

应用服务可保留提前检查以返回友好领域错误，数据库 trigger 作为最终防线。

跨表最终状态优先使用 deferred constraint trigger，使同一事务可先完成多步修改，再在提交前统一验证。

---

# 19. 测试体系

## 19.1 Clean-room assembly 测试

每个用例必须使用临时 workspace：

```text
无 qualy.lock.json
无 db/migrations
无 codegen
全新 PostgreSQL 数据库
```

流程：

```text
resolve
→ generate
→ migrate
→ provision
→ start
→ smoke
```

最低组合：

1. 最小 core；
2. core + org；
3. org + auth + auth-local + rbac；
4. 默认全装配；
5. 带真实 extension 的插件；
6. 带真实 function/trigger 的插件；
7. 只有安装期基线数据的插件；
8. 不完整依赖组合必须在 resolve 阶段失败。

## 19.2 Upgrade 测试

同一 workspace、同一数据库、同一 migration lineage：

```text
A
→ A + plugin-x
→ disable plugin-x
→ remove plugin-x（detached）
→ re-add plugin-x
→ plugin-x revision 1 → 2
```

每一步都执行：

```text
resolve
→ plan
→ generate
→ deploy
→ start
```

## 19.3 Purge 测试

```text
active → purge 拒绝
detached + 被依赖 → purge 拒绝
detached + 无依赖 → 生成 destructive migration
deploy 后对象不存在
reinstall 后 installEpoch 增加
```

## 19.4 Lock 测试

- 同一输入生成完全相同 lock；
- 修改 manifest 后 frozen 启动失败；
- 修改 lock 后 frozen 部署失败；
- 普通 resolve 可恢复 lock；
- lock 删除后可从数据库 snapshot 恢复；
- secret 永远不进入 lock。

## 19.5 Planner 属性测试

随机生成 dependency-closed manifests，验证：

- 拓扑顺序正确；
- 输出确定；
- 缺失依赖失败；
- 环失败；
- disabled 和 detached 仍贡献数据库；
- manifest 顺序变化不影响 lock；
- 同一输入 hash 稳定。

## 19.6 Migration 测试

- baseline pre 早于结构；
- baseline post 晚于结构；
- extension 在 ltree 列之前创建；
- fragment hash 修改硬失败；
- 相同 generate no-op；
- clean-room 不重放历史 upgrade；
- revision 升级只执行缺失步骤；
- 普通 remove 不生成 DROP；
- purge 才允许 DROP。

## 19.7 Provision 测试

- 首次创建；
- 二次 no-op；
- 用户修改展示字段不被覆盖；
- 稳定语义漂移失败；
- UUID 不进入 config；
- step DAG 顺序正确；
- 环错误显示完整路径；
- prepare/link 解决双向依赖；
- 任一步失败整个事务回滚。

## 19.8 直接 SQL 不变量测试

必须绕过 service，直接执行 SQL，验证数据库触发器能拒绝非法最终状态。

---

# 20. 错误处理与修复矩阵

| 情况                         | 行为                           |
| ---------------------------- | ------------------------------ |
| manifest 增加未安装插件      | resolve 失败                   |
| manifest 删除插件            | detached，不删数据             |
| `enabled: false`             | disabled，保留数据库           |
| 包目录被手工删除             | 判定 assembly 损坏，start 拒绝 |
| lock 被修改                  | frozen 命令失败                |
| lock 丢失且数据库非空        | 要求从数据库恢复               |
| migration 落后               | start 拒绝                     |
| provision 落后               | start 拒绝                     |
| migration bundle hash 不一致 | start/deploy 拒绝              |
| baseline 已编译后被修改      | generate 硬失败                |
| 插件数据库 revision 跳号     | resolve/generate 失败          |
| generate 出现普通 DROP       | drop guard 失败                |
| purge 存在依赖               | purge 失败                     |
| deploy 并发                  | advisory lock 串行化           |
| deploy 中途崩溃              | 下次安全重试                   |
| detached 插件重新加入        | 复用原有数据                   |
| purged 插件重新安装          | 新 install epoch               |

---

# 21. Readiness

readiness 只有在以下全部成立后才能返回 ready：

```text
manifest 与 lock 一致
包和 capability hash 一致
数据库 migration head 一致
migration bundle hash 一致
assembly artifact hash 一致
global provision 已完成
tenant provision 已完成
所有 active 插件完成初始化
所有 readiness probe 健康
```

装配进行中：

```json
{
  "status": "not-ready",
  "checks": {
    "assembly": "pending"
  }
}
```

不得再次出现空 checks 却返回 ready。

---

# 22. 推荐工程目录

```text
qualy.yml
qualy.lock.json
pnpm-lock.yaml

db/
  migrations/

packages/
  assembly/
    src/
      manifest.ts
      lock.ts
      resolver.ts
      planner.ts
      loader.ts
      state.ts
      doctor.ts

  cli/
    src/
      commands/
        init.ts
        resolve.ts
        plan.ts
        configure.ts
        generate.ts
        deploy.ts
        start.ts
        plugin.ts
        doctor.ts

  setup-contract/
  setup-cli/

  plugins/
    base/
      org/
        src/db/schema.ts
        src/db/provision.ts
        src/setup.ts
        db/baseline/
        db/upgrades/
        db/purge.sql
```

---

# 23. 分阶段实施计划

不要在一个提交里一次完成全部体系。

## 阶段 1：Assembly Foundation

目标：建立装配意图和精确解析结果。

实现：

- 高层 `qualy.yml` schema；
- 单一 `qualy.lock.json`；
- active、disabled、detached；
- runtime/database graph；
- resolver；
- planner；
- frozen-lockfile；
- `qualy resolve`；
- `qualy plan`；
- 原子 lock 写入；
- 现有 clean-room 测试改为 assembly workspace 测试。

验收：

- 同一 manifest 重复 resolve 完全 no-op；
- manifest 顺序不影响 lock；
- 缺失依赖和环在解析期失败；
- 删除条目变 detached；
- detached 仍贡献 schema；
- frozen 模式可靠拒绝漂移。

### 阶段 1 实施结果（2026-08-04，已完成）

全部验收项通过，实现与本节有三处**有意的偏离**，理由如下。

**一、不建 runtime graph。** 读 cordis loader 源码（`packages/loader/src/config/group.ts`）确认 `EntryGroup.update` 用 `Promise.all` 并发创建全部条目，激活顺序由 `inject` 决定，条目在数组里的位置不影响任何事，因此运行时拓扑序没有语义可承载。另一方面 `pnpm install` 当场警告 `@qualy/plugin-org` ↔ `@qualy/plugin-rbac` 已经是 workspace 循环依赖（org 的 devDependencies 引 rbac 做测试），用包依赖充当运行时图会把一个合法状态变成硬失败；而另立 `qualy.runtime.dependsOn` 声明只会与 `inject` 漂移。`runtimeOrder` 因此定义为「active 集按 id 排序」，`runtimeDependsOn` 不进 lock。database graph 保留全部硬约束。

**二、detached 只收拥有数据库对象的插件。** §5.3 让所有被移除的插件转 detached。但 purge 属于阶段 5，在它落地前 detached 是终态，于是一个从未拥有过任何数据库对象的插件（如 `@cordisjs/plugin-timer`）被移除后会永远留在 lock 里且无从清除。现在的规则是：有 `database` 声明才转 detached，否则直接离开 lock。语义不变（保留数据），只是不保留无数据可保留的条目。

**三、`qualy.yml` 保留在 `apps/server/`，并额外生成 `cordis.gen.yml`。** §22 把 manifest 放仓库根，但装配清单归宿主是既有纪律（include 会把 baseUrl 锚到清单目录，插件按宿主依赖解析）。阶段 2 的自定义 loader 尚未存在，所以清单改成产品格式后，由 `pnpm gen` 派生一份 loader 能吃的条目数组 `cordis.gen.yml`（gitignored）。条目 id 从插件名派生，`EntryTree.ensureId` 因此无 id 可补，也就不再把随机 id 写回人手维护的文件——这个写回本身是旧格式的一个缺陷。

另外两点值得记下：

- lock 的自校验是测试逼出来的。只比对「当前解析结果的哈希」抓不到手改 lock：改内容而不改 `resolutionHash` 时，存储值仍等于解析值。因此先验 lock 内容与自身哈希一致（`lockSelfHash`），再验是否等于当前解析结果。
- §13.1 说「现有 Include loader 没有可靠的 settled 信号」，这不成立。`EntryTree.await()` 循环等每个条目的 `_initTask || fiber.inertia` 直到全空，每轮重取，就是 settled 信号；实测在本清单上 1008ms resolve，而 `inject(['server'])` 在 693ms。readiness 已改用它（首个应答实测 `503 {"assembly":"pending"}`，169ms 后转 200）。阶段 2 若仍要自定义 loader，需要另找理由。

## 阶段 1.5：Capability Boundary（2026-08-04，已完成）

阶段 1 交付后暴露的问题：`@qualy/assembly` 名义上是通用装配核心，实际上把 Database 当成内建子系统——`LockedPlugin.database`、`plans.databaseOrder`、`hasDatabase()` 决定 detached、`database.dependsOn` 校验全在核心里；仓库根还持有 `drizzle.config.ts`、`drizzle-kit`/`drizzle-orm`/`pg` 依赖与五个 `db:*` 脚本。**Database 是可选插件**这个前提因此不成立。本阶段把边界补上。

### 结构

```text
@qualy/assembly-contract   AssemblyCapabilityProvider 接口，零依赖
@qualy/assembly            清单、插件状态、不透明 contributions、provider 注册表、lock
@qualy/plugin-database
  ./assembly               database 能力的全部语义（图、schema 聚合、baseline、generate、deploy、命令）
  .                        cordis 运行时插件
```

核心固定生命周期（`resolve` / `plan` / `generate` / `deploy` / `<capability> <command>`），能力插件填内容。核心不知道什么是表、迁移、Drizzle、PostgreSQL。

### 契约范围（每一项都有当下的消费者）

| 成员                | 消费者                                                        |
| ------------------- | ------------------------------------------------------------- |
| `key`               | 注册表的一键一主检查；contributions 的键                      |
| `parseContribution` | resolve 期校验，取代原先散在根脚本里的检查                    |
| `resolve`           | 产出 capability lock state                                    |
| `retainsPlugin`     | detached 判定，取代核心的 `hasDatabase()`                     |
| `plan`              | `qualy plan` 的每能力段落                                     |
| `generate`          | 吸收 `scripts/db-generate.ts`                                 |
| `deploy`            | 吸收 `scripts/db-migrate.ts`                                  |
| `commands`          | 吸收 `drizzle-kit check` / `--custom` / `studio` / drop-guard |

**砍掉的**（附触发条件）：provider 间依赖排序 `requires`（第二个 provider 出现时）；`verify()`（database 插件已在 `Service.init` 自门控并经 `server.readiness()` 注册探针）；`contractVersion`（**capability state 是派生的**——resolve 每次从 contributions 重算，`previousState` 只是建议值，所以没有需要迁移的旧状态；触发条件：某能力的 state 出现只有 lock 记得的事实，例如 purge 的 installEpoch）；旧 `qualy.database` 元数据兼容层（声明方全在本仓，同批迁完；旧键改为**硬拒**并指向新位置，否则一个插件会静默贡献为空、表悄悄离开聚合集）。

### lock 分区（lockfileVersion 2）

```json
{
  "plugins": { "@qualy/plugin-auth": { "version": "0.0.0", "state": "active",
    "contributions": { "database": { "schemaEntry": "src/db/schema.ts", "dependsOn": ["@qualy/plugin-org"] } } } },
  "capabilities": { "database": { "provider": "@qualy/plugin-database", "state": { "order": [...] } } },
  "runtime": { "plugins": [...] }
}
```

`state` 对核心不透明：序列化、进哈希、frozen 比对，但不解释。`plans.runtimeOrder` 更名 `runtime.plugins`，文档明确「排序只保证生成文件字节稳定，不表达初始化依赖」。

### 对抗审阅发现并修掉的四个真缺陷

1. **provider 只从清单发现 → 静默丢光 detached**。若 database 插件与全部贡献方同批离开清单，retention 循环找不到 provider，`claims` 为空，每个拥有表的插件都无声离开 lock。改为从**清单 ∪ 上一份 lock 中仍安装的插件**发现 provider；并区分「没人能回答」（硬失败）与「没什么要保留」（正常离开）。
2. **retained 插件的 contribution 从活的 package.json 重建**。detached 插件的包若删掉声明，下次 resolve 保留判定翻转，schema 先离开聚合集、条目再消失。改为硬失败：「X 由能力 K 保留，但它的包不再向 K 贡献」。
3. **connection string 会进入被提交的 lock**。`providerConfig`（database 插件的 cordis config，含 `url`）此前传给 `resolve()`，返回值进 `capabilities[key].state` 并被哈希提交。改为只在 `generate`/`deploy`/命令的 context 上提供。
4. **memo 缓存把 rejection 永久化**。`currentResolution` 改存 Promise 后，第一次失败会被整个进程继承。改为 `.catch` 时删除缓存键。

### 第二轮对抗审阅修掉的六个

①CI 的 frozen 检查排在生成 `cordis.gen.yml`(gitignored)之前,全新 checkout 必挂;②`qualy deploy` 与 `qualy database *` 不读 `.env`,DATABASE_URL 失效后静默打到 localhost 兜底(被删的 drizzle.config.ts 与 db-migrate.ts 都读);③provider 插件离开清单后只多活一次 resolve——它不贡献任何东西,下一次 resolve 把它扔出 lock,再下一次没人能回答保留问题:发现范围补 `previous.capabilities[key].provider`,并让仍在保留别人的能力把自己的 provider 也保留住;④`resolve` 读上一份 lock 的 contributions 却不校验 `lockSelfHash`,手改的 lock 一条命令被洗成正统:改为 `readLock` 拒读;⑤`stdio: 'pipe'` 吞掉 drizzle-kit 的 stderr,失败只剩 "Command failed" 加一个已被删的临时配置路径;⑥drop-guard 的 `--base-ref` 用 shell 字符串拼绝对路径,全量扫描在目录不存在时报「ok, 0 files」。

同批还证伪了本阶段自己写的门禁:`CORE_MAY_SAY` 按文件豁免,覆盖 resolve.ts / lock.ts / metadata.ts,它注释里自称要防的 `databaseOrder` 回归照样通过(注入验证)。改为剥整块注释后零豁免;provider 入口扫描改为从 package.json 声明发现(此前写死数据库插件目录)。

### lock 版本升级的处理

`readLock` 遇到**更旧**的版本不再抛错（抛错会让 `qualy resolve` 自己也跑不起来，而它正是补救手段）：先扫 `plugins[*].state`，全是 active/disabled 就当作没有 lock 并告警重写；一旦有非这两种状态（即某插件正被保留），硬失败并列出插件名。遇到**更新**的版本一律硬失败。

### 验收

`pnpm typecheck` exit 0；`pnpm test` 32 文件 244 例(全局 testTimeout 30s)；`pnpm test:browser` 10 例；`pnpm build` 通过。空库 `qualy deploy` 15 条迁移 + seed + 首个 ready 为 `503 {"assembly":"pending"}`、约 200ms 后 200 + 登录 200 + 零 `[E]`/`[W]`。**无 database 装配实测**：server + ui-registry + api-reference，`capabilities []`，`/health/live` 200、`/health/ready` 200 且 checks 为空、openapi 200。

### 仍留在根的 db 相关物（附触发条件）

`scripts/seed.ts` 与 `scripts/lib/seed.ts` 写的是 auth/org/rbac 的行，属 provisioning，本设计尚无归属阶段（阶段 4）；根因此保留 `pg` / `@types/pg`。`qualy.permissions` 是 rbac 的插件间元数据，不在 resolve 期消费，未提升为能力（触发条件：出现需要 resolve 期校验的权限约束）。`db:reset` 保留在根，它做的是 docker compose 的事。

## 阶段 2：Static Effect Runtime & Gate

> **本节在 2026-08-05 重写。** 原标题是「Assembly Loader 与 Gate」，实现方式是在 Cordis 上做一个
> 自定义 loader。[ADR 0001](adr/0001-no-online-plugin-install.md) 取消了在线热安装与进程内插件自重启，
> [ADR 0002](adr/0002-effect-as-the-backend-runtime.md) 据此把后端运行时换成 Effect，动态 loader
> 因而不再需要。目标不变，实现方式变了。迁移计划见 [effect-migration.md](effect-migration.md)。

目标：运行时只加载已锁定并已部署的 assembly——**不变**。

实现方式改为静态代码生成，而不是运行时解释 YAML 再动态激活 fiber：

```text
qualy.yml
  ↓ resolve
qualy.lock.json
  ↓ generate
runtime.gen.ts          （取代 cordis.gen.yml）
  ↓ TypeScript build
静态 Effect Layer 组合
```

实现：

- `runtime.gen.ts`：只 import lock 中 active 的插件；包缺失即构建失败，可 tree-shake，可做物料清单；
- 固定 bootstrap（logger / database / server / health 不由用户清单随意删除）；
- 单一根 Scope：数据库池、HTTP server、调度器、后台 fiber 全挂在上面；
- database gate：migration head 与 artifact hash 校验统一在业务 Layer 构建之前；
- readiness；
- `qualy start`。

`qualy start` 的顺序：

```text
读 manifest 与 lock → 验 frozen lock → 验 artifact hash → 验 migration head
→ 构建根 Layer → 获取全部 scoped resource → 构建最终 HttpApi handler
→ 监听端口 → 标记 ready
```

验收（前四条与原方案一致，最后一条是新增的语义）：

- migration 落后拒绝启动；
- lock 漂移拒绝启动；
- 首个 readiness 必为 pending；
- 装配完成后才 ready；
- **启动全有或全无**：数据库、业务 service、handler 任一构建失败，整个实例启动失败。不再有
  「某个插件 pending，其余插件继续提供不完整服务」。

### 阶段 1 的「没有运行时图」裁决必须重开

阶段 1 的结论是「只有能力图，没有运行时图」，两条理由：cordis 并发创建条目并靠 `inject` 门控，
条目顺序不决定任何事；workspace 包之间允许成环，org ↔ rbac 已经是。

第一条理由随 Cordis 一起消失——静态 Layer 图**必须**可构造，顺序有意义。第二条理由反而变成阻塞项：
Layer 不能把两个互相要求对方完整 service 的插件直接组合。因此阶段 2 必须同时解决：

1. 运行时依赖声明在哪（插件 descriptor 还是 package.json；resolver 必须能在不执行插件代码的情况下工作）；
2. org ↔ rbac 的环怎么拆（抽 port、跨域不变量归 coordinator、或整簇一次迁完）。

这是整个迁移里最需要设计的部分，细节与进度在 effect-migration.md。

## 阶段 2.6：组合根收口（设计修订 2026-08-06 v2；**实施方案细化为 v3，见 docs/composition-root-plan.md**，其中 permissions 因 rbac 构建期表同步的时序证据改回静态能力）

阶段 2 的静态 Effect 运行时留下一个缺口：`apps/server/src/{runtime,config,health}.ts` 无条件点名
五处插件导入，没有 database 的装配连编译都过不去——能力边界在核心里成立（有测试守），在能跑的
产品里不成立。

诊断：宿主的七处点名**不是一类问题，是三类**。v2 修订的核心认识：**只有「不启动应用就必须存在」
的值才需要静态文件**（client 类型、CLI generate、浏览器 chunk、layer 列表本身）；纯运行时的值走
Effect 原生的注册表习语，零 codegen。上游源码里就有三种注册表（实读路径）：

- `HttpRouter`（unstable/http/HttpRouter.ts:103-170,478-480,565）：`Context.Service` 内装可变
  路由器，注册即 `use(f) = Layer.effectDiscard(Effect.flatMap(HttpRouter, f))`，拥有方
  `layer = Layer.effect(HttpRouter)(make)`。本仓 `pluginRoutes` 已在用。
- `HttpApiBuilder.group`（unstable/httpapi/HttpApiBuilder.ts:120-155）：贡献方 layer 以
  `group.key` 为键把 routes 发布成服务，收集方从 context 逐键读走。本仓 `apiHandlers` 已在用。
- `Logger.CurrentLoggers`（Logger.ts:162）：`Context.Reference<ReadonlySet<Logger>>`，
  带默认值的环境集合。

cordis 对应关系（每项都更强）：`ctx.xxx.register(v)` → 贡献方 layer 里 `yield* Xxx.register(v)`
（注册值有类型）；`ctx.effect(反动作)` → `Effect.acquireRelease` 挂 layer scope（卸载自动反注册）；
`ctx.loader.await()` → **layer 图本身**（端口最后才绑，请求期读注册表必然完整）；`inject` 门控 →
require 注册表服务（缺拥有方 = 编译错，而非静默不激活）。

**读取时机规则**（注册表的唯一纪律）：消费只在两处安全——请求期，或 layer 图上贡献方之后。
顺序无语义、ID 命名空间化（UI 组合模型的冻结规则升为一切注册表的通用规则）。

### A 类：目录聚合 —— v2 修订：只有 entities 需要 codegen

四份「每个插件声明的 X，拼起来」里，**只有 entities 是 CLI 需求**（`generate` 要在不启动应用时
建 declared 库），保留为 database 能力的 `modules()` 产物，且生成模块导出
`entitiesLayer = Layer.succeed(Entities, [...])`（Tag 由生成模块自己 import；能力缺席则模块
不存在，没人 import 缺失的 Tag）。契约加可选 `CapabilityModule.layerExport?: string`，核心不解释、
只交给 runtime 模块生成器 emit import 与合并。

另外三份是纯运行时值，**不升能力、不 codegen，改注册表**：

- **login-drivers**：auth 的 layer 提供注册表服务，auth-local 在自己 layer 里注册。
  `login-driver.ts` 文件、exports 子路径、`gen-login-drivers.ts` 全部消失。sign-in 请求期读。
- **ui surfaces**：ui-registry 提供注册表，插件 layer 注册；`gen-ui.ts` 删除。`ui.ts` 保留但
  理由变了——definePage 的页面身份要被客户端共享（PageLink），是身份问题不是聚合问题。
- **permissions**：运行时目录走注册（rbac 提供注册表），`gen-permissions.ts` 删除。唯一静态
  消费者是 seed（CLI）——阶段 4 provision（运行中的装配自我供给）落地后该需求消失；过渡期
  seed 照旧读 `qualy.permissions` 声明。

新增一种集成点的成本从「新文件 + 新 exports 子路径 + 新声明 + 新 gen 脚本」降为：拥有方定义
一个注册表服务，贡献方在已有 layer 里加一行。

### B 类：每插件配置（DatabaseConfig / AuthConfig / WebConfig）

根因：cordis 的 loader 会把清单 config 交给插件；静态运行时没有这条路径，宿主于是替每个插件读
环境变量。修法是给 `qualy.runtime` 加一个面：

- 声明：`qualy.runtime.config: true` = 「我的 runtime entry 导出 `config`」。声明不探测。
- 插件侧：`export const config = (manifest: AuthManifestConfig, context: { manifestDir: string })
=> Layer.Layer<AuthConfig, ConfigError>`——环境变量读取、默认值、校验全归插件。
- 生成器把清单里该插件的 `config:` 节**作为字面量**写进 `runtime.gen.ts` 的调用：
  `databaseConfig({ migrationsFolder: './db/migrations' }, { manifestDir })`。字面量由插件导出的
  参数类型在 typecheck 期检查——yml 形状错 = 编译错，与 runtime.gen 现有的
  「缺包挂在 build 不挂在 boot」同一性质。
- **核心不解释 config**：路径类字段（migrationsFolder）由插件自己按 `manifestDir` resolve；
  生成器只负责 `const manifestDir = fileURLToPath(new URL('<相对>', import.meta.url))` 一行锚定，
  不知道哪个键是路径。
- 硬失败：清单里给了 `config:` 但插件既无 capabilityProvider 也未声明 `runtime.config` →
  resolve 拒绝（设置静默失效是本仓最恨的失败形态；databaseWork 现有的未知键硬拒保持不变）。
- 安全边界不变：清单本就是提交物，`config.url` 已被硬拒；secret 走环境变量，由插件的 config
  函数读取。
- 审计第 8 条（生产禁 localhost fallback）自然落进 database 的 config 导出，随此步一起修。
- 测试注入方式不变：config 是服务，testkit 继续直接 provide `DatabaseConfig`。

### C 类：就绪探针（ping） —— v2 修订：注册表吸收

不再生成 `readinessProbes` 数组。宿主（或 api-kit）定义 `Readiness` 注册表服务并在 health
handler 请求期读取；database 的 layer 用 `Effect.acquireRelease` 注册自己的探针。零探针时空
checks 返回 200，与冻结的健康语义一致。`health.ts` 里「本组合没有 database 就建不起来」的注释
随之作废。

### 端态

`runtime.gen.ts` 只导出 `assembly`（pluginLayers + 各插件 config layer + 能力 layer 模块），
宿主手写文件只剩自己的领地：`runtime.ts` import `{ assembly }`；`config.ts` 只剩 ServerConfig 与
apiReferenceEnabled；`health.ts` 读 Readiness 注册表。**宿主不再出现任何 `@qualy/plugin-*`
导入。**

### 不动的

api-handlers.gen / routes.gen / api.gen：API 聚合是产品面，宿主拥有，已经不点名插件；不升能力。
契约包里 Tag 的位置（PermissionCatalog 在 rbac-contract 等）由契约双方决定，不变。
`Layer.mergeAll` 分层与 `dependsOn` 语义不变。

### 实施顺序（每步一个绿提交）

1. `runtime.config` 面 + auth/web 两个 config 搬家（最小闭环，不碰能力）。
2. database config 搬家（manifestDir 锚定 + 生产禁 fallback 一起落）。
3. `layerExport` 契约字段 + entities.gen 导出 layer，宿主删 `Entities` 导入。
4. LoginDrivers 注册表（auth 拥有）；删 `gen-login-drivers.ts` 与 login-driver 子路径。
5. ui surfaces 注册表（ui-registry 拥有）；删 `gen-ui.ts`。
6. permissions 运行时注册表（rbac 拥有）；删 `gen-permissions.ts`（seed 过渡期照旧读声明）。
7. Readiness 注册表，health.ts 去插件化。
8. 宿主收口为 `{ assembly }`；验收 = capability-boundary 加一例：**纯静态装配 render 出的
   runtime 模块可编译、全文不含 database**，即「没装 db 插件也能启动」有测试守。

## 阶段 3：数据库版本演进

目标：完整支持 clean-room 和插件升级。

在现有 `baselineDir` 基础上增加：

- database revision；
- upgradesDir；
- pre/post phases；
- fragment hash；
- install epoch 字段；
- assembly 中央 migration generation；
- `qualy generate`；
- migration bundle hash。

验收：

- clean-room 使用当前 baseline；
- upgrade 使用 revision steps；
- 已编译 baseline 修改失败；
- 普通 detach 不生成 DROP；
- 全装配和最小装配均可从零部署。

## 阶段 4：Provision 与 Setup

目标：拆分当前中央 seed，显式管理跨插件初始化。

实现：

- provision step contract；
- requires/provides；
- global/tenant scope；
- provision state；
- setup contract；
- CLI prompt adapter；
- secret reference；
- `qualy configure`；
- `qualy deploy`；
- 当前 seed 拆分；
- composition bootstrap。

验收：

- 全新数据库完成 setup + deploy；
- 二次 provision no-op；
- 用户可编辑字段不回写；
- 缺 secret 的非交互部署失败；
- 跨插件 UUID 依赖通过资源或查询解决；
- provision 环硬失败。

## 阶段 5：Plugin Lifecycle

目标：完成 detach、purge、reinstall。

实现：

- purgeEntry；
- destructive plan；
- purge migration；
- installEpoch 生效；
- plugin remove/purge/prune；
- lock 从数据库恢复；
- doctor/repair。

验收：

- remove 不删数据；
- purge 必须显式确认；
- 有依赖时 purge 失败；
- purge 后可 prune；
- 重新安装生成新 epoch。

---

# 24. 当前提交后的直接下一步

基于 `247dd19`，下一会话不要继续堆 behavior fragment 功能，而应进入：

```text
Assembly Foundation
```

具体范围：

1. 定义新的 `qualy.yml` schema；
2. 定义 `qualy.lock.json` schema；
3. 实现 active/disabled/detached；
4. 实现 resolver 与 planner；
5. 将现有 `database.dependsOn` 纳入 lock；
6. 增加 `qualy resolve` 和 `qualy plan`；
7. 把 clean-room 测试改造成真正的临时 assembly workspace；
8. 验证不同插件组合拥有各自独立 lineage；
9. 不在本阶段实现 purge、provision DAG 和 setup prompt；
10. 为后续 loader、migration revision 和 provision 保留明确接口。

---

# 25. 完成定义

只有以下场景全部成立，Qualy 才能称为“可选装插件系统”：

```text
用户选择任意依赖闭合的插件组合
→ 生成确定性 manifest lock
→ 从空状态建立独立 migration lineage
→ 部署空数据库
→ 完成必要初始化
→ 启动前验证数据库一致
→ 正确加载插件
→ 后续增装或升级插件
→ 停用或移除插件不丢数据
→ 显式 purge 才进行永久删除
→ 配置、lock 或包损坏时可诊断和恢复
```

当前 `baselineDir` 修复证明了插件自包含非 Drizzle SQL 的必要性；下一阶段需要证明的，是整个 assembly 生命周期在不同组合、不同环境和长期演进中仍然成立。

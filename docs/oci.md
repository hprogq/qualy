# Qualy 构建、装配与部署架构重构开发设计

> **状态(2026-09-17,P4.5 架构收敛后)**:本文 P1–P4 已落地(P1、P2 全部保留;P3 只保留 `qualy deploy`、
> 「启动不修复」与迁移层的 single-writer;P4 的「lineage 归实例」与 transition 已撤回,lineage 回到仓库 `db/migrations`)。
> **原 P5–P9(§62–§79)整体作废,不再逐阶段执行**。现行定位与后续计划见文末 §84。本文其余内容作为设计推演的历史保留,
> 不再是实施依据。


> 请先完整阅读本文列出的现有源码，再实施。不要根据文档中的伪代码机械替换当前实现；应以仓库当前代码为准完成等价架构迁移。
>
> 本设计覆盖：
>
> - Product Package / Runtime Host 的职责分离
> - `package.json`、`pnpm-lock.yaml`、`qualy.yml`、`qualy.lock.json` 的最终边界
> - 第三方插件与 `file:.tgz`
> - Product Host resolution
> - target-specific OCI 构建
> - Deployment State
> - 实例级数据库 migration lineage
> - clean install / upgrade / failure recovery
> - Web Release
> - source-free distribution
> - Sandbox Runtime / Authoring 独立镜像
>
> 本轮不要再引入 `apps/product` 或 Qualy 自己维护的隐藏 package manager。

---

# 0. 最终架构结论

Qualy 应明确区分四个层次：

```text
Package Layer
    package.json
    pnpm-lock.yaml
        │
        │ 安装了哪些代码
        ▼
Assembly Layer
    qualy.yml
    qualy.lock.json
        │
        │ 这些代码怎样组成 Qualy
        ▼
Product Artifact
    target-specific OCI image
        │
        │ 当前目标产品
        ▼
Deployment State
    /var/lib/qualy
    PostgreSQL
        │
        │ 此实例过去实际发生了什么
        ▼
Running Instance
```

四层不能重新混合。

最终原则：

```text
pnpm owns packages.
Qualy owns assembly.
OCI owns runtime software.
Deployment State owns instance history.
```

---

# 1. 四个核心文件分别是什么

## 1.1 `package.json`

它回答：

> 此 Product Workspace 安装哪些 package？

例如：

```json
{
  "private": true,
  "dependencies": {
    "@qualy/plugin-auth": "workspace:*",
    "@qualy/plugin-org": "workspace:*",
    "@qualy/plugin-assessment": "workspace:*",
    "@acme/qualy-wechat": "^2.1.0"
  }
}
```

它属于标准 Node/package-manager 层。

Qualy 不重新实现：

- npm registry；
- semver；
- peer dependencies；
- private registry；
- `file:`；
- Git dependency；
- lifecycle script；
- package integrity；
- transitive dependency resolution。

第三方插件安装仍然应该是：

```bash
pnpm add @acme/qualy-wechat
```

本地 tarball：

```bash
pnpm add ./packages/acme-wechat-2.1.0.tgz
```

然后：

```bash
pnpm qualy plugin add @acme/qualy-wechat
```

`file:` 不进入 `qualy.yml`。

---

## 1.2 `pnpm-lock.yaml`

它回答：

> package graph 精确解析成了什么？

包括：

- exact version；
- package source；
- integrity；
- transitive dependencies；
- package-manager resolution。

Qualy 不应在 `qualy.lock.json` 里重复这些信息。

---

## 1.3 `qualy.yml`

它回答：

> 已安装的软件中，哪些 Qualy plugin 属于这个产品，以及如何配置？

例如：

```yaml
version: 3

application:
  logging:
    level: info

plugins:
  '@qualy/plugin-database': {}

  '@qualy/plugin-auth': {}

  '@qualy/plugin-storage':
    config:
      defaultBackend: local

  '@qualy/plugin-storage-local': {}

  '@qualy/plugin-storage-cos':
    enabled: false
    config:
      region: ap-beijing
      bucket: example

  '@acme/qualy-wechat': {}
```

`qualy.yml` 不知道：

```text
npm:
file:
workspace:
registry:
tgz:
```

也不应该知道 package 安装目录。

---

## 1.4 `qualy.lock.json`

它回答：

> 在当前 package world + manifest + previous Assembly history 下，Qualy 实际解析成了什么？

现有 lock 已经正确记录：

- plugin version；
- active / disabled / detached；
- retainedBy；
- capability contributions；
- capability state；
- runtime plugin set；
- `manifestHash`；
- `resolutionHash`。

当前仓库甚至已经有真实的：

```text
@qualy/plugin-ping
state = detached
retainedBy = database
```

这个语义必须保留。当前 root lock 确实如此。

`qualy.lock.json` 不记录 npm/file provenance。

---

# 2. 一个很重要的修正：installed ≠ selected

不要试图让：

```text
package.json plugin dependencies
==
qualy.yml plugins
```

强制完全相同。

正确关系是：

```text
qualy.yml selection
⊆
installed plugin packages
```

原因包括：

### disabled plugin

```yaml
'@qualy/plugin-storage-cos':
  enabled: false
```

它仍然必须安装，否则 descriptor 都无法 resolve。

### detached plugin

用户：

```bash
qualy plugin remove @qualy/plugin-ping
```

之后：

```text
ping 不在 qualy.yml
```

但 database capability 仍可能要求：

```text
ping = detached
```

因此 package 必须继续安装。

当前 `apps/cli/src/plugin.ts` 已经采用正确语义：

> remove 只从 selection 移除，不 uninstall package，不删除数据。

必须继续保持。

### 用户预安装但尚未启用的插件

也允许 package 已安装而尚未进入 Assembly。

因此 package set 是 Assembly resolver 的软件候选环境，不是 Assembly 本身。

---

# 3. 不再创建 `apps/product`

此前考虑过：

```text
apps/product/package.json
```

作为 Product Host。

现在正式取消。

原因：

1. 当前仓库根目录已经有 `package.json`；
2. `qualy.yml` 也在根目录；
3. 根目录就是天然 product package；
4. 再引入 `apps/product` 只会增加一个人为中间层；
5. standalone Qualy Product 最自然的布局也是同目录。

最终标准 Product Layout：

```text
my-qualy/
├── package.json
├── pnpm-lock.yaml
├── qualy.yml
├── qualy.lock.json
└── ...
```

当前 Qualy monorepo 的根目录就是默认开发 Product。

---

# 4. `application.workspace` 从 manifest 中删除

当前 `packages/core/assembly/src/manifest.ts` 强制要求：

```yaml
application:
  workspace: ./apps/server
```

并通过它寻找 plugin package host。当前 manifest parser、`hostDirFor()` 和 manifest hash 都依赖该字段。

这属于 monorepo implementation detail 泄漏进 Product Manifest。

应改为 Manifest v3：

```yaml
version: 3

application:
  logging: ...

plugins: ...
```

规则：

```text
默认 Package Host
=
qualy.yml 所在目录
```

即：

```ts
productRoot = dirname(manifestPath)
```

并要求：

```text
productRoot/package.json
```

存在。

`resolveAssembly({ hostDir })` 仍然保留 explicit override，供：

- tests；
- builder；
- fixtures；
  -特殊工具。

当前 `resolveAssembly()` 本身已经支持 `hostDir`，不要重构掉这个好边界。

---

# 5. Manifest v3 具体修改

修改：

```text
packages/core/assembly/src/manifest.ts
```

目标：

```ts
interface AssemblyManifest {
  version: 3
  plugins: Map<string, ManifestEntry>
  source: string
  logging: unknown
}
```

删除：

```ts
workspace
normalizeWorkspace()
```

删除：

```text
application.workspace
```

`manifestHash()` 只 hash：

```text
version
plugins
真正属于 Assembly identity 的 application data
```

继续不把 runtime-only logging 放进 Assembly hash。

Manifest parser 必须继续：

- 拒绝 duplicate key；
- 拒绝 unknown field；
- plugin ID 唯一；
- `enabled` 默认 true；
- 保留 YAML comments 的局部编辑行为。

`editManifest()` 当前“不重新 render 整份 yml、避免毁掉注释”的设计必须保留。

版本直接升：

```text
2 -> 3
```

不要长期维护 v2/v3 两套运行语义。

可以提供清晰 migration error：

```text
manifest version 2 used application.workspace;
version 3 resolves plugin packages from the package containing qualy.yml
```

当前仓库直接迁移。

---

# 6. PackageResolver 保持现有 ancestor `node_modules` 规则

不要把：

```text
packages/core/assembly/src/metadata.ts
```

改成“检查 package.json direct dependency membership”。

当前 `installedUnder()` 的目的，是拒绝 `NODE_PATH` / pnpm runner 环境偷偷暴露的 package，同时允许标准 Node ancestor `node_modules` resolution。这个边界是合理的。

保持：

```ts
createPackageResolver(hostDir)
```

以及：

```text
package must export ./package.json
descriptor id == package id
```

只修改默认 host 来源。

---

# 7. `host.ts` 改成 Product Root 语义

当前：

```text
hostResolver(manifestPath)
→ read manifest
→ hostDirFor(manifest)
```

应改为：

```text
hostResolver(manifestPath)
→ dirname(manifestPath)
→ createPackageResolver(productRoot)
```

或者提供：

```ts
productRootFor(manifestPath)
```

并验证：

```text
package.json exists
```

不要再通过 manifest 配置 package layout。

以下 helper 都继续通过同一个 resolver：

```text
resolvePluginModuleUrl
resolvePackageDir
resolvePluginExport
currentResolution
```

`currentResolution()` 仍然必须：

```text
manifest
+
adjacent qualy.lock
+
product package host
```

保持 single resolution vocabulary。

---

# 8. Capability-generated module 路径必须解除 workspace 耦合

当前：

```text
packages/core/assembly/src/modules.ts
```

把 provider 声明的：

```text
module.path
```

前缀成：

```text
manifest.workspace/module.path
```

这是旧 workspace model 的残留。

Manifest v3 后改为：

> CapabilityModule.path 永远相对 Product Root / manifest directory。

仍然：

- 禁止 absolute path；
- 禁止 `..` escape；
- 两 capability 不能 claim 同一路径；
- 保持 stable ordering；
- `QUALY_GEN_OUT` 测试重定向继续工作。

当前真实 database capability 已经直接从 descriptor 获取 entities，并没有再通过 `modules()` 生成 entity runtime module；因此迁移时必须先检查当前所有 capability provider，确认不存在生产模块依赖旧 `apps/server/...` 路径。

synthetic tests 要更新。

---

# 9. `apps/server` 正式成为 Generic Runtime Host

当前 `apps/server/src/runtime.ts` 已经做对了最重要的一步：

```text
它只拿 Resolution
→ loadAssembly()
→ 不点名产品插件
```

`hostPlugin = @qualy/app` 可以暂时保持名字不改。

真正错误的是：

```text
apps/server/package.json
```

仍然直接依赖 assessment、auth、database、org、storage、sandbox 等几乎全部产品插件。

应拆分：

## server production dependencies

只留下 Server 实现真正 import 的平台 package，例如实际源码扫描得到的：

```text
@qualy/assembly
@qualy/api-kit
@qualy/plugin-kit
@qualy/telemetry
@qualy/web-build
Effect / Node platform
...
```

禁止 product plugin implementation。

## server devDependencies

当前 `apps/server/tests/**` 仍然有一些 integration tests 直接 import：

```text
database/auth/storage/formula...
```

本阶段不要为了“架构纯度”一次性迁移全部成熟测试。

做源码扫描：

> 哪些 plugin package 被 `apps/server/tests/**` 直接 import，就仅把这些放入 `devDependencies`。

不能把原来的整套 plugin dependencies 原样搬进 devDependencies。

长期再考虑把 product integration tests 移出 server package。

---

# 10. 根 `package.json` 成为当前默认 Product Package

当前 root `package.json` 是 pnpm workspace root。

把当前 Product 所需的 concrete plugin packages 放进 root：

```text
dependencies
```

而不是 `apps/server.dependencies`。

必须至少包含：

```text
qualy.yml 中所有 selected plugins
UNION
qualy.lock.json 当前所有 detached plugins
```

所以当前：

```text
@qualy/plugin-ping
```

即使不在 `qualy.yml`，仍必须存在于 Product Package dependencies。

disabled COS / Tencent RUM 同样必须安装。

不要手写一个“必须正好等于某个列表”的测试。

正确 gate：

```text
required = manifest plugin IDs
         ∪ detached lock plugin IDs
         ∪ retained capability provider IDs when applicable

required ⊆ Product Package installed/direct plugin candidates
```

允许 installed set 是 superset。

---

# 11. 第三方插件的标准生命周期

正式确定：

## 安装

```bash
pnpm add @acme/plugin
```

或：

```bash
pnpm add ./acme-plugin.tgz
```

然后：

```bash
pnpm qualy plugin add @acme/plugin
```

## disable

```bash
pnpm qualy plugin disable @acme/plugin
```

只改 Assembly selection。

不卸载 package。

## remove

```bash
pnpm qualy plugin remove @acme/plugin
```

只从 manifest 移除。

可能变成：

```text
detached
```

继续安装。

## uninstall

未来可以新增 convenience：

```text
qualy plugin uninstall
```

但它必须先证明：

```text
not selected
not disabled
not detached
not retained
```

再调用/提示 package manager remove。

本轮不要实现自动 uninstall。

尤其不能：

```text
qualy plugin remove
→ pnpm remove
```

---

# 12. 不支持 `source:` / `file:` manifest schema

明确禁止重新引入：

```yaml
'@acme/foo':
  source: npm:@acme/foo@1.2
```

或：

```yaml
source: file:./foo.tgz
```

这些属于 package-manager concern。

当前真实 packed-plugin test 已经证明 `.tgz` 通过 package manager 安装后，可以被 Assembly、runtime 和 Web builder 正常使用。应保留并升级该测试，而不是另造 Qualy installer。

---

# 13. Testkit 和第三方插件测试调整

当前：

```text
packages/core/assembly/src/testkit.ts
```

硬编码：

```ts
../../../../apps/server/
```

作为 package host。

改为从 repository root/default product root 取 host：

```text
qualy.yml 所在目录
```

不要改成另一个硬编码：

```text
apps/product
```

`renderManifestText()` 删除：

```yaml
application:
  workspace: ...
```

`ManifestOptions.workspace` 删除。

throwaway test workspace 自己拥有：

```text
package.json
node_modules
qualy.yml
```

因此天然就是 Product Root。

`tools/tests/packed-plugin.test.ts` 当前创建的临时 standalone workspace 已经接近最终真实模型：

```text
package.json
pnpm install
node_modules
qualy.yml
```

删除 manifest workspace 字段即可。

它当前为 peer packages 解析使用 `apps/server` 作为 repository host，需要改为 root Product Host。

---

# 14. Dev Host 改为 Product Root-aware

当前 Dev Host 有大量优秀设计：

- 所有事件单队列；
- candidate 先 prepare；
- working backend 在 candidate 失败时继续服务；
- session / backend / service 三层 replacement；
- topology 从真实 Resolution 推导；
- watcher 在新 topology 后 resync。

全部保留。

修改的只是 Product inputs。

定义：

```text
productRoot = dirname(manifestPath)
```

bootstrap structural inputs 至少包括：

```text
qualy.yml
qualy.lock.json
productRoot/package.json
productRoot/pnpm-lock.yaml
```

monorepo 自己还可以额外 watch：

```text
pnpm-workspace.yaml
platform source
apps/server source
```

`.env` 改为：

```text
productRoot/.env
```

而不是假设 repository root。

Package change：

```text
package.json / pnpm-lock
```

应 classification 为：

```text
session replacement
```

因为 installed plugin graph 可能改变。

继续让 pluginRoots 从 Resolution resolver 获取真实 root。当前 linked package detection 设计可以直接保留。

---

# 15. CLI 默认 manifest 位置改为真正 portable

当前：

```text
apps/cli/src/main.ts
```

默认 manifest 是：

```text
这个 CLI 源码所属 repository root/qualy.yml
```

这只适合当前 monorepo。

应变成统一规则：

```text
--yml
优先

否则 QUALY_CONFIG
其次

否则从 cwd 向上寻找最近的 qualy.yml
```

Server 自己已经有类似向上寻找行为，可抽成共享 helper，避免两套规则。

以后在 standalone：

```text
/customer-product
```

执行：

```bash
qualy resolve
```

必须找到这个 product 的 manifest，而不是 Qualy SDK 安装路径里的 manifest。

---

# 16. `qualy resolve` 继续保持纯 Assembly Resolution

不要因为 Product Package 重构，就让：

```text
qualy resolve
```

开始执行：

```text
pnpm install
npm fetch
docker build
database migration
```

它仍然：

```text
read manifest
+
read installed packages
+
read previous lock
→ resolve Assembly
→ write lock / capability-derived artifacts
```

`resolveAssembly()` 继续：

```text
read-only
no external systems
```

当前 CLI 把 manifest/lock/generated modules 作为 FileSet 做 rollback 的事务式写入，非常好，必须保留。

---

# 17. `qualy.lock.json` 的两个身份必须拆开

当前 repository lock 只有一个概念。

生产部署需要两个不同角色。

## Target Lock

目标镜像包含：

```text
/app/assembly/qualy.lock.json
```

意思是：

> 这个 target image 是按哪个 Assembly 构建的。

## Applied / Deployed Lock

实例持久状态：

```text
/var/lib/qualy/assembly/deployed.lock.json
```

意思是：

> 这个实例的数据库/外部 capability 上一次真正成功部署了什么 Assembly。

不能把两者叫同一个东西并共用路径。

---

# 18. Target-specific image 与 previous lock

当前 detached retention 是 history-dependent。

因此正式 target image builder 必须接受：

```text
previous applied/deployed lock
```

作为可选输入。

### clean build

```text
previousLock = undefined
```

得到 fresh target。

这意味着从零部署当前 Qualy 时，不应该因为 repository 的历史曾经有 `plugin-ping` 就给全新数据库创建 `PingLog`。

### upgrade build

```text
previousLock = customer's last deployed.lock
```

resolver 才能正确决定：

```text
removed plugin
→ detached?
→ leave completely?
```

因此增加明确的 builder API：

```text
qualy build --fresh
```

和概念上的：

```text
qualy build --previous-lock <deployed.lock.json>
```

不要让 production builder 隐式拿 repository adjacent lock 当客户实例历史。

repository `qualy.lock.json` 仍用于开发和 review。

target build 的 lock 写入 build staging/image。

---

# 19. 一个重要后果：当前设计是 target/deployment-specific image

本方案明确接受：

> 不同 deployment history 可能产生不同 target Assembly，因此可能产生不同 Server image。

这样可以继续使用当前完整：

```text
resolutionHash
```

作为 Web release / Server Assembly identity。

如果未来要求：

> 一份完全相同的 OCI image 在任意历史不同的实例间直接 promotion

那么必须另做 compatibility-closure 设计，并重新定义 Web release identity。

本轮不要混入。

---

# 20. Deployment State

新增一个平台级模块，例如：

```text
packages/core/deployment-state/
```

不要把 Deployment State 放入 database plugin。

它属于整个 Qualy deployment。

生产默认：

```text
/var/lib/qualy
```

开发默认可以：

```text
<productRoot>/.qualy/state
```

支持：

```text
QUALY_STATE_DIR
```

生产若路径不可写，应 fail-fast。

结构：

```text
/var/lib/qualy/
├── assembly/
│   └── deployed.lock.json
│
└── database/
    └── migrations/
        ├── 202609170001_initial.sql
        └── ...
```

未来可扩：

```text
history/
metadata/
```

但本轮不要过度设计。

---

# 21. Deployment State 的原子语义

提供 API，而不是各插件随意 `fs.writeFileSync`：

```ts
deploymentPaths()
readDeployedLock()
writeDeployedLockAtomic()
ensureStateLayout()
```

target deployment：

```text
A = current deployed.lock
B = image target lock
```

只有在所有 deployment work 成功以后：

```text
deployed.lock: A -> B
```

必须 atomic rename。

失败时：

```text
deployed.lock remains A
```

不能因为 migration 执行到一半就提前记录 B。

---

# 22. Database migration ownership迁移到 Deployment State

当前：

```yaml
@qualy/plugin-database:
  config:
    migrationsFolder: ./db/migrations
```

应删除。

当前 database provider 明确从 manifest config 解析这个路径。

最终：

```text
database migrations folder
=
deploymentState/database/migrations
```

不是 Product Manifest config。

也就是说：

```yaml
'@qualy/plugin-database': {}
```

即可。

`DATABASE_URL` 继续属于 Environment。

migration lineage 属于具体实例。

---

# 23. 当前数据库生成算法不要推翻

当前 `packages/plugins/infra/database/src/assembly/diff.ts` 已经实现了一个非常重要的正确算法：

```text
scratch lineage DB
← replay migrations

scratch declared DB
← current entities + baseline

compare real DB A → real DB B
```

并且明确不直接拿 production database 做 generate source-of-truth。

这正是最终需要的算法。

不要重新改回：

```text
production DB
→ introspect
→ diff
```

P3 主要改：

```text
lineage location
generation database connection
deployment orchestration
```

而不是重写 comparator。

---

# 24. Generation Database 与 Production Database 分开

当前 scratch DB 是在：

```text
DATABASE_URL
```

对应 PostgreSQL server 上执行：

```sql
CREATE DATABASE qualy_gen_...
```

这对 managed PostgreSQL / restricted role 不够可靠。

增加：

```text
QUALY_GENERATION_DATABASE_URL
```

规则：

```text
generate:
    generation URL first
    dev 可 fallback DATABASE_URL
    production deploy 建议明确提供 generation DB

deploy/apply:
    DATABASE_URL only
```

`structuralDiff()` 改为显式收到：

```text
lineage scratch admin URL
declared scratch admin URL
```

或者统一：

```text
generationBaseUrl
```

Production DB 只负责最终 migration apply，不作为 generation scratch substrate。

---

# 25. Clean install 数据库流程

第一次部署：

```text
deployed.lock absent
migrations directory absent/empty
```

Deployment job：

```text
1. ensure state directories
2. create empty migrations directory
3. load image Target Assembly
4. database generate
5. scratch A = empty lineage
6. scratch B = target declared schema
7. A → B diff
8. write local initial migration
9. destructive guard
10. apply migration to DATABASE_URL
11. run remaining capability deploy work
12. atomically promote target lock → deployed.lock
```

当前 `generateDatabase()` 已经在 generation 开始时：

```ts
mkdirSync(migrations, { recursive: true })
```

这个行为可以保留。

---

# 26. Upgrade 数据库流程

实例：

```text
deployed = A
```

新 image：

```text
target = B
```

Deployment：

```text
state/database/migrations
        │
        ▼
scratch A
replay customer lineage
        │
        │ diff
        ▼
scratch B
target declaration
        │
        ▼
new local migration
        │
        ▼
apply production DB
        │
        ▼
other capability deploy
        │
        ▼
deployed.lock A → B
```

不要把 customer migration history bake 到 OCI。

---

# 27. Semantic migration 的限制必须明确

结构 diff 无法可靠推断：

```text
rename
data backfill
semantic split/merge
business transformation
```

因此未来需要 plugin-owned versioned transition recipes。

概念：

```text
plugin package
├── descriptor
├── current schema declaration
├── baseline fragments
└── transitions/
    ├── ...
```

在部署时：

```text
structural diff
+
applicable semantic transitions
→ compile into customer's local migration lineage
```

本阶段如果当前业务还没有必须的 semantic transition，可以先留 extension interface，不要虚构完整 DSL。

现有：

```text
qualy database custom
```

可以继续用于实例级 emergency/custom SQL，但不能被当成未来正式跨客户 schema evolution 机制。

---

# 28. Deploy Command 升级为真正的部署事务

当前 CLI：

```text
generate
deploy
```

是两个分离阶段。

开发者仍可单独运行：

```bash
qualy generate
```

查看生成内容。

但面向生产 Deployment Job：

```bash
qualy deploy
```

最终应该编排：

```text
verify target
→ acquire deployment lock
→ generate pending local artifacts
→ destructive safety gates
→ apply capabilities
→ promote deployed lock
→ release deployment lock
```

不要要求普通客户记住：

```text
generate
然后 deploy
然后 copy lock
```

---

# 29. Deploy 必须是 single-writer

新增部署并发保护。

最低要求：

```text
同一个 database / state directory
同时只允许一个 deployment job
```

可采用：

- State directory process/file lock；
- PostgreSQL advisory lock；
- 两者结合。

数据库 migration apply 最好有 PostgreSQL advisory lock，避免两个机器同时操作同一个 DB。

冲突时：

```text
fail clearly
```

不要等待无限时间。

---

# 30. Server startup 继续坚持 validate-only

当前：

```text
apps/server/src/verify-assembly.ts
```

已经明确：

> Start validates and starts; it never repairs.

生产启动最终检查：

```text
image target lock valid
+
installed packages resolve to target
+
deployment state exists
+
deployed.lock == target lock
```

否则拒绝：

```text
deployment required
```

Server 不能：

```text
generate migration
apply migration
write deployed.lock
pnpm install
rebuild web
```

Development 可以保持当前 non-frozen warning workflow。

---

# 31. Web Builder 改成 portable API

当前：

```text
packages/build/web/src/manifest.ts
```

硬编码 repo root。

当前：

```text
packages/build/web/src/stage.ts
```

又硬编码：

```text
apps/web/dist
→ packages/plugins/infra/web/client-dist
```

这不能支持 standalone Product Builder。

新增真正 API，例如：

```ts
buildWebRelease({
  resolution,
  sourceApp,
  outputDir,
  storeDir,
})
```

或者等价设计。

关键要求：

> Production product build 的 Server / Web 必须消费同一个 Resolution。

不要：

```text
server resolve once
web independently resolve again
```

否则 package tree/lock 在中间变化可能生成两个 Assembly。

`collectWebPlugins()` 当前已经通过 Assembly resolver 和 package exports 找第三方插件 browser half，不需要重新增加任何 plugin naming convention。

---

# 32. `apps/web` 继续不列 product plugin

当前质量 gate 已经确保：

```text
apps/web/package.json
```

不是 product plugin list。

必须继续。

第三方 plugin browser surface：

```text
installed package
→ Assembly
→ descriptor/exports
→ collectWebPlugins
```

不能要求：

```text
同时编辑 apps/web/package.json
```

当前 plugin isolation 测试的这个方向是正确的。

---

# 33. Target-specific Server Image Builder

新增正式 Product Builder。

输入：

```text
Product Root:
    package.json
    pnpm-lock.yaml
    qualy.yml

Previous Applied Lock:
    optional

Qualy Platform Runtime:
    current build
```

流程：

```text
pnpm install --frozen-lockfile
        ↓
resolve target Assembly
(previous applied lock when upgrading)
        ↓
frozen validation / plan
        ↓
build Web Release from SAME Resolution
        ↓
build/package server runtime
        ↓
package exactly required plugin/runtime closure
        ↓
write target qualy.yml + target lock
        ↓
OCI
```

构建 production target 时不修改产品工作树里的 `qualy.lock.json`。

target lock 写到 staging/image。

---

# 34. Machine-generated staging package.json 是允许的

这里不要混淆。

禁止的是：

> 让用户维护 `apps/product/package.json` 作为第二份 Qualy plugin config。

但是 Builder 内部为了让 pnpm 组装 runtime closure，完全可以生成：

```text
.qualy/build/<id>/package.json
```

这是：

> build artifact。

不是：

> product configuration。

如果最终 packaging 需要生成一个 minimal runtime host manifest，允许。

它必须完全从：

```text
source product package graph
+
Resolution
```

派生。

用户永远不编辑它。

---

# 35. OCI 内应该有什么

最终 Server image 概念结构：

```text
/app/
├── runtime/
│   └── dist/
│
├── product/
│   ├── package.json
│   ├── node_modules/
│   └── assembly/
│       ├── qualy.yml
│       └── qualy.lock.json
│
├── web/
│   └── release/
│
└── cli/
    └── deploy tooling
```

具体目录可根据 Node resolution 优化。

必须包含：

- generic Server runtime；
- CLI deploy runtime；
- Product package host；
- required plugin packages；
- plugin package manifests；
- runtime transitive dependencies；
- plugin baseline/resources；
- target manifest；
- target lock；
- Web Release。

---

# 36. OCI 内不应该有什么

正式 source-free release 不包含：

```text
.git
repo tests
test fixtures
TypeScript source
TSX source
source maps
devDependencies
Vite dev server
Vitest
Playwright
用户数据库
用户 migration lineage
用户 deployed.lock
用户 secrets
```

`pnpm-lock.yaml` 对 runtime 不是必须。

可以作为 SBOM/provenance 输入保存到构建系统，而不一定复制到 final layer。

---

# 37. Runtime `node_modules` 在镜像内

生产环境绝不能：

```text
host node_modules
→ volume mount
→ container
```

也不能在启动时：

```bash
pnpm install
```

所有 runtime dependency closure 在 image build 时完成。

最终 Node process 看到的是 image 自己的：

```text
package.json
node_modules
plugin packages
```

---

# 38. Source-free official package build

当前官方 plugin package 仍然主要指向 `src/*.ts/tsx`。

后续新增 dist build。

每个 target closure 内 official package 产出：

```text
package/
├── package.json
├── LICENSE
├── dist/
│   └── *.js
└── required static resources/
```

要求：

- exports 全部指向 dist；
- `./package.json` 保留；
- database baseline fragment 复制；
- browser exports 复制/编译；
- no `.map`；
- no source TS/TSX；
- 不改变 descriptor semantics。

第三方 package 按其发布 artifact 原样消费。

当前 packed-plugin test 已经要求第三方 dist package 无 `src` 且真实 bundle 可用，应升级为正式 release gate。

---

# 39. 不要一开始做 obfuscation

本阶段 source protection 顺序：

```text
不发 source
↓
不发 source map
↓
minify
↓
必要时再考虑 obfuscation
```

不要把 obfuscation 当安全边界。

---

# 40. Sandbox 是两个独立 Platform OCI

保持现有：

```text
qualy-sandbox-runtime
qualy-sandbox-authoring
```

不要合并到 Server image。

当前两个 Dockerfile 已经各自建立自己的 production closure。

正式发行：

```text
qualy-server:<target>
qualy-sandbox-runtime:<platform-version>
qualy-sandbox-authoring:<platform-version>
```

Sandbox images 属于 Platform Release，一般不随客户普通业务 plugin selection 重新 build。

---

# 41. Sandbox 安全边界必须保持

当前 Compose 已经配置：

```text
network_mode: none
read_only
non-root
cap_drop: ALL
no-new-privileges
pids_limit
tmpfs
CPU limit
memory limit
```

这些都是正式架构要求，不是 dev-only convenience。

Server 与 Sandbox 只通过 Unix socket 通信。

Sandbox 不获取：

```text
DATABASE_URL
Redis credentials
COS credentials
JWT secrets
OTel vendor secrets
```

Sandbox service 当前也明确没有 local fallback：runtime socket 不可用就是 typed outage。继续保持。

---

# 42. Sandbox socket 不属于 Deployment State

不要放：

```text
/var/lib/qualy
```

它是 ephemeral runtime IPC。

生产可以：

```text
/run/qualy-sandbox/runtime
/run/qualy-sandbox/authoring
```

用两个独立 named volume / bind runtime directory 在：

```text
Server
↔ Sandbox Runtime

Server
↔ Sandbox Authoring
```

间共享。

socket volume 不备份。

---

# 43. Sandbox source-free build 也要做

当前两个 Sandbox Dockerfile 会把 pruned workspace source tree 带入 final image。

在 source-free phase 中同步改：

```text
sandbox-runtime
sandbox-authoring
```

只携带：

```text
compiled dist
QuickJS/WASM/runtime assets
production dependencies
```

不要只把 Server 做成 source-free，却把 compiler / sandbox source 全放在另外两个镜像里。

---

# 44. Product Release 最终包含什么

正式客户交付：

```text
Qualy Product Release
│
├── Target-specific Server OCI
│
├── Sandbox Runtime OCI
│
├── Sandbox Authoring OCI
│
└── Deployment Kit
    ├── compose.yaml
    ├── .env.example
    ├── README
    ├── backup/restore docs
    └── optional reverse proxy example
```

PostgreSQL、Redis、OTel 使用各自官方/托管服务。

不要打进 Qualy Server image。

---

# 45. 客户全新部署完整流程

客户服务器只需要：

```text
Docker/Podman
deployment kit
credentials
persistent storage
```

不需要：

```text
Node
pnpm
TypeScript
Vite
Qualy source
```

流程：

```text
1. docker compose pull

2. start PostgreSQL / Redis
   或配置 managed services

3. prepare /var/lib/qualy volume

4. start sandbox-runtime / sandbox-authoring

5. run:
   docker compose run --rm qualy deploy

6. deploy:
   - verifies target assembly
   - creates local lineage
   - generates initial migration
   - applies database
   - applies capability work
   - writes deployed.lock atomically

7. docker compose up -d qualy

8. server:
   validates only
   then starts
```

---

# 46. 客户升级完整流程

推荐单机初版：

```text
1. backup PostgreSQL + /var/lib/qualy

2. pull new target image

3. stop old Server
   Sandbox 可按 compatibility 策略同步更新

4. run qualy deploy

5. generate local transition
6. apply DB/capabilities
7. promote deployed lock

8. start new Server

9. health/readiness checks
```

本轮不要承诺 zero-downtime migration。

数据库升级成功后：

```text
docker image rollback
```

并不自动意味着 DB 可逆。

文档中必须明确：

> Image rollback ≠ schema rollback.

---

# 47. `/var/lib/qualy` 和 PostgreSQL 是恢复对

Backup 设计：

```text
PostgreSQL backup
+
Qualy Deployment State backup
```

必须视为同一个 recovery checkpoint。

只恢复数据库但丢失：

```text
database/migrations
deployed.lock
```

是不完整恢复。

后续 backup tooling 应围绕这个 invariant 设计。

---

# 48. 当前 root `db/migrations` 的迁移策略

实施 Deployment State migration 时，不要简单删掉当前：

```text
db/migrations
```

先把现有开发实例作为 legacy lineage 迁移。

需要设计一次性 developer migration：

```text
db/migrations
→ .qualy/state/database/migrations
```

并校验：

```text
current DB ledger
==
copied lineage hashes
```

生产能力完成前保留兼容迁移工具。

Clean install 则不复制这份 history：

```text
empty state
→ generate own initial
```

这正是新的设计目的。

---

# 49. 当前 `database custom/adopt/drop-guard` 都必须重新审视路径

这些 command 当前全部通过：

```text
databaseWork().migrations
```

所以一旦 `databaseWork` 改成 Deployment State path，大部分可以自然跟随。

逐项验证：

```text
database check
database custom
database adopt
database drop-guard
database where
generate
deploy
```

任何一个都不能偷偷继续使用 root `db/migrations`。

---

# 50. Production image 不挂载 Product Source

正常 production compose 不应该出现：

```yaml
- ./qualy.yml:/app/qualy.yml
- ./package.json:/app/package.json
- ./node_modules:/app/node_modules
```

这些是 Build Inputs。

OCI 内有该 target 自己的 immutable copy。

真正 mount：

```text
Qualy State
Sandbox sockets
必要的 persistent upload storage（若 local backend）
```

以及 secrets/environment。

---

# 51. Build 与 Deploy 的职责必须写进代码注释和 CLAUDE.md

Build：

```text
packages
resolve
web
compile
package
OCI
```

Deploy：

```text
instance state
migrations
external capability mutation
applied lock
```

Start：

```text
validate
acquire runtime resources
serve
```

三者绝不能互相补救：

```text
Build != Deploy != Start
```

---

# 52. Quality Gates：Product / Runtime separation

扩展：

```text
tools/tests/plugin-isolation.test.ts
```

增加：

## Gate A

`apps/server/package.json.dependencies` 不允许依赖 concrete package under：

```text
packages/plugins/*/*
```

`@qualy/plugin-kit` 不算 product plugin implementation。

## Gate B

当前 Product Root：

```text
required(manifest + retained lock)
⊆
installed/direct plugin candidates
```

不要要求 exact equality。

## Gate C

root `qualy.yml` 必须位于一个合法 Product Package 中：

```text
dirname(qualy.yml)/package.json exists
```

## Gate D

`apps/web` 继续没有 product plugin list。

---

# 53. 增加 isolated Product Host 测试

monorepo root `node_modules` 很容易掩盖漏 dependency。

新增 clean-room test：

```text
temp/
├── package.json
├── qualy.yml
└── node_modules/
```

只 link/install Product Package 明确声明的 package。

然后：

```text
resolveAssembly()
loadAssembly()
collectWebPlugins()
```

必须成功。

这样验证：

> 当前 Product dependency list 自身足够。

不要通过修改 PackageResolver 为 strict direct dependency 来“修”这个测试。

---

# 54. Third-party packed plugin 必须继续作为一级回归测试

保留真实：

```text
pnpm pack
→ standalone package
→ pnpm install
→ plugin add
→ resolve
→ loadAssembly
→ collectWebPlugins
→ Vite bundle
```

升级后还要加：

```text
target builder
→ final image/staging
→ third-party dist package present
→ source absent
```

---

# 55. OCI clean-room tests

Builder 完成后增加：

### Test 1

final image 不 mount source，也能：

```text
qualy server
```

完成 Assembly validation。

### Test 2

selected third-party plugin 能加载。

### Test 3

没有包含不属于 target closure 的 plugin。

### Test 4

production image 中找不到：

```text
packages/plugins/**/src
apps/server/src
*.map
test fixtures
```

### Test 5

`node_modules` 不依赖宿主机 pnpm store。

### Test 6

生产 Server 没有 package manager write。

---

# 56. Sandbox image gates

现有：

```text
sandbox-isolation.test.ts
sandbox-smoke.ts
sandbox-uds-gate.ts
```

继续保留。

增加 final-image 检查：

```text
network none
read-only compatible
non-root
source-free
socket-only
no Product secrets
```

Runtime / Authoring 分别 smoke。

---

# 57. Implementation Phase P1 — Product Package / Runtime Host 分离

这是第一阶段，优先完成。

修改：

```text
packages/core/assembly/src/manifest.ts
packages/core/assembly/src/host.ts
packages/core/assembly/src/modules.ts
packages/core/assembly/src/testkit.ts

qualy.yml
package.json
apps/server/package.json

apps/server/src/dev/*
tools/tests/plugin-isolation.test.ts
tools/tests/packed-plugin.test.ts
所有 workspace 相关 assembly tests
```

完成内容：

```text
Manifest v3
remove application.workspace
root package = product host
move product plugin ownership out of server dependencies
server test plugin imports → minimal devDependencies
host resolver → manifest directory
generated module path → product root relative
testkit updated
dev watcher updated
```

完成后必须：

```text
qualy resolve
full test
typecheck
browser tests
packed plugin test
sandbox tests
```

并确认 current product semantics 不变：

```text
active plugins unchanged
disabled plugins unchanged
ping remains detached in DEVELOPMENT lock
capability state unchanged
```

---

# 58. P1 明确不做

不要在 P1 顺带：

```text
Dockerize Server
move DB lineage
create Deployment State
source-free build
change Sandbox protocol
write npm installer
write plugin marketplace
implement purge
```

P1 只建立正确 Product/Runtime ownership。

---

# 59. Implementation Phase P2 — Portable CLI / Dev Product

完成：

```text
portable manifest discovery
productRoot helper
product-root .env
product package/lock watcher
standalone product smoke
```

新增 standalone fixture：

```text
temp product
package.json
qualy.yml
installed packages
```

执行：

```text
qualy resolve
qualy plan
qualy list
```

全部不依赖 Qualy repository layout。

---

# 60. Implementation Phase P3 — Deployment State

新增：

```text
packages/core/deployment-state
```

实现：

```text
state paths
state bootstrap
deployed lock read/write
atomic promotion
state-dir validation
deployment lock
```

Server production 增加：

```text
deployed state verification
```

Development 不强迫有 `/var/lib/qualy`。

此阶段先不移动 database lineage，也可以先用 fixture capability 测：

```text
target A
deploy success
deployed=A

target B
deploy failure
deployed remains A

target B
success
deployed=B
```

---

# 61. Implementation Phase P4 — Database Instance Lineage

修改：

```text
packages/plugins/infra/database/src/assembly/work.ts
generate.ts
diff.ts
index.ts
migrator-related tests
qualy.yml
database config tests
```

完成：

```text
remove migrationsFolder manifest config
state/database/migrations
generation DB URL
clean install initial
upgrade local transition
deploy apply
atomic deployed lock promotion
```

保留 current scratch A/B algorithm。

增加：

```text
fresh deployment test
upgrade deployment test
failed migration test
managed-DB/no-CREATEDB simulation
```

---

# 62. Implementation Phase P5 — Portable Web Release Builder

去掉：

```text
repoRoot
apps/web/dist hardcode
packages/plugins/infra/web/client-dist hardcode
```

提供显式 Builder API。

Dev wrapper 仍可调用这个 API 使用当前 monorepo paths。

Production Product Builder 必须传同一个 `Resolution`。

验证第三方 browser surface。

---

# 63. Implementation Phase P6 — Target Application Builder

新增：

```text
packages/build/application
```

或等价 package。

职责：

```text
product input validation
pnpm frozen graph validation
resolve target
consume optional previous applied lock
invoke Web builder
prepare runtime closure
prepare target assembly files
produce OCI context
```

不让这个 package 负责：

```text
DB deployment
customer state
runtime startup
```

增加 CLI：

```text
qualy build
```

具体 OCI backend 可以稍后包 Docker buildx，但 builder 的核心应可以先输出：

```text
staging directory
```

便于测试。

---

# 64. Implementation Phase P7 — Source-free Distribution

增加 official package build pipeline。

先做到：

```text
server dist
plugin dist
web dist
sandbox dist
```

然后 final staging 只拿 dist。

Package exports 在 build artifact 中改到 dist。

不要直接修改 development workspace package exports，导致开发体验全部切换到 prebuild。

最好有：

```text
source workspace manifest
→ distribution manifest transform
```

---

# 65. Implementation Phase P8 — OCI + Sandbox Release Kit

最终产出：

```text
qualy-server target image
qualy-sandbox-runtime
qualy-sandbox-authoring
```

Deployment Compose：

```text
postgres
redis
qualy
sandbox-runtime
sandbox-authoring
```

Sandbox pair 使用独立 socket volume。

Server image 支持 role：

```text
server
deploy
doctor
```

同一 Server OCI，不需要 deploy 专用镜像。

---

# 66. Implementation Phase P9 — Release / Recovery Gates

最后补：

```text
fresh server from zero
upgrade
failed upgrade
backup state
restore
sandbox outage
sandbox version mismatch
third-party plugin
disabled plugin
detached plugin
source-free image inspection
```

形成真正 release smoke。

---

# 67. 关于 `qualy.lock.json` 与 build source lock 的注意事项

当前 root `qualy.lock.json` 有 development history，例如 detached ping。

因此：

```text
qualy build --fresh
```

绝不能偷偷读这个 lock 当 previous deployment。

否则 fresh customer 会继承开发数据库历史。

Builder 必须明确：

```text
fresh:
previous = undefined

upgrade:
previous = explicitly supplied deployed lock
```

这是硬性 acceptance criterion。

---

# 68. Removed plugin package 的 release 生命周期

安全流程：

```text
Release N:
package installed
plugin active

Release N+1:
qualy plugin remove
package STILL installed
target build using previous deployed lock
plugin becomes detached if retained

...
explicit destructive decommission/purge
data ownership removed

later release:
package can finally pnpm remove
future OCI no longer contains it
```

如果在 retention 结束之前：

```bash
pnpm remove plugin
```

target build 必须 fail：

```text
previous deployment requires this retained plugin,
but its package is not installed in the Product Package
```

不要静默放弃 retention。

---

# 69. Disabled plugin 与 OCI closure

disabled plugin：

```text
在 manifest
```

所以一定进入 target package closure。

虽然它不运行，但 resolver 需要 descriptor，用户也可能下一 target enable。

detached plugin：

```text
不在 manifest
但 target resolution 中
```

同样进入 closure。

最终 package roots：

```text
generic runtime roots
+
resolution.plugins
+
required platform tooling for deploy
```

而不是：

```text
runtimePlugins only
```

---

# 70. 不要把全部官方 plugin 都放进镜像

Target builder 不允许：

```text
COPY packages/plugins all
```

或：

```text
install every @qualy/plugin-*
```

镜像必须是 target-specific。

active / disabled / detached target closure 可以包含。

从未安装、从未选择、target 不需要的官方插件不能出现。

---

# 71. 但也不要混淆 package candidate 与 runtime active

在 build staging 阶段：

```text
Package candidate
```

和：

```text
Assembly accounted plugin
```

是两个概念。

最终严格 target image 可以 prune 到：

```text
resolution.plugins
```

但 resolution 之前，Product Workspace 可以安装额外 package。

不要为了 image pruning 改变开发 package manager semantics。

---

# 72. `@qualy/web-build -> @qualy/plugin-ui-registry` 等残余 transitive edge

P1 的目标是：

> apps/server 不再直接拥有 Product plugin implementations。

不要错误宣称：

> 整个 npm transitive graph 已经完全没有任何 plugin implementation edge。

例如 build tooling / capability facade 仍可能有合理/待迁移 dependency。

只针对实际边界修复，不为了口号制造循环重构。

---

# 73. Production secrets

任何这些都不能写入：

```text
qualy.yml
qualy.lock.json
image layers
```

例如：

```text
DATABASE_URL
Redis auth
JWT/session secret
COS secret
SMTP secret
OTel credentials
```

通过：

```text
environment
Docker secret
Kubernetes Secret
```

提供。

当前 database provider 已经拒绝在 manifest 放 URL，这个方向必须保留。

---

# 74. Runtime Config vs Assembly Config

继续保持当前好的思想：

```text
Assembly-changing config
→ qualy.yml
→ hash
→ target rebuild

Runtime/environment config
→ env/secret
→ 不改变 Assembly
```

例如：

```text
plugin enabled/config that affects product
→ Assembly

DATABASE_URL
log destination
credentials
→ Environment
```

不要把所有东西为了“一个 yml”塞进 yml。

---

# 75. 常见错误实现：明确禁止

Claude Code 实施时禁止以下方案。

### 错误 1

重新创建：

```text
apps/product/package.json
```

让人长期同时维护 yml 和这个 package。

### 错误 2

在 `qualy.yml` 增加：

```yaml
source: npm:
source: file:
```

### 错误 3

`qualy resolve` 自动执行 pnpm install。

### 错误 4

production start 自动：

```text
resolve/write lock
generate migration
apply migration
install package
rebuild web
```

### 错误 5

宿主机 node_modules mount 到 container。

### 错误 6

生产挂载可修改 `qualy.yml` 到已构建 image。

### 错误 7

把 migration history bake 到 product image。

### 错误 8

generate 直接 diff production schema。

### 错误 9

把 sandbox execution 放回 Server process。

### 错误 10

把 Sandbox Runtime 和 Authoring 合并成一个 process/container。

### 错误 11

为了 host separation 把 PackageResolver 改成只允许 package.json direct dependency。

### 错误 12

把所有 plugin packages COPY 进每个 target image。

### 错误 13

只根据 `runtimePlugins` 打包，导致 disabled/detached package 丢失。

### 错误 14

把 target lock 与 deployed lock 当成同一个文件。

### 错误 15

production builder 在 `--fresh` 时继承 repository development lock 的 detached history。

---

# 76. P1 完成标准

P1 完成前不要开始 Docker。

必须全部满足：

```text
[ ] manifest v3 无 workspace
[ ] root is Product Package
[ ] apps/server production deps 无 concrete product plugin
[ ] server tests需要的插件仅在 devDependencies
[ ] PackageResolver behavior preserved
[ ] root manifest resolve 成功
[ ] ping development lock仍 detached
[ ] disabled plugins仍 resolve
[ ] testkit standalone
[ ] packed third-party plugin works
[ ] web collector works
[ ] dev supervisor reload works
[ ] full typecheck passes
[ ] full unit/integration tests pass
[ ] browser tests pass
[ ] sandbox gates pass
```

---

# 77. Deployment 完成标准

P3/P4 完成：

```text
[ ] /var/lib/qualy state exists
[ ] fresh deploy creates its own initial migration
[ ] fresh deploy does not inherit repo historical migrations
[ ] deployed.lock written only after success
[ ] failed migration preserves old deployed.lock
[ ] generate never reads production schema as source-of-truth
[ ] generation DB can differ from production DB
[ ] concurrent deploy is refused
[ ] server refuses target != deployed
[ ] server never repairs
```

---

# 78. OCI 完成标准

```text
[ ] no runtime package install
[ ] no host node_modules mount
[ ] no product source mount
[ ] target yml baked
[ ] target lock baked
[ ] Web Release baked
[ ] active plugin works
[ ] disabled plugin package exists but does not run
[ ] detached retained plugin package exists
[ ] unrelated plugin package absent
[ ] third-party packed plugin works
[ ] source-free official packages
[ ] no sourcemaps
```

---

# 79. Sandbox 完成标准

```text
[ ] Runtime independent OCI
[ ] Authoring independent OCI
[ ] network none
[ ] read-only root
[ ] non-root
[ ] cap_drop ALL
[ ] no-new-privileges
[ ] CPU/memory/PID limits
[ ] only UDS communication
[ ] no Qualy secrets
[ ] source-free
[ ] protocol/ABI mismatch remains typed outage
```

---

# 80. 最终应形成的整体架构

```text
                     PRODUCT DEVELOPMENT
┌───────────────────────────────────────────────────┐
│ package.json                                      │
│ pnpm-lock.yaml                                    │
│ qualy.yml                                         │
│ qualy.lock.json (development/review)              │
└──────────────────────┬────────────────────────────┘
                       │
                       │ qualy build
                       │ + optional previous deployed lock
                       ▼
              TARGET ASSEMBLY RESOLUTION
                       │
          ┌────────────┼──────────────┐
          │            │              │
          ▼            ▼              ▼
     Server dist   Plugin closure   Web Release
          │            │              │
          └────────────┴──────┬───────┘
                              ▼
                    Target Server OCI
                  qualy.yml + target lock


                   PLATFORM RELEASE
          ┌──────────────────────────────┐
          │ sandbox-runtime OCI          │
          │ sandbox-authoring OCI        │
          └──────────────────────────────┘


                    CUSTOMER SERVER
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
       Server OCI        PostgreSQL          Redis
            │
            │ UDS
      ┌─────┴──────────┐
      ▼                ▼
Sandbox Runtime   Sandbox Authoring

            │
            ▼
      /var/lib/qualy
      ├── assembly/
      │   └── deployed.lock.json
      └── database/
          └── migrations/
```

---

# 81. Claude Code 实施要求

不要一次把 P1–P9 混成一个巨大 diff。

按阶段执行。

每一阶段：

1. 阅读相关实现与测试；
2. 先列出实际受影响文件；
3. 实施；
4. 添加 architecture gate；
5. 运行相关测试；
6. 运行 full typecheck/test；
7. 检查是否引入新的 hardcoded plugin list；
8. 检查是否重新产生 package/Assembly 双重 truth；
9. 更新 `CLAUDE.md` 和对应设计文档；
10. 提交阶段报告后再进入下一阶段。

---

# 82. Claude Code 每阶段最终报告格式

请最终报告：

```text
1. Changed architecture
2. Changed files
3. New invariants
4. Removed legacy assumptions
5. Tests added
6. Commands run
7. Test results
8. Remaining known limitations
9. Deferred work
10. Any deviation from this design and why
```

不能只写：

```text
implemented successfully
```

---

# 83. 最后重新强调整个系统的职责边界

最终必须能用下面几句话完整解释 Qualy：

```text
package.json says which software is installed.

pnpm-lock.yaml fixes the software dependency graph.

qualy.yml says which installed Qualy plugins form the desired product.

qualy.lock.json records the resolved target Assembly.

the OCI image contains the immutable software required by that target.

deployed.lock.json records what one concrete instance successfully applied.

database migrations belong to that concrete instance.

server startup validates and runs; it never repairs.

sandbox execution lives in separate hardened containers.
```

如果任何实现让其中两句话重新变成同一层职责，就应该停下来重新检查设计。

---

# 84. 现行结论(2026-09-17,P4.5 架构收敛)

## 产品定位

**Qualy 是一个单一代码库、单一产品、单一发布物的软件系统。** Plugin 的价值是内部模块化、能力组合、依赖隔离、开发扩展与架构展示;
当前不以「客户在生产环境任意安装/卸载插件、任意拼装自己的 Qualy Product」为产品目标。此前为「任意 Product / customer-specific
Assembly / per-instance lineage」引入的复杂度已收敛。

## P1–P4 的取舍(KEEP / ADAPT / REMOVE)

- **P1 全部 KEEP**:仓库根是 Qualy 自己的 Composition Root(不是面向客户的 Product Host);`package.json`/`pnpm-lock` 管包,
  `qualy.yml`/`qualy.lock.json` 管装配;`apps/server` 是通用运行宿主;descriptor / capability / resolver / active-disabled-detached /
  retention / `qualy plugin add|enable|disable|remove` / 隔离与边界门禁;`application.workspace` 不恢复。
- **P2 KEEP,停止平台化**:`locateManifest` 发现规则、product root 的 `.env`、dev supervisor 按 resolved package root 监听、
  packed third-party plugin smoke、standalone-product smoke 都保留(简单、正确、无维护成本);不再为多产品 / 外部 workspace /
  客户 Product Host / Product SDK / 插件市场增加机制。
- **P3 审计后**:KEEP `qualy deploy` 显式部署、启动不安装依赖/不生成/不迁移/不修复、失败测试;REMOVE `@qualy/deployment-state`
  (state 目录、`deployed.lock.json`、target/applied 比对、atomic promotion、`deploy.lock` 文件锁)与 production 启动的
  `deployment required` 校验——当前分支只有 database capability 有 deploy 副作用,PostgreSQL ledger 已是实例的 applied state,
  image + committed `qualy.lock.json` 已是 target state。single-writer 改放到迁移层:`migrator.ts` 的库级 advisory lock(排队,超时才拒绝)。
- **P4 收敛为标准开发期迁移工作流**:lineage 回到仓库 `db/migrations/` 并提交;KEEP 统一 schema graph、`Db.entities`、
  `dependsOn` DAG、复合外键、baseline 片段、retention、collision 校验、scratch 结构比较器、`qualy generate`、`database custom`、
  drop guard、ledger、migrator、`nextStamp`、`QUALY_GENERATION_DATABASE_URL`(只给开发/CI);REMOVE per-instance lineage、
  `import-lineage`、fresh 实例动态 initial、生产/OCI 构建期生成、transition 机制、按声明建测试模板的 globalSetup。
  开发流程:改 Entity/baseline → `qualy generate` → review(可改 SQL、穿插 DDL/DML/跨插件 backfill/expand-contract)→ commit。
  CI:**禁止生成**,`qualy database verify`(重放 committed lineage 建 scratch A、按声明建 scratch B、零 drift 且无 pending baseline)。
  生产:读 image 内 committed migrations,按 ledger 执行 pending。

## 后续计划(取代原 P5–P9)

- **新 P5 Production Build**:从仓库当前状态(package.json、pnpm-lock、qualy.yml、committed lock、committed db/migrations、源码)
  用 pnpm + Docker multi-stage 构建一个确定性的 immutable release image;不读部署状态、不生成迁移、不改 lock、不按客户历史出镜像;
  final image 只含 compiled JS、production deps、web 静态资源、qualy.yml/lock、db/migrations、必要静态资源。
- **新 P6 Production Deployment**:`qualy-server:<release>`、`qualy-sandbox-runtime` / `qualy-sandbox-authoring`、production compose、
  `.env.example`、PostgreSQL/Redis/持久存储、Sandbox UDS(runtime 与 authoring 不合并、无 TCP 回退、不暴露业务 secrets)、
  health/readiness、一次性 `qualy deploy` migration job、正常启动;compose 用已构建 image,不挂源码与宿主机 node_modules。
- **新 P7 Release Verification**:空库 replay 到 current 并与声明 parity;跨插件 FK 正确;至少一个历史 release 库升级到 current;
  已发布迁移不可静默修改;destructive 需显式 approval;迁移 single-writer;失败不记成功;final image 无源码/工具链可启动;
  Web production build 可加载;Sandbox RPC/ABI smoke;一次 backup → restore → startup;文档明确 image rollback ≠ schema rollback。
  完成后结束基础设施重构,回到业务功能开发。

## 最终架构原则

```text
Plugin 用来组织和组合 Qualy 本身。
package manager 管软件依赖。
Assembly 管应用组合。
开发者生成、审查并提交数据库 migration。
CI 只验证,不生成、不修复。
Build 只构建一个 immutable Qualy release。
Deploy 只执行已经审查的部署动作。
Startup 只验证并运行。
生产环境不安装 package、不生成 migration、不修复源码状态。
```

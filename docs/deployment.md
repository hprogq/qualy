# 生产构建、部署与发布验证

> 状态:现行(2026-09-17)。本文是 Qualy 从「一次提交」到「一台机器上跑着的一个 release」的唯一说明;
> 命令序列在 `deploy/README.md`,本文讲的是形状、不变量与为什么。
> 前提是 CLAUDE.md 的产品定位:**单一代码库、单一产品、单一发布物**。Plugin 用来组织和组合 Qualy 本身,
> 不存在客户在生产环境装卸插件、拼装自己的 Qualy 的场景。

## 1. 分工

| 角色    | 做什么                                                                                                                                                                                | 绝不做什么                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 开发者  | 改实体 → `pnpm qualy generate` → 审查、编辑并提交 SQL(DDL、DML、backfill、expand/contract)                                                                                            | 让生产环境替自己生成迁移                  |
| CI      | 验证:`qualy resolve --frozen-lockfile`、`qualy database verify`(committed lineage 重放 = 声明 schema,零 drift)、drop guard、迁移不可回改、测试、真启动 smoke、镜像门禁、release smoke | 生成、修复、提交任何东西                  |
| Build   | 从 checkout 构建一个 immutable release(三个镜像,同一 tag)                                                                                                                             | 读部署状态、生成迁移、改 lock、按客户变化 |
| Deploy  | 执行已审查的动作:`migrate` job 应用镜像里提交的迁移;`up -d` 换容器                                                                                                                    | 装 package、生成迁移、修源码状态          |
| Startup | 校验(manifest 对 lock、web release 对装配、ledger 对 lineage)然后运行                                                                                                                 | 安装、生成、迁移、修复                    |

## 2. 发布物

一个 release = 同一 checkout 构建、同一 tag 的三个镜像:

- `qualy-server:<release>`:服务进程(默认命令)与迁移 job(`node apps/cli/src/main.ts deploy`)共用;
- `qualy-sandbox-runtime:<release>`:QuickJS 计分沙箱,一条 unix socket;
- `qualy-sandbox-authoring:<release>`:公式编译沙箱(source policy、TS、esbuild),一条 unix socket。

`pnpm release:build <release> [--check]`(`tools/release/build-images.ts`)顺序构建三者;不给 tag 时用短 commit hash,
工作树不干净则加 `-dirty` 后缀,让脏树构建的镜像自己说出来。

### 2.1 server 镜像(根 `Dockerfile`)

三阶段,输入只有 checkout:

1. `web`:`pnpm install --frozen-lockfile --ignore-scripts` → `qualy resolve --frozen-lockfile`(lock 必须描述这棵树,过期是构建失败而不是修复)
   → `vite build` → stage 进 web 插件的 release store → `check-staged-web`。
2. `runtime`:`pnpm install --prod --filter-prod 'qualy...' --filter-prod '@qualy/app...' --filter-prod '@qualy/cli...'`
   (应用 = 根包的插件依赖 + server 宿主 + deploy CLI,**沿生产边**取闭包)→ `tools/release/prune-server-image.mjs`
   (闭包由 pnpm 现算,不手写清单;删闭包外的包、tests、`./testkit` 导出目标、`src/client`、`*.tsx`、tsconfig、vitest 配置、tools、docs)
   → 拷入 staged client-dist。
3. final:`node:24-bookworm-slim`(argon2 只有 glibc 预编译包)、`USER node`、`NODE_ENV=production`、HEALTHCHECK `/health/live`、
   预建 `/var/lib/qualy/storage` 与两个 socket 目录(归 node,命名卷首次挂载继承所有权)。

服务端**以 TS 源码 + node strip-types 运行**,与 sandbox 镜像同一做法:仓库没有 emit 步骤,workspace 包必须是 node_modules
之外的真实目录。镜像里没有 tests、浏览器源码、vitest / vite / typescript / tsgo / playwright / tsx / esbuild,没有 tools、docs、apps/web、
.git,没有 `.env`。`tools/quality/check-release-image.ts` 从外部逐条断言(CI `image` job)。

### 2.2 一条从镜像学到的纪律

镜像只装生产依赖,而开发态全量安装会把 devDependencies 也链接进包的 node_modules——运行时确实 import、却只写在
devDependencies 里的包,在每个开发机上都能解析,在镜像第一次启动时才炸(第一版镜像就死在 `@qualy/plugin-auth` import
`@qualy/api-kit`)。因此:**运行时 import 必须声明在 dependencies**,`tools/tests/workspace-deps.test.ts` 按镜像同一闭包扫
`src/`(排除 `client/`、`dev/`、testkit)守住;`pnpm --filter 'x...'` 会沿 devDependencies 跟进,镜像一律 `--filter-prod`。

## 3. 部署(`deploy/`)

`deploy/compose.yaml` + 从 `deploy/.env.example` 填出的 `.env`,就是部署单元。只有 `image:`,不 build、不 bind 源码、不挂宿主 node_modules。

服务:

- `postgres`(pgvector pg18):命名卷 `pg_data`、`pg_backups`;不发布端口,只在 compose 网络内可达。
- `migrate`(profile `deploy`):server 镜像跑 `deploy`,`docker compose run --rm migrate` 按需运行;migrator 持数据库级 advisory lock,
  第二个 writer 排队后发现无事可做;失败的迁移不进 ledger,job 非零退出,旧 server 继续跑。
- `server`:`env_file: .env`,容器内路径由 compose 覆盖(`PORT`、存储根、两条 socket 路径、`QUALY_VERSION=<release>`);
  只发布到 `127.0.0.1:3000`(边缘代理见 `ops/reverse-proxy/`);`read_only` 根 + tmpfs `/tmp`;卷:`storage`(附件)、
  `sandbox_runtime`、`sandbox_authoring`(读写挂载:unix socket 的 connect() 需要 socket inode 的写权限,只读挂载返回 EROFS)。
- `sandbox-runtime` / `sandbox-authoring`:按 `docs/sandbox-process-isolation.md`:`network_mode: none`、只读根、`cap_drop: ALL`、
  非 root、pids / mem / cpu 限额、各自一个卷;**不给 `.env`**——沙箱环境只有自己的 socket 路径与限额,没有业务 secret。
  两个卷分开,runtime 看不到 authoring 的 socket,反之亦然。没有 TCP fallback:socket 不可达时公式发布 / 计分失败,不退回主进程。

没有 Redis:源码里没有任何使用,不为「将来也许」加一个空转的服务。

### 3.1 升级

装入新 release 的三个镜像 → 改 `.env` 的 `QUALY_RELEASE` → `docker compose run --rm migrate` → `docker compose up -d` → `/health/ready`。
server 与 web release 是同一 deployment unit(同一镜像),不存在「只更新 server、复用旧 web」的部署;旧 tab 在下一次请求拿到
release 不匹配后自行 reload。

### 3.2 镜像回滚 ≠ schema 回滚

把 `QUALY_RELEASE` 改回去再 `up -d`,回滚的是**代码**。已应用的迁移留在库里,旧代码面对的是新 schema。

- 迁移只做加法(加表、加列、加索引、backfill 写新列)时,旧代码看不见新列,回滚安全。这正是「先 expand、等一个 release 再 contract」
  的理由:一条 contract(删列、改类型、收紧约束)必须等到依赖它的 release 已经稳定、不会再被回滚之后才提交。
- 迁移含破坏性变更(drop guard 要求 `ALLOW_DESTRUCTIVE=1` 或 `-- destructive: approved` 才放行)时,旧代码可能直接报错,
  这时「回滚」只有两条路:fix-forward 一个新 release,或从升级前的备份恢复并接受这段时间的写入丢失。
- 因此升级前先备份(`deploy/README.md`「Backup and restore」),这不是可选项。

这也是启动校验的另一半:server 对着**落后于自己**的库拒绝启动(`database is N migration(s) behind ... run the migration job`),
对着**领先于自己**的库(回滚后的镜像)不拒绝——ledger 里多出来的迁移它不认识也不需要认识,能否运行取决于上面的加法规则。

## 4. 发布验证

| #   | 要求                                                                           | 由谁证明                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 空 PostgreSQL 重放 committed lineage 到当前                                    | `qualy database verify`(CI 每次)                                                                                                                                       |
| 2   | 结果与 Assembly Schema Graph(全部 `Db.entities` + 复合外键 + baseline)零 drift | 同上:scratch A 重放、scratch B 按声明建、逐语句比对                                                                                                                    |
| 3   | 跨插件 / 复合外键正确                                                          | 同上(结构 diff 含约束);各插件 `schema-parity` 测试逐对象比对                                                                                                           |
| 4   | 有代表性的历史 release 数据库能升级到当前                                      | `packages/plugins/infra/database/tests/lineage-upgrade.test.ts`:在 2026-09-12 部署(Deployment B)时的 lineage 前缀上建库,再用完整 lineage 追平,与一次建成的库逐对象相同 |
| 5   | 已发布迁移不得悄悄修改                                                         | `tools/quality/check-migrations-immutable.ts <base>`:base..HEAD 之间 `db/migrations` 只许新增(CI 对 PR base / push 前 commit 跑)                                       |
| 6   | 破坏性迁移需要显式批准                                                         | `qualy database drop-guard`(CI 每次);generate 期自动 guard                                                                                                             |
| 7   | 迁移执行 single-writer                                                         | migrator 的 `pg_advisory_lock` + `lock_timeout`;`migrator.test.ts` 三条                                                                                                |
| 8   | 迁移失败不记为成功                                                             | 整文件一个事务,失败不入 ledger;`migrator.test.ts`                                                                                                                      |
| 9   | 最终 server 镜像无仓库源码 / 开发工具链也能启动                                | `check-release-image.ts`(镜像内 resolve、无库启动停在数据库)+ `release-smoke.ts`(对真库启动到 ready)                                                                   |
| 10  | Web production build 能加载                                                    | `smoke-production.ts`(CI)+ `release-smoke.ts`(镜像内 shell、manifest、一个哈希资源)                                                                                    |
| 11  | Sandbox RPC / ABI 冒烟                                                         | `qualy sandbox status`:从 server 容器内对两条 socket 取 capabilities,核对 rpc / abi 版本;`release-smoke.ts` 在 compose 栈上执行它                                      |
| 12  | 备份 → 恢复 → 启动                                                             | `release-smoke.ts`:`pg_dump -Fc` → dropdb/createdb → `pg_restore` → `migrate`(up to date)→ server 重启到 ready                                                         |
| 13  | 文档:镜像回滚 ≠ schema 回滚                                                    | 本文 §3.2                                                                                                                                                              |

`tools/quality/release-smoke.ts <release>` 在一个一次性的 compose project 上驾驭 `deploy/compose.yaml`:
postgres 起 → **未迁移就启动 server 必须被拒**(项 9 的另一半)→ `migrate` → server + 两个 sandbox 起 → `/health/ready` →
shell / manifest / 哈希资源 → `qualy sandbox status` → 第二次 `migrate` 报 up to date → 备份、销库、恢复、`migrate`、重启到 ready → `down -v`。
CI 的 `image` job 构建三个镜像后跑它。

## 5. 明确不做

零停机发布框架、Kubernetes operator、多副本协调器、通用发布平台、任意插件 sidecar、客户自定义镜像。
单机 compose、一次性迁移 job、明确的备份与回滚规则,就是 Qualy 现在需要的全部;再多一层都要等真实需求来触发。

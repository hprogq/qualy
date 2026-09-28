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

`pnpm release:build [<release>] [--check] [--allow-dirty] [--platform <os/arch>]`(`tools/release/build-images.ts`)顺序构建三者,
机器保证「一个 tag = 一个 commit、一个平台」:

- **命名 release 从 commit 的快照构建,不从工作目录**:`git worktree add --detach` 出一棵只含该 commit 的临时树作为三次 `docker build`
  的 context,构建完删除。工作目录里 git 忽略而 docker 不忽略的文件、构建期间的改动,都到不了镜像里。给了名字(如 `v1.0.0`)而构建输入
  有改动一律拒绝,除非显式 `--allow-dirty`(此时和无名构建一样从工作目录构建)。「构建输入」按 `.dockerignore` 判断:docs/、STATUS.md
  之类不进构建上下文的改动不算。
- 不给 tag 是开发构建:tag 用短 commit hash,构建输入有改动则加 `-dirty`;第一次构建前对工作目录取指纹(HEAD + 构建输入内的已跟踪改动
  内容 + 未跟踪文件名与内容),之后每次构建前与最后一次构建后比对,指纹变了就删除本次打出的 tag 并失败,三个镜像不会来自两棵树。
- **一个目标平台**:`--platform` 缺省 `linux/amd64`(服务器的平台,不是构建机的;Apple Silicon 上本机验证用 `--platform linux/arm64`)。
  三个镜像建完后逐个 `docker image inspect`:Os/Architecture 等于目标平台、`org.opencontainers.image.revision` 等于 commit(脏树加 `-dirty`)、
  `org.opencontainers.image.version` 等于 release,任一不符删除全部 tag 并失败。
- `--check` 在三者建完后对 server 镜像跑 `check-release-image.ts`,不通过同样删除本次打出的 tag:一个 release 要么完整可用,要么不存在。

基础镜像全部**按 digest 固定**:三个 Dockerfile 的 `node:24.20.0-*@sha256:…` 与 `mise.toml`、CI `setup-node` 同一版本;
`deploy/compose.yaml`、开发 compose 的两个集群、CI 的 postgres service 同一个 `pgvector/pgvector:pg18-bookworm@sha256:…`。
同一 commit 隔月重建,起点仍是同一批字节;`tools/tests/release-inputs.test.ts` 守住这三处一致与 digest 存在,升级基础镜像就是改这几行并过门禁。

### 2.1 server 镜像(根 `Dockerfile`)

三阶段,输入只有 checkout:

1. `web`:`pnpm install --frozen-lockfile --ignore-scripts` → `qualy resolve --frozen-lockfile`(lock 必须描述这棵树,过期是构建失败而不是修复)
   → `vite build` → stage 进 web 插件的 release store → `check-staged-web`。
2. `runtime`:`pnpm install --prod --filter-prod 'qualy...' --filter-prod '@qualy/app...' --filter-prod '@qualy/cli...'`
   (应用 = 根包的插件依赖 + server 宿主 + deploy CLI,**沿生产边**取闭包)→ `tools/release/prune-server-image.mjs`
   (闭包由 pnpm 现算,不手写清单;删闭包外的包、tests、`./testkit` 导出目标、`src/client`、`*.tsx`、tsconfig、vitest 配置、tools、docs)
   → 拷入 staged client-dist。
3. final:`node:24.20.0-bookworm-slim@sha256:…`(argon2 只有 glibc 预编译包)、`USER node`、`NODE_ENV=production`、HEALTHCHECK `/health/live`、
   预建 `/var/lib/qualy/storage`、`/var/lib/qualy/web` 与两个 socket 目录(归 node,命名卷首次挂载继承所有权)。

服务端**以 TS 源码 + node strip-types 运行,这是正式的生产执行模型**(2026-09-17 裁决,不是过渡方案),与 sandbox 镜像同一做法:
仓库没有 emit 步骤,workspace 包必须是 node_modules 之外的真实目录。选它的理由:开发、测试、镜像是同一套模块结构与包解析,
P5 的依赖声明缺陷正是因为没有 bundler/dist 掩盖才暴露;改预编译 JS 要另立 src→dist export 改写、描述器与 CLI 路径、迁移与 baseline
资产拷贝、源码/产物一致性等一整套不变量,而收益(135 MB 镜像、冷启动)目前没有数据支持。**重新考虑的触发条件**:冷启动、镜像拉取体积、
TS 解析 CPU 或源码分发要求中任何一项有实测数据证明成了问题。

镜像里没有 tests、浏览器源码、vitest / vite / typescript / tsgo / playwright / tsx / esbuild,没有 tools、docs、apps/web、
.git,没有 `.env`。`tools/quality/check-release-image.ts` 从外部逐条断言(CI `image` job):node 版本等于 Dockerfile 固定的版本;
qualy.yml、qualy.lock.json 与 `db/migrations` 每个文件按 **SHA-256** 与 checkout 比对(同一段脚本分别用宿主 node 与镜像内 node 执行,
名字对而 SQL 不同也会失败)。

### 2.2 一条从镜像学到的纪律

镜像只装生产依赖,而开发态全量安装会把 devDependencies 也链接进包的 node_modules——运行时确实 import、却只写在
devDependencies 里的包,在每个开发机上都能解析,在镜像第一次启动时才炸(第一版镜像就死在 `@qualy/plugin-auth` import
`@qualy/api-kit`)。因此:**运行时 import 必须声明在 dependencies**,`tools/tests/workspace-deps.test.ts` 按镜像同一闭包扫
`src/`(排除 `client/`、`dev/`、testkit)守住;`pnpm --filter 'x...'` 会沿 devDependencies 跟进,镜像一律 `--filter-prod`。

闭包只有一个答案:`tools/release/runtime-closure.ts` 以 `pnpm --filter-prod <roots>... ls --json` 问 pnpm,镜像修剪器与上面的门禁都经它取,
门禁另断言 Dockerfile 的 install filter 与它的根列表一致——不再有一处手写依赖 BFS、一处跑 pnpm 的分叉。两个 sandbox 镜像同一做法:
`prune-image-tree.mjs <app 包名>` 从它点名的那个 app 现算生产闭包(`workspaceClosure(root, [app])`),不再手写保留清单;
`pnpm install --filter` 总会顺带装上 workspace 根的依赖,修剪器再按 store 可达性删掉闭包外的包(实测 sandbox 镜像 292 MB → 闭包内 18 个 store 条目)。

### 2.3 构建之前的三条装配不变量

镜像只是 checkout 的投影,所以这三条在 resolve / generate / CI 就拒绝,不等到镜像里发现:

- **产品必须自己安装它选的插件**:`qualy.yml` 选的每个插件都要在放着清单的包(仓库根)的 `dependencies` 里。node 解析能从祖先目录、或从
  devDependencies 凑巧找到包,而 `pnpm install --prod` 两者都不链接,镜像第一次启动才炸。resolve 对两种情况分别点名
  (`is not in dependencies; pnpm add X` / `is only in devDependencies; a production install links dependencies alone`),
  `tools/tests/product-dependencies.test.ts` 守。
- **`Db.entities` 的 `dependsOn` 只能指向拥有数据库对象的插件**(有 `Db.entities` 或 baseline):指向一个什么表都没有的插件,
  是复制粘贴留下的死边或写错了目标,resolve 拒绝并点名。
- **lineage 只在末尾生长**:`db/migrations` 里已提交的文件不改、不删、不改名,新文件的时间戳必须晚于 lineage 现有的一切
  (`nextStamp` 取 head 之后而不是「现在」,时钟回拨也不会插到历史中间;`writeMigration` 以 `link(2)` 排他写入,同名即拒,
  一条迁移永不替换另一条)。CI 的 `check-migrations-immutable.ts <base>` 对 base..HEAD 断言:没有 M/D/R/T 变更(唯一例外是登记过的
  `20260916143334.sql → 20260916143334_administrative-imports.sql` 改名),新增文件名合规且时间戳晚于 base 的 head。
  反向实证:回填一个早于 head 的文件、与 head 同一秒的文件、名字不合规的文件都 exit 1,晚于 head 的 exit 0。

### 2.4 一次部署改变什么

有 deploy 副作用的能力有两个,每个都有一样启动时拿来与镜像比对的东西,所以仍然没有第二份「已部署」记录(P4.5 删除了 deployed lock):

- `database`:migration ledger 就是实例的 applied state;启动对落后于镜像 lineage 的库拒绝。
- `web-release`(2026-09-27 加入,`@qualy/plugin-web`):部署自己的 web release store(compose 的 `web_releases` 卷,
  `QUALY_WEB_RELEASE_STORE`);deploy 把镜像带的 release 装进去并设为 current,启动对「current 不是本镜像的 release」的 store 拒绝。

这个前提由 `tools/tests/deploy-capabilities.test.ts` 钉住:枚举仓库全部插件的能力 provider,实现 `deploy` 的只能是这两个。
出现第三种有持久部署副作用的能力时,先设计启动如何验证它执行过,再改这张表。

### 2.5 发布:tag → 镜像仓库(2026-09-28)

GitHub Actions 是唯一的发布构建者(`.github/workflows/release.yml`):推一个 `v*` tag → 以 `workflow_call` 在同一 commit 上跑完整 CI
(其 `image` job 跳过,由下一步自己构建)→ tag 必须在 main 上、同名 release 没有发布过 → `build-images.ts <tag> --check --platform linux/amd64`
→ `release-smoke.ts <tag>` → 推到 `vars.QUALY_REGISTRY`(CNB,`docker.cnb.cool/<org>/<repo>`)→ `tools/release/push-images.ts` 记下三个镜像的
digest 与 server 镜像携带的 web release id,写成 `release.json` 挂在该 tag 的 GitHub release 上。推送令牌只在 GitHub 的 `release` 环境里,
服务器只持只读令牌。部署按 `release.json` 的 digest 拉取(tag 只是名字,有推送权的人都能挪),拉下后以本地的 `qualy-*:<release>` 命名,
compose 与 `upgrade.sh` 不需要知道镜像仓库。`connectivity.yml` 是手动运行的测量:同一脚本以 `connectivity-<run>` 推一遍并逐个计时,
另对服务器的 SSH 端口做一次 host key 扫描。

**真桶门禁**(同一工作流的 `cos` job,与 `ci` 并行、`release` 等它):COS 后端的真桶套件在 GitHub 上以 CI 专用身份
`qualy-ci-storage` 跑,只对两个 CI 专用桶有权限(不碰生产桶,也不与开发者本机测试用的桶共用,免得两边的版本对账互删)。
凭据只在 `cos-test` 环境(只允许 `v*` tag),所以这个 job 只拿到 COS 测试身份、`release` job 只拿到镜像推送令牌;
缺任何一个设置即失败,套件里有被跳过的用例也算失败。本机跑一遍不算门禁——机器执行不了。

**SourceMap**(同一工作流的 `sourcemaps` job,2026-09-28):浏览器构建以 `hidden` 生成 map,它们带着 `sourcesContent`,永不进镜像
与 release store。`build-images.ts --export-web <dir>` 在同一个构建上下文里再取一次 `web` 阶段(命中同一批缓存层)导出 `apps/web/dist`,
并核对它的 web release id 就是 server 镜像里 `current.json` 的那个,否则整个 release 作废;`release` job 把它作为保留一天的 artifact
交给 `sourcemaps` job。后者在 `rum-sourcemaps` 环境(只允许 `v*` tag)里,先核对 map 属于已发布 `release.json` 的 `webRelease`,再以
`qualy rum sourcemaps` 按与浏览器相同的版本映射交给腾讯 RUM;上传凭据(`QUALY_RUM_TENCENT_SOURCEMAP_*`,子账号 `qualy-rum-uploader`)
只给上传那一步。它排在发布之后:map 没交上是一个要看的红 job,不是一个没发出去的 release(docs/rum.md 的失败策略)。
runner 在境外、RUM 的桶在境内,桶会以 `RequestTimeOut`「User network is too slow」丢弃过慢的连接(SDK 对 4xx 不重试;
v0.1.0-rc.3 的 job 因此跑了十分钟,一个 map 也没登记上),所以上传器 4 路并发、单个请求两分钟无进展即放弃、每个 map 换新 key 重试三次、
每 32 个登记一次记录,job 设 30 分钟上限。失败的一次留下已登记的部分,重跑只补缺的;重跑 job 用的是 tag 当时的代码,
所以修了上传器之后,用本机检出对该 release 的 `web-dist` artifact(保留一天,先按上面同样核对 `webRelease`)跑同一条命令补交。
慢的是字节进境这一段,不是 API:`rum.tencentcloudapi.com` 就近接入,桶却在广州(`DescribeFileCertificate` 不认 `Site`;
旧接口 `DescribeReleaseFileSign` 的 `Site=1` 凭据同样写得进广州桶、也不给境外桶名,而 `CreateReleaseFile` 只收项目与文件列表,
2026-09-28 实测后放弃;桶未开全球加速,`BucketAccelerateNotEnabled`)。所以上传器先按文件名查平台已有的记录:chunk 名带内容哈希,
某个旧版本登记过同样字节(md5 相同)的 map 只登记一条指向那个对象的新记录,不再上传。rc.2 → rc.3 有 125/189 个 map、
23.3 / 28.0 MB 不变;rc.3 → rc.4 因为改了分块只剩 3/316。平台若拒绝这种记录,那些 map 照常上传。

### 2.6 部署:按 digest,脚本随 release(2026-09-28)

`deploy/` 进 server 镜像(`prune-server-image.mjs` 保留它;`check-release-image.ts` 逐字节比对它、并确认其中没有任何部署自己的
env 文件)。服务器上只有一个不随 release 更新的东西:root 安装的 launcher `ops/deploy-host/qualy-deploy`,读 root 所有的
`/etc/qualy/deploy.conf`(镜像仓库路径)。它接受的只有 `deploy <release> <三个 sha256 digest> [--maintenance]`、`rollback`、`fetch`、`check`:
按 digest 从配置里的仓库拉三个镜像,核对都标着该 release、同一个非 dirty 的 revision,本机名 `qualy-*:<release>` 若已指向别的镜像即拒绝,
三个都通过才命名;从该 server 镜像 `docker create` + `docker cp` 取出 `deploy/` 到 `/opt/qualy/releases/<release>/`(属 root、去掉组与其他人的写权限),
以 `/opt/qualy/.env` 为 env 文件、在 launcher 持有的同一把锁下执行其 `upgrade.sh`。回滚执行**正在服务的**(较新的)release 的
`rollback.sh`——回到的那个更旧,它的脚本未必认得新脚本写进 `.env` 的东西;按名字部署一个更旧的 release 则用它自己的脚本,所以
`.env` 的格式只增不改。每步之后 `/opt/qualy/current` 指向 `.env` 记为服务中的 release:备份的 cron、手工恢复、边缘的维护页都从这里找文件。
`.env`、`collector.env`(脚本经 `QUALY_COLLECTOR_ENV_FILE` 在 `.env` 旁边找它)与 Caddy 片段永远在镜像之外。

SSH 用专门的 `qualy-deploy` 账户:`authorized_keys` 里 `restrict,command="/usr/local/sbin/qualy-deploy"`,不在 docker 组,sudo 只允许这一个文件;
launcher 以非 root 身份被调起时把 `SSH_ORIGINAL_COMMAND` 按空白切词(不做通配展开)经 `sudo -n` 交给自己,以 root 逐个校验。
所以这把密钥能做的只有:在已发布的 release 之间选一个部署,或回滚一步;给不了脚本、换不了镜像仓库。脚本最终仍以 root 操作 docker 与 Caddy,
这一层权限本身就高,要再降需要 rootless Docker 或另设窄接口,现在不做。安装步骤见 `ops/deploy-host/README.md`。

`.github/workflows/deploy.yml` 只能从 main 手动运行,`production` 环境要审批后才拿得到密钥:读该 release 的 `release.json`,核对它的 revision 就是该 tag 指向的 commit(`v*` tag 由仓库 ruleset 禁止移动与删除,一个 release 名永远对应一个 commit)、平台与每个镜像都在
`vars.QUALY_REGISTRY` 之下,只把 release 名与三个 digest 发给 launcher。三个动作:`deploy`、`rollback`,以及只拉取不启动的 `fetch`
(按 digest 拉取、核对、取出 `deploy/`,首次部署的第一步,也可以在部署前先把镜像拉到机器上)。连接只认 `production` 里那一行在控制台核对过的
host key(不用 runner 自带的 known_hosts)。发布制品(tag)与批准部署是两件事,tag 工作流不进 `production`。

## 3. 部署(`deploy/`)

`deploy/compose.yaml` + 从 `deploy/.env.example` 填出的 `.env`,就是部署单元。只有 `image:`,不 build、不 bind 源码、不挂宿主 node_modules。

服务:

- `postgres`(pgvector pg18):命名卷 `pg_data`;不发布端口,只在 compose 网络内可达(seed 时经 `compose.seed.yaml` 临时发布到本机回环地址)。
  备份与恢复见 §3.3。
- `migrate`(profile `deploy`):server 镜像跑 `deploy`,`docker compose run --rm migrate` 按需运行。先按 ledger 应用迁移
  (migrator 持数据库级 advisory lock,第二个 writer 排队后发现无事可做;失败的迁移不进 ledger,job 非零退出,旧 server 继续跑),
  再把镜像带的 web release 装进 `web_releases` 卷(可写挂载,`QUALY_WEB_RELEASE_STORE=/var/lib/qualy/web`,见 §3.1)。
- **两色**(2026-09-28 用户裁决,§3.1):`server-blue` / `sandbox-runtime-blue` / `sandbox-authoring-blue` 与同样三个 `-green`,
  每色一整套,profile 各自 `blue` / `green`;一色服务、另一色停在它上次跑的 release 上。两色共享的只有数据库、`storage` 与 `web_releases`。
  `.env` 记 `QUALY_ACTIVE_COLOR` 与每色的 `QUALY_RELEASE_BLUE` / `_GREEN`,由脚本写。
- `server-<色>`:`env_file: .env`,容器内路径由 compose 覆盖(`PORT`、存储根、两条 socket 路径、`QUALY_VERSION=<该色的 release>`、
  `NODE_OPTIONS=--max-old-space-size`);各发布到回环地址的一个端口(`QUALY_PORT_BLUE` 3001、`QUALY_PORT_GREEN` 3002,边缘代理见
  `ops/reverse-proxy/`);`read_only` 根 + tmpfs `/tmp`;`mem_limit`(`QUALY_SERVER_MEMORY`,默认 768m,堆上限 `QUALY_SERVER_HEAP_MB`
  默认 512,低于容器上限,进程先回收而不是被杀)、`stop_grace_period: 40s`(`QUALY_SHUTDOWN_TIMEOUT` 30s 加余量);卷:`storage`(附件)、
  `web_releases`(**只读挂载**,从这里服务 shell 与资源)、本色的 `sandbox_runtime_<色>`、`sandbox_authoring_<色>`(**只读挂载**:server 只 connect;Linux 对只读挂载的 EROFS 写检查不覆盖 unix socket,实测 `:ro` 客户端照常连通、写文件报 EROFS;创建与删除 socket 归沙箱自己的读写挂载)。
  每色的沙箱卷分开,server 只连得到本色、也就是本 release 的沙箱。
- `sandbox-runtime-<色>` / `sandbox-authoring-<色>`:按 `docs/sandbox-process-isolation.md`:`network_mode: none`、只读根、`cap_drop: ALL`、
  非 root、pids / mem / cpu 限额、各自一个卷;**不给 `.env`**——沙箱环境只有自己的 socket 路径与限额,没有业务 secret。
  两个卷分开,runtime 看不到 authoring 的 socket,反之亦然。没有 TCP fallback:socket 不可达时公式发布 / 计分失败,不退回主进程。
  **计分沙箱的时间(2026-09-29 在生产机上量):** v0.1.0-rc.4 上学生「我的成绩」每次 500(`ASSESSMENT_SCORING_EVALUATION_FAILED`,
  `execution`:hard deadline 100ms)。生产机是 2 vCPU Xeon Gold 6148 2.4GHz;用 rc.4 的 sandbox-runtime 镜像按线上限额起临时容器,
  11 个演示公式产物各跑两遍、每轮一个新 worker:原样 1 核时新 worker 的第一次调用 131–183 ms(引擎的 WASM 在首次用到时才编译),
  之后中位 10–13 ms、但尖峰到 117 ms,容器 43/43 个调度周期被节流(求值是一个线程,V8 的编译与 GC 在别的线程);超时的 worker
  被换掉,新来的又从第一次调用开始,所以永不恢复。实测组合:只放宽到 2 核,第一次 88–100 ms、无节流;只预热(1 核),仍每周期节流、
  尖峰 93–111 ms;worker 就绪前跑一段覆盖类、私有字段、BigInt、正则、Map/Set、数组与字符串方法的程序 **且** 2 核:第一次 24–45 ms、
  全部 ≤58 ms、0/110 超过 100 ms、0 节流。于是 `sandbox-runtime` 为一个 worker 配 2 核,worker 在报告就绪前预热三次
  (`packages/core/sandbox-engine/src/worker.ts`)。只覆盖 JSON / BigInt / 正则的窄版预热只把第一次降到约 55 ms。
- `tools`(profile `tools`):当前 release 的 server 镜像 + 部署的 `.env` + `storage` 与 `web_releases` 卷,只跑一次性命令
  (`docker compose run --rm tools <命令>`),`QUALY_MIGRATIONS=off`。备份、恢复、基线导入与运维 CLI(`auth set-password`、
  `storage export`)都经它,不点名颜色,也不按带 project 前缀的名字找卷。
- `otel-collector`(profile `telemetry`):`deploy/otel-collector.yaml` + `deploy/collector.env`(凭据只给这个容器),镜像按 digest 固定,
  `mem_limit: 256m`,不发布端口;启动一次,升级不动它——改了它的配置,要从新 release 的 `deploy/` 以同一 `collector.env` 重建这一个容器
  (`docker compose --profile telemetry up -d otel-collector`),凭据先填再重建。traces 走 APM 内网接入点(gRPC over TLS 4320;同一地址的 4319 是明文,
  token 随每次上报发送,所以走加密的那个——2026-09-28 从服务器实测协商出 h2、证书名含该主机);metrics 以 Prometheus remote write 直写 TMP 实例的内网地址
  (`TENCENT_TMP_REMOTE_WRITE_URL`,Bearer `TENCENT_TMP_TOKEN`;2026-09-29 服务器与云联网打通后实测查询与写入端点不带凭据均答 401),不再经 APM
  与控制台同步规则,且不过写入 APM token 的资源处理器(remote write 会把资源属性带进 `target_info`);logs 经 OTLP/HTTP 进 CLS 内网域名。server 经 `.env` 的
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` 与 `OTEL_LOGS_EXPORTER=otlp` 上报,接入点不可达只是后台重试。
- `postgres` 另有:`shared_buffers` 256MB、`effective_cache_size` 1GB、`work_mem` 8MB、`maintenance_work_mem` 64MB(`QUALY_PG_*` 可覆盖;
  PostgreSQL 自己的缺省假设整台机器归它)、`oom_score_adj: -500`(内存耗尽时先杀别的:server 被杀会重启,库被杀是一次恢复)、
  `stop_grace_period: 60s`(干净关机写检查点)。

没有 Redis:源码里没有任何使用,不为「将来也许」加一个空转的服务。

**数据库等待上限**:server 的连接池给每个会话设了上限——取连接或建连 5s、`statement_timeout` 30s、`lock_timeout` 10s、
`idle_in_transaction_session_timeout` 60s(`@qualy/plugin-database` 的 `DATABASE_TIMEOUTS`)。超过任一上限、连接断开或库拒绝新连接时,
该请求答 503 `SERVICE_UNAVAILABLE`,访问日志以 Error 记下原因;约束冲突与业务拒绝照旧。`/health/ready` 每个探针最多等 4s,超时即 503。
要放宽某一项,在 `DATABASE_URL` 上加同名参数(如 `?statement_timeout=120000`,`0` 为关闭),例如对库跑耗时较长的
`qualy assessment audit-scoring` 时;取连接的 5s 不开放配置。**值是毫秒整数**:驱动按 `parseInt` 读,`?statement_timeout=30s`
会变成 30 毫秒,要写 `30000`。只为一条命令放宽时不要改 server 与 `migrate` 共用的 `.env`,也不要在宿主机命令行上写出完整连接串
(密码会进 shell 历史和宿主机的进程列表):在容器里基于已有的 `DATABASE_URL` 拼上参数,例如
`docker compose exec server sh -c 'DATABASE_URL="${DATABASE_URL}?statement_timeout=0" exec node apps/cli/src/main.ts <命令>'`
(单引号让 `${DATABASE_URL}` 在容器内展开;在运行中的 server 容器里,卷与沙箱 socket 都在)。`DATABASE_URL` 已带查询参数
(如 `?sslmode=verify-full`)时,把 `?` 换成 `&`。
迁移(`migrate` job 与开发态 apply)用自己的会话,不受这些上限约束:
迁移器每开一个会话都先把这三项,连同 `idle_session_timeout` 与 `transaction_timeout`(PostgreSQL 17 起才有,DBA 常把它设在角色上
当安全网,超时直接断开会话)设为 0,URL 上的参数与库侧的 `ALTER ROLE / DATABASE … SET` 都不作用于迁移;它只限制等待迁移锁的时长
(`QUALY_MIGRATION_LOCK_TIMEOUT_MS`,默认 120s)。

**库前有 PgBouncer 这类连接池代理时**:上面三项 PostgreSQL 上限是随每条连接的启动报文(startup parameters)下发的。PgBouncer 默认拒绝
它不认识的启动参数,每条连接都报 `unsupported startup parameter`,server 起不来;而只把这三项加进 `ignore_startup_parameters`,
上限就被悄悄丢掉,库一慢请求又会一直等下去。二选一:

- 不经代理,server 与 `migrate` 直连库(compose 拓扑就是这样);
- 或在 `ignore_startup_parameters` 里列出 `statement_timeout,lock_timeout,idle_in_transaction_session_timeout`,同时在库侧给应用角色设同样的值
  (`ALTER ROLE <角色> SET statement_timeout = 30000` 等三条,只对之后新建的会话生效)。这时 URL 上的覆盖不再起作用,要放宽只能改角色默认值,
  或让那条命令直连库。迁移不受角色默认值影响(见上)。

代理必须是 session 池化模式(`pool_mode = session`):迁移锁是会话级 advisory lock,通知监听要一条会话一直 `LISTEN`,
transaction 池化下会话不跟着客户端走,两者都不成立。

**远程或托管 PostgreSQL 的 TLS**:compose 拓扑里 server 与 `migrate` 经内网连 `postgres` 服务,不需要 TLS。连远程或托管库时在
`DATABASE_URL` 上写 `sslmode`,但要按 node-postgres(pg-connection-string 2.x)的口径理解:`sslmode=require`、`prefer`、`verify-ca`
都按 `verify-full` 处理——既校验证书链也校验主机名,不是 libpq 那种「只加密、不校验」;驱动还会为此在每个进程打印一次 `SECURITY WARNING`,
直接写 `sslmode=verify-full` 即可免去。库的证书由自签或私有 CA 签发时,把 CA 文件以只读卷挂进 server 与 `migrate` 两个容器,并在 URL 上加
`sslrootcert=<容器内路径>`;不挂的话每条连接都因证书不受信被拒,server 起不来。不要用 `sslmode=no-verify` 绕过,那等于不再核对连上的是谁。
URL 原样交给驱动,应用连接池、迁移器与通知监听用的是同一套 TLS 设置。

**`/api` 的请求体**:带请求体的 `/api` 请求必须声明 `Content-Type`,缺了就在路由之前答 415 `BAD_REQUEST`,请求体不被读取。
浏览器与 typed client 总会带上;用 curl 或脚本直接调 API 时要显式写 `-H 'content-type: application/json'`。这一条比上游严:
上游 HttpApi 在缺类型时按 JSON 解码,而缺类型的请求体在「解码 payload 的端点」与「流式读取的上传门」之间有两种读法,在路由前分不清,
所以一律拒绝(`@qualy/api-kit/storable-text`)。要读完的请求体上限 2 MiB(上传门按预留大小流式写盘,不受此限)。
声明了 payload 的端点在解码之前,先检查 JSON 请求体里有没有 PostgreSQL 存不下的文字(NUL、落单的代理项);地址里的 `%00`
在路由前检查;两者都答 400 `BAD_REQUEST`。本地上传门(`PUT /api/storage/local/uploads/{reservationId}`)这类契约不声明 payload
的流式端点,请求体从不被这项检查读取,不论 `Content-Type` 写什么。

**CSP 报告与日志量**:`/csp-reports` 是匿名端点,server 对它每分钟最多写 50 行 Warn(同一「指令 + 被拦地址 + 来源文件」一分钟只写一次,
超出预算的只计数),每行最长约 3KB。有人持续灌入时一天约 200MB,正好是 compose 给 server 的日志轮转上限(`json-file`,20m × 10),
约一天前的日志会被挤掉。生产部署应把 server 日志转存到机器之外(Docker 的 `journald` / `syslog` / `fluentd` 等 logging driver,
或主机上的日志采集),并在边缘代理上对 `/csp-reports` 按来源地址限流(nginx 用 `limit_req`,Caddy 需要 rate limit 插件)。

**CAPTCHA provider**(docs/captcha.md):默认 `@qualy/plugin-captcha-altcha`(本地 PoW,不依赖第三方,无需任何配置——签名密钥由
`QUALY_SECRETS_MASTER_KEY` 派生);`@qualy/plugin-captcha-turnstile` 默认停用,只用于 Cloudflare 可服务的地区,启用时要先停用 altcha
(两个 provider 同时启用在装配时被拒),并在 `.env` 填 `QUALY_CAPTCHA_TURNSTILE_SITE_KEY` / `QUALY_CAPTCHA_TURNSTILE_SECRET_KEY`(缺失即拒绝启动)。
启用 Turnstile 会让 shell 的 CSP 在 `script-src` 与 `frame-src` 加入 `https://challenges.cloudflare.com`;浏览器端加载 Cloudflare 失败时只能重试,不会放行。

### 3.1 升级(2026-09-28 起双色零空窗)

装入新 release 的三个镜像 → `deploy/upgrade.sh <release>`。首次部署先 `docker compose run --rm migrate` 与 seed,再跑同一条命令。

`upgrade.sh` 的顺序,每一步失败时服务中的那一色照旧服务:

1. 镜像在本机;内存与磁盘够两色同时跑(`QUALY_UPGRADE_MIN_MEMORY_MB` 默认 600、`QUALY_UPGRADE_MIN_DISK_MB` 默认 2048,Linux 上实测,
   量不到的主机明说);
2. 待应用迁移里有不是 `-- rollout: expand` 的(按库里的 `mikro_orm_migrations` 与新镜像的 `db/migrations` 比对,没写这一行的
   按 maintenance 算)即拒绝,除非 `--maintenance`;首次部署没有服务中的一色,不做这项检查;
3. 设了 `QUALY_BACKUP_ROOT` 就先备份(§3.3);
4. 以新 release 跑 deploy job(迁移 + 把 web release 设为 store 的 current);
5. 空闲色以新 release 起来,等 `/health/ready`(`QUALY_READY_TIMEOUT` 默认 180s),先请求一次 shell 与 manifest 预热;
6. 改写边缘代理导入的片段(`QUALY_PROXY_UPSTREAM`,默认 `/etc/caddy/qualy/upstream.caddy`)指向新色端口,`caddy validate` 通过才
   `systemctl reload caddy`;校验或重载失败则片段还原、新色停下;
7. 经公网地址问 `/__qualy/release`,答的必须是新色自己报的那个 release id,否则代理指回旧色、新色停下;
8. `.env` 记下新的 `QUALY_ACTIVE_COLOR` 与 `QUALY_RELEASE`,旧色排空 `QUALY_DRAIN_SECONDS`(默认 20s)后 `stop -t 40`,停在旧 release 上留给回滚。

第 5 步之后的失败都会再以旧 release 跑一次 deploy job,把 web store 的 current 指回旧 release(旧色万一重启要找得到自己的),
并把 `.env` 里新色的 release 还原,之后的回滚不会指向一个从没服务过的 release。

**切换期间谁看见什么**:代理重载后新请求进新色;重载前已在旧色上的请求在排空时间内做完;旧色停下时它的实时通道(批次 SSE)断开,
浏览器里的 `useApiStream` 自己重拨(连接活过 15s 的 3s 后重拨,不是 EventSource,SSE 的 `retry:` 字段无人读取,所以不加),
新色先发 `sync`,页面据此刷新数据,不整页重载。开着的旧 tab 照常从 `web_releases` 取自己的 chunk(见下)。

**迁移纪律**(同一时刻两个 release 对着一个库):新 release 必须能在旧 release 留下的 schema 上跑,旧 release 也必须能在新 schema 上跑,
所以迁移先 expand(加表、加列、加索引、backfill),旧 release 不再用的东西晚一个 release 再 contract。

每条迁移自己声明属于哪一种(2026-09-28):`-- rollout: expand` 表示上一个 release 在它留下的 schema 上照常工作,
`-- rollout: maintenance` 表示不行。这与「会不会丢数据」(`-- destructive: approved`,drop guard 管)是两个问题:`SET NOT NULL`、
改列类型、改名、新加约束不丢数据,却让上一个 release 写不进或读不到;而旧 release 早已不读的列晚一个 release 再删,谁也不影响。
`pnpm qualy generate` 按 SQL 猜一个写进文件(`packages/plugins/infra/database/src/assembly/rollout.ts`:只有新表、对新表的一切、
普通索引、可空或带默认值的新列、注释等才猜 expand,其余一律 maintenance),review 时人可以改;`database custom` 建的空白迁移写
maintenance。CI 的 `check-migrations-immutable.ts` 拒绝 base..HEAD 之间新增而没写这一行的迁移。这条规则之前提交的迁移都没有这一行,
不回填:它们在首次部署时一起应用,那时还没有服务中的一色。

不是 expand 的迁移,`upgrade.sh` 拒走零空窗,要 `--maintenance`:代理先指向维护页(片段写 `error "maintenance" 503`,站点的
`handle_errors` 服务 `deploy/demo/maintenance.html`),服务中的那一色停下,job 跑完、新色就绪后代理再指过去。正常走 expand 再 contract,
这个开关应该很少被用到。

**一次只跑一个部署步骤,且先核对谁在服务**:`upgrade.sh`、`rollback.sh`、`restore.sh` 与演示重置开始时都在 `.env` 旁取同一把锁
(Linux 用 `flock`,没有它的机器用 `mkdir`),第二个步骤直接拒绝并说明;嵌套调用的子步骤继承同一把锁。`.env` 只是记录,事实是边缘代理的
片段:每个步骤先从片段读出服务中的是哪一色(`QUALY_PROXY=none` 时看哪一色的 server 在跑),与 `.env` 的 `QUALY_ACTIVE_COLOR` 比对。
答案唯一(片段指向的那一色的 server 正在跑)而记录不同——上一次步骤在改完片段、还没写 `.env` 时被中断——就把那一色与它正在跑的
release 写回 `.env`,并打出一行 `RECONCILED: …`;片段指向的那一色没在跑、片段停在维护页而 `.env` 记着一色、或两色都在跑而没有片段
可看,都拒绝并说明,由人判断。恢复(`restore.sh` 与演示重置)例外:它们本来就在服务停着时运行,或是重跑一次停在半路的恢复,
所以没有边缘且什么都没在跑、或边缘指着的正是 `.env` 记的那一色而它停着时,照记录继续,恢复完把那一色起来。`.env` 的每次写入都是同目录临时文件整份替换(保留权限与属主),多个键一次写完,不会留下半个文件。

**仍有停机的两种情形**:PostgreSQL 镜像升级(两色共用一个库),宿主机重启。

不做的仍然不做:这是两份 shell 脚本加一个 compose 文件,不是发布框架;没有多副本协调、没有编排器、没有自动回滚。

**入口密钥的主密钥**:`QUALY_SECRETS_MASTER_KEY`(32 字节 base64)是 `.env` 里的必填项,登录入口的 client secret 之类都用它加密。
生产进程缺它或格式不对直接拒启;换了这把 key,已存的密文就读不回来(不会自动重加密),所以它要和数据库备份一起保管。
读不回来的密钥不会让服务拒启(2026-09-25 裁决 #29):对应入口视为未就绪、不出现在登录页,管理端提示「密钥无法解密,需要重新填写」,
原密文保留不清除;启动时逐个入口记 Warn,全部或多个同时读不出时再记一条 Error,提示主密钥可能与写入时不同——换回原 key 即恢复。

**公开地址**:`QUALY_PUBLIC_URL`(纯 origin,生产必须 https)是邮件里链接的地址,也是「会把人送走再送回来」的登录入口的回调地址。
**生产必填**(2026-09-25 裁决 #15):缺它或为空,生产进程在配置阶段就拒绝启动并点名这个变量——找回密码、验证邮箱、更换邮箱的链接
与第三方登录的回跳都靠它,只用邮箱密码登录的部署也不例外。开发态不设时缺省 `http://localhost:5173`。

**登录入口能连到哪里**:服务端替登录入口发出的请求(CAS 票据校验、OIDC 发现与换 token)只许连公网地址;学校的 CAS 在内网时,
在 `QUALY_AUTH_PRIVATE_PROVIDER_ALLOWLIST` 里写它的主机名或网段(逗号分隔,缺省为空)。本机地址、link-local、云厂商 metadata
地址无论是否写进去都连不到;格式不对的条目直接拒启。这份名单归部署,租户管理员改不了它。

**演示账号**:`QUALY_DEMO_ACCOUNTS`(JSON 数组,每项 `email`、`password`、`label`)只给公开演示部署用。登录页会列出这些账号,
点一下即填好邮箱与密码;同时冻结它们的登录信息:本人与管理员都不能改密码、改邮箱、增删登录方式,找回密码对它们静默不发信
(对外回答与其他地址一致)。格式不对即拒启;不设则两种行为都不存在。

**邮件**:qualy.yml 同时启用 `@qualy/plugin-mail-resend` 与 `@qualy/plugin-mail-smtp`,产品默认 `defaultBackend: resend`,
部署以 `QUALY_MAIL_DEFAULT_BACKEND` 改选(开发环境设 `smtp`,发到本机 Mailpit)。**只有被选中发信的后端要求自己的配置齐全**,
另一个缺配置也照常启动、从不被用来发信(规则在 `@qualy/plugin-mail/server` 的 `offerBackend`)。
生产必填 `QUALY_MAIL_FROM`(发件人,`Name <address>` 或裸地址,经 Resend 时域名须已验证);经 Resend 发信时 `QUALY_MAIL_RESEND_API_KEY`
缺失或空白即拒启。改用 SMTP 中继设 `QUALY_MAIL_DEFAULT_BACKEND=smtp` 与下面的中继变量,不需要换 release:
`QUALY_MAIL_SMTP_HOST`(中继)在经 smtp 发信时生产必填。
`QUALY_MAIL_SMTP_TLS` 三态:`implicit`(465,一开始就是 TLS)、`starttls`(587,缺省,升级失败即不发)、`none`(明文,生产必须另设
`QUALY_MAIL_SMTP_ALLOW_PLAINTEXT=1` 才接受);端口随之缺省,可用 `QUALY_MAIL_SMTP_PORT` 覆盖;账号与密码(`QUALY_MAIL_SMTP_USER` /
`QUALY_MAIL_SMTP_PASSWORD`)要么都给要么都不给。这些是部署的,不进 qualy.yml,也不进租户的密钥表——单一产品只有一个中继。
Resend 答 400/422 算这封信被拒,429/409/5xx/超时算暂不可用;401/403 等是 key 或发信域配置错,同样算不可用并记 error 日志。
启动时不连中继:中继宕着不影响启动,第一封信会失败并记日志与指标 `qualy.mail.sent{outcome}`。

**恢复账号与 seed**:租户与其系统账户(租户自救用、以邮箱 + 密码登录)由 seed 供给;镜像不含 seed,从同一 release 的源码检出对部署库执行
`DATABASE_URL=… QUALY_ADMIN_EMAIL=… QUALY_ADMIN_PASSWORD=… node tools/fixtures/seed-cli.ts`(不用 `pnpm seed`:它读检出目录的 `.env`,
开发机上那是开发机的设置;`seed-cli.ts` 自己不读任何文件,2026-09-28)。生产 server 在 Assembled 屏障检查每个存活租户的恢复通道,
系统账户缺邮箱或缺密码即拒启并点名租户——顺序固定为 migrate → seed → boot。把本地入口改为邮箱登录的那次升级(迁移
`20260922164042_user-auth-bindings.sql`)必须走这一步:迁移后旧系统账户没有邮箱,seed 以 `QUALY_ADMIN_EMAIL` 补上(已有不同邮箱视为漂移报错)。
该迁移遇到「同一租户第二个仍在使用的密码入口」会直接失败并点名租户与入口 code,需人工清理后重跑,不做合并。
**Web release 与开着的旧 tab**(2026-09-27 纠正 2026-09-17 的裁决):server 与 web release 仍是同一 deployment unit——镜像里带着
构建它时的那个 release,不存在「只更新 server、复用旧 web」的部署。变的是 release 住在哪:09-17 定为「store 随镜像、只装当前 release」,
当时只考虑了进程(一个进程一套 api 与一个 shell),没考虑还开着的浏览器——换镜像后旧 tab 的下一次请求带着旧 release id,新进程在自己的
store 里查不到,答 409 `release`,整屏接管,未保存的输入丢失且绕过离开提示;不需要用户操作就会触发(轮询与实时通道的重连都算请求)。
现在部署把 release 放在比镜像活得久的 `web_releases` 卷里:`migrate` 把镜像带的 release 装进去(已有则只移指针,幂等),
按保留策略留下之前的(最近 `QUALY_WEB_RELEASE_RETAIN_COUNT`(默认 5)个 ∪ 最近 `QUALY_WEB_RELEASE_RETAIN_HOURS`(默认 72)小时,
current 永不删);server 从卷里服务,旧 tab 照样取到自己的 chunk,插件选择与 surface 不变时它的请求照常被接受,只在右下角看到
「有新版本」的提示,刷新由读者决定。插件启停或 surface 变化的 release 仍对旧 tab 答 409 `assembly`,那是正确的——旧 tab 的屏幕
可能已经没有对应的 api。**server 启动时核对卷的 current 就是本镜像的 release**,不是(或卷是空的)就拒启并提示先跑 `migrate`,
与「库落后于镜像就拒启」对称;启动本身不装、不修。没设 `QUALY_WEB_RELEASE_STORE` 时(开发机、`pnpm start`、裸跑镜像)
server 照旧服务镜像或 checkout 自带的 store,deploy 这一步什么都不做。

### 3.2 镜像回滚 ≠ schema 回滚

`deploy/rollback.sh` 回到空闲色上次跑的 release,切换方式与升级相同(不停服)。它回滚的是**代码**。回滚也要跑 `migrate`
(脚本代跑):旧镜像的
deploy 对领先于自己的库无事可做(上游 migrator 只挑「文件在、账本里没有」的迁移,账本里多出来的名字不理会,
`repos/mikro-orm/packages/core/src/utils/AbstractMigrator.ts` 的 `filterUp`),但会把旧 release 重新设为 `web_releases` 的
current,旧镜像的 server 要这一步才肯启动;旧 release 已被保留策略收走时从旧镜像重新装一份。回滚到本机制之前构建的 release 时,
那个 server 不认识 `QUALY_WEB_RELEASE_STORE`,照旧服务镜像自带的 store。已应用的迁移留在库里,旧代码面对的是新 schema。

- 迁移只做加法(加表、加列、加索引、backfill 写新列)时,旧代码看不见新列,回滚安全。这正是「先 expand、等一个 release 再 contract」
  的理由:一条 contract(删列、改类型、收紧约束)必须等到依赖它的 release 已经稳定、不会再被回滚之后才提交。
- 迁移不是 expand(`-- rollout: maintenance`,或没写这一行;删列、改类型、收紧约束都在此列)时,旧代码可能直接报错,
  这时「回滚」只有两条路:fix-forward 一个新 release,或从升级前的备份恢复并接受这段时间的写入丢失。
- 因此升级前先备份(`deploy/README.md`「Backup and restore」),这不是可选项。
- `rollback.sh` 先比对:库里已应用、旧 release 的 lineage 里没有的迁移,在当前镜像里不是 `-- rollout: expand` 的,或当前镜像也不认识的,
  一律拒绝回滚,除非 `--force`(运维确认旧 release 能在这个 schema 上跑)。

这也是启动校验的另一半:server 对着**落后于自己**的库拒绝启动(`database is N migration(s) behind ... run the migration job`),
对着**领先于自己**的库(回滚后的镜像)不拒绝——ledger 里多出来的迁移它不认识也不需要认识,能否运行取决于上面的加法规则。

### 3.3 备份与恢复(2026-09-27,外部审计 P3-2)

之前只有 README 里一条手动 `pg_dump`(写到执行者当前目录、没有定时、没有保留、没有异机),附件只有备份命令没有恢复步骤,
数据库恢复先 `dropdb` 再导入、不带 `--exit-on-error`,演练只覆盖数据库。现在:

- `deploy/backup.sh <root>`:`umask 077`;`pg_dump -Fc` 后以 `pg_restore --list` 验证;再 tar `storage` 卷(经 `tools`,用 server 镜像,不另拉镜像)
  并 `gzip -t`;然后经 `tools` 跑 `qualy storage export --except local`(2026-09-28):local 以外每个后端(COS)里的每个附件,经写它的后端、按库里记的
  `storage_version` 取回,核对大小(指纹是 sha256 时也核对),连同 `attachments.tsv`(附件 id、租户、后端、key、版本、大小、指纹)打成
  `attachments.tar.gz`,任何一个取不回或对不上整次失败——开了版本控制的桶,「拷一份桶」拿到的是每个 key 的最新写入,不一定是附件读的那个版本;
  写 `SHA256SUMS`;整个目录写完才改名就位(以时间戳命名的目录一定是完整备份);保留最近 `QUALY_BACKUP_KEEP`(默认 14)份;
  `QUALY_BACKUP_OFFSITE` 设了就以新目录为 `$1` 执行(rclone / scp / coscli 由运维选),失败则整次失败;异机副本写进另建的备份桶,
  用一个只能写的独立账号(`PutObject`,以及大文件分块上传要的 `InitiateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload`,
  没有读与删),例如 `QUALY_BACKUP_OFFSITE=coscli -c /etc/qualy/coscli.yaml cp -r "$1" cos://<备份桶>/qualy/`(`cp -r` 把目录本身放进目标下,
  目标只写到 `qualy/`;再拼一层目录名会得到 `qualy/<stamp>/<stamp>/`,2026-09-28 实测);成功后写 `<root>/last-success`,
  供监控按时间判断备份是否停了。主密钥不进备份,与备份分开保管。
- `deploy/restore.sh <dir>`:先核对 `SHA256SUMS`;导入临时库(`--exit-on-error`,全有或全无,期间照常服务)→ 停服务中的那一色 → 换名(旧库留作
  `_previous`)→ 附件解包到 `.incoming` 再换入、`chown 1000:1000` → `migrate`(旧版本备份追平到当前,并装入当前 web release)→ 该色启动并等待。
  桶里的附件不放回:恢复出来的行指向的版本仍在桶里(对账只删没有附件读的版本),只有备份之后被清扫的未保存附件不在了;
  `attachments.tar.gz` 留给桶本身丢失的那一天,届时逐个重新上传、按新版本改写 `storage_version`,是人工步骤。
  停服之前失败则实例原样;之后失败则点名步骤,重跑即补完。流程与演示部署的 `deploy/demo/restore.sh` 同一做法。
- 两个脚本经 `COMPOSE_PROJECT_NAME`、`QUALY_ENV_FILE` 指向具体部署;`release-smoke.ts` 每次 CI 都调用它们演练:备份前写一行数据与一个附件,
  销库、清空附件,恢复后两样都读回。
- `pg_backups` 卷删除:只挂载、从没有东西写它。README 的升级步骤第一步改为 `backup.sh`。

## 4. 发布验证

| #   | 要求                                                                           | 由谁证明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 空 PostgreSQL 重放 committed lineage 到当前                                    | `qualy database verify`(CI 每次)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2   | 结果与 Assembly Schema Graph(全部 `Db.entities` + 复合外键 + baseline)零 drift | 同上:scratch A 重放、scratch B 按声明建、逐语句比对                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | 跨插件 / 复合外键正确                                                          | 同上(结构 diff 含约束);各插件 `schema-parity` 测试逐对象比对                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | 有代表性的历史 release 数据库能升级到当前                                      | `packages/plugins/infra/database/tests/lineage-upgrade.test.ts`:按 `tests/fixtures/lineage-deployment-b.json`(Deployment B 提交 `05714cf2` 实际携带的 59 个迁移名与 SHA-256)先断言这些文件逐字节仍在,再用它们建旧库、用完整 lineage 追平,与一次建成的库逐对象相同;fixture 本身在克隆里有该 commit 时对 `git ls-tree` / `git show` 逐个核对,记录不能悄悄漂离它声称的提交。各插件的 migration-upgrade 测试用 `lineageBefore(target)` 取目标迁移之前的**真实历史前缀**建旧库,不再用「当前实体减一步」的近似 |
| 5   | 已发布迁移不得悄悄修改                                                         | `tools/quality/check-migrations-immutable.ts <base>`:base..HEAD 之间 `db/migrations` 只在末尾生长——不改、不删、不改名、不回填早于 head 的时间戳(§2.3;CI 对 PR base / push 前 commit 跑)                                                                                                                                                                                                                                                                                                                  |
| 6   | 破坏性迁移需要显式批准                                                         | `qualy database drop-guard`(CI 每次);generate 期自动 guard                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7   | 迁移执行 single-writer                                                         | migrator 的 `pg_advisory_lock` + `lock_timeout`;`migrator.test.ts` 三条                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | 迁移失败不记为成功                                                             | 整文件一个事务,失败不入 ledger;`migrator.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 9   | 最终 server 镜像无仓库源码 / 开发工具链也能启动                                | `check-release-image.ts`(镜像内 resolve、无库启动停在数据库)+ `release-smoke.ts`(对真库启动到 ready)                                                                                                                                                                                                                                                                                                                                                                                                     |
| 10  | Web production build 能加载                                                    | `smoke-production.ts`(CI)+ `release-smoke.ts`(镜像内 shell、manifest、一个哈希资源)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 11  | Sandbox RPC / ABI 冒烟                                                         | `qualy sandbox status`:从 server 容器内对两条 socket 取 capabilities,核对 rpc / abi 版本;`release-smoke.ts` 在 compose 栈上执行它                                                                                                                                                                                                                                                                                                                                                                        |
| 12  | 备份 → 恢复 → 启动                                                             | `release-smoke.ts`:`deploy/backup.sh`(数据库 + 附件 + 按版本导出的附件清单)→ 销库、清空附件 → `deploy/restore.sh`(临时库导入、换名、附件换入、`migrate`、启动)→ 备份前写入的一行数据与一个附件都读回(§3.3)                                                                                                                                                                                                                                                                                               |
| 15  | 双色升级与回滚不停服,两种拒绝在动手之前                                        | `release-smoke.ts`:`upgrade.sh` 起第一色 → 藏起一条不是 expand 的迁移的账本行,升级被拒、原色照常服务 → 升级到另一色、原色停下且保留旧 release → `.env` 改回记着原色,回滚先按实际服务的颜色记回(`RECONCILED`),再因账本里一条旧 release 不认识的迁移被拒 → 回滚到原色、另一色停下(§3.1、§3.2);有 Caddy 边缘时的切换与失败还原由 `tools/tests/deploy-scripts.test.ts` 以假 `docker`/`curl` 驱动真 `lib.sh` 覆盖                                                                                             |
| 13  | 文档:镜像回滚 ≠ schema 回滚                                                    | 本文 §3.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 14  | 发版后开着的旧 tab 仍取得到自己的 chunk,启动不越过部署                         | `release-store.test.ts`「promoting」(下一个镜像进来后上一个 release 与资源仍在、同镜像重跑幂等、回滚把旧 release 设回 current)+ `web-release-deploy.test.ts`(deploy 步骤)+ `effect-web.test.ts`(卷里 current 不是本镜像的 release 或卷为空即拒启、从卷服务并认得之前的 release)+ `release-smoke.ts`(见下)                                                                                                                                                                                                |

`tools/quality/release-smoke.ts <release>` 在一个一次性的 compose project 上驾驭 `deploy/compose.yaml` 与 `deploy/` 下的脚本
(`QUALY_PROXY=none`,没有边缘代理,脚本直接问各色端口):
postgres 起 → **未迁移就启动 server 必须被拒**(项 9 的另一半)→ `migrate`(迁移 + 把 web release 装进 `web_releases`)→
未 seed 就启动必须被拒(点名 `QUALY_DEFAULT_TENANT`)→ 经 `compose.seed.yaml` 从本检出执行 seed → `upgrade.sh` 起第一色 →
`/health/ready` → `/__qualy/release` 就是 `migrate` 装的那个 → shell / manifest / 哈希资源 →
**指向没装过本 release 的 store 启动必须被拒**(项 14)→ `qualy sandbox status` → 第二次 `migrate` 报 up to date 且 release 已装 →
`auth set-password` 从环境变量给系统账户设密码 → 项 15 的升级与回滚(同一组镜像另打一个 `-next` 标签当第二个 release)→
`backup.sh` 备份、销库并清空附件、`restore.sh` 恢复到 ready 且数据与附件读回 → `down -v`,删掉 `-next` 标签。
CI 的 `image` job 构建三个镜像后跑它。

## 5. 明确不做

发布框架、Kubernetes operator、多副本协调器、通用发布平台、任意插件 sidecar、客户自定义镜像、自动回滚。
单机 compose、一次性迁移 job、两色切换的两份脚本、明确的备份与回滚规则,就是 Qualy 现在需要的全部;再多一层都要等真实需求来触发。
(2026-09-28 修订:原先这里写「零停机发布框架」不做;用户裁决要零空窗切换,做法是两色加两份脚本,仍然不是框架。)

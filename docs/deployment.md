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
   预建 `/var/lib/qualy/storage` 与两个 socket 目录(归 node,命名卷首次挂载继承所有权)。

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

只有 database 能力有 deploy 副作用,而它的 migration ledger 本身就是实例的 applied state,所以没有第二份「已部署」记录(P4.5 删除了
deployed lock)。这个前提由 `tools/tests/deploy-capabilities.test.ts` 钉住:枚举仓库全部插件的能力 provider,实现 `deploy` 的只能是
database。出现第二种有持久部署副作用的能力时,先设计启动如何验证它执行过,再改这张表。

## 3. 部署(`deploy/`)

`deploy/compose.yaml` + 从 `deploy/.env.example` 填出的 `.env`,就是部署单元。只有 `image:`,不 build、不 bind 源码、不挂宿主 node_modules。

服务:

- `postgres`(pgvector pg18):命名卷 `pg_data`、`pg_backups`;不发布端口,只在 compose 网络内可达。
- `migrate`(profile `deploy`):server 镜像跑 `deploy`,`docker compose run --rm migrate` 按需运行;migrator 持数据库级 advisory lock,
  第二个 writer 排队后发现无事可做;失败的迁移不进 ledger,job 非零退出,旧 server 继续跑。
- `server`:`env_file: .env`,容器内路径由 compose 覆盖(`PORT`、存储根、两条 socket 路径、`QUALY_VERSION=<release>`);
  只发布到 `127.0.0.1:3000`(边缘代理见 `ops/reverse-proxy/`);`read_only` 根 + tmpfs `/tmp`;卷:`storage`(附件)、
  `sandbox_runtime`、`sandbox_authoring`(**只读挂载**:server 只 connect;Linux 对只读挂载的 EROFS 写检查不覆盖 unix socket,实测 `:ro` 客户端照常连通、写文件报 EROFS;创建与删除 socket 归沙箱自己的读写挂载)。
- `sandbox-runtime` / `sandbox-authoring`:按 `docs/sandbox-process-isolation.md`:`network_mode: none`、只读根、`cap_drop: ALL`、
  非 root、pids / mem / cpu 限额、各自一个卷;**不给 `.env`**——沙箱环境只有自己的 socket 路径与限额,没有业务 secret。
  两个卷分开,runtime 看不到 authoring 的 socket,反之亦然。没有 TCP fallback:socket 不可达时公式发布 / 计分失败,不退回主进程。

没有 Redis:源码里没有任何使用,不为「将来也许」加一个空转的服务。

**CAPTCHA provider**(docs/captcha.md):默认 `@qualy/plugin-captcha-altcha`(本地 PoW,不依赖第三方,无需任何配置——签名密钥由
`QUALY_SECRETS_MASTER_KEY` 派生);`@qualy/plugin-captcha-turnstile` 默认停用,只用于 Cloudflare 可服务的地区,启用时要先停用 altcha
(两个 provider 同时启用在装配时被拒),并在 `.env` 填 `QUALY_CAPTCHA_TURNSTILE_SITE_KEY` / `QUALY_CAPTCHA_TURNSTILE_SECRET_KEY`(缺失即拒绝启动)。
启用 Turnstile 会让 shell 的 CSP 在 `script-src` 与 `frame-src` 加入 `https://challenges.cloudflare.com`;浏览器端加载 Cloudflare 失败时只能重试,不会放行。

### 3.1 升级

装入新 release 的三个镜像 → 改 `.env` 的 `QUALY_RELEASE` → `docker compose run --rm migrate` →(需要时)`pnpm seed` → `docker compose up -d` → `/health/ready`。

**入口密钥的主密钥**:`QUALY_SECRETS_MASTER_KEY`(32 字节 base64)是 `.env` 里的必填项,登录入口的 client secret 之类都用它加密。
生产进程缺它或格式不对直接拒启;换了这把 key,已存的密文就读不回来(不会自动重加密),所以它要和数据库备份一起保管。

**公开地址**:`QUALY_PUBLIC_URL`(纯 origin,生产必须 https)只在启用了「会把人送走再送回来」的登录入口时才需要;没有它这类入口不能启用,
已启用又缺它的生产进程拒绝启动。只用邮箱密码登录的部署不必设置。

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
`DATABASE_URL=… QUALY_ADMIN_EMAIL=… QUALY_ADMIN_PASSWORD=… pnpm seed`。生产 server 在 Assembled 屏障检查每个存活租户的恢复通道,
系统账户缺邮箱或缺密码即拒启并点名租户——顺序固定为 migrate → seed → boot。把本地入口改为邮箱登录的那次升级(迁移
`20260922164042_user-auth-bindings.sql`)必须走这一步:迁移后旧系统账户没有邮箱,seed 以 `QUALY_ADMIN_EMAIL` 补上(已有不同邮箱视为漂移报错)。
该迁移遇到「同一租户第二个仍在使用的密码入口」会直接失败并点名租户与入口 code,需人工清理后重跑,不做合并。
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
| 12  | 备份 → 恢复 → 启动                                                             | `release-smoke.ts`:`pg_dump -Fc` → dropdb/createdb → `pg_restore` → `migrate`(up to date)→ server 重启到 ready                                                                                                                                                                                                                                                                                                                                                                                           |
| 13  | 文档:镜像回滚 ≠ schema 回滚                                                    | 本文 §3.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`tools/quality/release-smoke.ts <release>` 在一个一次性的 compose project 上驾驭 `deploy/compose.yaml`:
postgres 起 → **未迁移就启动 server 必须被拒**(项 9 的另一半)→ `migrate` → server + 两个 sandbox 起 → `/health/ready` →
shell / manifest / 哈希资源 → `qualy sandbox status` → 第二次 `migrate` 报 up to date → 备份、销库、恢复、`migrate`、重启到 ready → `down -v`。
CI 的 `image` job 构建三个镜像后跑它。

## 5. 明确不做

零停机发布框架、Kubernetes operator、多副本协调器、通用发布平台、任意插件 sidecar、客户自定义镜像。
单机 compose、一次性迁移 job、明确的备份与回滚规则,就是 Qualy 现在需要的全部;再多一层都要等真实需求来触发。

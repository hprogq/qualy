# 展示实例部署

一个按生产方式运行、带三学年历史数据的实例，用来现场演示。账号不公开：登录页就是正常的登录页，演示时由作者本人登录。
它和正式部署用同一套镜像与 `deploy/compose.yaml`，只多两件事：一份演示数据基线，以及把实例复原到基线的脚本。
演示数据的范围和验收见[演示数据说明](../../docs/notes/demo-data.md)，现场顺序见[面试演示指南](../../docs/qualy-demo-guide.md)。本文说明服务器操作；本机基线验收不代表公网实例已经部署上线。

## 1. 生成基线（在开发机上）

先准备独立的空演示库和可用沙箱。重建数据库是明确的准备操作，不把现有模板库或开发库作为试运行目标。私有配置放在 Git 忽略的 `data/demo-private.env`，权限为 `0600`，至少提供：

| 变量                                | 用途                             |
| ----------------------------------- | -------------------------------- |
| `QUALY_DEMO_DATABASE_URL`           | 空的独立演示数据库，不能是开发库 |
| `QUALY_DEMO_STORAGE_ROOT`           | 本次生成独占的附件目录           |
| `QUALY_DEMO_SNAPSHOT_ROOT`          | 本次基线包的输出目录             |
| `QUALY_DEMO_EMAIL_DOMAIN`           | 本次生成的演示账号邮箱域         |
| `QUALY_DEMO_ADMIN_PASSWORD`         | 系统管理员的本地生成密码         |
| `QUALY_DEMO_PERSONA_PASSWORD`       | 四个人物账号的本地生成密码       |
| `QUALY_DEMO_STUDENT_BUSINESS_NO`    | 学生主角私下提供的 CAS 学号      |
| `QUALY_DEMO_CLASS_LEAD_BUSINESS_NO` | 班级负责人私下提供的 CAS 学号    |

密码均至少 15 位。具体连接串、密码与真实学号不写入命令文本、仓库或本文。在仓库目录执行：

```sh
mise exec -- node --env-file-if-exists=.env --env-file=data/demo-private.env tools/demo/seed.ts
mise exec -- node --env-file-if-exists=.env --env-file=data/demo-private.env tools/demo/check.ts
mise exec -- node --env-file-if-exists=.env --env-file=data/demo-private.env tools/demo/snapshot.ts
```

生成默认包含软件学院前五个归档学期、进行中的第六学期及推免，以及英语学院的一归档一进行中批次。通过数据库检查、附件检查与五账号浏览器走查后，才把同次产出的 `qualy-demo.dump` 和 `storage.tar.gz` 交付服务器。具体耗时与文件大小以本次运行结果为准。

- 生成使用了 `--stage` 或 `--migration-state` 时，检查传入相同参数。缩短历史的 `QUALY_DEMO_TERMS` 只用于开发定位，不是六学期演示基线。
- `demo:snapshot` 拒绝混入会话、限流桶、待确认邮件、已用验证码挑战或本机密钥加密数据。`--clear-runtime` 会删除运行态数据，仅在确认目标可清理时使用。
- 快照只支持本机 `localhost:5434` 或 `127.0.0.1:5434` 对应的 `qualy-postgres-demo` 实例，连接地址不能带查询参数。检查与容器导出必须指向同一数据库；数据库名限 1 至 63 个字母、数字或下划线，首字符不能是数字。
- dump 包含两项私有学号和本地生成的密码散列，是私有产物。快照目录权限为 `0700`，两个产物为 `0600`，覆盖旧产物也会收紧权限。`restore.sh` 导入后，用服务器配置的五个密码替换本地密码；真实标识不会因此消失。
- 进行中的推免按生成时点布置近期工作，后续阶段不设置过期即自动推进的日期。演示前仍需核对时间语境及当前阶段，不把一份快照永久视为新鲜数据。
- 本地演练使用 `tools/demo/preview.ts` 从基线恢复 `qualy_demo_preview`，不直接在模板库中登录操作。加载同一私有环境文件后，预览读取同一 `QUALY_DEMO_SNAPSHOT_ROOT`；`--keep` 继续上次预览，省略则恢复副本。演练结果不覆盖回模板库或已验收的基线包。

## 2. 服务器配置

`deploy/.env` 按 `deploy/.env.example` 填写，与正式部署相同，另外注意：

- `QUALY_TRUSTED_PROXIES`：保持示例里的 `172.30.53.1`（compose 网络的网关，Caddy 连到发布端口时容器看到的就是它）。
  留空会让所有访客在登录限流里共用一个地址，一个人就能让全站登录不了。
- 附件：基线里的附件记在 local 后端上，随基线解进 `storage` 卷，经 local 读回；新上传的去 `QUALY_STORAGE_DEFAULT_BACKEND`
  指的后端（生产形态是 `cos`，同时给齐 COS 的四个变量）。复原只回到基线里的那些。
- `QUALY_CSP_MODE=enforce`（模板里已是）：上线前打开登录页、批次列表、审核工作台、公式编辑器、题目设置各一次，
  浏览器控制台里没有 CSP 报错再保留；有报错就先退回 `report` 并记下是哪一页。
- `QUALY_BASELINE_PASSWORD_ADMIN`、`_STUDENT`、`_CLASS_LEAD`、`_COUNSELLOR`、`_LEAD`：五个账号在这台服务器上的密码，
  每个至少 15 位、不含本人的名字或邮箱。缺任何一个，导入在停服之前就拒绝。
- `QUALY_PUBLIC_URL`：站点的 https 地址。找回密码、验证邮箱与第三方登录都用它拼回跳地址。
- `QUALY_DEMO_EMAIL_DOMAIN`：基线中已有的账号邮箱域，必须与生成基线时一致。它与网站地址及 `QUALY_MAIL_FROM` 分别配置；恢复不会修改账号邮箱。脚本在临时库导入完成后、停服前核对五个账号，配置与基线不匹配时拒绝继续。
- 不设 `QUALY_DEMO_ACCOUNTS`。它会把演示账号连同密码列在登录页上并冻结其凭据；本展示实例需要正常私有登录及可操作的账号流程。
- GitHub、OIDC、CAS 的提供方、密钥、回调与身份绑定由部署后配置，seed 不创建。CAS 分别通过两项私有学号匹配学生和班级负责人。新增入口必须设置用户类型受众，不接纳普通背景学生。
- 演示收件域由 `QUALY_DEMO_EMAIL_DOMAIN` 指定，邮件提供方、发件身份、回跳地址和实际收件仍需独立验证。完整恢复会丢失基线生成后新增的外部提供方、密钥、身份绑定和邮箱验证状态。恢复后必须重新配置外部入口并设置受众，重新绑定身份、完成实际邮箱验证，再逐项验证登录与收件；不要伪造验证成功或自动发送演示邮件。

Caddy 用 `ops/reverse-proxy/Caddyfile` 那一份：站点导入 `/etc/caddy/qualy/upstream.caddy`，由脚本改写指向服务中的那一色，
502/503/504 时服务本目录的 `maintenance.html`。证书签发与 DNS 服务商配置见[反向代理说明](../../ops/reverse-proxy/README.md)。首次导入前先放一个指向维护页的片段，站点才加载得起来：

```sh
sudo mkdir -p /etc/caddy/qualy
echo 'error "maintenance" 503' | sudo tee /etc/caddy/qualy/upstream.caddy
```

## 3. 首次导入

```sh
docker compose -f deploy/compose.yaml up -d postgres
deploy/demo/restore.sh /opt/qualy/demo-baseline      # 导入基线、跑迁移、换五个账号的密码、以 blue 启动并把代理指过去
curl -sf http://127.0.0.1:3001/health/ready
```

`.env` 里先填好 `QUALY_RELEASE`（要跑的 release）。之后的升级与回滚用 `deploy/upgrade.sh` / `deploy/rollback.sh`（`deploy/README.md`）。

导入后经公网地址登录一次，到「我的 → 账号安全」的登录记录里看来源地址：应当是你自己的公网地址。
看到 `172.30.53.1` 说明代理没被信任，回头检查 `QUALY_TRUSTED_PROXIES`。

## 4. 复原

演示时改过的数据，随时用同一条命令复原，期间访客看到维护页：

```sh
deploy/demo/restore.sh /opt/qualy/demo-baseline
```

- 先把 dump 还原进一个临时库，这一步站点照常服务；成功后才停下服务中的那一色、换库、换附件、跑迁移、换五个账号的密码、
  再启动这一色，并等服务就绪。
- 被换下来的库留作 `<库名>_previous`，到下一次复原时才删除，出了问题可以手工换回。
- 中途失败会说明停在哪一步，站点停在维护页；再运行一次即可接着完成。两次复原不能同时进行。
- 需要定时复原时（例如每周一次），日志写到当前用户能写的位置：

```cron
0 4 * * 1 /opt/qualy/deploy/demo/restore.sh /opt/qualy/demo-baseline >> $HOME/qualy-demo-restore.log 2>&1
```

## 5. 演示身份

四个人物账号在服务器上各用对应的 `QUALY_BASELINE_PASSWORD_*`。系统管理员使用 `QUALY_BASELINE_PASSWORD_ADMIN`，同样不公开。完整点击顺序、预期状态和备用案例见[面试演示指南](../../docs/qualy-demo-guide.md)。

以下邮箱中的 `<邮箱域>` 指 `QUALY_DEMO_EMAIL_DOMAIN`，与站点域名不必相同。既有 dump 保留生成时的邮箱；切换网站入口不要求重建基线或重命名账号。

| 邮箱                  | 主要用途                                                     |
| --------------------- | ------------------------------------------------------------ |
| `student@<邮箱域>`    | 第六学期提交、补件、申诉与成绩；前五学期历史及推免材料       |
| `class-lead@<邮箱域>` | 本班审核、补件、自审回避，以及自己的申报                     |
| `counsellor@<邮箱域>` | 多轮审核、补件回件、复查、行政认定与导入更正                 |
| `lead@<邮箱域>`       | 推免复核、六学期阶段性成绩来源、批次管理及显式授权的重新认定 |
| `admin@<邮箱域>`      | 两院组织、权限与公式共享；通过显式督查任命获得重新认定权     |

其他人物用于填充真实可读的业务历史，不批量创建可登录身份。两名学生主角使用独立的演示学生类型，普通背景学生不在登录入口受众中。教务业务账号没有学工号，也不因此获得系统管理员权限。

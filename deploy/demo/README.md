# 展示实例部署

一个按生产方式运行、带三学年历史数据的实例，用来现场演示。账号不公开：登录页就是正常的登录页，演示时由作者本人登录。
它和正式部署用同一套镜像与 `deploy/compose.yaml`，只多两件事：一份演示数据基线，以及把实例复原到基线的脚本。
演示数据的生成方式见 `tools/demo/`（`pnpm demo:seed`）与 docs/notes/demo-data.md，这里只讲服务器上怎么用。

## 1. 生成基线（在开发机上）

```sh
pnpm demo:reset-db                       # 只重建 demo 容器里的 qualy_demo
QUALY_DEMO_DATABASE_URL=postgres://qualy:qualy@localhost:5434/qualy_demo \
QUALY_DEMO_ADMIN_PASSWORD='<系统管理员密码，至少 15 位>' \
QUALY_DEMO_PERSONA_PASSWORD='<四个演示身份共用的密码，至少 15 位>' \
  pnpm demo:seed                         # 约 50 分钟；--stage=entry|review|appeal，--migration-state=before
QUALY_DEMO_DATABASE_URL=postgres://qualy:qualy@localhost:5434/qualy_demo pnpm demo:snapshot
```

得到 `data/demo-baseline/qualy-demo.dump` 与 `storage.tar.gz`，上传到服务器的 `/opt/qualy/demo-baseline/`。

- 两个密码都只来自环境变量，不进仓库，也不写进任何文档。2026-09-25 之前生成的基线里，四个演示身份的密码是仓库里公开的值，
  不能再用来部署：重新生成，或者导入后立即给这四个账号改密码。
- `demo:snapshot` 拒绝打包带有会话、限流桶、待确认邮件、已用验证码挑战的库（在这份库上登录过就会有），
  确认可以清掉时加 `--clear-runtime`。它同样拒绝带有本机密钥加密数据的库，服务器用自己的 `QUALY_SECRETS_MASTER_KEY` 即可。
- 基线里进行中的推免批次按生成当天定时间（「材料审核」阶段、前几天刚开始），会随时间变旧，建议每月重新生成一次。

## 2. 服务器配置

`deploy/.env` 按 `deploy/.env.example` 填写，与正式部署相同，另外注意：

- `QUALY_TRUSTED_PROXIES`：保持示例里的 `172.30.53.1`（compose 网络的网关，Caddy 连到发布端口时容器看到的就是它）。
  留空会让所有访客在登录限流里共用一个地址，一个人就能让全站登录不了。
- `QUALY_STORAGE_DEFAULT_BACKEND=local`：附件放在 `storage` 卷里，才能随基线一起复原。
- `QUALY_CSP_MODE=enforce`：上线前用 enforce 打开登录页、批次列表、审核工作台、公式编辑器、题目设置各一次，
  浏览器控制台里没有 CSP 报错再保留；有报错就先退回 `report` 并记下是哪一页。
- `QUALY_PUBLIC_URL`：站点的 https 地址。找回密码、验证邮箱与第三方登录都用它拼回跳地址。
- 不设 `QUALY_DEMO_ACCOUNTS`。它会把演示账号连同密码列在登录页上并冻结其凭据，只给将来开放受限演示时用。

Caddy（与 `ops/reverse-proxy/Caddyfile` 相同，另加维护页）：

```caddyfile
demo.example.com {
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-Host {http.request.host}
		flush_interval -1
	}
	handle_errors 502 503 504 {
		root * /opt/qualy/deploy/demo
		rewrite * /maintenance.html
		file_server
	}
}
```

## 3. 首次导入

```sh
docker compose -f deploy/compose.yaml up -d postgres
deploy/demo/restore.sh /opt/qualy/demo-baseline      # 导入基线、跑迁移、启动全部服务
curl -sf http://127.0.0.1:3000/health/ready
```

导入后经公网地址登录一次，到「我的 → 账号安全」的登录记录里看来源地址：应当是你自己的公网地址。
看到 `172.30.53.1` 说明代理没被信任，回头检查 `QUALY_TRUSTED_PROXIES`。

## 4. 复原

演示时改过的数据，随时用同一条命令复原，期间访客看到维护页：

```sh
deploy/demo/restore.sh /opt/qualy/demo-baseline
```

- 先把 dump 还原进一个临时库，这一步站点照常服务；成功后才停服、换库、换附件、跑迁移、启动，并等服务就绪。
- 被换下来的库留作 `<库名>_previous`，到下一次复原时才删除，出了问题可以手工换回。
- 中途失败会说明停在哪一步，站点停在维护页；再运行一次即可接着完成。两次复原不能同时进行。
- 需要定时复原时（例如每周一次），日志写到当前用户能写的位置：

```cron
0 4 * * 1 /opt/qualy/deploy/demo/restore.sh /opt/qualy/demo-baseline >> $HOME/qualy-demo-restore.log 2>&1
```

## 5. 演示身份

四个身份共用生成基线时给的 `QUALY_DEMO_PERSONA_PASSWORD`：

| 账号                                 | 能看到什么                                                    |
| ------------------------------------ | ------------------------------------------------------------- |
| student@demo.qualy.example           | 六个学期的申报、审核与申诉历史；推免批次里正在辅导员处审核的材料 |
| class-lead@demo.qualy.example        | 本班历次审核记录                                              |
| counsellor@demo.qualy.example        | 推免材料审核的待办、补充材料与退回                            |
| assessment-lead@demo.qualy.example   | 批次与阶段管理、题目与计分公式、名单对账、无人可审的告警      |

系统管理员的密码只在生成基线时由环境变量给出，同样不公开。

# 公开演示部署

公开给面试官、访客随意操作的演示站，与正式部署同一套镜像与 `deploy/compose.yaml`，只多三件事：一份演示数据基线、
定时恢复到基线、公开的演示账号。演示数据的生成方式见 `tools/demo/`（`pnpm demo:seed`），这里只讲服务器上怎么用。

## 1. 生成基线（在开发机上）

```sh
pnpm demo:reset-db                       # 只重建 demo 容器里的 qualy_demo
QUALY_DEMO_DATABASE_URL=postgres://qualy:qualy@localhost:5434/qualy_demo \
QUALY_DEMO_ADMIN_PASSWORD='<系统管理员密码，至少 15 位>' \
  pnpm demo:seed                         # 约 50 分钟；--stage=entry|review|appeal，--migration-state=before
QUALY_DEMO_DATABASE_URL=postgres://qualy:qualy@localhost:5434/qualy_demo pnpm demo:snapshot
```

得到 `data/demo-baseline/qualy-demo.dump` 与 `storage.tar.gz`，上传到服务器的 `/opt/qualy/demo-baseline/`。
seeder 结束时会打印一行 `QUALY_DEMO_ACCOUNTS=...`，放进服务器的 `deploy/.env`。

基线里的推免批次按生成当天定时间（「材料审核」阶段、前几天刚开始），所以它会随时间变旧：建议每月重新生成一次基线。
基线不含任何用本机密钥加密的数据（`pnpm demo:snapshot` 会检查并拒绝），服务器用自己的 `QUALY_SECRETS_MASTER_KEY` 即可。

## 2. 服务器配置

`deploy/.env` 在正式部署的基础上：

- `QUALY_DEMO_ACCOUNTS`：上一步打印的那一行。登录页据此列出演示账号，并冻结它们的登录信息。
- `QUALY_STORAGE_DEFAULT_BACKEND=local`：附件放在 `storage` 卷里，才能随基线一起恢复。

Caddy 在后端重启期间显示维护页：

```caddyfile
demo.example.com {
	reverse_proxy 127.0.0.1:3000
	handle_errors 502 503 504 {
		root * /opt/qualy/deploy/demo
		rewrite * /maintenance.html
		file_server
	}
}
```

## 3. 首次导入与定时恢复

```sh
docker compose -f deploy/compose.yaml --profile deploy run --rm migrate   # 先把库迁到镜像的版本
deploy/demo/restore.sh /opt/qualy/demo-baseline                            # 导入基线
```

之后每 6 小时恢复一次（`crontab -e`）：

```cron
0 */6 * * * /opt/qualy/deploy/demo/restore.sh /opt/qualy/demo-baseline >> /var/log/qualy-demo-restore.log 2>&1
```

有人改乱了数据，随时手动执行同一条命令即可，一次大约一分钟，期间访客看到维护页。

## 4. 演示账号

| 账号           | 能看到什么                                               |
| -------------- | -------------------------------------------------------- |
| 学生           | 六个学期的申报、审核与申诉历史；推免批次里正在审核的材料 |
| 班级综测负责人 | 本班历次审核记录                                         |
| 辅导员         | 推免材料审核的待办、补充材料与退回                       |
| 综测负责人     | 批次与阶段管理、题目与计分公式、名单对账、无人可审的告警 |

系统管理员的密码只在生成基线时由环境变量给出，不公开，也不写进仓库。

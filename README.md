# Qualy

插件化综合素质测评系统(毕业设计,开发中)。技术栈:Effect(HttpApi)+ MikroORM/Kysely + PostgreSQL 18 + React/Vite;插件 = 一个默认导出的描述器值(`Plugin.define`),由宿主在启动时装配。

## 开发

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm dev        # development:vite 中间件 + HMR,lock 漂移仅告警,迁移自动应用
```

## 生产

```bash
pnpm build          # 浏览器构建并 stage 到 web 插件(产物携带装配指纹)
pnpm qualy deploy   # 应用数据库迁移(生产 start 默认不迁移,避免多副本争抢)
pnpm start          # production:静态资源 + 指纹校验,frozen lock,拒绝 vite
```

`pnpm start` 经 apps/server/src/run.ts 强制 production 语义;单机想让启动顺带迁移,显式 `QUALY_MIGRATIONS=apply`。

## 日志

默认级别 Info,dev 下访问日志只记 `/api` 且成功请求为 Debug(不刷屏)。默认值写在 `qualy.yml` 的 `application.logging`(不参与装配 hash),环境变量 `QUALY_LOG_LEVEL` / `QUALY_LOG_FORMAT` / `QUALY_ACCESS_LOG` 优先。

## 常用脚本

- `pnpm qualy resolve` 由 qualy.yml 解析出 qualy.lock.json(`--frozen-lockfile` 只校验)
- `pnpm qualy plan` 只读展示这次解析会改变什么
- `pnpm qualy generate` 让每个能力产出本地产物(数据库能力:迁移,自动过 drop-guard)
- `pnpm qualy deploy` 让每个能力把产物应用到它管的外部系统(数据库能力:执行迁移)
- `pnpm qualy list` 列出全部生命周期与插件命令
- `pnpm qualy database <命令>` 数据库专属:`migrate` / `check` / `custom` / `adopt` / `drop-guard` / `where`(别名 `db`)
- `pnpm db:reset` 开发用:连同备份卷一并清空并重建本地库,用于分支切换后的本地库漂移恢复
- `pnpm typecheck` / `pnpm test` / `pnpm test:browser` / `pnpm format`

License: AGPL-3.0-only

# Qualy

插件化综合素质测评系统(毕业设计,开发中)。基于 cordis 插件运行时 + oRPC + Drizzle + PostgreSQL 18。

## 开发

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm dev        # 先应用迁移,再启动宿主
```

常用脚本:

- `pnpm qualy resolve` 由 qualy.yml 解析出 qualy.lock.json 与 loader 条目表
- `pnpm qualy plan` 只读展示这次解析会改变什么
- `pnpm qualy generate` 让每个能力产出本地产物(数据库能力:迁移,自动过 drop-guard)
- `pnpm qualy deploy` 让每个能力把产物应用到它管的外部系统(数据库能力:执行迁移)
- `pnpm qualy database <命令>` 数据库专属:`check` / `custom` / `studio` / `drop-guard` / `where`
- `pnpm db:reset` 开发用:连同备份卷一并清空并重建本地库,用于分支切换后的本地库漂移恢复
- `pnpm typecheck` / `pnpm test` / `pnpm format`

License: AGPL-3.0-only

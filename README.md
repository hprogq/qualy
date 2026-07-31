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

- `pnpm db:generate` 生成迁移(自动过 drop-guard)
- `pnpm db:generate:custom` 手工 SQL 空迁移(trigger/function 等)
- `pnpm db:migrate` 应用迁移
- `pnpm db:reset` 开发用:连同备份卷一并清空并重建本地库,用于分支切换后的本地库漂移恢复
- `pnpm typecheck` / `pnpm test` / `pnpm format`

License: AGPL-3.0-only

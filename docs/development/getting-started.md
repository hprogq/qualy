# 本地开发

## 工具链

版本来源只有两处：Node 由根目录 `mise.toml` 固定，pnpm 由根目录 `package.json#packageManager` 固定。不要在文档里另抄一份版本表。仓库要求 Node 24，使用 pnpm workspace；生产服务直接由 Node 的 TypeScript strip-types 运行 workspace 源码。

## 首次启动

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm dev
```

`pnpm dev` 启动开发监督者。后端由候选进程接力重载，Web 由独立 Vite 进程提供，浏览器通过 Vite 访问并把 `/api` 与 `/health` 反代给当前后端。详细行为见[开发态进程模型](runtime.md)。

`.env` 是本地运行配置；产品组成在 `qualy.yml`，解析结果在 `qualy.lock.json`。不要把凭据写进清单或文档。CLI 从产品根读取 `.env`，已经存在的进程环境优先。

## 常用命令

```bash
pnpm dev                 # 开发监督者
pnpm typecheck           # 全仓 TypeScript 与组件引用门禁
pnpm lint                # 快速 lint
pnpm lint:types          # 类型感知 lint
pnpm test                # Node 测试
pnpm test:browser        # Chromium 浏览器测试
pnpm test:browser:webkit # WebKit 浏览器测试
pnpm build               # 构建并 stage Web release
pnpm qualy list          # 查看生命周期与插件命令
```

完整脚本以根 `package.json` 为准。如何按改动范围选择命令见[验证指南](validation.md)。

## 数据库安全边界

普通开发使用 `docker compose up -d` 创建本地 PostgreSQL。`pnpm dev` 默认可以应用已提交迁移；生产启动默认不应用迁移。修改实体或迁移前必须先读[数据库与迁移](../architecture/database.md)。

`pnpm db:reset` 会删除本地 Compose 数据卷，只有用户明确要求重置开发数据库时才能运行。文档核对、类型检查和普通单元测试都不需要重置数据库。

## 增加插件和修改装配

仓库内新插件使用 `pnpm plugin:add <name>` 创建；装配选择通过 `pnpm qualy plugin ...` 修改。不要让根脚本、`apps/server` 或 `apps/web` 手工枚举可选业务插件。变更 `qualy.yml` 后按 CLI 指示更新并提交 `qualy.lock.json`，不要手改 lock。

## 进一步阅读

- 写 Effect：[Effect 源码政策](../agents/effect-source-policy.md)
- 改综测业务：[领域入口](../domain/README.md)
- 改 UI：[StyleX 指南](stylex.md)与 [ADR 0010](../adr/0010-ui-widget-platform.md)
- 改部署：[生产部署](../deployment.md)
- 维护文档：[文档维护](documentation.md)

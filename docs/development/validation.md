# 验证指南

验证应覆盖改动真实承重的边界。先运行窄检查，结果有理由时再扩大；不要为了纯文档改动重置数据库、构建镜像或跑完整业务套件。

## 通用检查

```bash
pnpm format:check
git diff --check
```

代码改动通常还需要：

```bash
pnpm typecheck
pnpm lint
pnpm lint:types
```

测试脚本和精确参数以根 `package.json`、相关包的测试配置和 CI workflow 为准。

## 按改动类型选择

| 改动              | 最低检查                                       | 需要扩大时                                      |
| ----------------- | ---------------------------------------------- | ----------------------------------------------- |
| 文档和链接        | 修改文件格式检查、链接检查、`git diff --check` | 文档路径被代码或脚本消费时运行对应窄门禁        |
| Effect / API 契约 | `pnpm typecheck`、相关 Node 测试               | API parity、OpenAPI、HTTP 或完整 Node 套件      |
| React / UI / i18n | `pnpm typecheck`、相关 Chromium 用例           | WebKit、构建、CSP 与 public-web 门禁            |
| 数据层            | 相关数据库测试、迁移检查                       | `pnpm qualy database verify` 和升级测试         |
| 构建或 release    | `pnpm build` 与相应质量脚本                    | image/release smoke，由发布流程执行真实外部门禁 |
| 部署脚本          | shell 语法和脚本测试                           | 只在明确授权的隔离或生产流程执行                |

浏览器测试使用真实浏览器；业务断言优先验证可观察状态和稳定数据属性，不把普通文案当作行为契约。覆盖率用于观察，不设通过阈值。

## 记录结果

提交或交接中列出真正执行的命令和结果；未执行的检查注明原因。`STATUS.md` 只维护当前快照，不再追加每次会话的终端输出。长期有价值的测量放进对应 `docs/notes`，同时保留环境、方法、结果和代码依据。

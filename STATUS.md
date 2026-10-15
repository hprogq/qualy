# Qualy 当前状态

更新时间：2026-10-15

本文件只记录当前工作、验证和生产状态。完成过程、终端输出和历史迁移保存在 Git、ADR、`docs/notes` 与 `docs/archive`，不再按会话追加。

## 仓库与产品基线

- 主开发分支：`main`。
- 产品形态：单一代码库、单一产品、单一发布物；仓库根是 composition root。
- 后端：Effect v4 是唯一运行时，API 使用 Effect HttpApi；Cordis 与 oRPC 已退出生产代码。
- 前端：React、Mantine 和 StyleX；Paraglide 只负责消息编译，运行时由 Qualy 管理文档语言。
- 数据：PostgreSQL、MikroORM 实体、Kysely 查询；中央 SQL migration lineage 位于 `db/migrations`。
- 发布：server、runtime sandbox、authoring sandbox 三个不可变镜像；生产采用蓝绿切换。

阅读入口见 [docs/README.md](docs/README.md)，系统结构见[架构概览](docs/architecture/overview.md)，综测规则见[领域入口](docs/domain/README.md)。

## 当前开发状态

- 上线前的 Effect、插件装配、Web release、沙箱、审计、遥测、Mantine/StyleX 和 Paraglide 迁移均已完成并有持续门禁。
- 语言切换在写偏好和 cookie 前确认整页重载；每个已打开文档继续使用自己的 locale，请求不会因其他标签页改 cookie 而变语言。
- API mutation 的平台失败由 runtime 处理；领域失败由调用处处理。多请求写工作流逐请求进入会话恢复边界，已成功的写入不会被整段重放。
- 生产消息编译和 Web 构建只读取 active assembly；全仓消息完整性检查可以显式读取全部已安装包。
- 文档已分为现行架构、领域、开发、证据、ADR 和历史材料；根 `AGENTS.md` 与本文件不再承担实施历史台账。

Formula RPC 心跳误断线和 WebSocket HTTP 计时的修复已随 `v0.1.0-rc.32` 上线
（[实测笔记](docs/notes/formula-rpc-heartbeat.md)）。

`main` 上另有尚未发布的提交：WebSocket 会话 span 在握手时结束、语句级数据库追踪与遥测导出清理
（[笔记](docs/notes/statement-tracing.md)）、收件箱与巡检的规划开销优化
（[笔记](docs/notes/kysely.md)）、原生 tsc 直接启动、模态框下的更新提示层级、
依赖图巡检改用异步 SBOM 接口。

## 最近验证的代码状态

rc.24 源码提交 `7ceb08ca8fe230654790f4dbc26e094b16fbbbc7` 的最终 CI 全部成功：

- static、Node CI、Chromium、WebKit、image、release-eligible 全部通过；
- Node：413 个测试文件通过、3 个跳过；3098 个测试通过、29 个跳过；
- Chromium：125 个测试文件、1605 个测试通过；
- WebKit：5 个测试文件、50 个测试通过；
- 正式 release 的 COS、三个镜像构建与检查、smoke、推送和 sourcemap 任务通过。

CI：https://github.com/hprogq/qualy/actions/runs/36924654216

Release：https://github.com/hprogq/qualy/actions/runs/36926331266

后续提交若修改代码，应按[验证指南](docs/development/validation.md)重新选择检查；这里的结果不能替代新改动的验收。

## 生产状态

- 2026-10-15 部署 `v0.1.0-rc.32`（revision `bb1a21cd13902d7082fd13ea4d2911af224a4195`），服务颜色为 blue。
- 2026-10-15 生产数据库启用 `pg_stat_statements`（含 `track_planning`），扩展装在 `monitoring` schema；
  设置写在数据卷的 `postgresql.auto.conf`，不在 compose 文件里。查看与开关方式见
  `deploy/README.md` 的 Statement statistics（`deploy/query-stats.sh` 随下一个 release 上机）。
- 演示数据为 10-08 基线；旧库保留为 `qualy_previous`。

## 仍需用户确认的业务语义

以下问题没有因文档整理而裁决，现有实现维持保守行为：

- `assessment-design.md` §32.94：人员权限页可见的单位名称范围仍待确认。
- 只有部分账页读取权的工作人员，页面是否以及如何明确提示“当前列表和统计是部分结果”；相关空状态和计数不能假装是完整账页。
- 管理员是否应看到参评人从未提交的草稿，现有代码和测试允许，但领域设计没有单独裁决。
- 只有 `assessment.review.reopen`、没有重新认定权限的工作人员是否应获得“发起复查”入口；演示说明与当前能力边界需要统一。

遇到这些路径时先请用户裁决，不用代码现状反推政策。

## 尚无完成证据的运维事项

这些事项需要外部账号、控制台或宿主机权限，仓库不能自行宣布完成：

- 为异地恢复演练配置只读 COS 身份和 GitHub `recovery-drill` 环境变量；运行一次真实恢复演练。
- 在 TMP 配置备份新鲜度与指标缺失告警，并完成外部可用性和磁盘告警。
- 复核生产 COS 身份是否具备对象版本枚举所需权限。
- 处理宿主机记录的 Caddy 重启策略、Docker live-restore/日志轮转、旧镜像和 journald 空间、异地备份与安全更新重启窗口。
- 按真实运行数据决定 APM/TMP/RUM 的采样和主观性能阈值，避免同一故障多路重复告警。

## 文档资料待确认

- `docs/terms.md` 没有记录原章程的标题、发布单位、发布日期和许可。当前仅作为业务背景材料保留，补齐来源前不应当作可对外再发布的政策文本。

## 下一步

1. 发布 `main` 上未发布的提交，上线后在 APM 核对语句级 span、导出内容与上报量（全量上报，先观察一周数据）。
2. 新业务继续按现行 contract 开发；不要重新打开已经关账的基础设施迁移。
3. 运维事项取得相应权限后逐项验证，把长期有效的结果更新到部署文档或窄 notes，而不是追加会话流水账。

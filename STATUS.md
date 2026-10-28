# Qualy 当前状态

更新时间：2026-10-28

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
- COS 的可选 EdgeOne 原件交付已实现，边缘函数的审计修复、热缓存下停用及恢复、临时对象清理已实测。服务端导入与备份改用独立的有作用域直读流，附件下载端点支持鉴权后 302，预览支持一次重新授权重试。`v0.1.0-rc.36` 已部署，生产应用已启用 EO，正式函数 HEAD 长度修复及 COS 实际内网读流已验证；验证边界与平台限制见 [EO 联调记录](docs/notes/edgeone-file-delivery.md)。
- 生产 EO 站点已转为个人版，主站和文件域名分别配置五分钟流量封顶；迁移后的附件、缓存与安全策略检查及验证边界见 [EO 切换记录](docs/notes/edgeone-rollout.md#个人版迁移后的检查2026-10-28)。
- `v0.1.0-rc.37` 已部署：审核页批量下载 iframe 退出布局；长时间停留后的大图和 PDF 打开时重新授权；批次顶部运行卡片独立于底部筛选；审核人可读取同一申报截至最后提交版本中已移除的历史附件（未提交版本、他人材料、失去审核资格后仍拒绝）；附件不存在与业务授权拒绝不再计入存储故障指标，后端、数据库与 defect 仍计数。EO 固定缩略图已启用：正式函数先更新并复验原件不变，再在应用侧开启。上线复验与告警归因见 [EO 切换记录](docs/notes/edgeone-rollout.md#rc37-上线2026-10-28)，真实材料可读性验收见 [缩略图实测](docs/notes/edgeone-thumbnails.md#真实材料验收2026-10-28)。
- 批次实时事件已从 SSE 迁为同源 WebSocket（随 `v0.1.0-rc.39` 上线）：同一标签页内同一身份、同一批次共享一条连接并带宽限复用；拒绝改用关闭码区分未登录、无权、不兼容与席位已满，席位已满时界面显示“正在恢复实时更新”并抖动退避，页面继续轮询；会话与批次可见性在连接期间定期复核。SSE 端点与 `useApiStream` 已删除。经 EO 的升级、心跳、超过 300 秒的连接、约 10 分钟续期与第 7 席 4429 已在生产验证，蓝绿切换重连等未验证项见[批次实时通道](docs/notes/live-websocket.md#生产验收2026-10-28rc39)。
- 依赖：Monaco 内置 DOMPurify 更新为官方 3.4.17，undici、nodemailer、fast-uri 取修复版；Effect 升级到 4.0.6 并随之适配客户端类型与 pre-response handler，其余次版本更新一并完成，处置依据见[安全核对](docs/notes/security-dependency-review-2026-10.md#2026-10-28-依赖告警)。

Formula RPC 心跳误断线和 WebSocket HTTP 计时的修复已随 `v0.1.0-rc.32` 上线
（[实测笔记](docs/notes/formula-rpc-heartbeat.md)）。

WebSocket 会话 span 在握手时结束、语句级数据库追踪与遥测导出清理
（[笔记](docs/notes/statement-tracing.md)）、收件箱与巡检的规划开销优化
（[笔记](docs/notes/kysely.md)）、原生 tsc 直接启动、模态框下的更新提示层级、
依赖图巡检改用异步 SBOM 接口均已进入当前生产发布。

站点入口、演示邮箱域和可选备案页脚已改为部署配置，见[部署说明](docs/deployment.md)与
[演示数据说明](docs/notes/demo-data.md)。已随 `v0.1.0-rc.34` 部署，现有演示账号与基线完成定向迁移。
备案组件的 Fast Refresh 边界、Web 构建请求预算和本轮安全告警已完成修复与验证；
依赖处置依据见[安全核对](docs/notes/security-dependency-review-2026-10.md)。

Node 安全运行时、COS 间接 HTTP 重定向依赖补丁和 GitHub 登录阶段诊断已随
`v0.1.0-rc.35` 上线。三个生产应用容器均实测为 Node 24.22.1。

## 最近验证的代码状态

rc.37 源码提交 `ebbc917fc25b9366fc051380090428cc7cfb0f13` 的 CI 全部成功（static、Node CI、Chromium、WebKit、image、release-eligible）；正式 release 的 COS 真桶套件、三个镜像构建与 smoke、镜像推送和 Sourcemap 登记全部成功。以下为 rc.36 时的详细计数，作为对比保留：

- static、Node CI、Chromium、WebKit、image、release-eligible 全部通过；
- Node：443 个测试文件通过、3 个跳过；3463 个测试通过、29 个跳过；其中 27 项 COS 真桶用例在正式 release 门禁补跑，另两项为既有的 vendor/CSP 环境条件跳过；
- Chromium：134 个测试文件、1758 个测试通过；WebKit：5 个测试文件、50 个测试通过；
- 正式 release 的 COS 135 个测试全部通过，无跳过；三个镜像构建、检查、部署/回退/备份/恢复 smoke、镜像推送和 release.json 发布成功。Sourcemap 任务成功，333 份全部登记到本次 Web release。
- 本地两种文件交付配置均已验证签发和互斥行为；真实 Chromium 的跨域单个/全部下载、图片灯箱、PDF 画面与原件哈希检查通过。正式 EO、直接 COS 回退通道和实际 COS 内网读流已通过上线验证；真实浏览器单个下载、图片预览及 local/COS 混合全部下载已验证。批量下载同时发现 iframe 占位造成布局挤压，局部隐藏样式修复及 74 项浏览器回归已通过，尚待补丁发布与线上布局复验，见 [EO 切换与回退](docs/notes/edgeone-rollout.md)。

2026-10-22 的安全核对记录了两项编译器内嵌 Go 告警（Linux 目标依赖图不包含受影响包）及两项不进入生产镜像的 Vitest 开发依赖中危告警，依据见[安全核对](docs/notes/security-dependency-review-2026-10.md)。本轮未重新核对这些平台告警的当前状态。

CI：https://github.com/hprogq/qualy/actions/runs/40566683534

Release：https://github.com/hprogq/qualy/actions/runs/40569520758

后续提交若修改代码，应按[验证指南](docs/development/validation.md)重新选择检查；这里的结果不能替代新改动的验收。

## 生产状态

- 2026-10-28 部署 `v0.1.0-rc.39`（revision `ee7112ff9`，签名 tag），服务颜色为 green，Web release 为 `r_pKGGtxQINePSHVyFJEMs0A`；批次实时事件改为 WebSocket，无新增迁移。部署前整站备份 `20261028T073117Z` 与部署入口备份 `20261028T075928Z` 已异地复制，`doctor` 全部通过，旧 `rc.38` 保留用于回退。
- 2026-10-28 部署 `v0.1.0-rc.38`（revision `dad290558`，签名 tag），服务颜色为 blue，Web release 为 `r_qFwHSb3L3wPjjYGmMWuhNw`；应用代码与 rc.37 相同，新增演示实例的换域与保留登录方式复原。部署入口备份 `20261028T015501Z` 已异地复制，保存了复原前的全部生产数据。
- 演示邮箱域改为 `demo.hprogq.cn`：服务器基线经 `deploy/demo/rehome.sh` 在隔离库改写并重新导出，8 个账号换域，旧 dump 保留为 `qualy-demo.dump.qualy.hprogq.cn.20261028T015612Z`；发件地址仍为 `noreply@qualy.hprogq.cn`。随后以 `deploy/demo/restore.sh --keep-sign-in` 复原：四个登录入口、5 条受众与 2 个入口密钥复原前后逐行指纹一致，2 条外部身份绑定、会话与基线后的业务数据回到基线；`doctor` 全部通过，启动无不可解密的密钥。用户已用新域账号登录并完成邮箱验证收发。
- 2026-10-28 部署 `v0.1.0-rc.37`（revision `ebbc917fc25b9366fc051380090428cc7cfb0f13`），服务颜色为 green，Web release 为 `r_p2JGky0hjeLd5jNNv9xKtA`。升级前整站备份 `20261027T192916Z` 与部署入口备份 `20261027T194016Z` 均完成异地复制；`qualy-deploy doctor` 全部通过，旧 `rc.36` 保留用于回退。两个发布之间没有新增迁移。
- 2026-10-27 经用户批准部署 `v0.1.0-rc.36`（revision `0267c6d965c00a8c155863ebbceeca870779895d`），服务颜色为 blue，Web release 为 `r_EUFFloS2UR-IGb5GAnVf6A`。升级前整站及异地备份、部署入口、doctor、三个运行容器 revision 和公开 release 均已核验；旧 `rc.35` 保留用于回退。EO 模式启用，公安备案号及完整查询链接已在实际页脚生效。
- EO 主站回源应答空闲超时已从默认 15 秒调整为 60 秒，解决当时的 SSE 在 25 秒心跳前反复断开的问题（通道迁到 WebSocket 并上线后，是否保留另行评估）；规则只匹配主站 HOST，不绑定业务 URL。真实浏览器已观察到跨过 60 秒的多轮心跳，见 [切换记录](docs/notes/edgeone-rollout.md#主站-sse-空闲超时修复)。上线后整站备份已实际导出 3 个 COS 附件并完成异地复制。
- 新入口作为唯一应用主站；旧入口的普通导航由边缘永久跳转，旧 API、写请求及 WebSocket 不跨域续接。新入口使用独立的普通 ACME 签发策略。
- rc.34 上线时已验证真实本地登录、会话及退出、一个现有本地附件下载、三种外部登录入口生成的新回调地址，以及生产 COS 临时对象的写入、签名下载、CORS 和精确清理。未代替用户完成外部提供方授权，也未发送真实邮件；rc.35 本轮未重复真人授权或生产存储写入。
- GitHub token 端点出现出站连接超时，已用宿主机单域名解析覆盖缓解；调整后首个登录仍超时，其后五次真实登录均成功，已核对生产登录记录。覆盖需要维护，阶段诊断已随 rc.35 部署，见[排查记录](docs/notes/github-oauth-connectivity.md)。
- 2026-10-15 生产数据库启用 `pg_stat_statements`（含 `track_planning`），扩展装在 `monitoring` schema；
  设置写在数据卷的 `postgresql.auto.conf`，不在 compose 文件里。查看与开关方式见
  `deploy/README.md` 的 Statement statistics（`deploy/query-stats.sh` 已随发布上机）。
- 演示数据保留原基线业务内容，仅定向更新 8 个受控邮箱；线上 1215 个用户、15503 个已绑定本地附件保留，4 个登录提供方、7 个身份绑定和 2 个 secret 原样保留。基线从独立临时库更新后复原校验，未重新生成或覆盖线上库。
- 切换前已完成完整数据库与附件备份，并独立保存私密配置；原基线 dump 保留副本，附件归档摘要未变。

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

生产已切换至 `rc.36` 和 EO；后续补丁需先完成发布门禁并取得部署批准，再上线复验批量下载布局、长时间停留后的附件预览和批次卡片。切换与回退依据见 [EO 切换与回退](docs/notes/edgeone-rollout.md)。

1. 由真实用户完成三种外部登录和邮件收发复核；在 APM 核对语句级 span、导出内容与上报量（全量上报，先观察一周数据）。
2. 新业务继续按现行 contract 开发；不要重新打开已经关账的基础设施迁移。
3. 运维事项取得相应权限后逐项验证，把长期有效的结果更新到部署文档或窄 notes，而不是追加会话流水账。

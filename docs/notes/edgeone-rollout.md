# EO 切换与回退

本文记录本次发布前核对和待批准的生产操作。交付协议、边缘规则及审计证据见 [EO 联调记录](edgeone-file-delivery.md)，发布与蓝绿切换遵循 [部署说明](../deployment.md)。应用部署需单独批准。

## 已核对的生产基线

2026-10-27 核对：生产仍运行 `v0.1.0-rc.35`，green 服务流量；三个应用镜像版本一致，`qualy-deploy doctor` 全项通过。服务镜像 revision 为 `5e68131186724f032386f3c39dab85b0d069fbbe`，公开 Web release 为 `r_6EUdv9tJt8nTaddG6Ub2Dw`。

- 新上传默认后端已经是 `cos`。当次只读汇总为 15503 个已绑定 `local` 附件、无 COS 附件；新版本不会迁移这些历史附件。
- `files.qualy.hprogq.cn` CNAME 指向 EO；`files.qualy.hprogq.com` CNAME 指向生产 COS 桶，HTTPS 可达，匿名请求被拒绝。拒绝匿名请求不等于已验证签名下载。
- 当前旧版本仍设置 `QUALY_STORAGE_COS_DOWNLOAD_DOMAIN=https://files.qualy.hprogq.cn`。这项配置与 DNS 已迁至 EO 的现状不一致，不能作为可用的直连回退配置。
- 宿主机和服务容器均将 COS 默认域名解析为 `169.254.0.49`，实际 HTTPS 连接远端 IP 相同。请求未带对象授权、返回 403；这证明内网连通，不证明新版附件读取已上线。
- 本地待部署的私钥派生公钥与已部署 EO 的 `VERIFY_KEYS` 一致，`kid=download-20261027`。私钥尚未写入生产配置。
- 用户另行授权部署前补充公安备案：生产 `.env` 的 `QUALY_MPS_RECORD` 已设为 `辽公网安备21010402000601号`，`QUALY_MPS_RECORD_URL` 已设为 `https://beian.mps.gov.cn/#/query/webSearch?code=21010402000601`。链接在文件中加引号，保留 `#` 后内容；原文件已做 0600 备份。此次只更新这两个配置项，现有容器尚未重建，页脚待新版本启动生效，回退时保留此备案设置。

## 待批准的候选发布

- 发布：[`v0.1.0-rc.36`](https://github.com/hprogq/qualy/releases/tag/v0.1.0-rc.36)，源码 `0267c6d965c00a8c155863ebbceeca870779895d`，目标 `linux/amd64`，Web release `r_EUFFloS2UR-IGb5GAnVf6A`。
- 部署只使用该发布的 [release.json](https://github.com/hprogq/qualy/releases/download/v0.1.0-rc.36/release.json) 中三个镜像 digest，已核对清单 revision 与不可变 tag 一致。本次尚未拉取或启动生产候选容器。
- [main CI](https://github.com/hprogq/qualy/actions/runs/40509399940) 全部通过：Node 3463 项、Chromium 1758 项、WebKit 50 项；格式、lint、类型检查、三个镜像检查和发布资格均通过。Node 普通 CI 跳过 27 项真桶测试及两项既有 vendor/CSP 条件检查；真桶测试在下面的正式发布门禁补跑。
- [正式发布](https://github.com/hprogq/qualy/actions/runs/40511587514) COS 135 项全部通过、无跳过；三个镜像构建、检查、部署/回退/备份/恢复 smoke 与镜像推送成功。Sourcemap 任务也已成功，333 份全部登记到本次 Web release（189 份复用，144 份上传），发布流水线全部通过。
- 本次与 `rc.35` 的 `db/migrations` 无差异。待更新的 EO 单文件脚本 SHA-256 为 `64ee189e0596573739403347a8ca3be712e0347a6b5dd94401d1dde5094e1853`，来自同一候选源码，包含 HEAD 空流修复。

## 两套互斥配置

| 设置                                    | EO                              | 直连回退                         |
| --------------------------------------- | ------------------------------- | -------------------------------- |
| `QUALY_STORAGE_DEFAULT_BACKEND`         | `cos`，保持现值                 | `cos`，保持现值                  |
| `QUALY_STORAGE_COS_DELIVERY`            | `edgeone`                       | `direct`                         |
| `QUALY_STORAGE_COS_DOWNLOAD_DOMAIN`     | 删除或留空                      | `https://files.qualy.hprogq.com` |
| `QUALY_STORAGE_COS_EDGEONE_ORIGIN`      | `https://files.qualy.hprogq.cn` | 不使用，可保留                   |
| `QUALY_STORAGE_COS_EDGEONE_ISSUER`      | `https://qualy.hprogq.cn`       | 不使用，可保留                   |
| `QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY` | 与已部署公钥对应的私钥 JWK      | 不使用，可保留，仍按密钥保护     |

桶、地域、CAM 凭据、上传权限、版本控制、已有附件记录均不变。选择 EO 后只签发 EO 下载凭证，失败不会改签源站地址；直连模式继续使用 COS SDK 的签名协议。服务端的导入和备份读流在两种模式下均直接使用 COS SDK，不使用以上两个下载域名。

浏览器上传仍使用 COS STS，因此 CSP 的 `connect-src` 继续包含 COS 上传域名。这个公开域名不是下载凭据，也不表示 EO 模式会返回源站下载链接。`img-src` 与 `frame-src` 只允许所选的文件交付域名。

## 批准后的操作顺序

1. 记录已通过发布门禁的 tag、revision、三个镜像 digest 和 Web release；确认此次没有数据库迁移差异。先拉取和核验镜像，再做业务切换。
2. 创建本次操作专用、权限为 0600 的配置备份，并完成升级前整站备份。私钥只通过受保护通道写入服务器，不放进 Git、构建参数、命令行或输出。
3. 在 `/opt/qualy/.env` 原子更新上表 EO 配置，保持其他设置；检查缺项、混合配置、密钥公私部分和 issuer/audience 一致。使用发布自身的部署脚本启动待切换颜色并检查 readiness。
4. 蓝绿切换后核对 `doctor`、镜像 revision 和公开 Web release，随后执行下面的真实业务验收。配置变更通过重新创建容器生效，单纯修改 `.env` 不会改变已运行进程。

## 两级回退

**只回退文件交付：**保留新版本，将模式改为 `direct`、下载域名改为 `.com`，在短暂维护窗口内只重新创建当前颜色的 server 容器并核验 readiness，sandbox 与旧颜色不动。现有 `upgrade.sh` 明确拒绝重复部署同一 release，因此不能把重复执行 deploy 当作配置刷新。若不接受此次短暂重启，则直接选择下一项应用蓝绿回退。不能把旧 `.env` 整份覆盖回来：部署脚本会更新颜色及版本记录，整份回写可能破坏当前部署状态。

**回退应用版本：**在切回 `rc.35` 前同样设置 `.com` 的直连下载域名；旧版本不支持 EO 签发，不能指望它读取新的模式开关。使用当前发布携带的 rollback 流程恢复旧 Web release 和服务颜色，再检查登录、附件和健康。数据库回退保护继续生效，不使用 `--force`。此次基线至候选代码没有新增迁移；最终 tag 前再次确认。

两个文件域名保留现有 DNS，无需等待 DNS 切换。EO 已签发链接最多存活 60 秒（另有 3 秒容差），回退后让它自然过期；不删除 EO 公钥和读取规则，不把桶改成公开读。若失败发生在配置写入后、切流前，只恢复本次改动的配置项，旧容器继续服务。

## 上线后必须实际验收

- 使用受控测试附件走正常上传、完成与业务授权流程，分别打开图片与 PDF 预览，比较原始字节；历史 local 附件也要打开一次。现有 local 附件不能充当 COS/EO 的验收证据。
- 单个下载与审核页“全部下载”均通过真实浏览器保存文件，核对文件数、中文文件名、长度和 SHA-256。页面放置至旧链接过期后再下载，确认点击时重新鉴权签发。
- 预览过期仅重新申请一次；无权限、服务错误或持续失败有可读提示，没有无限续签。
- 检查 describe 与下载端点的响应，只出现 `.cn/v1/…`，没有 `.com` 或 COS 源站下载 URL；同时验证上传仍可完成。
- 从生产容器执行真实的服务端 COS 读取，记录目标 Host、连接远端 IP、版本和字节核对结果，不记录授权头或签名 URL。预期使用 COS 默认域名和内网 IP；仅有当前 DNS 记录不算完成此项。
- 验证合法、过期、篡改链接、GET/HEAD/Range、条件请求及热缓存；保持私有桶、内部对象路径拒绝、非预期函数入口拒绝的边界。
- 精确删除本轮测试附件和版本并刷新对应缓存；不使用桶级删除或全站刷新。

## 本地验证边界

`delivery-modes.test.ts` 从真实配置加载到实际 COS SDK 签名，以及服务端 ES256 签发到边缘验签交付，覆盖 `.com` 直连、`.cn` EO、历史 null 版本、直连模式忽略未启用 EO 配置、EO 上游拒绝不回退。测试凭据和文件体均为临时模拟数据，不代表生产签名下载已经通过。

本地真实 Chromium 还覆盖两种模式下的跨域 302 和“全部下载”，文件服务使用本机 HTTPS、测试公私钥及受控字节；正常弹窗限制与 CSP 开启，核对两份文件及中文文件名。这不是正式域名的真实对象下载：正式域名映射到本机的实验遇到连接失败，改用明确的本机地址隔离后运行；实际 `.cn` / `.com` 的签名交付仍留在上线验收。

补充媒体验收使用真实 PNG 与一页 PDF，通过实际 `AttachmentLink` 打开灯箱和预览。两种模式均确认图片解码为 32×32、完整 Chromium 的内置 PDF 查看器显示测试页、预览 Blob 与原 PDF 的 SHA-256 一致，单个下载保存中文文件名且哈希一致。默认 headless shell 不渲染内置 PDF 查看器，因此字节读取与画面检查分开，画面验证使用完整 Chromium。临时文件和测试服务器仅在本地，不写生产附件。

HEAD 的隔离 EO 实测已找到可行修复：保留上游 HEAD 空流而不是替换成 null，长度为 945；HEAD → GET → HEAD 的 GET 哈希与源文件相同。候选代码已修复，正式函数在批准后更新，随后用真实签名附件重复此检查。

main CI、真实 CI COS 桶门禁、三个正式镜像构建和 release smoke 已通过。生产应用、EO 交付配置和正式边缘函数尚未切换，以上真实业务验收仍须在取得部署批准后执行。

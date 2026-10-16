# GitHub OAuth 出站连接排查

2026-10-16，生产 `v0.1.0-rc.34` 的 GitHub 登录两次在回调中约十秒后失败，
日志为 `github did not name an account`，`reason=failed:timeout`。
这次排查将站点回调配置、GitHub token 兑换和账号 API 的可达性分开验证。

## 已确认的边界

- 宿主机与正在运行的 server 容器均将 `github.com` 解析为 `20.205.243.166`；
  TCP 443 连接超时。多个公共递归 DNS 返回同一地址，不能仅凭这个结果判断 DNS 污染。
- `api.github.com/user` 无凭据请求在约 0.3～0.8 秒返回 401。这说明账号 API 可达，
  不能据此推断 `github.com/login/oauth/access_token` 同样可达。
- 使用容器内实际 `makeOutbound` 重现：token 探测超时，user 探测正常返回 401。
  探测只使用刻意无效的 client/code 字段，没有发送真实 OAuth secret、token 或授权码。
- 另一公共 DNS 返回的两个地址曾完成 TLS 握手，但没有返回 HTTP 响应；
  TCP 连通或 TLS 握手成功单独都不足以证明登录接口恢复。

## 宿主机临时缓解

从 [GitHub Meta API](https://api.github.com/meta) 的 `web` 地址中选取候选，
通过保留 `github.com` URL、Host、SNI 和证书校验的请求测试实际 HTTP 响应。
其中 `20.200.245.247` 的静态页面返回 200，连续三次 token 接口探测返回 JSON 404，
耗时约 0.45～1.5 秒；404 是使用无效 client 的探测响应，**不是成功兑换 token 的证据**。

宿主机备份原 `/etc/hosts` 后，仅增加 `github.com` 的这一条地址覆盖并清理解析缓存。
现有 systemd-resolved 读取 hosts，Docker 内部 DNS 转发到宿主机 stub，
所以运行中的容器也取得新地址；无需重启应用、Docker 或数据库。
应用仍请求 GitHub 官方域名，TLS、SSRF 检查和请求内 DNS 固定机制保持不变。

变更后通过生产镜像的实际认证出站实现验证：token 探测约 1.6 秒返回 404，
user 探测约 0.55 秒返回 401。随后用户重新发起真实登录，首个请求仍发生十秒超时，
其后五次全部成功；生产 `sign_in_events` 的五条 `success` 与用户反馈一致，
成功回调耗时约 1.35～2.80 秒。最后一次成功记录为 20:39:56（UTC+8）。
这已验证 token 兑换、账号查询和本地会话建立，但不代表这条网络路径绝无偶发失败。
首个失败发生在解析调整之后；旧版日志缺少请求阶段，不能武断归因于缓存切换。
失败后应重新发起登录，不能重放之前已经消费的 callback。

该覆盖属于部署网络的临时缓解，不进入产品源码、镜像或通用 compose。
GitHub 明确说明其 [IP 地址会变化](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses)。
若复发，应重新核对官方地址、证书和完整请求，再更新或移除这一条覆盖；
移除后清理宿主机解析缓存并核对容器解析。不要覆盖整份 hosts 或盲目导入第三方列表。
本次没有增加定时同步任务，也没有把静态地址视为永久稳定性保证。

## 代码诊断改进

`auth-github` 的失败结果和警告日志增加 `stage=token|user`，
保留现有网络原因与 HTTP 状态分类。token 响应中的上游 `error` 仅保留
[GitHub 文档列出的固定代码](https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/troubleshooting-oauth-app-access-token-request-errors)，
其他值归为 `unknown-token-error`，避免任意上游字符串进入日志。
没有对 token POST 或整个登录流程增加自动重试。

本地检查：GitHub OAuth 单元与登录集成共 28 个测试通过，全仓 `pnpm typecheck` 通过，
变更文件 lint 与格式检查通过。诊断改进尚未进入生产镜像；本次连接恢复来自宿主机解析覆盖。

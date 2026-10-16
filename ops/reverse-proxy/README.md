# 反向代理与站点域名

[Caddyfile](Caddyfile) 和 [nginx.conf](nginx.conf) 是通用模板。实际站点地址和证书配置属于部署环境，不写入发布镜像；蓝绿切换只更新模板导入的 upstream 片段。部署协议见[生产构建与部署](../../docs/deployment.md)。

## Caddy 自动 HTTPS

公开站点只有一个明确主机名时，在 Caddyfile 中用这个主机名替换 `qualy.example.com`，通常即可使用 Caddy 的自动证书申请、续期和 HTTP 到 HTTPS 跳转，不需要 DNS 服务商 API。默认 HTTP-01 使用公网 TCP 80，TLS-ALPN-01 使用公网 TCP 443；DNS 托管在 DNSPod 或 Cloudflare，不改变这两个验证方式。

部署前确认：

- A 记录指向正确公网服务器；若发布 AAAA，IPv6 必须同样到达 Caddy。错误的 AAAA 可能让 IPv4 正常而证书验证失败。
- 安全组、防火墙、端口映射和前置代理允许验证流量到达 Caddy。默认保留 HTTP-01 和 TLS-ALPN-01；前置服务若终止 TLS，需确认它不妨碍所选验证方式。
- 若配置了 CAA，记录允许实际使用的证书颁发机构，包括从父域继承的限制。
- Caddy 的证书存储可写且持久化，进程能访问 ACME 服务；自动续期仍需要这些条件持续成立。
- 实际配置未关闭自动证书，也没有继承其他 DNS 区域的全局 DNS challenge。

只有需要通配符证书，或公网验证无法到达 Caddy 时，才引入 DNS-01 与对应 provider 插件。申请 `qualy.example.com` 不要求申请 `*.example.com`，也不要求把 DNSPod 区域迁入 Cloudflare。

官方依据：[Automatic HTTPS](https://caddyserver.com/docs/automatic-https)、[通配符证书](https://caddyserver.com/docs/caddyfile/patterns#wildcard-certificates)、[IPv6 验证](https://letsencrypt.org/docs/ipv6-support/)、[CAA](https://letsencrypt.org/zh-cn/docs/caa/)。

## 同一 Caddy 管理不同 DNS 服务商

全局 `acme_dns cloudflare ...` 会为所有 ACME 交易配置 DNS challenge。新增一个由 DNSPod 托管的域名时，不能假设新站点自动恢复 HTTP 验证，也不能假设单独写 `issuer acme` 就能取消全局设置。

将 Cloudflare DNS challenge 限定在确实需要它的站点 `tls` 块或这些站点引用的 snippet 中；其他公开主机名保留默认自动 HTTPS。若确实需要 DNSPod DNS-01，再按实际 Caddy 版本和所装插件配置相应站点。新版本的全局 `dns` provider 默认值与 `acme_dns` 不是同一个开关，检查时应区分。

调整前记录实际 Caddy 版本与模块，使用同一二进制验证候选配置及其 TLS automation policies，确认各站点的签发方式。保留既有其他站点所需的 DNS challenge；不要为一个站点换域名就删除整台服务器的凭据或证书数据。查看转换后的配置时不得输出已展开的密钥。

官方依据：[全局选项](https://caddyserver.com/docs/caddyfile/options#acme-dns)、[站点 TLS 配置](https://caddyserver.com/docs/caddyfile/directives/tls)、[维护者关于全局 DNS challenge 的说明](https://caddy.community/t/override-global-acme-dns-and-use-http-01-challenge-for-specific-domain/19864)。

## 切换网站入口

1. 先配置新域名的 DNS、反向代理和证书，核对对应备案信息及站点展示要求。
2. 同步服务器部署环境 `QUALY_PUBLIC_URL` 和 GitHub **仓库级 Actions 变量** `QUALY_PUBLIC_URL`。前者生成邮件操作链接与外部登录回调；后者提供部署记录链接，工作流会在远程操作前校验它是 HTTPS origin。不要只在 GitHub `production` environment 中设置后者：environment 变量到 runner 开始执行后才可用，不能作为 job 环境及部署链接所需的提前配置。
3. 按实际启用的登录方式更新外部提供方登记的 callback、redirect URI 或 CAS service。已有会话 Cookie 不跨域，切换后需要重新登录；旧域重定向不能替代新域回调登记。
4. 分别验收 HTTP 跳转、HTTPS、登录、邮件回跳和依赖域名的监控或存储配置，再更新对外链接。

网站入口、账号邮箱域与发件域分别配置。更换 `QUALY_PUBLIC_URL` 不改变数据库中的邮箱，也不要求更换 Resend 发件域或邮件 DNS。旧入口的跳转应只匹配该 Web 主机名，避免影响同一主域下的邮件或其他服务。

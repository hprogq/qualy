# 2026-10 发布依赖安全核对

核对日期：2026-10-16、2026-10-22。本文记录告警的依赖来源、真实调用路径和修复边界；部署状态见 `STATUS.md`，本文不替代后续镜像扫描。

## Node 安全更新（2026-10-22）

依据 [Node.js 10 月 21 日安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)，
开发工具链、全部 CI 工作流及三个发布镜像统一升级到 24.22.1，保持在现有主版本内。
本次包含 Brotli 解码器越界写与可能的远程代码执行修复（CVE-2026-111497）、TLS 主机名验证等安全修复。
Qualy 的部分服务端出站请求使用 Node `fetch`，可进入自动解压路径；这说明应升级运行时，
不构成已确认可利用的 Qualy 漏洞。生成和发送预压缩静态资源也不等同于处理不可信 Brotli 输入。

通过官方镜像仓库核对并固定多平台索引摘要：

- Bookworm slim：`sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`。
- Alpine：`sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53`。

在无宿主挂载的临时 linux/amd64 Bookworm slim 容器中确认：Node 为 `v24.22.1`，
`perl-base` 为 `5.36.0-7+deb12u4`，`libpcre2-8-0` 为 `10.42-1+deb12u2`。
新基础镜像已包含下面两项 Debian 安全修订，因此移除最终阶段的临时 apt 升级；
实际发布镜像的安全版本下限仍由 `check-release-image.ts` 检查。

## 服务镜像的 Debian 安全包（2026-10-16）

服务镜像继续使用仓库固定的 Node 版本，基础镜像切到该版本官方 Bookworm slim 重建的摘要 `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`。实际检查 linux/amd64 基础容器得到：

- `libpcre2-8-0` 为 `10.42-1+deb12u2`，已达到本次告警的修复版本。
- `perl-base` 仍为 `5.36.0-7+deb12u3`，所以最终阶段显式安装 `5.36.0-7+deb12u4`。该候选版本来自镜像自带的官方 `deb.debian.org/debian-security`、`bookworm-security/main` 源。

在无宿主挂载的临时 linux/amd64 基础容器中实际执行同一精确升级已通过：apt 只升级 `perl-base` 一个包，随后 `dpkg-query` 确认 Perl 为 `5.36.0-7+deb12u4`、PCRE2 为 `10.42-1+deb12u2`。首次尝试受本机 Docker 默认 DNS 解析失败影响；临时容器指定公共 DNS 后成功。仓库没有因此更改部署 DNS。本地没有构建完整 Qualy 镜像，完整镜像构建、运行门禁和扫描由后续 CI/release 验证。

这里没有运行宽泛的系统升级。版本写死使安全修订不可取得时直接构建失败；它不是 Debian 仓库的永久快照。下次更新基础镜像时，应重新检查并决定是否移除此临时安装步骤。[镜像门禁](../../tools/quality/check-release-image.ts) 在实际发布镜像中用 Debian 的版本比较检查上述两个安全下限。

## Monaco 实际加载的 DOMPurify

核对时 Monaco 最新稳定版仍为 0.57.0。它既声明 `dompurify` npm 依赖，也将一份 DOMPurify 3.4.15 源码复制到 `esm/vs/base/browser/dompurify/dompurify.js`；`domSanitize.js` 直接导入后者。只 override npm 依赖不能修复浏览器实际执行的代码。

本次使用 [DOMPurify 3.4.16 官方发布](https://github.com/cure53/DOMPurify/releases/tag/3.4.16) 的 ESM 产物替换这一个 vendored 文件，并将 `monaco-editor>dompurify` 精确约束为同版。补丁由 `pnpm patch` / `patch-commit` 生成，lock 由 pnpm 更新。仅移除原产物末尾指向未复制文件的 `sourceMappingURL`，与 Monaco 原来的复制方式一致；保留官方许可证头，不修改其实现。

可复核的产物身份：

- npm 元数据：<https://registry.npmjs.org/dompurify/3.4.16>。
- 上游提交：`b9b9d80f7e401771c2ccaef5f45def7eec8f27d7`。
- 下载 tarball 的 SHA-512 integrity：`sha512-sqo+pNp3qRhCIpbgRi1y8Tgk27Bo2Ry7w0dC1NBeNTdZChWjz9Xb/KOoZbRP/R6pQZ80Qw8YhXw13hWWBbMRnQ==`，提取前已校验。
- 去掉 source-map trailer 后 ESM 文件的 SHA-256：`9c52577e368cdc6f3fb2bc87de222c8139e30655eef54a2bebde6d4b0a85ccb8`。

[发布输入测试](../../tools/tests/release-inputs.test.ts) 从公式包解析实际安装的 Monaco，核对 vendored 文件摘要、许可证头及其与 npm 产物的字节一致性。[浏览器回归](../../packages/plugins/assessment/formula/tests/monaco-sanitizer.browser.test.tsx) 直接导入这个文件，复核官方修复对应的五种 IN_PLACE hook 移除子树情形；公式编辑器原有测试也覆盖升级后的装配路径。未来 Monaco 自行升级净化器后，应同时移除补丁、约束与对应的固定摘要。

## HTTP 重定向依赖补丁（2026-10-22）

本轮镜像扫描还报告 `follow-redirects@1.16.0` 的 CVE-2026-111755、CVE-2026-111756。
依赖来源为 COS 插件的 `qcloud-cos-sts@3.1.3 → axios@1.20.0 → follow-redirects`。
两项问题分别涉及自定义敏感头名称的正则转义和数组形式请求头在跨域重定向时的凭据清理，
均由上游 [1.16.1 补丁](https://github.com/follow-redirects/follow-redirects/releases/tag/v1.16.1)修复。
本次由 pnpm 更新该插件的间接依赖解析，lock 只变化这一包的版本、完整性摘要及引用；
没有新增 override 或升级 Axios。COS 的真实桶验证由正式发布工作流执行。

## TypeScript 原生编译器内嵌 Go 的告警

扫描定位到 `@typescript/typescript-linux-x64@7.0.2/lib/tsc` 内嵌的 Go 1.26.4，报告修复版为 Go 1.26.9 或 1.27.2。核对时 npm 的 TypeScript 和原生平台包最新稳定版均仍为 7.0.2；没有可直接替换的稳定修复二进制。本次保留该工具链，不引入预发布 TypeScript 或自建 Go 编译流程，也不添加扫描忽略规则。

以下判断基于 npm 7.0.2 的 `gitHead` 对应的完整上游源码 `2bd066d87f5bafd315be9f40889d0a60b9e58e0b`，而不是后续主分支或仅仅依据容器网络配置：

1. Qualy [编译调用](../../packages/core/formula-compiler/src/staging.ts) 使用 `execFile` 和固定 `-p <workspace> --pretty false` 参数；[工具链探测](../../packages/core/formula-compiler/src/toolchain.ts) 只使用 `--version`。公式源文本不是进程参数或 shell。
2. [语言服务启动](../../apps/sandbox-authoring/src/lsp/manager.ts) 固定传入 `--lsp -stdio`，父子进程通过标准输入输出管道交换 LSP 数据。上游 [main.go](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/cmd/tsgo/main.go) 明确将 `--lsp` 路由到 [lsp.go](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/cmd/tsgo/lsp.go)；后者只支持 stdio，将 `os.Stdin`、`os.Stdout` 交给 LSP server。
3. 对该提交所有非测试 Go 文件搜索 `net/http`、`crypto/tls`、HTTP/TLS 调用和文件服务入口均无匹配。[profiling 实现](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/pprof/pprof.go) 使用 `runtime/pprof` 写本地文件，没有 `net/http/pprof` 监听器。TypeScript 的文件 URI 或 stdio LSP 消息不会转为 Go HTTP/TLS 会话。
4. [部署配置](../../deploy/compose.yaml) 还将 authoring sandbox 置于 `network_mode: none`；这只是额外约束，不是全部论据。上游 LSP 存在 npm 安装回调，但当前[最终镜像](../../apps/sandbox-authoring/Dockerfile) 删除了 npm 和其他包管理器。

独立复核还检查了另外两条可能混淆的路径：`--api` 在 Linux 上使用 [Unix socket](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/api/transport_unix.go)，既不是 HTTP/TLS，也不在 Qualy 的固定启动参数中；LSP telemetry 经同一 stdio 通道发送 `telemetry/event`，没有另外的 HTTP exporter。`go.mod` 和生产源码的外部导入也未发现隐藏的 HTTP/TLS 客户端；本次没有重编译全部 Go 传递依赖，结论限于上述源码与实际调用路径。

| 告警           | 必需的受影响路径                                      | 当前判断                                           |
| -------------- | ----------------------------------------------------- | -------------------------------------------------- |
| CVE-2026-97031 | Go TLS server 处理恶意 ECH outer extension references | 编译器不提供 TLS server，没有该输入路径            |
| CVE-2026-78669 | Go HTTP/2 client/server 处理恶意 SETTINGS 帧          | 编译器没有 HTTP/2 peer，会话为 stdio LSP           |
| CVE-2026-78667 | Go HTTP 文件服务解析恶意 Range header                 | 编译器不使用 FileServer、ServeContent 或 ServeFile |

因此这三个具体漏洞在当前部署和调用方式下不适用，可以附上述证据进行告警处置；这不代表 Go 标准库版本已经修复。扫描仍可能按二进制版本报告它们。未来升级 TypeScript、改变编译器启动参数、引入 HTTP/TLS 接口或改变 sandbox 部署时必须重新核对，稳定上游二进制提供修复后仍应正常升级。

### 2026-10-22 新增两项告警

本轮扫描还按同一编译器二进制的依赖版本报告以下两项，告警保持 Open，未添加忽略规则：

- [CVE-2026-111943](https://pkg.go.dev/vuln/GO-2026-6809)：`crypto/x509.Certificate.Verify` 对已不可信中间证书的拒绝列表；修复版为 Go 1.26.10 或 1.27.3。
- [CVE-2026-56851](https://pkg.go.dev/vuln/GO-2026-6629)：`golang.org/x/text/secure/precis` 的 Nickname profile 在特制输入和短目标缓冲区下可能 panic；修复版为 x/text 0.41.0。

重新取得上文相同提交的官方 TypeScript Go 源码，对 `cmd/tsgo` 以 `GOOS=linux`、
`GOARCH=amd64`、`GOWORK=off` 执行 `go list -deps ./cmd/tsgo`，成功解析实际目标的传递依赖图。
结果不包含 `crypto/x509`、`crypto/tls` 或 `golang.org/x/text/secure/precis`；
x/text 仅包含 language、transform、unicode/norm 及其 internal 包。
对非测试源码搜索受影响包和符号也未发现生产调用。
因此这两项在当前编译器调用路径下不适用；这是对应源码依赖图的核对，没有重编译或替换 npm 分发的二进制。
2026-10-22 查询 npm 稳定 TypeScript 仍为 7.0.2，继续跟踪上游重建，版本变化时重新评估。

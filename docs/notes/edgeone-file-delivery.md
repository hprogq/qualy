# EdgeOne 附件交付联调记录

2026-10-27 在生产文件域名 `files.qualy.hprogq.cn` 上的实测，以及据此作出的协议决定，对应 storage-cos 的 `edgeone` 交付模式。测试对象是生产桶中临时写入的两个版本，测完已精确删除，相关缓存已清除。所有请求都从生产服务器发出：本机代理会把该域名解析成 COS 证书，本机测出的结果不可信。

## 协议决定

第一轮联调用的是 EO 原生 D 型 Token（`?token=&t=`）。鉴权本身能工作，但实测暴露出三个无法在函数里解决的问题：

- 原生鉴权在函数之前拒绝请求，403 没有正文，也没有 CORS 头。应用通过 `fetch` 读取 PDF 时，连状态码都拿不到。“自定义错误页面”只作用于回源响应，覆盖不到这一步。
- 链接有效期要在 EO 控制台与服务端两处保持一致。
- D 型密钥在规则编辑器里明文可见。

因此改为 **ES256 签名的 JWT（JWS 紧凑序列化）**，由边缘函数验签，撤掉这个入口上的原生 D 型鉴权：

- 地址形如 `/v1/<JWT>`，不带查询参数。函数拒绝任何查询串。
- 头部固定为 `alg: ES256`、`typ: qualy-download+jwt`，`kid` 只能在函数配置的 JWK Set 里查找。
- 载荷固定为 `iss`、`aud`、`iat`、`exp` 加上 `k`（对象 key）、`r`（版本，`null` 表示读取时不指定版本）、`f`（文件名）、`m`（交付 MIME），成员不能多也不能少。
- 有效期 60 秒，上限 300 秒，容许 3 秒时钟误差。
- 签名私钥只在服务端（`QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY`）；边缘函数只持有公钥（`VERIFY_KEYS`），不能签发凭证。
- 签发和验证共用 `packages/plugins/infra/storage-cos/src/edgeone/protocol.ts`，底层用 jose 实现。边缘函数由 `pnpm qualy cos edge-build` 打包成一个单文件脚本。

## 内部读取

函数读对象时向同一 Host 发出 `/attachments/<key>?versionId=` 子请求。**这个子请求同样会经过规则引擎**，会被“除 `/v1/` 外一律 403”的规则拦下。所以它要带上 `x-qualy-edge-key`，这条 403 规则只放过值与函数 Secret 变量 `QUALY_EDGE_KEY` 完全相等的请求。

这个值是服务间读取凭据：不知道它的人伪造任意值仍然得到 403，但一旦泄露，就能读取规则放行范围内的对象。所以：

- 放行范围要收窄到 `^/attachments/<uuid>/<uuid>$` 且方法为 GET 或 HEAD；
- 回源 COS 之前删除这个头；
- 不要写进日志。

另一个方案是让函数给子请求现签短期凭证（EO 运行时原生支持 MD5 摘要）。它的局限是：D 型签名不覆盖 `versionId` 参数，还需要额外设计路径和版本的保护，所以暂不采用。

## 其他实测结论

- 当前套餐不允许自定义 Cache Key。默认缓存键包含完整查询串，子请求只带 `versionId`，因此不同版本自然分开缓存。同一版本换签名、换文件名访问，`x-qualy-cache` 为 HIT，交付头仍按每次请求单独设置。
- 函数不运行时（把触发路径临时改成不可能匹配的值），`/v1/...` 会回源到 COS 中并不存在的 `v1/<...>` 对象，返回 404 `NoSuchKey`，不会读到任何附件，但会带出 COS 的 XML 错误体。
- 函数的平台默认域名（`*.eo-edgefunctions.com`）也能调用到函数。函数现在只在 `FILES_ORIGIN` 上应答，其他来源一律 404。
- HEAD 响应的 `content-length` 为 0：运行时把空 body 的长度重置了。下载与预览不依赖 HEAD。
- 生产桶已开启版本控制。生产库里的附件当时全部是 `local` 后端，COS 中没有任何附件。

## 控制台配置（站点 hprogq.cn）

| 项                                              | 内容                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 规则 Qualy files deny outside v1                | Host = files 且路径不匹配 `^/v1/` 且内部密钥头不等于密钥时，返回 403（`qualy-files-forbidden` 页）；放行范围待按上文收窄         |
| 规则 Qualy files object cache                   | Host = files 且路径匹配 `^/attachments/` 时，节点缓存自定义 1 小时，忽略源站 Cache-Control                                       |
| 规则 Qualy files token auth                     | D 型 Token 鉴权，JWT 函数验证通过后删除                                                                                          |
| 边缘函数 `qualy-file-delivery`（`ef-3cdjmump`） | 触发条件 Host = files 且路径 `/v1/*`；环境变量 `FILES_ORIGIN`、`APP_ORIGIN`、`ISSUER`、`VERIFY_KEYS`、`QUALY_EDGE_KEY`（Secret） |

files Host 的图片瘦身、格式转换、自动旋转、去 EXIF、指定参数处理全部关闭：原件必须保持原始字节。

## 第一轮实测矩阵（D 型）

| 情况                                             | 结果                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- |
| 指定版本 v1、v2                                  | 200，SHA-256 与写入时一致                                  |
| 不指定版本                                       | 200，最新版本                                              |
| `versionId=null`（对象写于开启版本控制之后）     | 404                                                        |
| 篡改签名、缺签名、过期、篡改描述中的文件名或版本 | 403                                                        |
| 直接访问 `/attachments/...`，或带伪造的密钥头    | 403                                                        |
| 额外的 `versionId`、`eo-img.*` 参数，重复的 `t`  | 403                                                        |
| `Range: bytes=0-99`                              | 206，`Content-Range` 正确；之后再完整 GET，哈希仍正确      |
| 越界 Range                                       | 416                                                        |
| 不存在的对象                                     | 404                                                        |
| `Origin` 为应用自身                              | 返回 ACAO 与 Expose-Headers；其他 Origin 不返回            |
| OPTIONS（应用 / 其他来源）                       | 204 / 403                                                  |
| POST                                             | 405                                                        |
| 同一版本，不同文件名与 MIME                      | 内容相同，`Content-Type` 与 `Content-Disposition` 各自正确 |

改用 JWT 后，这张矩阵需要在部署后重跑，并加上两项：热缓存下停用函数、从平台默认域名访问。

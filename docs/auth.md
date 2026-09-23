阅读Qualy源代码，https://github.com/hprogq/qualy ，我想给该项目增加CAS登录和OAuth绑定功能。由于Qualy不同租户其实是允许自行添加、删除登录方式的，且每个登录方式允许添加多种（比如OAuth通用协议就可以添加多套配置），你认为Qualy应该怎么实现？应该将OAuth的SecretKey放到数据库里存储吗？OAuth应该自己实现还是利用已有的库来做？CAS3.0的NodeJS有无实现？自己写的话应该做什么端点（ticket回调）？CAS的validate会回传学工号，直接查找学工号即可登录，所以无需也不能绑定。OAuth需要提前绑定（比如Github），是做成不绑定就报错提示未绑定，还是未绑定的话需要用其他登录方式先登录一次绑定？现在的本地账号做的是用户名密码的方式，我认为是不是应该改成邮箱密码的方式，这样可以接入resend，用户可以自行找回密码，且与学工号的关系分的更开？如果这么做，邮箱是存在identity表还是user表，是否不应该双写？你考虑下整套流程怎么做更好，或者是有一些你认为不该做的。

思考了 5m 50s

我把当前默认分支的认证相关代码读了一遍，重点看了 auth、auth-local、LoginDriver、AuthProvider、UserIdentity、provider 管理和账号绑定这一整条链。你现在的架构其实已经把这个问题抽象到比较正确的位置了，尤其是最近加进去的 managed / self / derived 三类绑定模式，基本就是 CAS、OAuth、本地账号应该有的三个答案。
我不建议为了 CAS/OAuth 再引入一套 Auth.js / Better Auth / Passport 式的认证体系。Qualy 已经有自己的多租户 Provider、用户身份、Audience、Session、审计和插件注册机制，应该继续让 @qualy/plugin-auth 管“谁最终成为 Qualy 用户并获得 Session”，协议插件只负责“证明外部是谁”。
你现在的核心模型可以直接理解成：
登录方式 Provider 实例 如何找到 Qualy 用户 UserIdentity binding
邮箱 + 密码 可多套，但通常 1 套 identifier=email 有 managed
GitHub / OIDC 每套 Client 一条 Provider 外部稳定 subject → identity 有 self
CAS 每个 CAS Server 一条 Provider CAS 学工号 → User.businessNo 没有 derived

这正好与你当前 LoginDriver 的设计一致。当前 LoginDriver / binding 契约 AuthProvider / UserIdentity 表结构

1. Provider 模型不要改，反而应该继续沿着现在这条路走
   你现在：
   协议实现 = LoginDriver
   租户配置的一套登录方式 = AuthProvider
   这个分层是对的。
   因此一个租户完全可以有：
   本地邮箱密码
   大外统一认证 CAS
   研究生院 CAS
   GitHub OAuth
   Microsoft OIDC

甚至：
GitHub-学生
GitHub-教师

都是不同的 AuthProvider，只不过 type 相同。
你现在数据库唯一约束是 (tenantId, code)，不是 (tenantId, type)，所以已经天然支持“一种协议配置多套实例”。
而且 Provider 的 code 和 type 目前不能在更新接口里修改，这一点建议继续保持。因为一旦：
github-student

下面已经有了大量 UserIdentity，再把它改成另一个 issuer/client，原来的 identifier 就完全变义了。
我甚至建议：Provider 一旦产生过身份绑定，核心协议配置也不能随便改成另一个身份域。
例如 OIDC 的 issuer 改了，应该要求新建 Provider，而不是原地修改。2. OAuth Client Secret 可以在数据库，但绝对不要像现在这样直接放 config JSON
这一点是我认为你现在真正需要先改的地方。
当前 AuthProvider 是：
config JSON

而你的 EntranceKind.prepare() 最后返回：
config

providers.ts 就直接把它 JSON 化写数据库了。当前 Provider 配置写入实现
对于：
CAS Server URL
OIDC issuer
clientId
scope

没问题。
但如果未来 OAuth driver 把：
clientSecret

也塞进去，它就是数据库里的明文。
我的建议是：Secret 应当存数据库，因为它是“租户动态创建 Provider”所需要的运行时配置；但必须应用层加密，而不是 hash。
密码可以 hash，因为以后只需要验证。
OAuth Client Secret 后面要拿出来给 Token Endpoint，所以必须可解密。
我比较推荐把模型直接拆成：
auth_providers

id
tenant_id
type
code
name
config
...
以及：
auth_provider_secrets

tenant_id
auth_provider_id
key
ciphertext
nonce
key_version
updated_at
例如 GitHub：
auth_providers.config

clientId: Ov23...
authorizationEndpoint: ...
tokenEndpoint: ...
而：
auth_provider_secrets

provider_id = ...
key = "clientSecret"
ciphertext = ...
主加密密钥不能也放数据库里，而放部署环境：
QUALY_AUTH_SECRETS_KEY
以后想更完整一点可以接 KMS；现在自己部署的话 AES-256-GCM 这类 AEAD 已经足够，并且存一个 keyVersion，以后可以轮换。
更重要的是，我建议直接把你的 driver contract 从：
prepare() -> {
config
}

变成概念上的：
prepare() -> {
config,
secrets
}

这样从类型层就断绝：
Secret 不小心混进普通 Provider config

这种事故。
你已经在 EntranceField 里明确区分了：
text
url
secret

所以这一步非常顺。
后台编辑 Provider 时仍然维持你现在很好的语义：
Secret 输入框为空
→ 保留原 Secret

输入新值
→ 替换 Secret

GET Provider 配置时永远不要把 Secret 解密后返回浏览器，只返回：
clientSecret: 已配置
就够了。3. OAuth 我不建议自己实现协议，CAS 反而可以自己实现
这两个我会采取完全不同的策略。
OAuth/OIDC 直接用成熟的协议库，但不要让库接管 Qualy 的账号体系和 Session。
我目前最倾向：
openid-client
它目前仍在积极维护，支持 OAuth 2.0 / OIDC、Discovery、Authorization Code Flow 等，当前 npm 版本是 6.8.8。NPM
也就是说：
openid-client
↓
负责 OAuth/OIDC 协议正确性

@qualy/plugin-auth-oidc
↓
拿到外部 subject

@qualy/plugin-auth
↓
UserIdentity → User → Qualy Session
而不是：
openid-client/Auth.js
↓
自己建立另一套 User/Session/Account
后者会直接和 Qualy 当前模型打架。
OAuth 这块非常不值得自己手搓。现在的 OAuth 安全最佳实践要求考虑 PKCE、CSRF、state/nonce、redirect URI 精确匹配、authorization-server mix-up 等问题。RFC 9700 甚至建议机密 Web Client 也使用 PKCE，并明确要求 redirect URI 精确匹配。RFC 编辑器
所以这里“自己写几个 fetch”没什么收益。4. 我甚至建议你优先做 OIDC，而不是所谓“通用 OAuth 登录”
这里要区分一个容易混淆的问题：
OAuth 2.0 本身不是身份认证协议。
OAuth 可以告诉你：
某人授权 Qualy 获得某个 Access Token。

但没有统一规定：
“这个人是谁”应该从哪里读、哪个字段才是永久 ID。

GitHub 是：
GET /user
id
别的平台可能完全不同。
OIDC 在 OAuth 上把身份这一层标准化了，所以它有：
issuer
sub
id_token
userinfo
并且规范明确规定，稳定身份键应该是：
(iss, sub)
而不能拿 email、preferred_username、name 当用户唯一标识；这些字段允许变化甚至重复。开放ID基金会
因此我建议 Qualy 第一阶段做：
@qualy/plugin-auth-oidc
@qualy/plugin-auth-cas
如果确实想支持 GitHub，再做：
@qualy/plugin-auth-github
至于：
@qualy/plugin-auth-oauth2-generic
我反而会放到后面。
因为所谓“通用 OAuth”最终会变成要求租户配置：
Authorization Endpoint
Token Endpoint
UserInfo Endpoint
Scopes
用户 ID 在 JSON 哪个字段
然后还有各种 provider quirks。
最终它不像一个简单协议插件，而越来越像一个可配置 HTTP 解释器。
还有一个更现实的安全问题：这些 URL 都由租户管理员填写，就产生了 SSRF 面。
所以如果做通用 OIDC，只允许：
https issuer

再通过 discovery。
如果以后真的做 Generic OAuth，再单独认真处理外部 URL 校验、私网访问策略等。5. GitHub 绑定绝对不要存 username，更不要按 email 自动匹配
你的 UserIdentity.identifier 对 GitHub 应该存：
GitHub user.id

而不是：
hprogq

GitHub 自己的文档也专门强调 durable user ID，因为 login 是可能变化的。GitHub Docs
例如：
UserIdentity

authProviderId = github
identifier = "12345678"
credentialHash = null

可以另外考虑以后加：
displayLabel = "hprogq"

用来给用户看：
已绑定 @hprogq

但它只是展示快照，不参与身份判断。
OIDC 同理。
如果一个 Provider 的 issuer 是固定不可变的，那么：
identifier = sub

就够了，因为 Provider 本身已经代表 issuer。
如果未来允许 issuer 被修改，那就危险了；所以我前面才建议 issuer 一旦产生绑定就不要允许原地换。6. OAuth 未绑定时，我建议“拒绝登录，但引导用户登录后绑定”
不要做：
GitHub OAuth 成功
↓
没找到 UserIdentity
↓
发现 GitHub 邮箱和 Qualy 某个用户一样
↓
自动绑定

这个设计我非常不建议。
尤其 OIDC 规范明确说 email 不保证永久稳定或唯一。开放ID基金会
正确流程应该是：
点击 GitHub 登录
↓
GitHub OAuth 成功
↓
得到 GitHub durable user id
↓
查 UserIdentity
↓
┌───────────────┬──────────────────┐
│ 已绑定 │ 未绑定 │
│ │ │
│ 建 Qualy │ 不创建 Session │
│ Session │ │
│ │ 提示：此账号尚未 │
│ │ 绑定 Qualy │
└───────────────┴──────────────────┘

然后提示：
此 GitHub 账号尚未绑定。请先使用其他登录方式登录 Qualy，再到账户设置中绑定 GitHub。

登录以后：
账户设置
→ 登录方式
→ GitHub
→ 绑定
→ OAuth
→ callback
→ 当前 Qualy User + GitHub user.id
→ INSERT UserIdentity

这正是你现在：
binding.mode = 'self'

应该表达的东西。
管理员只能：
查看
撤销

不能替用户输入 GitHub ID 然后“绑定”。7. 可以进一步优化成“OAuth 成功一次，然后登录其他方式确认绑定”
如果你觉得：
GitHub OAuth → 发现未绑定 → 本地登录 → 再点一次 GitHub OAuth

做两遍 OAuth 比较烦，可以做高级一点。
第一次 OAuth 已经证明：
provider = github
subject = 123456

Qualy 可以短暂保存一个：
PendingExternalIdentityProof

例如 10 分钟。
然后页面显示：
此 GitHub 账号尚未绑定。
请登录现有 Qualy 账号完成绑定。

用户随后 CAS / 邮箱登录成功，再明确确认：
将 GitHub @hprogq 绑定到当前账号？

确认后写 UserIdentity。
这比自动按 email 合并安全很多，而且 UX 也很好。
不过这个可以作为第二阶段，MVP 完全可以要求重新走一次 GitHub OAuth。8. OAuth redirect flow 建议在 auth 核心增加一个短期事务模型
不要简单把这些都塞进：
state=<JSON>

我建议建一张短期表，大概类似：
auth_flows

id
state_hash
tenant_id
provider_id

intent
initiated_user_id
initiated_session_id

pkce_verifier
nonce

return_path

expires_at
consumed_at
created_at

其中：
intent = login | bind

浏览器只拿一个高熵随机：
state

DB 和 Session 一样只存：
sha256(state)

callback 后原子 consume。
登录：
intent = login
initiatedUserId = null

绑定：
intent = bind
initiatedUserId = 当前用户
initiatedSessionId = 当前 session

绑定 callback 的时候还要确认：
当前 Session 仍然是启动绑定流程的那个 Session

不要仅仅因为数据库 flow 里记了 userId 就把外部账号绑定过去。
OAuth Code Flow 用 PKCE S256。对于 OIDC 再做 nonce/issuer 校验。RFC 9700 对这些 redirect-based flow 的要求已经比较明确。RFC 编辑器
Access Token 如果只是为了“登录 GitHub”：
获取 /user → 得到 GitHub ID → 丢弃 Access Token。

不要存。
只有未来 Qualy 真的需要代表用户调用 GitHub API，才应该建立单独的：
oauth_tokens

并加密存储 access/refresh token。
它不属于 UserIdentity。9. CAS 的情况完全不同：你的判断对，不应该绑定
如果你学校 CAS 明确保证：
CAS principal == 学号/工号

那：
CAS
↓
学工号
↓
users.business_no
↓
User

就是完整身份映射。
不应该再产生：
UserIdentity

否则数据库里只是在重复：
User.businessNo = 23000001
UserIdentity.identifier = 23000001

而且一旦两边不一致，还多出同步问题。
所以 CAS driver：
binding: {
mode: 'derived',
by: '人员编号'
}

最合适。
这其实就是你现在 LoginDriver 注释中描述的 derived 使用场景。Qualy LoginDriver 定义 10. CAS 3.0 Node 是有实现的，但我反而建议 Qualy 自己实现客户端
Node 现成库不是没有。
passport-cas 支持 CAS 3.0，但 npm 上目前版本 0.1.1，已经 9 年没有发布，而且它是 Passport abstraction。NPM
http-cas-client 也明确支持 CAS 1/2/3，包括 /p3/serviceValidate，但当前 0.4.3 已经约 5 年没更新。NPM
对于普通 Express 项目，我可能还会评估一下。
但对 Qualy，我不会用。
因为你现在根本不是：
Express
→ Passport
→ req.user

而是：
Effect HttpApi
→ LoginDriver
→ LoginSessions
→ Qualy Session

硬套 Passport 只是在外面又包一层完全不需要的框架。
而 CAS Client 真正需要写的协议其实非常小。
Apereo CAS 3.0 官方协议定义的核心就是：
/login
/p3/serviceValidate

其中 /p3/serviceValidate 在 CAS 2.0 /serviceValidate 基础上增加用户属性返回。Apereo Community Blog
所以 CAS 是少数我认为自己写反而更干净的认证协议。
XML 解析可以使用现成 parser，例如目前仍维护的 fast-xml-parser。NPM 11. CAS 不应该做一个所谓“ticket 登录接口”，而是 start + callback
我建议：
GET /api/auth/cas/:providerCode/start

执行：
resolve Provider
↓
读取 CAS server URL
↓
生成 Qualy callback URL
↓
302 到：

https://cas.example.edu/login
?service=https://qualy.example.com/api/auth/cas/school/callback

CAS 登录成功以后浏览器回来：
GET /api/auth/cas/:providerCode/callback
?ticket=ST-xxxxxxxx

然后 Qualy 服务端 请求：
GET https://cas.example.edu/p3/serviceValidate
?service=https://qualy.example.com/api/auth/cas/school/callback
&ticket=ST-xxxxxxxx

注意这里的 service 必须和签发 ticket 时那个 service 一致。
CAS 返回：
<cas:serviceResponse>
<cas:authenticationSuccess>
<cas:user>2023123456</cas:user>
...
</cas:authenticationSuccess>
</cas:serviceResponse>

然后：
businessNo = 2023123456
↓
Auth Core 查 User
↓
检查：
user enabled
userType enabled
tenant enabled
Provider audience
↓
completeLogin()
↓
Qualy Session
↓
302 回首页

这里需要对你现在 LoginSessions 做一个小扩展。
现在有：
findIdentity(...)

我建议增加类似：
findDerivedUser({
tenantId,
providerId,
identifier
})

CAS 传入：
identifier = businessNo

由 auth core 完成：
User.businessNo +
Provider audience

的判断。
不要让 auth-cas 自己直接查 users，否则每个 derived driver 都可能绕过统一的 audience 规则。12. CAS Provider 配置甚至可以非常简单
第一版我会只让管理员配置：
名称
CAS 服务器地址
账号来源

其中账号来源如果你的场景固定，可以甚至不用暴露：
cas:user

默认就是学工号。
如果有学校是：
<cas:attributes>
<cas:studentNumber>...</cas:studentNumber>
</cas:attributes>

再允许：
身份字段：
○ CAS 用户名
○ 指定属性：studentNumber

我不建议允许什么：
XPath
JavaScript 表达式
任意转换脚本

复杂度和安全风险远大于收益。
另外 CAS Server URL 和 OAuth issuer 都是后台出网 URL，所以要防 SSRF。至少默认：
只允许 https
拒绝 URL 中的 username/password
拒绝 fragment

是否允许访问 RFC1918 内网地址，应该作为部署方能力，而不是租户随便决定。13. callback URL 千万不要直接相信 Host header 拼
CAS 和 OAuth 都会遇到：
redirect_uri / service

建议 Qualy 有一个可信的：
publicBaseUrl

例如：
https://qualy.example.edu

然后所有 callback 都由它生成。
不要：
`${request.headers.host}/api/auth/...`

否则不仅反向代理环境容易错，还有 Host Header Injection 类问题。
于是：
CAS callback
publicBaseUrl

- /api/auth/cas/{code}/callback

OIDC/OAuth 同理。14. 本地登录我赞成从“用户名 + 密码”改成“邮箱 + 密码”
我认为这对 Qualy 是更合理的最终形态。
你现在本地 identity 是：
UserIdentity

identifier = username
credentialHash = argon2(...)

完全可以直接变成：
identifier = normalizedEmail
credentialHash = argon2(...)

其他模型不用改。
而且这会把几个概念彻底分清：
businessNo
= 学号 / 工号
= 学校业务身份

email
= 本地登录身份 / 恢复渠道

User.id
= Qualy 内部真正 ID

这比：
用户名
学号
邮箱

三个“看起来都像账号”的字段混在一起清楚很多。15. Email 应该放 UserIdentity，不应该放 User，更不要双写
至少以你现在的需求来看，我会明确选择：
User
不加 email

而是：
UserIdentity

provider = local
identifier = user@example.com
credentialHash = ...

因为这里的 email 是：
我用什么凭据进入 Qualy？

这是 Authentication Identity，不是 Person Profile。
所以它就应该属于 UserIdentity。
不要：
users.email
user_identities.identifier

各存一份。
否则迟早出现：
改了 users.email
没改 identity

或者

改了 identity
users.email 还是旧的

然后你不得不发明“谁是真值”。
如果以后 Qualy 真正出现了另外一个业务需求：
我要给这个人发送测评通知，他的联系邮箱是什么？

那再建：
user_contacts

或者 profile field：
email
verifiedAt
source

那是另一件事。
登录邮箱和业务联系邮箱不要因为它们恰好都叫 email 就强制合并。
OAuth 返回的 email 同样不要自动写到 User。16. 但如果变成邮箱密码，就应该把“邮箱验证 + 密码找回”一起设计完整
接 Resend 是合理的，不过不要只做：
忘记密码
→ 输入邮箱
→ 发链接

至少需要：
password_reset_tokens

id
tenant_id
identity_id
token_hash
expires_at
consumed_at
created_at

原始 Token 只发送到邮件里，数据库存：
SHA-256(token)

和 Session Token 一个思路。
找回接口无论账号存不存在都回答类似：
如果该邮箱对应账号，我们已经发送了重置邮件。

避免枚举用户。
重置成功后：
重新 hash 密码 +
注销该用户全部 Qualy Session

这一点也与你现在“替换/撤销 Identity 时结束 Session”的安全语义一致。
还有一个容易遗漏的问题：
只有已经验证过的邮箱才能承担找回密码。

所以最终本地邮箱 identity 可能需要：
verifiedAt

或者由某个可信目录导入时标记为 verified。
第一阶段如果这些邮箱全部由管理员从学校名册导入，而且你明确把目录来源视为可信，也可以先认为是已验证。17. 我不会把邮箱密码强制成所有人的唯一兜底方式
系统恢复账号还是应该特殊考虑。
你现在已经有 system user / recovery channel 相关约束。我不会让系统自举变成：
必须先配 Resend 才能创建管理员。

应该仍然允许部署初始化时：
系统管理员 +
本地邮箱 +
初始密码

直接创建。
邮件系统挂了，也不影响已有密码正常登录。
Resend 是：
验证 / 找回渠道

不是 Qualy Auth 本身的可用性依赖。18. Provider 的“删除”我也建议再斟酌一下
我检查当前源码时，实际上看到的是：
create
update
enable/disable
audience
reorder

我没有看到真正的 deleteAuthProvider。
这一点我反而觉得未必是坏事。
因为现在：
UserIdentity → AuthProvider

又保留撤销后的 identity 历史；
SignInEvent 也会记录 provider。
所以“某个登录方式以前存在过”本身已经成为安全审计历史的一部分。
我更倾向 UI 上以后提供：
删除登录方式

但领域里实际是：
deletedAt +
enabled = false

历史继续保留。
只有：
从未产生绑定
从未产生登录记录

的 Provider 才允许物理删除。
而且已经删除的 Provider code 最好也不要再被另一个完全不同的 Provider 复用，否则：
/auth/oidc/github

在两个历史时期代表不同身份域，会让日志很难解释。19. 还有一个你当前 auth core 需要补的关键能力：Provider runtime config
你现在：
resolveProvider()

主要返回：
tenantId
providerId

local 足够，因为 local 不需要配置。
但 CAS/OIDC 不够。
driver callback 最终需要：
CAS base URL

OIDC issuer
clientId
clientSecret
scopes
...

所以我建议不要让插件自己直接查 AuthProvider 数据库，而是让 auth core 暴露受控的：
resolveProvider(...)
↓
ResolvedProvider {
tenantId
providerId
config
secrets
}

或者分成：
resolveProvider()
providerRuntimeConfig()

都可以。
我更倾向前者，但 config/secrets 必须是 server-only 类型，绝不能进入 browser contract。
这样职责仍然是：
auth core
负责存储、解密、多租户边界

driver
只负责理解这些配置是什么

20. 你的 self binding 还差一个核心操作
    现在 putIdentity() 很明显是为：
    managed

设计的。
OAuth 不能调用它，因为管理员不应该能手动写：
GitHub ID = 123456

所以建议 auth core 再提供：
bindSelfIdentity({
tenantId,
providerId,
userId,
identifier
})

但它不是普通 IAM API，而只给登录 driver 服务端使用。
它统一负责：
Provider 是否 active
Provider audience
User 是否 active
是否已有其他用户占用这个 external subject
该用户在此 Provider 是否已经绑定
审计

这样 OAuth driver 不碰 UserIdentity SQL。
撤销仍然可以走 auth core。21. 还有一个当前多租户实现上的点需要注意
你的数据库模型确实是全面 tenant-scoped 的：
AuthProvider
UserIdentity
User
Session

但是我看当前 sign-in.ts，匿名登录这边还是通过：
AuthConfig.defaultTenantSlug

解析默认租户。
所以目前更准确地说是：
数据模型已经支持多租户登录配置，但匿名登录入口仍然有“默认租户”的假设。

如果 Qualy 最终是：
一套部署 = 一个主要租户

这没问题。
但如果未来真的是：
qualy.example.com/t/a
qualy.example.com/t/b

或者：
a.qualy.com
b.qualy.com

那 CAS/OAuth 开工前最好先定义清楚匿名请求怎样确定 Tenant。
因为 OAuth state、CAS callback、Provider code 查找，全都首先需要知道：
我现在正在登录哪个 Tenant？

这个问题不能靠 callback 时猜。22. 如果由我来落地，我会把整个 Auth 最终整理成这样
这是我认为最适合你当前 Qualy 架构的一套形态：
@qualy/plugin-auth
┌──────────────────────┐
│ AuthProvider │
│ UserIdentity │
│ Session │
│ AuthFlow │
│ secret encryption │
│ audience │
│ audit │
│ completeLogin() │
└─────────┬────────────┘
│
┌─────────────────┼──────────────────┐
│ │ │
▼ ▼ ▼
auth-local-email auth-cas auth-oidc
managed derived self
│ │ │
email + argon2 CAS ticket openid-client
│ │ │
UserIdentity businessNo UserIdentity
│ │ │
└─────────────────┴──────────────────┘
│
User
│
Session

其中新增数据库内容我会尽量控制到：
auth_provider_secrets
auth_flows
password_reset_tokens

UserIdentity 目前的总体结构其实不用重做。
如果以后需要展示 OAuth 账号名称，再考虑给它补一个：
displayLabel

如果本地邮箱需要找回密码，则考虑：
verifiedAt

而不是马上把 identity 表变成一个几十列的万能表。
最后给几个明确的取舍结论
你问的几个问题，我的答案可以压缩成：
问题 我建议
CAS 是否写 UserIdentity 不写，由 businessNo 派生
CAS 是否自己实现 可以，而且我建议自己实现协议客户端
CAS 3.0 验证接口 /p3/serviceValidate
CAS Qualy 路由 /start + /callback?ticket=...
OAuth 是否自己实现 协议层不要自己实现
OAuth 库 优先 openid-client
Generic OAuth 后做，优先 Generic OIDC
Client Secret 放哪里 DB，但应用层加密
Client Secret 放 config JSON 明文 不要
根加密密钥放 DB 不要
OAuth 未绑定怎么办 拒绝登录，引导先用其他方式登录后绑定
OAuth 按 email 自动绑定 不要
GitHub identity durable numeric id，不是 login/email
OIDC identity sub，Provider 固定 issuer
OAuth token 只为登录则用完即丢，不持久化
本地 username/password 我支持改成 email/password
email 放 User 不放
email 放哪 local UserIdentity.identifier
User 和 Identity 双写 email 不要
Resend 用于验证/找回密码，很合适
Provider 删除 用过以后建议软删除/退役，不物理抹掉

这里我认为最值得你在真正写 auth-cas / auth-oidc 前先做的不是协议插件，而是 先把 AuthProvider.config 的 Secret 边界拆出来、补 ResolvedProvider runtime config、findDerivedUser() 和 bindSelfIdentity()。这四件事做完以后，CAS 和 OAuth 都会变成非常薄的 Driver；如果反过来先写协议插件，很容易让 CAS/OAuth 各自开始直接查表、自己存 Secret、自己处理绑定，最后破坏你现在刚建立起来的 auth core 边界。

你再考虑下具体的实现细节。以及如果邮箱就存在identity里，那么以后发通知邮件就用不了这个，以及本地账号只能创建一个实例的，如果就是做邮箱的话是不是应该存在用户表里作为用户信息存在啊，否则太奇怪了，管理员还要思考用户的邮箱和登录的邮箱的区别，用户也觉得很奇怪怎么还会有这种对应关系。

思考了 4m 7s

你这个判断更合理。把“邮箱”放在 UserIdentity 里，前提是邮箱只是某个登录 Provider 的账号标识；但你现在真正想做的是：
邮箱 = 用户的 canonical 邮箱资料 = 通知邮件地址 = 本地账号登录名 = 密码找回地址。

在这个定义下，邮箱就应该属于 User，而且应该只有一份。管理员不应该面对“用户邮箱”和“本地登录邮箱”两个概念，用户也不应该。
而且这个结论会进一步影响我对你目前 managed / self / derived 设计的看法：这三个模式之前看起来很顺，但现在可以发现它把“怎么找到这个用户”和“这个登录方式如何绑定”混成了一件事。我建议趁 CAS/OAuth 还没真正实现，把这层再拆干净。
一、我现在建议的最终模型
我会把三类登录方式定义成这样：
登录方式 外部返回/输入什么 怎么定位 User 是否存在绑定记录 绑定记录里有什么
邮箱密码 email + password User.email 有 password hash
CAS 学工号 User.businessNo 无 无
GitHub/OAuth provider subject Auth Binding 有 GitHub ID / OIDC sub
OIDC sub Auth Binding 有 sub

这意味着两个概念应该正式分开：
User
= “这个人是谁”

AuthBinding
= “这个人和某个登录入口之间有什么认证关系”

所以我甚至建议把现在的：
UserIdentity

重新理解甚至直接改名成：
UserAuthBinding

因为未来本地密码那条记录根本不是真正意义上的 “Identity”。
数据结构可以变成：
users

id
tenant_id
business_no
email
email_verified_at
display_name
user_type_id
primary_org_node_id
...

以及：
user_auth_bindings

id
tenant_id
user_id
auth_provider_id

subject nullable
credential_hash nullable

display_label nullable

bound_at
last_used_at
revoked_at
revoked_by

三种情况分别是：
本地邮箱密码：

subject = null
credential_hash = Argon2id(...)

GitHub：

subject = "18374628" // GitHub durable user ID
credential_hash = null
display_label = "hprogq" // 仅展示，可变

CAS：

根本没有 user_auth_bindings 记录

这样比现在的：
identifier + credentialHash

语义更准确。
如果你不想现在做表改名，也完全可以继续叫 user_identities，但我会至少把：
identifier

改成：
subject nullable

然后接受：
local binding 的 subject 为 null。

否则为了迁就一个字段名去双写邮箱，我认为不值得。
二、User.email 应该怎么设计
我建议直接：
users.email nullable
users.email_verified_at nullable

邮箱不必强制每个用户都有。
因为很可能存在：
CAS-only 学生

他们有：
businessNo
displayName

但还没有邮箱。
只要租户允许 CAS 登录，他们照样可以用。
邮箱一旦存在，统一承担：
用户资料中的邮箱
通知收件地址
本地账号登录名
密码找回地址

这样整个产品的心智模型非常简单：
“你的邮箱就是你的邮箱。”

而不是：
“资料邮箱”和“登录邮箱”可能不同。

我会在租户内对活跃用户做大小写无关唯一约束。
数据库可以直接保存规范化后的 lowercase：
HangQi@Example.com
↓
hangqi@example.com

然后：
unique (tenant_id, email)
where email is not null
and deleted_at is null

我不会像 businessNo 那样让邮箱永久占用。
学号基本可以视作这个人的业务历史身份，所以你现在让删除用户仍占用 businessNo 是有道理的。
邮箱却有可能被学校重新分配，因此：
老用户 deleted
↓
邮箱以后允许被新用户使用

更实际。
恢复老用户时如果邮箱已经被别人占用，就显式提示冲突。
三、本地账号应该彻底变成“邮箱 + 密码”，而且每租户只有一个
这个我现在很赞成。
并且你已经有 AuthProvider.isSystem，其实不需要再设计复杂的 maxInstances。
现在 auth-local 有：
entrance: {
label: ...,
fields: []
}

由于声明了 entrance，当前 Provider 管理页面实际上可以创建多个 local Provider。
我会直接改成：
auth-local 不提供 entrance 创建能力

即：
entrance: undefined

然后创建 Tenant 时由系统 provision：
AuthProvider

type = local
code = local
isSystem = true
enabled = true

永远最多一个。
于是租户管理员：
可以启用
可以停用
可以改显示名称

不能创建第二个
不能改 type/code
不能真正删除

如果完全不想密码登录：
停用即可

它就从登录页消失。
这里我反而不建议真的删除 local Provider，因为它是系统级认证入口，停用表达得已经足够准确。
CAS / OIDC / GitHub 则：
isSystem = false

可以创建任意多个实例。
四、这样以后“设置本地账号”的 UI 也会自然很多
现在你的 generic binding 是：
identifier
password

管理员要给用户创建本地账号时，会填写：
登录名：xxx
密码：xxx

改完以后不应该再这样。
用户基本资料里是：
姓名 郭航旗
人员编号 2023xxxx
邮箱 xxx@xxx.edu.cn

然后“登录方式”里：
邮箱密码

登录邮箱
xxx@xxx.edu.cn
来自用户邮箱

密码
••••••••••
[重置密码]

如果用户没有邮箱：
邮箱密码

尚未设置邮箱
请先在基本资料中填写邮箱，再设置登录密码。

管理员根本不需要再输入一次邮箱。
这样非常符合人的直觉。
五、这也意味着 putIdentity() 应该重新抽象一下
你现在：
putIdentity(
tenantId,
userId,
providerId,
{
identifier,
secret
}
)

这个 API 是“外部账号 ID + secret”捆在一起的。
以后会越来越别扭。
我会让“用户怎么被找到”和“绑定怎么建立”成为两个正交维度。
Driver 大致变成：
subject:
| {
source: 'user-field'
field: 'email' | 'businessNo'
}
| {
source: 'binding'
}

以及：
binding:
| {
mode: 'managed'
secret: ...
}
| {
mode: 'self'
}
| undefined

于是：
local

subject:
user-field / email

binding:
managed / password

CAS

subject:
user-field / businessNo

binding:
none

GitHub

subject:
binding

binding:
self

这比现在的：
managed
self
derived

更加准确。
因为实际上：
derived 并不是一种“绑定方式”。

CAS 压根没有 binding。
它真正表达的是：
CAS 返回的 subject 应该拿 User 的哪个固有字段进行匹配。

同理 local：
用户输入的 email 也是拿 User.email 匹配，只不过验证过程中额外需要一份 password credential。

我认为这是这次重新推导后最值得改的一处领域模型。
六、LoginSessions 我会改成这样
现在核心给 driver 的主要东西是：
resolveProvider()
findIdentity()
completeLogin()

未来我会改成三个更明确的能力。
第一类是根据 User 固有字段找人：
findUserBySubject({
tenantId,
providerId,
subject: {
kind: 'email',
value: 'xxx@example.com'
}
})

或者：
subject: {
kind: 'businessNo',
value: '2023123456'
}

这一步由 auth core 做，而不是 driver 自己查数据库。
原因是 core 还要统一处理：
Provider audience
UserType
User 状态
Tenant

这样：
auth-local
auth-cas

都不会各自重写一次这些规则。
第二类是 Provider binding：
findBinding({
tenantId,
providerId,
subject
})

OAuth 使用。
第三类是：
findUserBinding({
tenantId,
providerId,
userId
})

local 用它取得：
credentialHash

最后全部统一：
completeLogin(...)

这一层保持你现在的设计即可。
七、本地邮箱密码的完整登录流程
例如用户输入：
hangqi@example.com
password

driver：
normalize email
↓
resolveProvider(local)
↓
findUserBySubject(email)

auth core 内部：
users.email = email +
provider audience

找不到：
dummy Argon2 verify
↓
INVALID_CREDENTIALS

找到 User：
findUserBinding(userId, localProvider)

没有 binding 或 credentialHash = null：
dummy Argon2 verify
↓
INVALID_CREDENTIALS

有：
verify Argon2
↓
completeLogin()

这样：
邮箱来自 users.email

密码来自 user_auth_bindings.credential_hash

没有任何重复数据。
八、修改邮箱的行为也得认真定义
因为现在邮箱不仅是资料，也是登录名。
所以：
修改邮箱

已经不是普通 profile edit，而是安全敏感操作。
我建议至少做到：
修改 users.email
↓
废除尚未使用的 password reset token
↓
如果这个用户存在 local credential：
撤销现有 Session

因为如果管理员是因为：
旧邮箱已经不再属于这个人

才给他改邮箱，那么让以前拿到的 session 无限继续存在并不理想。
对于用户本人修改邮箱，我更建议不要直接：
PATCH users.email

而是：
输入新邮箱
↓
向新邮箱发送验证链接
↓
验证成功
↓
真正替换 User.email

也就是说可以有：
email_change_requests

user_id
new_email
token_hash
expires_at
created_at

在验证成功之前：
User.email

仍然是旧值。
否则用户输错：
xxx@gamil.com

马上就把自己新的登录名和找回渠道改错了。
九、emailVerifiedAt 我认为值得有，但不要把它理解成“这个邮箱能不能当用户名”
建议：
email
emailVerifiedAt

本地用户名可以仍然用 email。
verifiedAt 表达的是：
Qualy 是否确认过当前这个地址确实被用户控制。

它主要影响：
密码找回
用户自主修改敏感设置

例如：
管理员导入：
email = student@school.edu
emailVerifiedAt = null

用户仍然可以在管理员已经给他设置密码的情况下：
邮箱 + 密码登录

因为这里 password 已经证明身份。
但：
忘记密码

我会只允许 verified email 使用。
这样如果管理员手滑把邮箱填错了，不会直接给错误地址发送可以接管账号的密码重置链接。
通知邮件倒可以根据产品策略发到未验证邮箱，因为通知邮件本身不授予账号权限。
十、通知邮件就直接读 User.email
这样以后 Notification 模块非常简单：
Notification recipient = userId
↓
users.email
↓
发送

不用知道：
这个用户有没有 local Provider
有没有绑定密码
有没有 OAuth

这就是为什么你刚才提出的问题非常重要。
通知系统和认证系统都需要邮箱，但：
邮箱本身属于 Person。

认证系统只是把它当作某种登录 identifier 使用。
这两个方向应该都是引用 User.email，而不是 Authentication 拥有 email。
以后如果真的产生需求：
登录邮箱和通知邮箱需要分开

再新增：
notificationEmail

也来得及。
现在提前设计两个邮箱，我认为只会制造不必要的产品复杂度。
十一、Resend 也不应该直接写死在 auth-local 里面
既然你已经明确以后通知也要邮件，我会避免：
auth-local
→ import resend

而是抽一层很薄的邮件发送能力：
@qualy/mail-contract

例如：
Mail.send({
to,
template,
variables
})

然后：
@qualy/plugin-mail-resend

实现这个能力。
未来：
auth-local
↓
password reset

notification
↓
通知邮件

email verification
↓

全部使用 Mail

这样以后从 Resend 换成：
SMTP
SES
企业邮件网关

认证模块不用改。
这一层很符合 Qualy 现在的插件化架构，我认为值得做。
十二、OAuth/CAS 的 Provider Secret 还是应该拆出去
这一点我的结论没变化。
目前 auth_providers.config 是 JSON。
我不会放：
clientSecret

进去。
建议：
auth_provider_secrets

tenant_id
provider_id
key

ciphertext
nonce
key_version

created_at
updated_at

比如：
provider = github-1
key = client-secret

配置：
clientId
authorizationUrl
tokenUrl
scope

放：
auth_providers.config

Secret：
auth_provider_secrets

应用主密钥：
QUALY_AUTH_SECRET_KEY

只放服务器环境。
加密使用 AEAD，比如 AES-256-GCM，并把：
tenantId
providerId
secretKey

作为 AAD。
这样数据库 dump 泄漏也不会直接把所有 OAuth Client Secret 带走。
十三、Provider driver 的 prepare() 也应该返回两块
现在类似：
prepare()
→ config

改为：
prepare()
→ {
config,
secrets
}

例如 OIDC：
config

issuer
clientId
scope

secrets

clientSecret

这样从类型层就不允许：
OAuth 插件顺手把 secret 塞进普通 JSON。

编辑页面则返回：
Client ID
abc123

Client Secret
已配置
[输入新值以替换]

永远不要把原 Secret 解密发给浏览器。
十四、OAuth / OIDC 的 runtime config 也不要让 driver 直接查数据库
你现在的 ResolvedProvider：
{
tenantId,
providerId
}

我建议继续保持这种“handle”很薄的形态，而不是直接塞：
config
secrets

防止某次：
console.log(resolvedProvider)

把 Secret 全打出来。
可以给 driver 一个 server-only service：
ProviderRuntime.read(providerId)

返回：
{
config,
secrets: {
clientSecret: Redacted<string>
}
}

你本身就在大量使用 Effect，因此 Secret 值用 Effect 的 Redacted 思路也比较合适。
也就是说：
auth core
负责：
数据库
租户边界
解密

auth-oidc
负责：
理解 issuer/clientId/clientSecret 是什么意思

边界很清楚。
十五、CAS 具体流程我会这么实现
Provider：
大外统一身份认证
type = cas
code = dlufl

config 最初只需要：
serverUrl

例如：
https://cas.example.edu/cas

driver：
subject:
user-field / businessNo

binding:
none

入口：
GET /auth/cas/dlufl/start

我仍然建议不要直接裸跳 CAS，而是先生成一次短期 Auth Transaction。
例如：
auth_transactions

id
tenant_id
provider_id

purpose
session_id nullable
user_id nullable

state_hash

pkce_verifier_encrypted nullable
nonce nullable

return_path

expires_at
consumed_at
created_at

CAS start：
生成随机 flow token
↓
数据库存 SHA256(flow)
↓
service =
https://qualy.xxx/api/auth/cas/dlufl/callback?flow=xxx
↓
302
CAS /login?service=...

CAS 回来：
GET callback
?flow=xxx
&ticket=ST-xxx

Qualy：
原子消费 flow
↓
使用完全一致的 service
↓
服务端请求：
/p3/serviceValidate
↓
解析 XML
↓
拿到 cas:user
↓
findUserBySubject({
kind: businessNo,
value: casUser
})
↓
completeLogin

CAS ticket 不进入数据库，不进入日志。
callback 的 query string 尤其要检查你当前 Access Log 有没有记录；OAuth 的：
code
state

CAS 的：
ticket

都不应该进日志正文。
十六、CAS 为什么也要 AuthTransaction
CAS 本身的 ticket 已经绑定 service，确实比普通 OAuth 简单很多。
但 AuthTransaction 仍然可以解决：
登录完成后回哪个页面
这个跳转是否由 Qualy 自己发起
防止 callback 被无限重放
以后 bind/login 两种 intent
一次性消费

而且 OAuth 本来就需要它，所以两边共用一个模型更舒服。
CAS 的 flow 直接进入 service URL，所以验证时再次发送的 service 也会包含这个 flow。
十七、OAuth 绑定流程
OAuth 我会做成两种 intent：
login
bind

登录：
GET /auth/oauth/github/start
↓
AuthTransaction(intent=login)
↓
provider authorization
↓
callback
↓
取得 stable external subject

例如 GitHub：
subject = GitHub numeric user id

查：
user_auth_bindings

provider_id = github
subject = xxx
revoked_at IS NULL

找到：
completeLogin

没找到：
不自动创建
不按照 email 匹配

显示：
此 GitHub 账号尚未绑定 Qualy 账号，请先使用其他方式登录后绑定。

绑定：
当前已登录 User
↓
点击“绑定 GitHub”
↓
AuthTransaction(
intent = bind,
userId,
sessionId
)
↓
GitHub
↓
callback
↓
检查 callback 时仍是同一个 Session
↓
检查 subject 没有绑定给别人
↓
INSERT user_auth_bindings

这里 sessionId 必须钉住。
不能只是：
flow.userId = 123

然后 callback 无登录状态也照样绑定，否则拿到 flow token 的人就可能替别人完成绑定。
十八、OAuth 未绑定后的 UX，我建议最终做成“登录后确认绑定”
第一版完全可以：
GitHub 登录
→ 未绑定
→ 提示先用 CAS/邮箱登录
→ 登录成功
→ 用户再点一次“绑定 GitHub”

简单、明确、安全。
以后如果你嫌第二次 OAuth 很烦，可以做：
GitHub 已证明成功
↓
产生 PendingExternalBinding，10 分钟
↓
用户用 CAS / 邮箱登录
↓
提示：

已验证 GitHub @hprogq
是否绑定到当前 Qualy 账号？

[绑定]

这样 GitHub OAuth 不用走第二遍。
但这是体验优化，我不会第一版就做。
十九、OAuth 库我也修正一下上一条的说法
截至现在，openid-client v6 本身已经提供 OAuth 2.0 Authorization Code Grant、Authorization Server Metadata 等能力，并不局限于“只有 OIDC discovery”。GitHub
因此我会：
OIDC → openid-client

普通标准 OAuth2 → openid-client / 它底层的 oauth4webapi

GitHub identity profile → 交换 token 后自己调用 GitHub /user

不会用 Auth.js / Passport 接管 Qualy。
另外现在不建议选 Arctic：它的 npm 包在 2026 年已经被标记 deprecated。NPM
二十、Generic OAuth 我依然建议晚一点做
真正的 Generic OAuth 最麻烦的并不是：
authorization URL
token URL

而是：
“拿到 access token 后，到底去哪里、从什么字段确定这个人的永久身份？”

GitHub 是：
GET /user
id

另外一家可能：
GET /userinfo
user_id

再另外一家可能：
/me
data.account.id

因此第一批我更倾向：
auth-local
auth-cas
auth-oidc
auth-github

它们已经覆盖绝大多数真实情况。
以后 Generic OAuth 再提供：
authorizationEndpoint
tokenEndpoint
profileEndpoint
subjectField
scopes

subjectField 最多允许：
JSON Pointer

或者明确的字段路径。
不要允许管理员输入：
JavaScript
JSONPath expression with functions
模板脚本

否则一个登录插件就慢慢变成脚本执行器了。
二十一、这次我认为应该真正改动的核心设计
结合你刚提出的邮箱问题，我会在写 CAS/OAuth 前先把认证核心整理到下面这个状态：
User
┌──────────────┼──────────────┐
│ │ │
businessNo email displayName
│ │
│ │
CAS Local password
│ │
│ UserAuthBinding
│ credentialHash
│
│
└─────── User ───────── OAuth
│
UserAuthBinding
subject

一句话就是：
businessNo 和 email 都是 User 的属性；CAS 和本地登录分别拿这两个属性定位用户；OAuth/OIDC 才用 Binding 中的外部 subject 定位用户。

这套模型我认为比“所有能登录的东西都强行塞进 UserIdentity.identifier”干净得多。
而且它会直接让你以后的用户详情页非常自然：
基本资料

姓名
郭航旗

人员编号
2023xxxx

邮箱
xxx@example.com
已验证

登录方式

邮箱密码 已设置
大外统一认证 使用人员编号登录，无需绑定
GitHub @hprogq · 已绑定
Microsoft 未绑定

管理员和用户都不需要知道什么“资料邮箱”和“Identity 邮箱”，系统内部也没有双写。
如果现在让我在 Qualy 当前代码上正式拍板，我会选择这套，并且我认为应该先重构 IdentityBinding 的领域定义，再写 auth-cas 和 auth-oauth。现在改的影响范围还主要集中在 auth；等 CAS、GitHub、OIDC 都落地之后再发现 derived 和 managed 混了“查人方式”和“绑定方式”，改起来会明显更痛。

用户被删除后，邮箱可以继续释放给其他人使用，那万一用户后来被恢复，邮箱不就冲突了吗？还是说，既然用户都已经被删除了，软删除不代表非要提供恢复功能啊，软删除就让用户从系统内完全看不到不行吗，这样记录和外键由于软删除都能留下，不涉及到恢复功能，那么学工号、邮箱也都可以重复了。及Github支持OIDC吗，还是说必须自己写一个插件？以及mail是否要做成和storage一样的通用能力，未来可以做mail-smtp、mail-resend、mail-XXX等其他插件。以及如果有的cas/oauth返回临时token（可能会过期，需要定时刷新），能否给予一个能力，可以让登录方式在session内存储token信息等（或存在），这个功能保留相关的接口/拓展能力就行，目前不用做？

思考了 1m 41s

我重新把这几个问题放到同一套生命周期里推了一遍。现在我会把 Qualy 的认证数据明确分成四层：
User 人本身：businessNo / email / displayName
AuthProvider 登录入口：CAS / GitHub / OIDC / local
UserAuthBinding 用户与外部入口的绑定：GitHub user id / OIDC sub / 本地密码摘要
SessionAuthGrant 某次登录会话临时获得的外部凭据：access token / refresh token
再单独把 Mail 做成基础设施能力。这样每一类数据的生命周期都非常清楚。

1. 我赞成“软删除但绝不恢复”
   这实际上比现在 Qualy 的设计更简单。
   当前源码里的 User 明显把 soft delete 同时理解成了“历史保留 + 可恢复”：businessNo 连 deleted row 都永久占用，users.ts 还有 restore 逻辑和 UserRestored 审计动作。这个约束的复杂度主要就是为了支持恢复。
   但 soft delete 完全不意味着产品必须提供恢复。
   我更建议定义：
   删除是不可逆的业务动作；soft delete 只是数据库实现手段，用于保留 FK、审计历史和历史记录。

于是用户删除以后：
用户列表：彻底看不到
用户搜索：搜不到
People Picker：搜不到
权限系统：不存在
登录：不允许
通知：不发送
管理员：不能恢复
数据库里那一行依然存在：
deleted_at = ...
enabled = false
只是除了审计、历史记录解析等极少数内部路径，所有查询都必须带：
deleted_at is null
这样 businessNo 和 email 的唯一约束都可以改成：
create unique index uq_users_tenant_business_no_live
on users (tenant_id, business_no)
where deleted_at is null and business_no is not null;
create unique index uq_users_tenant_email_live
on users (tenant_id, email)
where deleted_at is null and email is not null;
于是：
旧 User A
businessNo = 20230001
email = a@school.edu
deletedAt = 2026-09-22

新 User B
businessNo = 20230001
email = a@school.edu
deletedAt = null
完全合法。
这里不会产生历史歧义，因为历史记录应该永远引用：
userId
而不是重新通过：
businessNo/email → User
解析历史人物。
这点非常关键。businessNo 是当前业务标识，userId 才是历史实体标识。
所以以后同一个学生退学被删除，两年后重新导入，即使现实世界中是同一个人，在 Qualy 的领域模型里也是：
旧生命周期 User A
新生命周期 User B
旧综测、旧授权、旧审计继续指向 A；新的数据全部指向 B。不会串历史。
我认为这个语义是可以接受的，而且比“复活原 User，然后判断他过去十年的哪些东西应该一起复活”稳得多。
删除事务我会统一做：
User.deletedAt = now
User.enabled = false

→ revoke 所有 UserAuthBinding
→ 删除所有 Session
→ 失效 password-reset / email-change / auth-flow
→ 撤销当前角色授权（按你现有删除用户规则）
其中 GitHub/OIDC binding 由于 revokedAt 被设置，外部 subject 也自动释放给未来的新 User。你现在 user_identities 的唯一索引本来就是只约束 revoked_at is null，这一点已经很适合这种语义。
至于 deleted row 里的旧 email/businessNo，我第一阶段会继续保留用于审计可读性；如果以后有隐私清除需求，再增加“删除 N 天后脱敏”，那是另一个生命周期问题。
结论上，我会把现有的：
删除
恢复
改成只有：
删除
并移除 restore API、restore UI、UserRestored、为恢复设计的冲突逻辑。soft delete 只是墓碑，不是回收站。2. GitHub 不能直接用你未来的通用 OIDC 插件
GitHub 确实有 OIDC，但这里非常容易误解。
GitHub Actions 有一个 OIDC Provider，用来让 workflow 向 AWS/Azure/GCP 等云平台证明“我是某个 GitHub Actions workflow”。它不是让普通用户点“使用 GitHub 登录”时给第三方网站发 OIDC ID Token 的用户认证服务。GitHub Docs
GitHub Enterprise Managed Users 也支持 OIDC，但方向同样不是：
GitHub → Qualy
而是：
Microsoft Entra ID
↓ OIDC
GitHub Enterprise
也就是 GitHub 自己作为 relying party 使用企业 IdP。GitHub Docs
普通“使用 GitHub 登录 Qualy”仍然应该走 GitHub OAuth 2.0 Web Application Flow：
Qualy
→ github.com/login/oauth/authorize
→ callback
→ exchange access token
→ GitHub /user
→ durable GitHub user id
GitHub 官方目前也明确说明 OAuth Apps 和 GitHub Apps 都使用 OAuth 2.0，并支持 Web Application Flow；官方现在更推荐新集成优先考虑 GitHub App。GitHub Docs
所以架构上我建议：
@qualy/plugin-auth-oidc
通用标准 OIDC

@qualy/plugin-auth-github
GitHub OAuth
不过 auth-github 没必要自己从 HTTP 细节开始重复造轮子。
可以再有一个不属于插件的内部库：
@qualy/auth-oauth2
负责公共协议部分：
state
PKCE
authorization-code exchange
token response parsing
OAuth error handling
然后：
auth-github
↓
@qualy/auth-oauth2
↓
GitHub-specific:
authorization endpoint
token endpoint
/user
user.id
以后：
auth-wechat
auth-feishu
auth-generic-oauth
也可以复用。
而：
auth-oidc
因为身份模型已经标准化：
issuer + sub
所以可以独立使用 openid-client。
我反而不建议一开始做一个巨大：
auth-oauth
然后让管理员填写：
用户信息 URL
JSONPath
ID 字段
昵称字段
各种奇怪参数
GitHub 这种常见 Provider 做成十几二十行 provider adapter，维护成本远小于把 UI 做成 OAuth 调试器。3. GitHub 登录只为了认证时，Access Token 不应该保存
流程应该是：
GitHub callback
↓
换 access_token
↓
GET /user
↓
取得 GitHub numeric id
↓
找到 UserAuthBinding
↓
completeLogin()
↓
access_token 丢弃
如果只是：
使用 GitHub 证明你是谁。

Access Token 完成任务以后就没有存在价值。
这会让你的系统安全面小很多。
但你后面提出的情况确实值得提前保留扩展能力：
某个 OAuth / CAS 类协议返回了临时凭据，并且插件在 Qualy Session 生命周期内还需要继续访问上游系统。

这个应该支持，但是要作为完全独立的一层。4. 不要把外部 token 塞进 sessions 表
我不建议：
sessions

id
user_id
token_hash
...
provider_token_json
因为 Auth Core 马上会开始知道：
accessToken
refreshToken
expiresIn
refreshTokenExpiresIn
idToken
然后每加一种协议就继续长字段。
也不要塞进：
UserAuthBinding
因为 OAuth binding 的生命周期是：
GitHub ID ↔ Qualy User
而 Access Token 的生命周期可能只有：
这一个 Qualy Session
它们不是一个东西。
最终应该清楚分成：
数据 生命周期
auth_provider_secrets.clientSecret Provider 生命周期
user_auth_bindings.subject 用户绑定生命周期
session_auth_grants.accessToken Qualy Session 生命周期

后者未来如果真正出现需求，我会建：
session_auth_grants

tenant_id
session_id
provider_id

state_ciphertext
expires_at
updated_at
version
唯一约束：
(session_id, provider_id)
并：
FK session_id → sessions
ON DELETE CASCADE
里面的 state_ciphertext 是一个整体加密的 opaque payload。
例如 GitHub driver 自己知道里面其实是：
accessToken
refreshToken
accessTokenExpiresAt
refreshTokenExpiresAt
scope
tokenType
Auth Core 完全不知道。
另一个 OAuth driver 里面可以是完全不同的结构。
Auth Core 只负责：
加密
保存
按照 Session 生命周期删除
租户隔离
Driver 负责：
解释
使用
刷新
这和我们刚才说的 auth_provider_secrets 非常类似。5. 现在不用实现 session_auth_grants，但我建议留一个正确的接口缝
目前你的：
completeLogin(...)
直接：
创建 Session
set cookie
返回 SignedInUser
我会稍微调整内部 server contract，使它以后可以自然加入 session state。
比较好的最终形态是概念上：
completeLogin({
tenantId,
providerId,
userId,
identityId,

sessionGrant?: ...
})
其中：
sessionGrant
以后才真正实现。
但现在甚至不用把 sessionGrant 类型提前设计出来。
我只会先确保 completeLogin 的 API 是：
Driver 把“认证结果”交给 Core，Core 创建 Session。

而不是让 driver 自己 insert Session。
以后第一次真正需要保存 OAuth Token 时，加一个 optional field 不会破坏现有 driver。
也可以让它返回一个 server-only：
{
user,
session: {
id
}
}
而 API handler 最后仍然只返回：
user
这样 driver 将来也有明确的 Session Handle。
不过，如果将来真要保证：
Session 创建 +
session_auth_grant 保存
原子提交，我还是更推荐把 grant 作为 completeLogin() 的输入，由 Core 在同一 transaction 中落库，而不是 driver 在 Session 创建后再单独写。6. Token 刷新不要设计成“每个 Session 一个定时器”
这个提前定原则很重要。
不要：
setInterval(() => refreshToken(), ...)
更不要一个 Session 起一个 timer。
因为：
服务重启
多实例部署
Session 数量多
token rotation
并发请求
都会把这种方案搞得很麻烦。
应该做：
driver.getValidGrant(sessionId)
↓
读取 encrypted state
↓
access token 还有足够有效期
→ 直接返回

快过期 / 已过期
→ 对该 grant 加锁
→ refresh
→ 原子替换 accessToken + refreshToken + expiresAt
→ 返回
也就是 lazy refresh / refresh-on-demand。
只有未来出现：
即使用户没有请求，Qualy 也必须持续代表用户后台调用第三方 API。

这时再交给 queue / scheduled job 主动 refresh。
普通登录场景根本不需要定时刷新。
而且 GitHub 官方现在确实支持会过期的 OAuth access token + refresh token；文档给出的一个模式是 access token 8 小时、refresh token 长期一些，并提供 refresh flow。GitHub Docs
所以现在把生命周期边界设计好是有价值的。7. CAS ticket 则不要进入这个机制
普通 CAS：
ST-xxxx
是认证用的一次性 Service Ticket。
流程：
Qualy callback 收到 ticket
↓
/p3/serviceValidate
↓
CAS 确认成功
↓
获得 businessNo
↓
ticket 生命周期结束
验证完直接丢。
它不是：
OAuth access token
所以不要为了抽象统一而把 CAS ticket 也存进 session_auth_grants。
以后如果你真的碰到 CAS Proxy Ticket / PGT 之类“验证完成后还要代表用户访问另外的 CAS Service”的高级场景，再让 CAS driver 使用 session grant 能力即可。
但最开始的学校 CAS 登录完全没必要。8. Mail 我认为应该正式做成和 Storage 同级的通用基础设施
这个我非常赞成，而且看了你现在 storage 的结构以后，我认为直接沿用它的思想最一致。
现在已经是：
@qualy/plugin-storage
核心能力

@qualy/plugin-storage-local
@qualy/plugin-storage-cos
backend
Mail 可以是：
@qualy/plugin-mail

@qualy/plugin-mail-smtp
@qualy/plugin-mail-resend
@qualy/plugin-mail-ses
甚至以后：
@qualy/plugin-mail-tencent
@qualy/plugin-mail-sendgrid
业务插件只依赖：
@qualy/plugin-mail
所以：
auth-local
忘记密码
邮箱验证

notification
系统通知

assessment
批次通知

audit
某些安全通知
都不会知道 Resend 是什么。
这非常符合 Qualy 现在的 plugin graph。9. Mail Core 我会比 Storage 更薄一点
Storage 有：
reservation
quota
object lifecycle
upload backend
Mail 不需要照抄这么重。
第一阶段核心接口差不多只需要：
Mail.send({
to,
subject,
text,
html,
replyTo?,
})
真正的 Backend contract：
interface MailBackend {
send(message): Effect<{
providerMessageId?: string
}, MailDeliveryError>
}
Core 负责：
选择 backend
统一错误
metrics
日志脱敏
Backend 负责：
SMTP protocol
Resend API
SES API
我甚至建议第一阶段：
一个部署只选一个 default mail backend。

和现在 storage 的 defaultBackend 类似。
不要一开始做：
租户 A Resend
租户 B SMTP
某种邮件走 SES
没有真实需求先别引入这个复杂度。10. Mail 的 Secret 和 OAuth Provider Secret 又不完全一样
这里我会区别处理。
CAS/OAuth Provider 是：
租户管理员动态创建的实例。

所以：
clientSecret
需要动态存储，适合：
auth_provider_secrets
加密入数据库。
Mail backend 更像 COS：
部署基础设施。

所以例如：
RESEND_API_KEY
SMTP_PASSWORD
AWS_ACCESS_KEY
我更倾向跟你现在 COS Secret 一样：
deployment env / secret manager
而不是数据库。
例如：
QUALY_MAIL_DEFAULT_BACKEND=resend
QUALY_MAIL_RESEND_API_KEY=...
等未来真的需要“每租户自己的 SMTP”时，再加 DB-backed mail instance。11. 通知模板不应该放在 mail-resend 里
也不要：
Mail.sendPasswordReset()
Mail.sendAssessmentNotice()
否则 mail core 开始知道业务。
应该：
auth
↓
生成：
subject
text/html
↓
Mail.send()
assessment
↓
生成：
subject
text/html
↓
Mail.send()
Resend backend 看到的就只是一封邮件。
因此：
业务语义 / i18n / 模板
属于调用方

传输
属于 mail
这条边界和 Storage 非常相似：
Assessment 知道“这是证明材料”
Storage 只知道“这是一组 bytes” 12. 最后我会把整体表关系定成这样
users
────────────────────
id
tenant_id
business_no
email
email_verified_at
display_name
...
deleted_at

        │
        │
        ├──────────────────────────┐
        │                          │
        ▼                          ▼

user_auth_bindings sessions
───────────────── ─────────────
user_id user_id
provider_id token_hash
subject? expires_at
credential_hash? │
revoked_at │
▼
session_auth_grants
───────────────────
session_id
provider_id
encrypted_state
expires_at

auth_providers
─────────────────
type
code
config

        │
        ▼

auth_provider_secrets
─────────────────────
provider_id
key
ciphertext
然后四种典型认证：
Email/password
User.email +
UserAuthBinding.credentialHash
CAS
User.businessNo
无 binding
无 grant
GitHub 登录
UserAuthBinding.subject = GitHub numeric ID
grant 默认不保存
未来某 OAuth 集成需要调用上游 API
UserAuthBinding.subject = external subject +
SessionAuthGrant = encrypted access/refresh token
我认为这已经是一套比较稳定的长期模型了。
其中我现在真正会立刻实现的是：删除用户改成不可恢复的墓碑语义、email 进入 User、local 单实例、CAS + GitHub/OIDC 的 Provider/Binding 边界、Mail backend abstraction、Provider Secret 加密存储。
session_auth_grants 则只把位置和接口方向在设计文档里明确下来，暂时不要建表、不要写 refresh scheduler。等第一个真正需要“登录后继续调用第三方 API”的插件出现，再实现这一层，避免为了假想需求提前养一套 token 生命周期系统。

其实现在我觉得有点别扭，对于storage这种现在是纯粹的环境变量/yml配置，没有提供动态可变的配置功能，但是登录方式的配置却提供了相关的配置接口，密钥放在了数据库而不是.env，我觉得怪怪的。你认为登录方式这种是否不应该做成现在这样呢，你有什么见解。

我觉得你现在感到“别扭”，根源不是“Secret 到底该放 .env 还是数据库”，而是 Qualy 现在其实混着两种完全不同的配置层级：

- storage-local / storage-cos 是部署级基础设施：由部署 Qualy 的运维者决定，一套进程通常只有少数几个后端。
- CAS / OAuth / OIDC 登录方式 如果允许每个租户自行增删，那就是租户级业务配置：由租户管理员决定，而且一个租户可以有多套实例。
  所以二者不完全对称。Storage 用 YAML/env、Auth Provider 用数据库，并不天然矛盾。
  但我确实建议你把现在的 Auth Provider 再重新分层，否则以后会越来越像“数据库里塞了一坨运行时配置”。
  我会采用一个明确的“三层模型”。
  第一层是“这个部署安装了哪些认证能力”，完全静态：
  qualy.yml

@qualy/plugin-auth-local
@qualy/plugin-auth-cas
@qualy/plugin-auth-oidc
@qualy/plugin-auth-github
这一层和：
storage-local
storage-cos
完全一样。
没有安装 auth-github，数据库里即使以前存在 GitHub Provider，也不能工作。
也就是说：
Plugin / Driver 是部署能力。

第二层才是数据库中的：
AuthProvider
它表达的是：
某个租户实际启用了哪一套身份认证服务。

例如：
租户：大连外国语大学

本地邮箱密码
大外 CAS
GitHub
Microsoft 365
另一个租户可能是：
本地邮箱密码
Google Workspace
学校 OIDC
这种东西我认为必须动态放数据库，否则你所谓的“租户可以自己添加登录方式”实际上根本做不到。
如果改成 YAML：
auth:
providers: - type: oidc
issuer: ...
那么租户管理员点一下“增加 Microsoft 登录”就会变成：
联系服务器管理员
→ 修改 qualy.yml
→ 修改 .env
→ 重启 Qualy
这就已经不是一个多租户产品功能，而是部署配置了。
所以如果你的产品目标仍然是：
每个租户自己管理自己的登录方式

那 AuthProvider 动态化我认为应该保留。
真正值得修改的是第三层：Secret。
我不太喜欢让：
auth_providers.config JSON
同时承担：
issuer
clientId
clientSecret
scope
authorizationEndpoint
...
这里应该严格拆开。
我会把整个配置体系定义成：
Driver 部署时静态安装
Provider 租户运行时配置
Secret 独立的 Secret 能力
例如：
AuthProvider

type = oidc
code = microsoft
name = Microsoft 365

config:
issuer
clientId
scope
而：
clientSecret
不能进入 config。
然后这里其实有两种实现路线。
第一种是你之前说的：
auth_provider_secrets
数据库加密保存。
这个并不是什么奇怪或者不正规的做法。只要一个系统允许用户在 Web UI 中动态配置：
OAuth Client Secret
SMTP Password
Webhook Secret
API Key
这些 Secret 就不可能全部只依赖 .env，因为 .env 是进程级静态配置。
真正的问题不是：
Secret 能不能进数据库？

而是：
Secret 是否以明文进入普通业务配置数据库？

明文当然不应该。
因此至少应该是：
数据库
↓
ciphertext

服务器
↓
master encryption key
Master Key 才在 .env：
QUALY_SECRETS_MASTER_KEY=...
这在概念上和 password hash 不一样：

- password：以后不需要拿回原文，所以 hash；
- OAuth client secret：以后还得拿去 token endpoint，所以必须可解密。
  不过我觉得你可以再往前走一步，不要做一个仅供 Auth 使用的：
  auth_provider_secrets
  而是给 Qualy 建一个非常小的、通用的 Secret 基础设施。
  例如：
  @qualy/plugin-secrets
  它只提供：
  Secret.create(...)
  Secret.replace(...)
  Secret.read(...)
  Secret.delete(...)
  数据库：
  secrets

id
tenant_id nullable
owner_type
owner_id
key
ciphertext
key_version
created_at
updated_at
加密主密钥：
QUALY_SECRETS_MASTER_KEY
然后：
auth-oidc
→ Secret

未来 tenant SMTP
→ Secret

未来 webhook
→ Secret

未来第三方 API integration
→ Secret
这样我觉得整个架构会比：
OAuth secret 有一套
mail secret 有一套
webhook secret 又有一套
漂亮很多。
但这里我要特别区分你刚才举的 Storage。
当前：
storage-cos
我仍然不会马上迁移到这个 Secret 系统。
因为现在 COS 是：
deployment infrastructure。

所以：
QUALY_STORAGE_COS_SECRET_ID
QUALY_STORAGE_COS_SECRET_KEY
留在 env 非常合理。
只有未来如果你做：
租户 A 使用自己的 COS
租户 B 使用自己的 S3
租户管理员可以从 Web 添加存储后端

那 Storage 才应该演化成：
StorageBackendInstance +
Secret

数据库动态配置。
所以真正应该保持一致的不是：
所有模块的配置必须都存在同一个地方。

而是：
相同生命周期和相同管理主体的配置，采用相同机制。

我会这样划：
配置 谁管理 生命周期 放哪里
PostgreSQL URL 部署者 Process env
Redis URL 部署者 Process env
COS Secret 部署者 Deployment env
默认 Storage Backend 部署者 Deployment yml/env
安装哪些 Auth Driver 部署者 Deployment yml
租户的一套 CAS 租户管理员 Tenant DB
租户的一套 OIDC 租户管理员 Tenant DB
OIDC Client Secret 租户管理员提供、服务器使用 Tenant encrypted Secret store
GitHub Client Secret 同上 Tenant encrypted Secret store
用户密码 用户级 User password hash
OAuth access token Session/User integration Session encrypted runtime grant

这样其实非常整齐。
还有一个我现在会修改的地方：不要让所有 Login Driver 都自动获得“可动态创建 Provider”的能力。
你当前的：
driver.entrance
大概是：
声明了 entrance 就允许管理员添加实例。

我会把这一层再明确一点，比如：
provisioning:
| { mode: 'system-singleton' }
| { mode: 'tenant-managed'; config: ... }
| { mode: 'deployment-managed' }
这样：
local
→ system-singleton
Tenant 创建时自动生成一个：
local
租户只能启用/停用。
cas
→ tenant-managed
允许创建：
大外 CAS
研究生院 CAS
oidc
→ tenant-managed
允许多个。
甚至以后某个企业版插件可以：
corporate-sso
→ deployment-managed
只能在 YAML 中配置，租户 UI 不允许创建。
这样就不会出现：
因为 AuthProvider 表支持动态配置，所以所有登录 Driver 理论上都必须允许租户动态配置

这种错误推导。
我会把这作为一个很重要的领域属性。
另外还有一个选择你可以考虑：允许 Provider 的配置来源有两种。
例如：
source = tenant
source = deployment
租户配置：
source = tenant

config → DB
secret → Secret store
部署配置：
source = deployment

config → qualy.yml
secret → env

例如某个学校部署 Qualy 时就可以直接：
auth:
providers:
dlufl-cas:
type: cas
serverUrl: ...

然后这一条在 UI 中显示：
大外统一身份认证
由系统管理员配置

不可修改或删除。
与此同时租户还能另外添加：
GitHub
Microsoft

这其实是最完整的设计。
但我不建议第一阶段就做双来源。
因为你现在最大的真实需求还是：
租户可添加 CAS/OAuth
直接把 Tenant-managed Provider 做好即可。
我现在对 Qualy 的具体建议会变成：
qualy.yml
─────────────────────────
装了哪些 driver
基础设施配置
部署级 secret

Database
─────────────────────────
AuthProvider
租户选择了哪些登录方式
非敏感 provider config

Secret Store
─────────────────────────
OAuth clientSecret
OIDC clientSecret
未来其他动态 Secret

User / Binding
─────────────────────────
email/businessNo
password hash
GitHub/OIDC subject

Session Grant
─────────────────────────
未来需要的话保存 OAuth token
这比简单追求：
“Storage 用 env，所以 Auth 也必须用 env”
或者反过来：
“Auth 用数据库，所以 Storage 也应该数据库配置”
都更合理。
还有一点我会明确反对：不要把每个租户 OAuth Client Secret 映射成动态环境变量。
例如：
QUALY_TENANT_123_GITHUB_SECRET
QUALY_TENANT_456_GITHUB_SECRET

这种设计很快就失控：

- 租户创建 Provider 后必须重启；
- 删除 Provider 要清 env；
- Secret rotation 依赖运维；
- 容器部署需要重新发布；
- 多租户数量变化无法自然表达。
  所以只要接受：
  Tenant Admin 可以动态创建 OAuth Provider

就基本必然意味着：
Qualy 需要一个 runtime secret persistence mechanism。

因此我认为你现在真正要决定的不是“登录方式要不要动态配置”，而是一个更上层的问题：
Qualy 到底要不要把身份源管理作为租户管理员的产品能力？
以你现在的多租户架构、AuthProvider audience、排序、动态 Driver UI 都已经做到这个程度来看，我会继续保留这个能力。否则你当前很多 AuthProvider 管理代码实际上都会变成过度设计。
我会做的调整不是退回 YAML，而是把现在：
AuthProvider.config = 一切
收紧为：
Driver installation 静态
Provider instance 动态
Provider public config DB
Provider secret Secret service
这样整个边界会自然很多，也不会再给人一种“为什么 COS Secret 很正规地在 env，OAuth Secret 却随手塞 JSON 数据库”的违和感。

你再考虑下内部的实现细节等，然后给我一个完整的开发设计方案。

# Qualy 多租户认证体系开发设计

## 1. 最终架构结论

Qualy 的认证体系建议明确分为五个层级：

| 层级               | 代表内容                          | 配置主体                   | 存储位置               |
| ------------------ | --------------------------------- | -------------------------- | ---------------------- |
| Driver 能力        | local、CAS、OIDC、GitHub          | 部署者                     | `qualy.yml` / 插件装配 |
| Provider 实例      | “大外 CAS”“Microsoft 365”“GitHub” | 租户管理员                 | Database               |
| Provider Secret    | clientSecret 等                   | 租户管理员提供、服务器使用 | 加密 Secret Store      |
| User / AuthBinding | 邮箱、学工号、密码摘要、GitHub ID | IAM / 用户                 | Database               |
| Session Grant      | OAuth access/refresh token        | 登录协议运行时             | 未来按需加密存储       |

核心原则是：

```text
Plugin 决定“这套 Qualy 会不会这种登录协议”
Provider 决定“这个租户实际配置了哪一套登录入口”
User 决定“这个人本身是谁”
AuthBinding 决定“这个人和某个入口之间有什么认证关系”
Session 决定“这一次登录以后是谁”
```

Storage 和 Auth Provider 因而不需要强行采用同一种配置模型。

`storage-cos` 是 deployment-managed infrastructure，所以 YAML/env 正确。

CAS/OIDC/GitHub Provider 是 tenant-managed product configuration，所以动态存在数据库正确。

真正需要解决的是：

> 租户动态 Secret 不应该混进普通 `auth_providers.config` JSON。

为此增加通用 `Secrets` 能力。

---

# 2. 用户生命周期重新定案：删除是终态

当前 `auth` 中 `deletedAt` 同时承担了“历史保留”和“将来可恢复”的语义，这导致了：

```text
businessNo 永久占用
deleted 用户仍需要查询
restore permission
restore API
restore placement
restore userType
恢复冲突
```

建议全部删除“恢复用户”这个产品概念。

今后的定义：

> 用户删除是不可逆业务操作；soft delete 只是数据库墓碑，用于外键、历史和审计。

数据库仍保留：

```text
users.id
users.display_name
users.business_no
users.email
users.deleted_at
```

但正常业务查询一律：

```sql
deleted_at is null
```

删除用户不会出现在：

```text
用户列表
用户搜索
人员选择器
用户详情
组织成员
登录
通知收件人
角色授权
```

历史记录仍引用原来的 `user_id`。

例如：

```text
2026：
User A
id = A
businessNo = 20230001

删除 A

2028：
重新导入 businessNo = 20230001
→ User B
id = B
```

旧综测：

```text
participant.user_id = A
```

新综测：

```text
participant.user_id = B
```

不会串历史。

因此唯一索引全部改成只约束 live user：

```sql
create unique index uq_users_tenant_business_no_live
on users (tenant_id, business_no)
where deleted_at is null and business_no is not null;
```

以及：

```sql
create unique index uq_users_tenant_email_live
on users (tenant_id, email)
where deleted_at is null and email is not null;
```

删除以后，两者都释放。

### 用户 API

当前：

```text
PUT /iam/users/:userId/status

active
disabled
deleted
deleted -> disabled restore
```

建议改成：

```text
PUT /iam/users/:userId/status

active
disabled
```

然后新增真正符合资源语义的：

```text
DELETE /iam/users/:userId?version=...
```

删除可以直接从 active 执行，不要求管理员先手动停用。

服务器在一个 transaction 中：

```text
检查权限
检查非 system account
检查不会删除最后管理员

撤销全部 role grants
撤销全部 auth bindings
结束全部 sessions
失效尚未完成的 auth flows
mark deleted
audit
```

然后提交。

当前以下东西全部删除：

```text
auth.user.restore permission
UserRestored audit action
markUserRestored()
恢复相关 UI
status=deleted 的用户列表入口
restore 相关测试
```

Audit Trail 自己已经保存 target label 和 userId，所以没有必要为了查看审计重新暴露 deleted User。

如果其他历史页面引用一个已删除用户，应显示：

```text
郭航旗
已删除
```

或者：

```text
已删除用户
```

而不是重新开放用户详情 API。

---

# 3. User 增加 canonical email

`users` 修改为：

```text
users

id
tenant_id

business_no nullable
email nullable
email_verified_at nullable

display_name
user_type_id
primary_org_node_id

enabled
deleted_at
version
...
```

其中：

```text
businessNo
= 机构业务编号 / 学号 / 工号

email
= 用户邮箱
= 通知邮箱
= 本地密码登录用户名
= 密码找回地址

id
= Qualy 永久内部身份
```

不要再存在：

```text
资料邮箱
登录邮箱
```

两个概念。

管理员看到的就是：

```text
姓名
人员编号
邮箱
```

本地登录页面则直接使用同一个 `User.email`。

邮箱入库统一：

```text
trim
lowercase
```

并进行基本 email syntax 校验。

当前场景没有必要试图保留 RFC 意义上的大小写 local-part。

### emailVerifiedAt

邮箱设置不等于邮箱已验证。

所以：

```text
email != null
emailVerifiedAt == null
```

是合法状态。

它仍然可以：

```text
接收普通通知
作为管理员已经设置密码的用户的登录名
```

但是不能进行：

```text
忘记密码
安全敏感的邮箱所有权证明
```

密码找回只对：

```text
emailVerifiedAt != null
```

开放。

管理员直接修改邮箱后：

```text
emailVerifiedAt = null
```

用户自己修改邮箱则推荐采用：

```text
输入新邮箱
→ 新邮箱验证
→ 验证通过
→ 原子替换 User.email
```

避免用户输入错误地址后直接失去登录和找回能力。

---

# 4. 重构 `UserIdentity` 为真正的 AuthBinding

当前：

```text
user_identities

identifier
credential_hash
```

把“外部身份 subject”和“密码凭据”塞在同一个 identifier 模型下。

加入 CAS/OAuth 之后会开始别扭。

建议现在直接重命名为：

```text
user_auth_bindings
```

结构：

```text
id
tenant_id
user_id
auth_provider_id

subject nullable
display_label nullable
credential_hash nullable

bound_at
last_used_at

revoked_at nullable
revoked_by nullable
```

语义分别为：

### Local

```text
subject = null

credentialHash =
Argon2id(password)
```

邮箱不重复存在这里。

User 通过：

```text
users.email
```

定位。

Binding 只保存：

> 这个 User 在 local Provider 下有没有密码凭据。

### CAS

完全没有 AuthBinding。

CAS：

```text
CAS principal
↓
User.businessNo
```

即可。

### GitHub

```text
subject = GitHub durable numeric user ID
displayLabel = GitHub login
credentialHash = null
```

真正用于身份判断的是：

```text
subject
```

`displayLabel` 仅用于：

```text
已绑定 GitHub @hprogq
```

用户名变化以后可以刷新，绝不能参与登录判断。

### OIDC

```text
subject = sub
credentialHash = null
```

由于一个 AuthProvider 固定对应一个 issuer，因此：

```text
(providerId, subject)
```

就等价于：

```text
(issuer, sub)
```

### 唯一约束

```sql
unique (
  tenant_id,
  auth_provider_id,
  subject
)
where revoked_at is null
  and subject is not null;
```

以及：

```sql
unique (
  tenant_id,
  user_id,
  auth_provider_id
)
where revoked_at is null;
```

所以：

```text
一个 GitHub 账号不能绑定两个 Qualy 用户
一个 Qualy 用户在一套 GitHub Provider 下只能绑定一个账号
```

删除 User 时撤销全部 live binding。

之后 external subject 也可以被未来的新 User 重新绑定。

---

# 5. LoginDriver 契约重新拆分

当前：

```text
managed
self
derived
```

存在一个问题：

`derived` 实际描述的不是 binding，而是：

> 怎么根据登录协议返回的信息找到 User。

因此建议拆成两个正交概念：

```text
identity resolution
binding capability
```

概念上的接口如下：

```ts
interface LoginDriver {
  type: string

  provisioning: ProviderProvisioning

  presentation: LoginPresentationDeclaration

  resolution:
    | {
        mode: 'user-field'
        field: 'email' | 'businessNo'
      }
    | {
        mode: 'binding-subject'
      }

  binding?: ManagedCredentialBinding | SelfBinding
}
```

### Local

```text
resolution:
  user-field / email

binding:
  managed credential
```

### CAS

```text
resolution:
  user-field / businessNo

binding:
  none
```

### GitHub / OIDC

```text
resolution:
  binding-subject

binding:
  self
```

于是彻底去掉：

```text
derived binding
```

这个混淆概念。

---

# 6. Provider 的创建方式也进入 Driver 声明

不是所有 Driver 都应该允许租户无限创建实例。

增加：

```ts
type ProviderProvisioning =
  | {
      mode: 'system-singleton'
      code: string
      defaultName: UiText
    }
  | {
      mode: 'tenant-managed'
      entrance: ProviderConfigDefinition
    }
```

现在：

### Local

```text
system-singleton
```

Tenant 创建时自动 provision：

```text
type = local
code = local
isSystem = true
enabled = true
```

租户管理员：

```text
可启用
可停用
可调整 audience
可改展示名称
```

但：

```text
不能创建第二个
不能删除
不能换 code/type
```

### CAS / GitHub / OIDC

```text
tenant-managed
```

可以：

```text
创建多个
修改配置
停用
删除
排序
配置 audience
```

未来如果确实出现：

```text
只能由部署管理员在 YAML 中配置的登录方式
```

再增加：

```text
deployment-managed
```

目前不要实现。

---

# 7. AuthProvider 生命周期：创建时先是“未配置”

这里建议修改当前 `createAuthProvider()` 的行为。

OAuth 配置存在一个现实问题：

管理员注册 OAuth App 时需要先知道：

```text
Callback URL
```

但当前如果创建 Provider 时就必须提供：

```text
clientId
clientSecret
```

会形成鸡生蛋问题。

所以：

```text
POST /auth/providers
```

只要求：

```text
type
code
name
```

创建出来：

```text
enabled = false
config = {}
```

然后 UI 立即显示：

```text
回调地址

https://qualy.example.com/api/auth/dlufl/github/github/callback
```

管理员去 GitHub / Microsoft 注册应用以后，再回来填写：

```text
clientId
clientSecret
issuer ...
```

Provider UI 状态由服务器派生：

```text
未配置
已停用
正常
```

不是必须增加第三个 DB enum。

计算方式：

```text
configured = driver required fields 全部存在
             &&
             required secret 全部存在
```

因此：

```text
!configured
→ 未配置

configured && !enabled
→ 已停用

configured && enabled
→ 正常
```

执行：

```text
PUT /auth/providers/:id/status
status=active
```

时服务器必须先：

```text
driver.validateReady()
```

不完整就：

```text
AUTH_PROVIDER_CONFIG_INCOMPLETE
```

---

# 8. AuthProvider 增加软删除

动态登录方式真正支持删除：

```text
auth_providers.deleted_at nullable
```

查询正常 Provider：

```sql
deleted_at is null
```

删除：

```text
DELETE /auth/providers/:providerId?version=...
```

system singleton：

```text
禁止删除
```

tenant-managed Provider 删除 transaction：

```text
enabled = false
deletedAt = now

撤销 provider 全部 live AuthBinding
删除 provider secrets
失效未完成 AuthFlow
结束通过该 Provider 创建的 Session
写 Audit
```

因为下面会给 Session 增加 `authProviderId`，所以最后一点可以准确做到。

Provider `code` 建议改成仅 live row 唯一：

```sql
unique (tenant_id, code)
where deleted_at is null;
```

因此删除后允许未来重新创建相同 code。

历史 `SignInEvent` 本来就保存：

```text
providerId
providerType
providerCode snapshot
```

不会失去历史含义。

旧 Provider 的未完成 callback 即使在新 Provider 复用了 code 后回来，也必须通过 `AuthFlow.providerId` 指向旧 Provider，检测 deleted 后直接失败，不会错绑到新 Provider。

---

# 9. `config` 与 Secret 完全分离

`auth_providers.config` 今后严格规定：

> 永远只能存非敏感配置。

例如 OIDC：

```text
issuer
clientId
scope
```

CAS：

```text
serverUrl
```

GitHub：

```text
clientId
```

绝不出现：

```text
clientSecret
accessToken
refreshToken
```

---

# 10. 新增通用 `@qualy/plugin-secrets`

不建议创建：

```text
auth_provider_secrets
```

这种 Auth 专属设施。

Qualy 后续还很容易出现：

```text
Webhook Secret
第三方 API Key
租户 SMTP Password
AI Provider Key
```

因此做一个很窄的基础设施插件：

```text
packages/plugins/infra/secrets/
```

依赖：

```text
database
```

数据库：

```text
secrets

id
tenant_id

owner_kind
owner_id
key

ciphertext
nonce
auth_tag
key_version

created_at
updated_at
```

唯一：

```text
tenant_id
owner_kind
owner_id
key
```

例如：

```text
ownerKind = auth-provider
ownerId = provider UUID
key = clientSecret
```

### Master Key

真正的根 Secret 放部署环境：

```text
QUALY_SECRETS_MASTER_KEY
```

要求：

```text
32-byte random key
base64 encoded
```

不进入：

```text
qualy.yml
数据库
日志
lock file
```

第一版使用 Node 原生 crypto：

```text
AES-256-GCM
12-byte random nonce
16-byte authentication tag
```

AAD 至少包含：

```text
tenantId
ownerKind
ownerId
key
```

防止 ciphertext 被移动到另一个 owner/key 后继续解密。

表保留：

```text
keyVersion = 1
```

第一版不必实现 key rotation，但结构不要堵死。

### 服务接口

服务端能力大致：

```ts
Secrets.put({
  tenantId,
  owner,
  key,
  value: Redacted<string>
})

Secrets.get(...)
  -> Option<Redacted<string>>

Secrets.has(...)

Secrets.delete(...)

Secrets.deleteOwner(...)
```

不要提供：

```text
list all plaintext secrets
```

也不要让 API 层直接读取它。

如果安装此版本 Qualy，建议生产启动要求提供 Master Key。

开发环境由初始化脚本生成，而不是代码每次随机生成，否则重启后旧 ciphertext 将永久无法解密。

---

# 11. Provider config form 自动拆 Secret

当前 `EntranceField` 已经有：

```text
text
url
secret
```

继续保留，非常合适。

但 core 应该自己根据字段定义拆分。

例如 OIDC Driver 声明：

```text
issuer       url
clientId     text
clientSecret secret
scope        text
```

浏览器提交：

```text
issuer
clientId
clientSecret
scope
```

Auth core：

```text
text/url
→ AuthProvider.config

secret
→ Secrets
```

Driver 的 `prepareConfig` 只处理非 Secret：

```ts
prepareConfig({
  values,
  previousConfig,
})
```

Secret 对 Driver 应该是 opaque value，不需要参与普通配置 JSON。

编辑 Provider 时 GET 只返回：

```text
issuer = ...
clientId = ...
scope = ...

clientSecretConfigured = true
```

绝不返回：

```text
clientSecret = abc...
```

编辑 Secret 输入框：

```text
留空
→ 保留旧值

填写
→ 替换
```

Secret 更新同样必须：

```text
provider.version++
```

这样运行时缓存可以按 provider version 自动失效。

---

# 12. Provider Runtime API

现在 `resolveProvider()` 只返回：

```text
tenantId
providerId
```

CAS/OIDC 已经不够。

但也不要直接：

```ts
{
  config,
  clientSecret: string
}
```

防止整个对象被误日志。

建议增加 server-only：

```ts
ProviderRuntime.resolve({
  tenantSlug,
  providerCode,
  expectedType,
})
```

结果：

```ts
{
  tenantId,
  providerId,
  version,
  code,
  config,

  secret(key):
    Effect<Redacted<string>, ProviderSecretMissing>
}
```

所以 Driver：

```text
Auth Core
负责数据库、tenant boundary、Secret decrypt

Driver
负责解释 issuer/clientId/clientSecret 的协议意义
```

浏览器永远接触不到 `ProviderRuntime`。

---

# 13. 真正解决多租户匿名登录

当前 `sign-in.ts` 通过：

```text
AuthConfig.defaultTenantSlug
```

解析匿名 Tenant。

这意味着数据库虽然是 multi-tenant，但匿名登录实际上仍然只能自然服务默认 Tenant。

CAS/OAuth 开工时建议顺便解决。

公共认证路径直接把 tenant slug 放进去：

```text
GET  /auth/:tenantSlug/methods

POST /auth/:tenantSlug/local/:providerCode/login

GET  /auth/:tenantSlug/cas/:providerCode/start
GET  /auth/:tenantSlug/cas/:providerCode/callback

GET  /auth/:tenantSlug/github/:providerCode/start
GET  /auth/:tenantSlug/github/:providerCode/callback

GET  /auth/:tenantSlug/oidc/:providerCode/start
GET  /auth/:tenantSlug/oidc/:providerCode/callback
```

管理 API 因为已经有 authenticated Principal：

```text
/iam/...
/auth/providers...
```

不需要 tenant slug。

登录页面也应明确 Tenant：

```text
/t/:tenantSlug/login
```

现有 `/login`：

```text
有 defaultTenantSlug
→ redirect /t/:defaultTenantSlug/login
```

即可保持单租户部署的体验。

这一步很重要，因为：

```text
Tenant A: provider code = github
Tenant B: provider code = github
```

必须可区分。

---

# 14. 增加可信 publicBaseUrl

CAS `service`、OAuth/OIDC `redirect_uri` 不允许根据：

```text
Host Header
X-Forwarded-Host
```

临时拼。

AuthConfig 增加：

```text
publicBaseUrl
```

例如：

```text
https://qualy.example.edu
```

来源：

```text
env / deployment config
```

所有 callback URL：

```text
publicBaseUrl
+
frozen route
```

计算。

因此 OAuth Provider 管理页可以稳定展示：

```text
授权回调地址
https://qualy.example.edu/api/auth/xxx/...
```

---

# 15. 新增 AuthFlow，而不是把状态塞 Cookie/URL

新增：

```text
auth_flows
```

字段：

```text
id

tenant_id
auth_provider_id

state_hash

purpose
  login
  bind

user_id nullable
session_id nullable

return_path nullable

payload_ciphertext nullable

expires_at
consumed_at nullable
created_at
```

随机产生：

```text
256-bit flow token
```

浏览器拿：

```text
raw state
```

数据库只存：

```text
SHA-256(state)
```

OAuth 的：

```text
PKCE code verifier
OIDC nonce
其他短期协议状态
```

放进：

```text
payload_ciphertext
```

使用同一 Secret encryption primitive 加密。

默认：

```text
10 分钟过期
```

消费必须原子：

```text
stateHash matching
expiresAt > now
consumedAt IS NULL
↓
SELECT FOR UPDATE / conditional UPDATE
↓
consumedAt = now
```

callback 永远只能消费一次。

`returnPath` 必须是 same-origin path：

```text
/app
/profile
```

禁止：

```text
https://evil.example
//evil.example
```

避免 open redirect。

---

# 16. Session 增加 Provider 来源

当前 Session 只有：

```text
userId
```

现在顺手增加：

```text
auth_provider_id
auth_binding_id nullable
```

`completeLogin()` 本来已经拿到了：

```text
providerId
identityId
```

所以实现成本很低。

收益却很多：

```text
以后“登录设备”页面能显示登录方式
Provider 被删除时能精确结束相关 Session
安全审计更完整
未来 SessionAuthGrant 有自然 FK
```

这一步现在就做。

---

# 17. Local 改成唯一的邮箱密码 Provider

`auth-local` 改成：

```text
system-singleton
```

不再出现在：

```text
添加登录方式
```

类型选择器里。

它的 Binding UI 不再要求：

```text
用户名
密码
```

而显示：

```text
邮箱密码

登录邮箱
hangqi@example.com
来自用户邮箱

密码
••••••••
[设置密码]
```

如果 User.email 为空：

```text
尚未设置邮箱。
请先填写用户邮箱。
```

### Login API

payload 改为：

```text
email
password
```

流程：

```text
normalize email
↓
resolve Provider
↓
findUserByField(email)
↓
读取该 user + local provider 的 AuthBinding
↓
verify credentialHash
↓
completeLogin()
```

未知 email、没有 password binding、错误 password：

```text
全部 INVALID_CREDENTIALS
```

未知用户继续执行 dummy Argon2 verify，维持当前防时序枚举策略。

当前源码中 `PASSWORD_MIN_LENGTH` 是 8，而安全设计文档写的是 12。这次一起统一成 12，避免代码与安全文档继续分叉。

---

# 18. Auth Core 增加三类查询能力

当前主要是：

```text
findIdentity()
```

建议变成：

```ts
findUserByField({
  tenantId,
  providerId,
  field: 'email' | 'businessNo',
  value,
})
```

它负责：

```text
User lookup
+
Provider audience
```

第二类：

```ts
findBindingBySubject({
  tenantId,
  providerId,
  subject,
})
```

供 GitHub/OIDC。

第三类：

```ts
findBindingForUser({
  tenantId,
  providerId,
  userId,
})
```

供 local 读取密码摘要。

Driver 不允许直接查询：

```text
users
user_auth_bindings
```

这样所有 Driver 都自动遵守同样的：

```text
tenant isolation
provider audience
revoked binding
```

最终都走现有：

```text
completeLogin()
```

重新检查：

```text
user enabled
userType enabled
tenant active
```

并建立 Session。

---

# 19. CAS Driver

新增：

```text
@qualy/plugin-auth-cas
```

Provider config 第一版只要：

```text
serverUrl
```

例如：

```text
https://cas.dlufl.edu.cn/cas
```

不要让管理员配置：

```text
loginUrl
validateUrl
```

两套 URL。

全部从 base URL 推导：

```text
/login
/p3/serviceValidate
```

CAS 3.0 标准确实定义 `/p3/serviceValidate` 用于 Service Ticket validation，并额外返回属性。citeturn200558search5

### Start

```text
GET /auth/:tenant/cas/:code/start
```

服务器：

```text
create AuthFlow
↓
callback =
publicBaseUrl +
/auth/:tenant/cas/:code/callback?flow=<RAW_FLOW>

service = callback
↓
302:
CAS_SERVER/login?service=<service>
```

### Callback

CAS 返回：

```text
callback
?flow=...
&ticket=ST-...
```

Qualy：

```text
consume AuthFlow
↓
确认 Provider 未删除且 active
↓
请求：
CAS_SERVER/p3/serviceValidate
  ?service=<完全相同 callback>
  &ticket=<ticket>
↓
解析 XML
↓
authenticationSuccess.user
↓
normalize businessNo
↓
findUserByField(businessNo)
↓
completeLogin
↓
redirect returnPath
```

CAS ticket：

```text
不入 DB
不入 Audit
不入日志
验证完成立即丢弃
```

XML 用成熟 parser，例如 `fast-xml-parser`。

协议逻辑自己写即可，不需要 Passport。

CAS client 本质上只需要：

```text
redirect
service validation
XML parsing
```

没有必要把 Passport authentication stack 引进 Effect + `LoginDriver` 架构。

---

# 20. CAS 出站安全

因为 `serverUrl` 是 Tenant Admin 输入，存在 SSRF 面。

第一版至少要求：

```text
HTTPS
禁止 URL username/password
禁止 fragment
限制 redirect
HTTP timeout
response body size limit
```

另外永久拒绝：

```text
127.0.0.0/8
::1
link-local
cloud metadata addresses
```

RFC1918 是否允许不要写死。

增加 deployment policy：

```text
QUALY_AUTH_ALLOW_PRIVATE_PROVIDER_HOSTS=false
```

SaaS 默认 false。

学校内网部署若 CAS 本身就在私网：

```text
true
```

再允许。

所有外部请求禁止自动无限 redirect，限制在非常小的次数，最好 Provider host 不允许在 redirect 后突然跨域。

---

# 21. GitHub 必须单独一个 Driver

GitHub 的 OIDC Provider 是给 GitHub Actions workflow 向云服务证明 workflow 身份用的，不是普通用户的 “Sign in with GitHub”。citeturn200558search0turn200558search3

因此新增：

```text
@qualy/plugin-auth-github
```

使用 GitHub OAuth Web Application Flow。GitHub 官方当前 Web Flow 已支持并强烈建议使用 `state` 和 PKCE S256。citeturn889488search0

Provider：

```text
config:
  clientId

secret:
  clientSecret
```

第一版不要请求多余 scope。

Qualy 只需要：

```text
OAuth callback
↓
access token
↓
GET GitHub /user
↓
id
login
```

保存：

```text
subject = String(user.id)
displayLabel = user.login
```

然后立刻丢弃 access token。

不要：

```text
按 GitHub email 自动寻找 User
按 GitHub login 自动寻找 User
```

GitHub subject 必须是 durable numeric ID。

### GitHub 登录

```text
GitHub OAuth
↓
subject
↓
findBindingBySubject
```

找到：

```text
completeLogin
```

找不到：

```text
AUTH_EXTERNAL_ACCOUNT_UNBOUND
```

前端提示：

> 此 GitHub 账号尚未绑定。请先使用其他方式登录，然后在账户设置中完成绑定。

不要自动创建 User。

---

# 22. OAuth Self Binding

用户已经通过：

```text
CAS
或邮箱密码
```

登录后：

```text
账户设置
→ 登录方式
→ GitHub
→ 绑定
```

调用同一个 start route：

```text
GET .../github/:code/start?intent=bind
```

AuthFlow：

```text
purpose = bind
userId = CurrentUser.id
sessionId = CurrentSession.id
```

OAuth callback 后：

```text
consume flow
↓
当前 Session 仍必须存在
↓
当前 Session.id == flow.sessionId
↓
取得 GitHub subject
↓
确认 subject 未绑定其他 User
↓
创建 AuthBinding
↓
Audit
```

只记 `userId` 不够。

一定钉：

```text
sessionId
```

否则拿到 flow 链接的人可能替另一个 User 完成绑定。

管理员不能手工输入：

```text
GitHub ID = ...
```

self binding 只能由用户本人完成 OAuth proof。

管理员只能：

```text
查看
撤销
```

---

# 23. OIDC Driver

新增：

```text
@qualy/plugin-auth-oidc
```

配置：

```text
issuer
clientId
scope
```

Secret：

```text
clientSecret
```

scope 默认：

```text
openid profile email
```

但：

```text
email
name
preferred_username
```

只能用于 display。

实际绑定：

```text
subject = sub
```

由于 Provider 固定 issuer：

```text
(providerId, sub)
```

就是用户外部身份。

`issuer` 一旦存在 live binding，就禁止修改。

如果真要切另一个 IdP：

```text
创建新的 AuthProvider
```

不要原地改变 identity namespace。

### Library

OIDC 使用 `openid-client`。

当前 API 已提供：

```text
discovery
buildAuthorizationUrl
authorizationCodeGrant
PKCE
nonce
state
refreshTokenGrant
fetchUserInfo
```

并明确提供 OAuth/OIDC protocol validation 能力。citeturn563033search0turn563033search5

不要使用 Auth.js / Passport 接管：

```text
User
Session
Account
```

Qualy 自己已经有这些领域对象。

Driver 只让 `openid-client` 负责：

```text
协议正确性
token validation
PKCE
nonce
issuer/audience 等验证
```

然后把：

```text
sub
```

交回 Qualy Auth Core。

### Runtime cache

OIDC discovery 不要每次登录重新请求。

Driver 内部缓存：

```text
providerId
+
providerVersion
→ openid-client Configuration
```

Provider config/secret 修改：

```text
version++
```

自然使旧 cache 失效。

---

# 24. GitHub 也优先复用 `openid-client` 的 OAuth 能力

`openid-client` 当前并不仅限于 OIDC，也包含标准 OAuth Authorization Code、PKCE、protected-resource 和 refresh-token 能力。citeturn563033search0

GitHub Driver 可以先做一个 compatibility spike：

```text
显式构造 GitHub authorization server metadata
↓
buildAuthorizationUrl
↓
authorizationCodeGrant
↓
fetch /user
```

如果 GitHub 的某些非标准细节让 `openid-client` 使用很别扭，再在 `auth-github` 内写一个很薄的 token exchange。

不要为了只有 GitHub 一个消费者提前新建：

```text
@qualy/oauth-framework
```

等第二个非 OIDC OAuth Driver 真正出现后再抽公共层。

---

# 25. AuthProvider 编辑 API

保留现有：

```text
GET /auth/providers
POST /auth/providers
PATCH /auth/providers/:id
PUT /auth/providers/:id/status
PUT /auth/providers/:id/audience
PUT /auth/provider-order
```

增加：

```text
GET /auth/providers/:id
DELETE /auth/providers/:id
```

Provider detail 返回：

```text
id
type
code
name
status
configured
version
audience

config:
  非敏感字段

secrets:
  clientSecret:
    configured: true

callbackUrl
```

不返回任何 secret value。

`GET /auth/provider-kinds` 只列：

```text
provisioning.mode = tenant-managed
```

所以 local 不出现在“添加登录方式”。

---

# 26. Provider 配置和 identity namespace

Driver config declaration 增加：

```text
identityNamespaceKeys
```

OIDC：

```text
['issuer']
```

Core 在修改 config 时：

```text
如果修改 identityNamespaceKey
并且 provider 已有 live binding
→ 拒绝
```

错误：

```text
AUTH_PROVIDER_IDENTITY_NAMESPACE_IN_USE
```

Client ID 和 Client Secret 则允许 rotation。

GitHub namespace 固定为 GitHub 本身，没有这类字段。

---

# 27. Mail 正式做成 Storage 类似的基础设施能力

新增：

```text
@qualy/plugin-mail
```

以及 backend：

```text
@qualy/plugin-mail-resend
@qualy/plugin-mail-smtp
```

未来：

```text
mail-ses
mail-tencent
mail-sendgrid
```

结构直接参考当前：

```text
plugin-storage
storage-local
storage-cos
```

不过 Mail Core 可以明显更薄。

### Mail declaration

```ts
interface MailBackendDeclaration {
  code: string
}
```

插件：

```text
Mail.backend({ code: 'resend' })
Mail.backend({ code: 'smtp' })
```

Core：

```text
MailBackends registry
MailConfig.defaultBackend
boot barrier
```

如果：

```text
defaultBackend = resend
```

但没有安装：

```text
plugin-mail-resend
```

启动直接失败。

与 Storage 行为一致。

---

# 28. Mail 仍然是 deployment-managed

第一阶段 Mail 不做租户动态配置。

例如：

```yaml
'@qualy/plugin-mail':
  config:
    defaultBackend: resend
    from: Qualy <no-reply@example.com>
```

Resend：

```text
QUALY_MAIL_RESEND_API_KEY
```

SMTP：

```text
QUALY_MAIL_SMTP_HOST
QUALY_MAIL_SMTP_PORT
QUALY_MAIL_SMTP_USER
QUALY_MAIL_SMTP_PASSWORD
```

这些仍然在 deployment env。

所以：

```text
Storage Secret
Mail Secret
```

继续使用 env，因为它们属于部署基础设施。

只有：

```text
Tenant-managed Auth Provider Secret
```

使用动态 Secret Store。

这个差异是有意的，不是架构不一致。

---

# 29. Mail Core API

业务插件只知道：

```ts
Mail.send({
  to,
  subject,
  text,
  html?,
  replyTo?
})
```

Mail Core 负责：

```text
选择 backend
default from
统一错误
timeout
metrics
```

Backend 负责：

```text
Resend API
SMTP
SES
```

绝对不要出现：

```text
Mail.sendPasswordReset()
Mail.sendAssessmentNotification()
```

模板属于业务方。

例如：

```text
auth-local
→ 生成密码重置邮件内容
→ Mail.send()

assessment
→ 生成批次通知
→ Mail.send()
```

就像：

```text
Assessment 知道“这是证明材料”
Storage 只知道 bytes
```

Mail 只知道：

```text
这是一封邮件
```

日志禁止记录完整 body，因为里面可能出现：

```text
密码重置 token
邮箱验证 token
敏感通知内容
```

Metrics 最多：

```text
backend
outcome
```

---

# 30. 密码找回

新增：

```text
password_reset_requests
```

字段：

```text
id
tenant_id
user_id
token_hash
expires_at
consumed_at
created_at
```

原始 token：

```text
256 bit random
```

DB 只存：

```text
SHA-256(token)
```

邮件链接推荐：

```text
https://qualy.example/reset-password#token=RAW_TOKEN
```

使用 URL fragment 的好处是：

```text
RAW_TOKEN 不会自动进入服务器 access log
```

页面读取 fragment 后：

```text
POST API
{
  token,
  newPassword
}
```

匿名：

```text
请求密码重置
```

无论邮箱：

```text
存在
不存在
未验证
```

外部响应都一样：

> 如果该邮箱对应可找回的账号，我们已发送重置邮件。

不能枚举 User。

重置成功：

```text
更新 credentialHash
结束 User 全部 Sessions
consume token
Audit
```

---

# 31. 邮箱验证

可以复用类似结构：

```text
email_verification_requests
```

或者抽象：

```text
user_email_challenges
```

第一版我倾向分表，业务语义更清晰。

验证成功：

```text
users.email_verified_at = now()
```

用户自主修改邮箱则使用：

```text
email_change_requests

user_id
new_email
token_hash
expires_at
```

验证后才真正替换 `User.email`。

---

# 32. Session Token Grant：现在不实现，但预留正确边界

未来某个 OAuth Provider 可能需要：

```text
accessToken
refreshToken
expiresAt
```

以便 Qualy 在当前 Session 内继续访问外部 API。

不要：

```text
塞进 sessions JSON
```

也不要：

```text
塞进 UserAuthBinding
```

未来增加独立：

```text
session_auth_grants

tenant_id
session_id
auth_provider_id

state_ciphertext
expires_at
version
updated_at
```

唯一：

```text
session_id
auth_provider_id
```

FK：

```text
session_id
→ sessions
ON DELETE CASCADE
```

整个 token state 加密。

Auth Core 完全不知道里面有没有：

```text
accessToken
refreshToken
idToken
scope
```

Driver 自己解释。

Core 只负责：

```text
加密
保存
Session 生命周期
```

### Refresh

将来不要：

```text
每个 Session 一个 setInterval
```

而是 lazy refresh：

```text
driver.getValidGrant()
↓
token 仍有效
→ 返回

即将过期
→ 锁 grant
→ refresh
→ 原子替换 state
→ 返回
```

只有未来出现真正后台任务时才接 Queue / scheduler。

GitHub 当前支持可过期 access token + refresh token 的 OAuth 模式，因此这个扩展方向是真实存在的，但普通“使用 GitHub 登录”完全没有必要保存 token。citeturn200558search1

### 现在代码层面预留什么？

现在只做：

```text
Session.authProviderId
Session.authBindingId
```

并坚持：

> `completeLogin()` 是唯一创建 Session 的地方。

不要现在创建：

```text
session_auth_grants
```

也不要提前发明无消费者的接口。

未来第一次出现需要 token persistence 的 Driver 时，让：

```text
completeLogin()
```

增加 optional encrypted session grant input，并在同一 transaction 写 Session + Grant。

这样才是真正的原子性。

---

# 33. CAS Ticket 不进入 Session Grant

普通 CAS：

```text
ST-xxxx
```

是一次性 Service Ticket。

流程：

```text
callback
→ serviceValidate
→ success
→ ticket 生命周期结束
```

直接丢弃。

只有将来真的支持：

```text
CAS Proxy Granting Ticket
CAS Proxy Ticket
```

并且 Qualy 需要代表 User 调其他 CAS Service 时，才考虑使用 Session Grant 扩展。

第一版不做。

---

# 34. Origin Guard 无需为 OAuth callback 放洞

当前 Qualy 的 origin guard 已经规定：

```text
GET / HEAD / OPTIONS
直接放行
```

OAuth/CAS callback 都是顶层 GET，因此无需为了第三方 callback 特判整个 origin guard。

真正的 callback CSRF 防护由：

```text
AuthFlow state
PKCE
OIDC nonce
CAS service-ticket binding
```

承担。

不要添加：

```text
/auth/** 跳过所有安全检查
```

这种大洞。

---

# 35. callback query 参数不能进入日志

必须增加测试保证：

```text
ticket
code
state
flow
```

不会出现在：

```text
Access Log
Trace attributes
Audit
error details
```

当前 SignInEvent 也继续保持：

```text
不记录 identifier
不记录 token
```

只记录：

```text
provider
userId
bindingId
outcome
reason
sessionId
requestId
IP
UA
```

这条原则不要改变。

---

# 36. GitHub/OIDC 未绑定 UX

登录成功证明了外部身份但没有 Binding：

页面：

```text
此 GitHub 账号尚未绑定 Qualy。

请先使用其他登录方式登录，然后在账户设置中绑定此账号。
```

提供：

```text
返回登录
```

不要：

```text
自动按 email 匹配
自动创建 User
自动绑定同邮箱账号
```

第二阶段可以优化成：

```text
OAuth 已证明外部账号
↓
暂存 pending proof
↓
用户使用 CAS / Email 登录
↓
询问：
是否将 GitHub @hprogq 绑定到当前账号？
```

但第一版不要做。

---

# 37. 用户详情页最终展示

你之前正在做的插件化用户详情页非常适合这套模型。

基本资料：

```text
姓名
人员编号
邮箱
邮箱状态
组织归属
身份类型
```

登录方式页：

```text
邮箱密码
  邮箱：xxx@xxx.edu.cn
  密码：已设置
  [重置密码]

大外统一身份认证
  使用人员编号登录
  无需绑定

GitHub
  @hprogq
  已绑定
  [解除绑定]

Microsoft 365
  未绑定
  [绑定]
```

UI 不需要理解：

```text
CAS
GitHub
OIDC
```

特殊逻辑。

继续根据 Driver declaration 渲染。

但新的 binding view 应改成：

```text
managed credential
self
none/user-field
```

而不是现在的：

```text
managed/self/derived
```

---

# 38. Provider 管理 UI

“登录方式”页：

```text
邮箱密码
系统登录方式

大外统一身份认证
CAS

Microsoft 365
OpenID Connect

GitHub
GitHub
```

添加按钮只列：

```text
tenant-managed Driver
```

点击“添加 GitHub”：

第一步：

```text
名称
标识 code
```

创建 disabled Provider。

第二步详情页立即显示：

```text
回调地址
```

第三步填写：

```text
Client ID
Client Secret
```

保存。

状态：

```text
未配置
```

变为：

```text
已停用
```

最后：

```text
启用
```

如果必填 Secret 缺失：

```text
不能启用
```

这种工作流比在一个 Modal 里要求用户先准备好全部 OAuth 参数合理得多。

---

# 39. Provider 删除 UI

删除前明确展示影响：

```text
删除“GitHub”？

该登录方式将立即停止使用。
17 个账号绑定将被解除。
3 个相关登录会话将结束。

历史登录和审计记录不会删除。
```

确认后 terminal delete。

local：

```text
系统登录方式不能删除，只能停用。
```

---

# 40. 建议的包结构

最终新增：

```text
packages/plugins/infra/secrets/
packages/plugins/infra/mail/
packages/plugins/infra/mail-resend/
packages/plugins/infra/mail-smtp/

packages/plugins/base/auth-cas/
packages/plugins/base/auth-github/
packages/plugins/base/auth-oidc/
```

修改：

```text
packages/contracts/auth/
packages/plugins/base/auth/
packages/plugins/base/auth-local/
```

不新增：

```text
passport
auth.js
better-auth
```

也暂时不新增：

```text
generic-oauth
oauth-framework
session-grant
```

没有真实消费者先不抽。

---

# 41. 数据库最终形态

核心关系：

```text
Tenant
 │
 ├── User
 │     ├── businessNo
 │     ├── email
 │     └── deletedAt
 │
 ├── AuthProvider
 │     ├── type
 │     ├── code
 │     ├── config (non-secret)
 │     └── deletedAt
 │
 ├── UserAuthBinding
 │     ├── User
 │     ├── AuthProvider
 │     ├── subject?
 │     └── credentialHash?
 │
 ├── Session
 │     ├── User
 │     ├── AuthProvider
 │     └── AuthBinding?
 │
 ├── AuthFlow
 │
 └── Secret
       └── owner = AuthProvider
```

未来：

```text
Session
└── SessionAuthGrant
```

Mail 当前没有业务 DB 表。

---

# 42. 建议开发顺序

## Phase A：清理用户生命周期

修改：

```text
User unique indexes
删除 restore permission/action/API/UI
DELETE user endpoint
所有 live user query 默认 deletedAt IS NULL
directory-import 对 terminal delete 的适配
```

同时加：

```text
User.email
User.emailVerifiedAt
```

验收：

```text
删除用户彻底不可见
businessNo/email 可重新使用
历史记录 userId 不变
不能删除最后管理员
```

## Phase B：AuthBinding 重构

```text
user_identities
→ user_auth_bindings

identifier
→ subject nullable

增加 displayLabel
```

更新：

```text
sign-in
IAM entrances
Audit
fixtures
tests
```

重构 Driver：

```text
resolution
binding
provisioning
```

去掉：

```text
derived
```

## Phase C：Local Email Login

local：

```text
system-singleton
User.email
AuthBinding.credentialHash
```

更新 seed：

```text
QUALY_ADMIN_EMAIL
QUALY_ADMIN_PASSWORD
```

不保留 legacy username fallback。

Qualy 目前尚处于快速开发阶段，没必要为了旧 username 模型永久污染领域模型。

## Phase D：Secrets Infrastructure

新增：

```text
plugin-secrets
Secret DB
AES-GCM
master key
Redacted
```

改 Provider config：

```text
secret 字段不再进入 config
```

增加：

```text
provider detail
configured state
callback URL
```

Provider 创建改成：

```text
先创建 disabled shell
后填写配置
```

## Phase E：真正 multi-tenant auth routing + AuthFlow

新增 tenant slug 公共登录路径。

新增：

```text
publicBaseUrl
auth_flows
```

改：

```text
LoginPresentation href
resolveProvider
```

使其不再依赖：

```text
defaultTenantSlug
```

Driver 内部。

defaultTenantSlug 只保留为 `/login` 的 convenience redirect。

## Phase F：CAS

实现：

```text
auth-cas
start
callback
p3/serviceValidate
businessNo resolver
```

优先拿你现在已有的大外 CAS 做真实集成测试。

## Phase G：GitHub

实现：

```text
auth-github
OAuth Code + PKCE
login
self bind
unbind
```

Access token 用完即丢。

## Phase H：OIDC

实现：

```text
auth-oidc
openid-client
discovery cache
PKCE
nonce
sub
```

## Phase I：Mail

新增：

```text
mail core
mail-resend
```

SMTP 可以同阶段，也可以后一个 PR。

## Phase J：Email verification / password reset

实现：

```text
email verification
password reset
email change
```

这时候 Mail 已经可以被 auth-local 使用。

---

# 43. 测试矩阵

这轮认证重构不能只写 happy path。

至少覆盖以下类别。

### User

```text
delete live user
delete disabled user
delete last administrator refused
deleted user invisible
deleted businessNo reusable
deleted email reusable
same live businessNo refused
same live email refused
```

### Local

```text
email normalization
unknown email timing equalization
no password binding
wrong password
correct password
disabled user
disabled user type
provider audience exclusion
local singleton
```

### Secrets

```text
ciphertext != plaintext
wrong AAD cannot decrypt
wrong master key cannot decrypt
secret never appears in Provider GET
secret update keeps old when blank
provider version bumps
delete provider deletes secret
```

增加 repo-level grep/test：

禁止：

```text
clientSecret
refreshToken
accessToken
```

出现在 audit details / API response schema 的危险位置。

### AuthFlow

```text
state replay refused
expired flow refused
wrong provider refused
deleted provider refused
bind flow wrong session refused
unsafe returnPath refused
```

### CAS

```text
authenticationSuccess
authenticationFailure
unknown businessNo
audience excluded
ticket replay
service mismatch
malformed XML
oversized XML
timeout
SSRF blocked
```

### GitHub

```text
state mismatch
PKCE
token exchange failure
/user failure
unbound login
successful login
subject already bound
bind wrong session
bind success
unbind
```

GitHub 当前文档明确支持 Web Flow 的 state + PKCE，因此测试应该把这两项作为硬要求，而不是可选增强。citeturn889488search0

### OIDC

```text
issuer mismatch
nonce mismatch
state mismatch
PKCE
invalid ID token
wrong audience
missing sub
binding collision
provider issuer immutable after binding
```

`openid-client` 本身提供 expected state、nonce 和 PKCE verifier 的校验入口，应直接使用，不要在外围重新实现一套。citeturn563033search3

### Mail

像 Storage 一样做 backend contract tests：

```text
send text
send html
provider failure normalized
timeout
backend unavailable
no body/token logged
```

每个：

```text
mail-resend
mail-smtp
```

都跑同一套 contract。

---

# 44. 现有 Qualy 门禁需要同步修改

别忘记你仓库现在大量行为都是冻结的。

需要同步：

```text
frozen-routes.ts
OpenAPI parity
error-codes.test
catalogs.test
permissions registry
qualy.lock.json
plugin dependency graph tests
browser graph tests
DB assembly tests
fixtures / seed
production smoke
```

尤其新的 redirect callback route 仍然应进入 API frozen route 集，而不是另起一套裸 `HttpRouter`，除非 Effect HttpApi 确实无法表达 redirect response。

---

# 45. 不建议现在做的东西

这轮明确不要顺手扩大成：

```text
Generic OAuth 配置解释器
多租户 SMTP 动态配置
OAuth token 后台 scheduler
CAS Proxy Ticket
自动按 OAuth email 合并账户
用户恢复
Provider deployment/database 双来源
Secret backend 多实现
Vault/KMS
账号自动注册
```

它们都有合理未来场景，但现在没有消费者。

当前真正需要预留的只有结构边界：

```text
Session 记住 provider
completeLogin 是 Session 唯一 writer
AuthProvider config 不存 secret
Driver 不直接查 User/AuthBinding 表
```

这些保证以后扩展不需要推翻核心。

---

# 46. 最终各登录方式的数据归属

| 内容               | Local        | CAS               | GitHub          | OIDC                  |
| ------------------ | ------------ | ----------------- | --------------- | --------------------- |
| Provider           | singleton    | 多实例            | 多实例          | 多实例                |
| 用户定位           | `User.email` | `User.businessNo` | Binding subject | Binding subject       |
| Binding subject    | 无           | 无                | GitHub user id  | `sub`                 |
| Binding credential | Argon2 hash  | 无                | 无              | 无                    |
| Provider config    | 无           | serverUrl         | clientId        | issuer/clientId/scope |
| Provider Secret    | 无           | 无                | clientSecret    | clientSecret          |
| AuthFlow           | 无           | 有                | 有              | 有                    |
| Session Grant      | 无           | 无                | 默认无          | 默认无                |
| 绑定方式           | 管理密码     | 不绑定            | 用户自绑        | 用户自绑              |

这是我建议最终冻结的领域模型。

---

# 47. 最关键的几项领域裁决

这几条最好直接写进 `docs/notes/auth-security.md` 或单独 ADR，避免以后又绕回来。

**用户删除：**

```text
删除不可恢复。
soft delete 仅用于历史和外键。
业务编号、邮箱、外部身份都在删除后释放。
```

**邮箱：**

```text
User.email 是唯一 canonical email。
本地登录、通知和密码找回都引用它。
不建立第二份 login email。
```

**本地登录：**

```text
每租户只有一个 system local Provider。
email 来自 User，Binding 只保存 password hash。
```

**CAS：**

```text
CAS principal 对应 businessNo。
CAS 不创建 Binding。
```

**OAuth/OIDC：**

```text
只按稳定 external subject 绑定。
绝不按 email 自动绑定 Qualy User。
```

**动态 Secret：**

```text
Provider 非敏感配置进 AuthProvider.config。
Provider Secret 进 encrypted Secrets。
Master Key 只在 deployment env。
```

**Mail：**

```text
Mail 是 deployment infrastructure。
mail-resend/mail-smtp 是 backend。
业务模板属于调用插件。
```

**Token：**

```text
仅为登录使用的 access token 用完即弃。
未来真正需要外部 API delegation 时才增加 SessionAuthGrant。
```

按这个方案实施以后，Qualy 的身份体系不会变成“每种登录方式各写一套”；同时也不会为了追求形式统一，把本该由租户管理员动态配置的身份源硬塞进 YAML。

样例代码两份：

```ts
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { Parser } from 'xml2js'

const CAS_BASE_URL = 'https://cas.dlufl.edu.cn/cas'
const CAS_VALIDATE_TIMEOUT_MS = 10_000

const ID_TYPE_NAMES: Record<string, string> = {
  '1': '本科生',
  '2': '研究生',
  '3': '教师',
  '21': '外聘专家',
  '22': '外籍教师',
  '26': '临时人员',
  '27': '国培生',
  '28': '非学历',
  '29': '留学生',
  '30': '业务遗留',
  '31': '进修生',
  '99': '访客',
}

export interface CasDluflProfile {
  idNumber: string
  userName: string
  unitName: string | null
  userId: string | null
  idType: string | null
  idTypeName: string | null
  userType: 'TEACHER' | 'STUDENT'
  attributes: Record<string, string>
}

@Injectable()
export class CasDluflService {
  private readonly parser = new Parser({
    explicitArray: false,
    trim: true,
  })

  buildLoginUrl(serviceUrl: string): string {
    const url = new URL(`${CAS_BASE_URL}/login`)
    url.searchParams.set('service', serviceUrl)
    return url.toString()
  }

  async validateTicket(ticket: string, serviceUrl: string): Promise<CasDluflProfile> {
    let response: Response

    try {
      response = await fetch(`${CAS_BASE_URL}/proxyValidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/xml,text/xml,*/*',
        },
        body: new URLSearchParams({ service: serviceUrl, ticket }).toString(),
        signal: AbortSignal.timeout(CAS_VALIDATE_TIMEOUT_MS),
      })
    } catch {
      throw new ServiceUnavailableException('DLUFL CAS service is unreachable')
    }

    if (!response.ok) {
      throw new UnauthorizedException('CAS ticket validation failed')
    }

    const xml = await response.text()
    return this.parseValidationXml(xml)
  }

  async parseValidationXml(xml: string): Promise<CasDluflProfile> {
    let parsed: unknown
    try {
      parsed = await this.parser.parseStringPromise(xml)
    } catch {
      throw new UnauthorizedException('CAS response is not valid XML')
    }

    const root = readObject(
      readObject(parsed)['sso:serviceResponse'] ??
        readObject(parsed)['cas:serviceResponse'] ??
        readObject(parsed).serviceResponse,
    )
    const success = readObject(
      root['sso:authenticationSuccess'] ??
        root['cas:authenticationSuccess'] ??
        root.authenticationSuccess,
    )

    if (Object.keys(success).length === 0) {
      throw new UnauthorizedException('CAS authentication failed')
    }

    const attributes = collectAttributes(success)
    const casUser = readString(success['sso:user'] ?? success['cas:user'] ?? success.user)
    const idNumber = attributes.id_number ?? casUser
    const userName = attributes.user_name

    if (!idNumber || !userName) {
      throw new UnauthorizedException('CAS response is missing user identity')
    }

    const idType = attributes.id_type ?? null
    return {
      idNumber,
      userName,
      unitName: attributes.unit_name ?? null,
      userId: attributes.user_id ?? null,
      idType,
      idTypeName: idType ? (ID_TYPE_NAMES[idType] ?? null) : null,
      userType: idType === '3' ? 'TEACHER' : 'STUDENT',
      attributes,
    }
  }
}

function collectAttributes(success: Record<string, unknown>) {
  const attributes: Record<string, string> = {}

  for (const [key, value] of Object.entries(success)) {
    if (localName(key) !== 'attributes') continue

    for (const container of asArray(value).map(readObject)) {
      for (const [attributeKey, attributeValue] of Object.entries(container)) {
        const name = localName(attributeKey)
        if (name === 'attribute') {
          for (const item of asArray(attributeValue).map(readObject)) {
            const meta = readObject(item.$)
            const attrName = readString(meta.name)?.trim().toLowerCase()
            const attrValue = readString(meta.value)
            if (attrName && attrValue !== undefined) {
              attributes[attrName] = attrValue
            }
          }
          continue
        }

        if (attributeKey === '$') continue

        const directValue = readString(attributeValue)
        if (directValue !== undefined) {
          attributes[name.toLowerCase()] = directValue
        }
      }
    }
  }

  return attributes
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) return readString(value[0])

  const objectValue = readObject(value)
  if (typeof objectValue._ === 'string') return objectValue._
  return undefined
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function localName(name: string): string {
  return name.includes(':') ? name.split(':').pop()! : name
}
```

```py
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from django.conf import settings

CAS_VALIDATE_TIMEOUT = 10

ID_TYPE_NAMES = {
    "1": "本科生", "2": "研究生", "3": "教师", "21": "外聘专家", "22": "外籍教师", "26": "临时人员", "27": "国培生",
    "28": "非学历", "29": "留学生", "30": "业务遗留", "31": "进修生", "99": "访客",
}


class CasError(Exception):
    pass


class CasUnavailable(CasError):
    pass


def build_login_url(service_url):
    return f"{settings.CAS_BASE_URL}/login?{urllib.parse.urlencode({'service': service_url})}"


def build_logout_url(service_url=None):
    if service_url:
        return f"{settings.CAS_BASE_URL}/logout?{urllib.parse.urlencode({'service': service_url})}"
    return f"{settings.CAS_BASE_URL}/logout"


def validate_ticket(ticket, service_url):
    data = urllib.parse.urlencode({"service": service_url, "ticket": ticket}).encode()
    req = urllib.request.Request(
        f"{settings.CAS_BASE_URL}/proxyValidate", data=data, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/xml,text/xml,*/*"},
    )
    try:
        with urllib.request.urlopen(req, timeout=CAS_VALIDATE_TIMEOUT) as resp:
            if resp.status != 200:
                raise CasError("CAS ticket validation failed")
            xml = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise CasError(f"CAS ticket validation failed ({e.code})") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise CasUnavailable("DLUFL CAS service is unreachable") from e
    return parse_validation_xml(xml)


def _local(tag):
    if "}" in tag:
        tag = tag.split("}", 1)[1]
    return tag.split(":")[-1]


def parse_validation_xml(xml):
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        raise CasError("CAS response is not valid XML") from e
    success = next((el for el in root.iter() if _local(el.tag) == "authenticationSuccess"), None)
    if success is None:
        failure = next((el for el in root.iter() if _local(el.tag) == "authenticationFailure"), None)
        raise CasError((failure.text or "").strip() or "CAS authentication failed" if failure is not None else "CAS authentication failed")
    attributes = {}
    cas_user = None
    for el in success:
        name = _local(el.tag)
        if name == "user":
            cas_user = (el.text or "").strip()
        elif name == "attributes":
            for child in el:
                cname = _local(child.tag)
                if cname == "attribute":
                    attr_name = (child.get("name") or "").strip().lower()
                    attr_value = child.get("value")
                    if attr_name and attr_value is not None:
                        attributes[attr_name] = attr_value
                elif child.text is not None and child.text.strip():
                    attributes[cname.lower()] = child.text.strip()
    id_number = attributes.get("id_number") or cas_user
    user_name = attributes.get("user_name")
    if not id_number or not user_name:
        raise CasError("CAS response is missing user identity")
    id_type = attributes.get("id_type")
    return {
        "id_number": id_number.strip(),
        "user_name": user_name.strip(),
        "unit_name": attributes.get("unit_name"),
        "user_id": attributes.get("user_id"),
        "id_type": id_type,
        "id_type_name": ID_TYPE_NAMES.get(id_type) if id_type else None,
        "user_type": "TEACHER" if id_type == "3" else "STUDENT",
        "attributes": attributes,
    }
```

这两份代码的逻辑是差不多的，只是给你一个简单的参考，但是你在制作CAS插件时应该做成通用的，不能仅仅局限于此。

我把官方 CAS 3.0.3 规范、Apereo 当前实现/官方 Java Client，以及你给的腾讯 OneID、飞连、Authing、Quick BI 和大外 CAS 实践放在一起看了一遍。结论是：**Qualy 的 CAS 插件不应该写成“大外 CAS 适配器”，但也没有必要复制 OneID 那种完整 IAM 映射平台。应该做成“标准 CAS Client + 少量兼容开关 + 可配置身份取值”的通用驱动。**

CAS 当前正式协议版本仍然是 **3.0.3**。CAS 1/2/3 并不是三套完全不同的登录协议，核心 `/login -> ticket -> server-side validation` 一直没变；主要演进是验证响应、属性、代理认证、SLO 等能力。Apereo CAS 4.x 以后支持 CAS 3.0。

### 先把 CAS 的真正协议模型定下来

我建议 Qualy 内部不要把 CAS 理解成“OAuth 的简化版”。它实际上是：

```text
浏览器
  │
  │ GET CAS /login?service=<Qualy callback>
  ▼
CAS Server
  │
  │ 用户登录 / 已有 TGC
  │
  └──── redirect ────>
          service?ticket=ST-xxx

Qualy callback
  │
  │ server-to-server
  │ validate(service + ticket)
  ▼
CAS Server
  │
  └──── principal + attributes
          │
          ▼
       Qualy User
          │
          ▼
       Qualy Session
```

这里最重要的是 `service` 和 `ticket`。

Service Ticket 是**绑定到特定 service 的一次性凭据**。官方规范要求 ST 只能针对签发时的 service 使用，而且无论验证成功还是失败，一次验证尝试后都应失效；未验证 ticket 推荐生命周期不超过约 5 分钟。

因此我们之前 Phase E 的 `auth_flow` 非常适合 CAS，但要坚持：

```text
登录时传给 CAS 的 service
===
验证 ticket 时传给 CAS 的 service
```

不能 callback 时再“差不多拼一个 URL”。

---

### CAS 1 / 2 / 3 到底分别需要支持什么

| 能力         | CAS 1.0       | CAS 2.0                    | CAS 3.0                   |
| ------------ | ------------- | -------------------------- | ------------------------- |
| 登录         | `/login`      | `/login`                   | `/login`                  |
| 基础验证     | `/validate`   | `/serviceValidate`         | `/p3/serviceValidate`     |
| 返回格式     | `yes/no` 文本 | CAS XML                    | CAS XML，可要求 JSON      |
| 用户标识     | username      | `<cas:user>`               | `<cas:user>`              |
| 用户属性     | 无            | 非标准扩展较多             | 标准化 `<cas:attributes>` |
| Proxy Ticket | 否            | `/proxyValidate`、`/proxy` | `/p3/proxyValidate`       |
| SLO          | 无完整标准    | 有实现                     | 标准明确                  |

CAS 1 的 `/validate` 成功响应基本就是：

```text
yes
username
```

失败是：

```text
no
```

CAS 2 的 `/serviceValidate` 开始返回 `serviceResponse` XML；`/proxyValidate` 与它类似，但**还允许 Proxy Ticket**。

CAS 3 的 `/p3/serviceValidate` 明确增加用户属性返回，官方响应结构允许：

```xml
<cas:authenticationSuccess>
  <cas:user>username</cas:user>
  <cas:attributes>
    ...
  </cas:attributes>
</cas:authenticationSuccess>
```

而且属性可以重复，例如 affiliation 可以出现多次，所以内部模型绝对不能是你现在示例代码里的：

```ts
Record<string, string>
```

否则：

```xml
<cas:affiliation>staff</cas:affiliation>
<cas:affiliation>faculty</cas:affiliation>
```

后一个会把前一个覆盖掉。官方示例正好就存在这种多值属性。

我建议统一成：

```ts
interface CasPrincipal {
  principal: string
  attributes: Readonly<Record<string, readonly string[]>>
  proxies: readonly string[]
}
```

单值也是数组：

```ts
{
  id_number: ['2023123456'],
  user_name: ['张三'],
  affiliation: ['student', 'member']
}
```

Driver 上层再提供：

```ts
firstAttribute(profile, 'id_number')
```

而不是 parser 直接损失信息。

---

## 你们学校的返回其实是一个很典型的“CAS 兼容实现”

你给的两份代码有三个明显的非标准/兼容性特点：

```text
/login
/proxyValidate
POST form
```

而且 XML 既可能：

```xml
<cas:...>
```

也可能：

```xml
<sso:...>
```

属性又可能不是标准的：

```xml
<cas:id_number>xxx</cas:id_number>
```

而是：

```xml
<attribute name="id_number" value="xxx"/>
```

所以当前两份代码里 `localName()` 的思路是对的：

> 不信 prefix，解析 local name。

但实现应该更严格一点。

不要像 Python 版本这样：

```py
next(
  el for el in root.iter()
  if _local(el.tag) == "authenticationSuccess"
)
```

因为这样会接受任意深度嵌套的 `authenticationSuccess`。

应该要求结构是：

```text
serviceResponse
└── authenticationSuccess
    ├── user
    ├── attributes
    ├── proxyGrantingTicket?
    └── proxies?
```

也就是 prefix/namespace 可以宽容，**结构不能宽容**。

---

# 我建议的 `@qualy/plugin-auth-cas`

它继续完全符合你现在 Phase B–E 的边界：

```text
@qualy/plugin-auth
    Session
    AuthProvider
    auth_flow
    tenant/origin
    user resolution
          ▲
          │
@qualy/plugin-auth-cas
    CAS protocol implementation
```

CAS Driver：

```ts
const casDriver: LoginDriver = {
  type: 'cas',

  provisioning: {
    mode: 'tenant-managed',
    entrance: ...
  },

  resolution: {
    mode: 'user-field',
    field: 'businessNo'
  },

  presentation: {
    mode: 'redirect',
    href: ({ code }) => `/auth/cas/${code}/start`
  },

  callback: ({ code }) =>
    `/auth/cas/${code}/callback`
}
```

第一版我仍然建议 **CAS 最终解析到 `User.businessNo`，不建 UserAuthBinding**。

这里的 `businessNo` 不是“大外学号”，而是 Qualy 的“机构人员编号”：

```text
大学 → 学号 / 工号
企业 → 员工号
学校 → 学籍号
机构 → 人员编号
```

所以并不学校特化。

真正应该配置的是：

> CAS 返回的什么字段代表 Qualy 的人员编号。

---

# 身份映射不要学 OneID 做脚本语言

腾讯那套：

```text
user.xxx
upper()
lower()
?:
fromJSON()
数组操作
...
```

是一个完整 IAM 平台需要的功能。

Qualy 现在做它，我认为是明显过度设计。

第一版只需要：

```ts
type CasIdentitySource =
  | { kind: 'principal' }
  | {
      kind: 'attribute'
      name: string
      fallbackToPrincipal: boolean
    }
```

甚至可以支持优先级：

```text
人员编号取值：

1. attribute: id_number
2. CAS principal
```

于是大外：

```text
CAS:
  id_number = 20230001
  user      = 20230001

Qualy:
  businessNo = 20230001
```

某企业：

```text
CAS:
  employeeNumber = E1024
  user           = zhangsan

Qualy:
  businessNo = E1024
```

另一个 CAS：

```text
CAS:
  user = E1024

Qualy:
  businessNo = E1024
```

这已经覆盖大量现实场景。

以后确实有人遇到：

```text
DOMAIN\E1024
```

需要变成：

```text
E1024
```

再增加一个受控 transform pipeline：

```text
trim
lowercase
uppercase
strip-prefix
regex-capture
```

都比允许管理员执行任意脚本合理。

---

# Provider 配置不要只有 `CAS_BASE_URL`

大厂产品为什么往往让管理员填：

```text
登录地址
Ticket 校验地址
登出地址
```

而不是只填：

```text
CAS_BASE_URL
```

你们学校就是一个活例子。

标准 CAS 3 通常：

```text
https://cas.example.com/cas/login
https://cas.example.com/cas/p3/serviceValidate
https://cas.example.com/cas/logout
```

大外却是：

```text
/login
/proxyValidate
```

所以我会让 UI 提供“标准配置”和“高级配置”，但数据库最终保存的是已经展开的明确 endpoint。

比如最终 `AuthProvider.config`：

```text
loginUrl
validationUrl
logoutUrl?

validation:
  requestMethod
  responseFormat

identity:
  source
  attributeName?
  fallbackToPrincipal

login:
  renew
```

不要持久化成一个含糊的：

```text
casBaseUrl
```

然后运行时猜路径。

UI 可以让用户输入：

```text
CAS 服务地址
协议版本：CAS 3.0
```

然后自动预填：

```text
/login
/p3/serviceValidate
/logout
```

管理员需要时展开“高级设置”修改。

---

## Ticket Validation 这里尤其要做兼容层

官方规范主要展示 query GET 方式，而你们学校明确使用：

```http
POST /proxyValidate
Content-Type: application/x-www-form-urlencoded

service=...
ticket=...
```

因此我会允许：

```ts
validationRequestMethod:
  | 'GET'
  | 'POST'
```

GET：

```text
/validate?service=...&ticket=...
```

POST：

```text
Content-Type: application/x-www-form-urlencoded

service=...
ticket=...
```

默认：

```text
GET
```

大外：

```text
POST
```

同样响应格式建议：

```ts
responseFormat:
  | 'auto'
  | 'xml'
  | 'json'
  | 'cas1-text'
```

CAS 3.0.3 正式规范已经定义 `format=XML|JSON`，不传时默认 XML。

但是：

> **不要默认请求 JSON。**

因为大量高校、老系统、自研 CAS 根本没做这个扩展。

默认：

```text
不传 format
Accept: application/xml,text/xml,...
```

管理员明确选择 JSON 才：

```text
format=JSON
Accept: application/json
```

`auto` 则根据 Content-Type + 内容判断。

---

# `/proxyValidate` 可以兼容，但 Qualy 不应该因此接受 Proxy Ticket

这是大外案例里最值得专门处理的一点。

CAS 规范：

```text
/serviceValidate
    只能验证 ST

/proxyValidate
    可以验证 ST + PT
```

大外虽然调用的是：

```text
/proxyValidate
```

实际上 Qualy 登录收到的仍应是：

```text
ST-...
```

而不是：

```text
PT-...
```

因此 callback 在向 CAS 发请求前直接做：

```ts
if (!ticket.startsWith('ST-')) {
  reject()
}
```

CAS 规范规定 Service Ticket 必须以 `ST-` 开头，而 Proxy Ticket 是 `PT-` 系列。

这样：

```text
validationUrl = /proxyValidate
```

只是兼容 CAS Server，

并不意味着：

```text
Qualy 支持 CAS Proxy Authentication
```

这两个概念一定要分开。

---

# PGT / PT 第一版不要做

CAS 2/3 的 Proxy Authentication 是另一套能力：

```text
ST
 ↓
serviceValidate + pgtUrl
 ↓
PGTIOU
+
CAS → Qualy pgtUrl
       PGT
 ↓
Qualy 用 PGT 请求 /proxy
 ↓
PT
 ↓
代表用户访问第三方后端
```

规范甚至要求 `pgtUrl` 用 HTTPS，并通过 TLS 建立可信连接。

Qualy 当前完全没有：

> 登录后代表用户访问另外一个 CAS Service

的需求。

所以：

```text
支持 /proxyValidate 作为 ST 校验地址   ✓
支持 Proxy Ticket 登录               ✗
申请 PGT                             ✗
保存 PGT                             ✗
调用 /proxy                          ✗
```

以后真需要 PGT，正好接你之前预留的：

```text
SessionAuthGrant
```

因为 PGT 是典型的“跟登录会话相关的外部凭证”。

---

# `renew` 和 `gateway`

这两个是正式 CAS 能力。

`renew=true` 表示：

> 不接受已有 CAS SSO Session，要求用户重新提交主凭证。

`gateway=true` 则相反：

> 不允许 CAS 弹登录页；如果已有 SSO 就给 ticket，否则直接返回 service 且没有 ticket。

两者不能一起使用。

Qualy 我建议：

```text
强制重新认证 renew
→ 高级配置，可支持

gateway
→ 协议层支持 callback 无 ticket
→ 第一版 UI 不开放
```

因为 `gateway` 更多是“静默探测用户有没有 CAS Session”，并不是普通的“点击 CAS 登录”场景。

---

# login `method=POST` 也应该留兼容能力

CAS 3 还定义了：

```text
method=GET
method=POST
method=HEADER
```

默认通常 GET；POST/HEADER 是否实现由 CAS Server 决定。

Qualy 不需要 HEADER。

但是 callback 最好天然同时有：

```text
GET  /auth/cas/:code/callback
POST /auth/cas/:code/callback
```

GET 读：

```text
ticket query
```

POST 可以读：

```text
ticket form
```

这样将来遇到要求 `method=POST` 的 Server 不需要重新改 Driver。

---

# AuthFlow 与 CAS 的组合方式

我会这样实现：

```text
GET /auth/cas/:code/start

1. resolve provider
2. providerReadiness
3. start auth_flow
4. 产生 flow state
5. 构造：

   https://qualy.example.com/api/auth/cas/foo/callback
      ?flow=<state>

6. 上面的完整字符串就是 service
7. redirect：

   CAS_LOGIN
      ?service=<encoded service>
```

CAS 回来：

```text
GET callback
  ?flow=...
  &ticket=ST-...
```

随后：

```text
consume auth_flow
        ↓
取出 provider
        ↓
重新构造 EXACT service
        ↓
validate CAS ticket
        ↓
parse CasPrincipal
        ↓
extract businessNo
        ↓
findUserByField
        ↓
completeLogin
        ↓
303 returnPath
```

这里 `flow` 放进 `service` 没问题。

而且有一个非常重要的收益：

```text
CAS ticket 自己防 ticket 重放
auth_flow 防 callback CSRF / 登录流程串线
```

两个不是重复的。

---

# `service` 最好在 flow 中保存 canonical 字符串

我会进一步修改 Phase E：

```text
auth_flows.payload_sealed
```

对 CAS 保存：

```text
serviceUrl
```

而不是 callback 时重新拼。

原因是 CAS 会严格检查 validation 时的 service 与签发 ST 时的 service 是否匹配；如果 service 不匹配，标准错误就是 `INVALID_SERVICE`，而且这个 ticket 随后也必须失效。

所以：

```text
生成一次
→ 保存
→ login 用它
→ validation 仍用它
```

不要依赖：

```text
new URL()
```

第二次序列化恰好生成完全一样的字符串。

---

# CAS XML Parser 需要重新设计

你给的 parser 可以作为 fixture，但我不会原样进入 Qualy。

内部输出：

```ts
interface CasValidationSuccess {
  principal: string
  attributes: Readonly<Record<string, readonly string[]>>
  proxies: readonly string[]
  proxyGrantingTicketIou?: string
}
```

解析规则：

```text
允许：
cas:serviceResponse
sso:serviceResponse
serviceResponse

但只认 localName = serviceResponse
```

然后它的**直接子节点**只能判：

```text
authenticationSuccess
authenticationFailure
```

success 下：

```text
user
attributes
proxyGrantingTicket
proxies
```

属性同时支持：

```xml
<attributes>
  <id_number>123</id_number>
</attributes>
```

以及你们学校：

```xml
<attributes>
  <attribute name="id_number" value="123"/>
</attributes>
```

重复值全部保存。

不要 lower-case 后直接覆盖。

---

# XML 安全这里要认真一点

CAS Server 虽然是可信上游，但“管理员能配置 validation URL”之后，本质上它仍然是网络输入。

至少要求：

```text
最大响应体，例如 1 MiB
拒绝 <!DOCTYPE
拒绝自定义实体
解析器不开 external entity
结构严格验证
超时
```

这里我现在反而不建议随手上一个默认配置的 `fast-xml-parser`。它在 2026 年连续出现了多项 DOCTYPE/entity expansion 安全公告；维护方给出的规避方式也包括关闭 entity processing。

如果最后选它，也至少：

```text
锁最新安全版本
processEntities: false
解析前直接拒绝 <!DOCTYPE
响应大小限额
```

而不是：

```ts
new XMLParser().parse(untrustedXml)
```

直接裸跑。

---

# CAS 的网络请求也必须进入统一 Auth Outbound Policy

这不是 CAS 独有问题。

未来：

```text
CAS validationUrl
OIDC discovery URL
OIDC token endpoint
OAuth userinfo endpoint
SAML metadata URL
```

全部都是管理员配置、由 Qualy Server 主动访问的 URL。

这是一个 SSRF 面。

所以不要在 `auth-cas` 自己写：

```ts
fetch(config.validationUrl)
```

应该在 auth infra 里最终有一个统一策略：

```text
HTTPS production required
禁止 URL credentials
禁止 fragment
validation 请求禁止自动跟随 redirect
loopback / link-local / metadata 地址拒绝
private network 是否允许由部署策略决定
```

企业确实可能有：

```text
https://cas.internal.example
```

所以不能粗暴永久禁 RFC1918。

应该是：

```text
生产默认禁止
部署管理员显式允许 private auth upstream
```

而不是租户管理员勾一个：

```text
允许访问内网 ✓
```

---

# SLO 值得做成真正的可选标准能力

你们学校明确不支持 SLO，但通用 CAS 插件最好架构上支持。

CAS 3 的 SLO 是：

```text
用户退出 CAS
   ↓
CAS Server
   ↓ HTTP POST
Qualy service URL

logoutRequest=<SAML LogoutRequest>
```

LogoutRequest 中包含 `SessionIndex`。标准规定 CAS Server 可以向访问过的 Service 发送 POST，使对应 Service Session 失效。

Apereo 官方 Java Client 默认接收的 form field 名也正是：

```text
logoutRequest
```

这会暴露出一个我们之前 Auth Core 设计还没有的东西：

> Qualy 必须知道某个 CAS Service Ticket 创建了哪个 Qualy Session。

但我不建议为此保存原始 ST。

加一个很薄的通用表更合理：

```text
session_auth_refs

tenant_id
session_id
provider_id
kind
value_hash
created_at

UNIQUE (
  tenant_id,
  provider_id,
  kind,
  value_hash
)
```

CAS 登录成功：

```text
kind = cas-service-ticket
value_hash = sha256(ST-xxx)
```

SLO：

```text
logoutRequest
 ↓
SessionIndex = ST-xxx
 ↓
sha256
 ↓
session_auth_refs
 ↓
delete Qualy Session
```

不保存 ticket 明文。

这个抽象以后还能服务：

```text
SAML SessionIndex
OIDC sid
```

所以它不是 CAS 特例。

并且它和未来的：

```text
session_auth_grants
```

完全不同：

```text
session_auth_refs
= 外部会话 ↔ Qualy Session 的关联键

session_auth_grants
= Qualy Session 持有的外部 access/refresh token
```

不要混。

---

# CAS 主动 Logout 和 SLO 也不要混

用户在 Qualy 点击“退出登录”：

```text
默认：
只退出 Qualy
```

不要默认把用户重定向：

```text
CAS /logout
```

否则一个用户只是想退出 Qualy，却把学校整个统一认证 Session 一起杀掉，其他学校系统也可能重新要求登录。

可以以后提供：

```text
退出 Qualy
退出 Qualy 并退出统一身份认证
```

第二个才走：

```text
CAS /logout?service=...
```

CAS 3 正式规范支持 `/logout?service=` 回跳；是否实际自动回跳仍取决于 Server 配置。

---

# 一个非常重要的“不做”

我不会支持 CAS 自动创建 Qualy User。

腾讯、飞连、Authing 那些：

```text
未匹配
→ 自动创建员工
→ 更新姓名
→ 加入部门
```

是因为它们本身就是 IAM/目录产品。

Qualy 已经有：

```text
组织
用户导入
directory-import
人员类型
组织归属
人员编号
```

所以 CAS 登录应该只有：

```text
CAS 证明你是 X
        ↓
Qualy 找已有 X
        ↓
登录
```

找不到：

```text
统一身份认证成功，但系统中没有匹配的人员
```

而不是：

```text
CAS 登录顺手给你创建一个 User
```

否则 Auth Driver 会开始修改组织目录，职责彻底乱掉。

---

# 大外最终会是一份“普通配置”，而不是特殊代码

按照上面的通用模型，大外只是：

```text
名称
  大连外国语大学统一身份认证

登录地址
  https://cas.dlufl.edu.cn/cas/login

Ticket 校验地址
  https://cas.dlufl.edu.cn/cas/proxyValidate

验证请求
  POST form

响应格式
  XML / auto

人员编号来源
  attribute: id_number
  fallback: CAS principal

强制重新认证
  false

SLO
  false
```

于是代码里不会出现：

```ts
CAS_BASE_URL = 'https://cas.dlufl.edu.cn'
ID_TYPE_NAMES = ...
id_number
user_name
unit_name
```

这些学校特有内容。

尤其：

```text
user_name
unit_name
id_type
```

Qualy 登录根本不需要。

CAS 返回了可以解析，但不应该在每次登录时偷偷覆盖：

```text
User.displayName
User.userType
组织归属
```

这些属于 Qualy Directory，而不是 Auth。

---

# Phase F 我会怎么切

如果接着你现在 A–E 的开发计划，我会让 CAS 这一阶段实际包含这些能力：

1. `@qualy/plugin-auth-cas` tenant-managed driver。
2. 标准 CAS 1/2/3 validation parser + XML/JSON。
3. GET/POST ticket validation。
4. configurable login/validation/logout endpoints。
5. principal/attribute → businessNo 映射。
6. `renew`。
7. GET + POST callback。
8. DLUFL XML 作为 compatibility fixture。
9. 可选 SLO + `session_auth_refs`。
10. Auth outbound URL safety。
11. **同时完成 callback query tracing redaction。**

最后这一项我现在会从你之前的：

> “等第一个 ticket/code/state 路由再做”

正式移动到 CAS commit。

因为 CAS callback 第一次会真正出现：

```text
?ticket=ST-xxxxxxxx
&flow=xxxxxxxx
```

官方规范又明确 ST 是短期一次性 credential。不能让 Effect tracing 的：

```text
url.full
url.query
```

把完整 ticket 写进 telemetry。

---

至于 Node 库，我仍然倾向于**自己实现一个薄 CAS protocol client，不采用 Passport/Auth.js 一类框架**。目前比较完整的 `http-cas-client` 已经约 5 年没发版，而且依赖 axios 0.21、旧 cookie/xml2js；较新的 `next-cas-client` 又绑定 Next.js 和自己的 session 模型。它们的职责都明显超过 Qualy 所需要的“构造 URL + 验 ST + 解析 response”。

CAS 本身其实协议面并不大。**最难的不是实现 `/login` 和 `/serviceValidate`，而是把兼容性、身份映射、SLO、SSRF、ticket 生命周期和 Qualy 自己的 Session/AuthFlow 边界划清楚。** 按上面这个模型做，既可以直接接大外，也不会锁死在大外的 CAS 实现上。

我会把两者做成明显不同的产品层级：

**OIDC：做成 Qualy 的一等、通用企业认证协议。**  
**OAuth 2.0：第一版不要做“万能 OAuth 认证源”，只做 GitHub 这类明确 Provider 的适配器。**

原因不是实现难度，而是协议语义。OIDC 本身就是建立在 OAuth 2.0 上的身份层，标准化了 `issuer`、`sub`、ID Token、UserInfo、Discovery 等身份概念；纯 OAuth 2.0 没有规定“哪个字段是用户 ID”“UserInfo 长什么样”。

### OIDC 我建议做到这个程度

Qualy 的 `auth-oidc` 应该能比较正规地接 Microsoft Entra ID、Keycloak、Authentik、Okta、学校/企业自建 OIDC，而不是只够 Google 登录。

第一版协议范围直接限定为：

```text
Authorization Code Flow
+ PKCE S256
+ state
+ nonce
+ ID Token validation
+ Discovery
+ optional UserInfo
```

不做：

```text
Implicit Flow
Hybrid Flow
Password Grant
Device Flow
CIBA
JAR / PAR / JARM
DPoP
FAPI
Dynamic Client Registration
```

`openid-client` 已经覆盖 Discovery、Authorization Code、PKCE、nonce、UserInfo、issuer 校验以及大量协议验证，Qualy 应该让它负责协议正确性，而不是自己验证 JWT。

虽然 OAuth 2.1 到 **2026 年 9 月仍然只是 Internet-Draft**，不是正式 RFC，所以文档里不要写“符合 OAuth 2.1”。但实现安全基线应采用 RFC 9700 的现代做法：Authorization Code + PKCE S256，不实现 implicit/password 等旧模式。RFC 9700 已明确把 PKCE 作为现代安全基线。

### OIDC 配置不需要像 OneID 那么复杂

我建议管理页面第一层只有：

```text
名称
标识

Issuer
Client ID
Client Secret
Scopes
```

Scopes 默认：

```text
openid profile email
```

且 `openid` 不允许删除。

Qualy 根据：

```text
https://idp.example.com
```

自动 Discovery：

```text
authorization_endpoint
token_endpoint
jwks_uri
userinfo_endpoint
end_session_endpoint
supported algorithms
token endpoint auth methods
...
```

OIDC Discovery 本来就是为这个用途设计的。

不要模仿 OneID 把：

```text
输入 issuer
输入 Well-Known URL
手填所有 endpoint
```

三个模式全部摆在第一层。

建议只有：

```text
自动发现（默认）
高级：手动配置
```

手动配置时才开放：

```text
Issuer
Authorization Endpoint
Token Endpoint
JWKS Endpoint
UserInfo Endpoint（可选）
```

而且即使手填，`issuer` 仍必须存在。

我也不建议提供“直接输入 arbitrary well-known URL”。`openid-client` 自己都明确说，直接给 discovery document URL 虽然支持，但不推荐，因为会失去正常的 metadata issuer validation。

---

### Token Endpoint 身份验证支持两种就够了

第一版：

```text
client_secret_basic
client_secret_post
```

默认根据 Discovery 支持情况选择。

如果两种都支持，我倾向：

```text
client_secret_basic
```

管理员可以在高级设置手动选。

暂时不做：

```text
client_secret_jwt
private_key_jwt
mTLS
```

如果某企业 IdP 只支持这些方式，Provider 页面明确提示：

> 当前 Qualy 版本不支持该客户端认证方式

而不是为了“通用”第一版就把私钥生命周期、证书轮换全部拖进来。

---

### PKCE 我会直接强制 S256

这里我不会像一些老 IAM 产品一样提供：

```text
不开启 PKCE
plain
S256
```

第一版直接：

```text
S256
```

而且不能管理员关闭。

RFC 9700 已把 PKCE 纳入现代 OAuth 安全基线，并指出当前能够避免 verifier 暴露的 challenge method 就是 S256。

如果以后真的碰到一个古老企业 OIDC：

> 不支持 PKCE，但必须接

再增加一个明确叫：

```text
兼容旧版身份服务
```

的部署级兼容开关，而不是今天先把不安全选项暴露给所有租户。

---

## OIDC 身份必须固定为 `sub`

这一点不要做 OneID 那种：

```text
唯一标识优先级：
email
preferred_username
phone
sub
...
```

OIDC 已经替我们定义了身份：

```text
issuer + sub
```

Qualy 一个 AuthProvider 已经固定了 issuer，因此 Binding：

```text
providerId + sub
```

就是稳定身份。

所以：

```text
UserAuthBinding.subject = sub
```

绝不能允许：

```text
subject = email
subject = preferred_username
subject = name
```

这些都可能变化。

`email / preferred_username / name` 只用于：

```text
displayLabel
```

比如：

```text
Microsoft 365
zhangsan@school.edu.cn
```

底层实际上：

```text
subject = a8fed22d-...
```

---

### 还有一个之前设计里容易漏掉的点：`clientId` 也应属于 identity namespace

之前我们只说：

```text
issuer
```

有 Binding 后禁止改。

我现在会改成至少：

```text
issuer
clientId
```

都锁定。

因为 OIDC 支持 **pairwise subject identifier**。同一个真实用户面对不同 Client 时，OP 完全可能返回不同的 `sub`。

因此：

```text
Provider 已经产生过任何 Binding
```

以后：

```text
issuer     不可修改
clientId   不可修改
```

想换 Client ID：

```text
创建新的 OIDC 登录方式
```

而：

```text
Client Secret
Scopes
Token auth method
显示名称
```

可以改。

这一点比只锁 issuer 更正确。

---

## UserInfo 应该支持，但不能依赖它才能登录

完成 Code Flow 后拿到：

```text
ID Token
Access Token
```

ID Token 已经足够证明：

```text
issuer
sub
audience
expiry
nonce
```

所以登录身份判断完全依据经过验证的 ID Token。

UserInfo 只是辅助取得：

```text
name
preferred_username
email
picture
```

我会采用：

```text
ID Token claims
        ↓
缺少友好展示信息？
        ↓
如果有 UserInfo Endpoint
→ 尝试 UserInfo
```

但如果：

```text
ID Token 合法
sub 已获得

UserInfo 临时 500
```

我倾向于**不要因此拒绝登录**。

因为 UserInfo 不是身份成立的必要条件。

Binding 可以暂时显示：

```text
OIDC 账号
```

以后登录成功再更新 `displayLabel`。

另外 UserInfo 返回的 `sub` 如果存在，必须和 ID Token `sub` 一致。

---

## 不要把 OIDC claims 同步进 Qualy User

我也不会第一版实现：

```text
OIDC.name → User.displayName
OIDC.email → User.email
OIDC.department → OrgNode
```

更不会：

```text
每次登录更新用户资料
```

原因和 CAS 一样。

Qualy 已经有自己的：

```text
Directory
组织导入
User
businessNo
email
UserType
OrgNode
```

Auth Provider 的职责是：

> 证明登录者是谁。

不是：

> 顺便成为另一个用户目录同步系统。

---

# 但这里有一个值得提前考虑的产品问题

OIDC 企业 SSO 有两种合理模式。

第一种是我们现在设计的：

```text
OIDC sub
↓
UserAuthBinding
↓
User
```

也就是：

> 先绑定，再登录。

这是 GitHub、个人 Microsoft/Google 登录最合理的模型。

但企业场景可能更希望：

```text
OIDC claim:
employee_number = 20230001

↓
直接匹配

User.businessNo = 20230001
```

这和 CAS 完全一样。

比如一个学校未来不用 CAS，而给你 OIDC：

```json
{
  "sub": "82a19...",
  "student_number": "20230001"
}
```

要求所有几千名学生先自己绑定一次，体验显然不好。

所以长期来看，我认为 Qualy 最终应该支持两种 **账号关联方式**：

| 模式         | 用途                           |
| ------------ | ------------------------------ |
| 外部账号绑定 | `sub → UserAuthBinding → User` |
| 机构字段匹配 | claim → `User.businessNo`      |

但是——**我不建议为了第一版 OIDC 现在就把它塞进 Phase B–E Core。**

第一版：

```text
CAS
→ businessNo 直接匹配

OIDC
→ sub Binding

GitHub
→ GitHub ID Binding
```

已经覆盖你的真实部署。

等真正出现：

> 某客户只有 OIDC，并希望用 employeeNumber 自动匹配 Qualy 用户

再把当前：

```ts
LoginDriver.resolution
```

升级成 Provider-level association policy。

而不是今天为了一个尚不存在的需求把 Auth Core 又推翻一次。

---

# OIDC Clock Skew 可以有，但放高级设置

腾讯 OneID 提供 Max Clock Skew 是合理的。

Qualy 可以：

```text
时钟容差
默认 60 秒
范围 0–300 秒
```

但 UI 放“高级设置”。

不要允许：

```text
3600 秒
86400 秒
```

那已经是在掩盖服务器时钟错误。

---

# OIDC Logout 第一版只做 Qualy 本地退出

OIDC 确实已经有正式的：

```text
RP-Initiated Logout
Front-Channel Logout
Back-Channel Logout
Session Management
```

相关 Logout 规范目前都是 Final Specification。

但我不会在第一版全部实现。

第一版：

```text
退出
→ 删除 Qualy Session
```

就够。

第二阶段可以加入：

```text
退出 Qualy 并退出统一身份认证
```

如果 Discovery 存在：

```text
end_session_endpoint
```

再使用 RP-Initiated Logout。

更以后支持 Back-Channel Logout 时，正好复用我刚才 CAS 提议的：

```text
session_auth_refs
```

例如 OIDC ID Token 有：

```text
sid = abc
```

保存：

```text
providerId
kind = oidc-sid
valueHash = sha256(sid)
sessionId
```

收到经过验证的 Logout Token：

```text
iss
sid
```

就可以结束对应 Qualy Session。

OIDC Back-Channel Logout 本身也正是用 `sid` 或 `sub` 标识要注销的 RP Session。

所以 CAS：

```text
ST → session
```

OIDC：

```text
sid → session
```

可以落到同一个通用抽象。

---

# 再说 OAuth 2.0：我不建议第一版做 Generic OAuth

这是我和你给的 OneID 设计差异最大的一块。

OneID 可以要求管理员填写：

```text
Authorization Endpoint
Token Endpoint
UserInfo Endpoint
Token 携带方式
UserInfo GET/POST
Client Auth Basic/Form
sub 字段
preferred_username 字段
...
```

因为它的定位就是：

> 万能身份连接平台。

Qualy 没必要第一版走到这里。

纯 OAuth 回调完成后，你只能确定：

```text
我拿到了一个合法 access token
```

协议本身没有告诉你：

```text
这个用户的唯一标识是什么
```

更没有标准化：

```text
GET /userinfo
{
  id: ?
  user_id: ?
  sub: ?
}
```

这正是 OIDC 存在的原因。OIDC 明确是 OAuth 2.0 之上的身份层。

所以我会做：

```text
@qualy/plugin-auth-github
```

而不是先做：

```text
@qualy/plugin-auth-oauth2
```

GitHub Driver 自己知道：

```text
Authorization Endpoint
Token Endpoint
GET /user

user.id
= stable subject

user.login
= displayLabel
```

以后如果需要：

```text
飞书
钉钉
GitLab
企业微信
```

先各自做 adapter。

出现第二、第三个 adapter 以后再抽内部 OAuth helper。

---

## GitHub OAuth 应做到什么程度

就是：

```text
Authorization Code
PKCE S256
state

code → access token
access token → GET /user

subject = String(user.id)
displayLabel = user.login

创建/查 UserAuthBinding

丢弃 access token
```

不要请求：

```text
repo
workflow
read:org
```

除非登录确实需要。

也不要为了取得 email 要：

```text
user:email
```

Qualy 根本不需要 GitHub email 证明身份。

---

# 如果未来做 Generic OAuth，我会限制得非常死

等真正出现需求以后，我允许的 Generic OAuth 第一版最多只有这些配置：

```text
Authorization Endpoint
Token Endpoint
UserInfo Endpoint

Client ID
Client Secret

Scopes

Token Endpoint Authentication:
  client_secret_basic
  client_secret_post

UserInfo:
  GET
  Bearer Authorization header

唯一标识字段:
  JSON Pointer

显示字段:
  JSON Pointer
```

例如：

```text
subject
  /id

displayLabel
  /login
```

或者：

```text
subject
  /data/user/id
```

用 RFC JSON Pointer 或自己极简单的 path selector。

**绝对不要第一版做：**

```text
JavaScript 自定义脚本
表达式语言
任意 Header 模板
任意 HTTP Body
任意 access-token 携带方式
任意 UserInfo transformation
登录后创建 User
登录后修改组织
```

否则你最后不是写 Auth Driver，而是在写一个低代码 HTTP workflow engine。

---

# Generic OAuth 还有一个 OIDC 没那么棘手的安全问题：Mix-Up

Qualy 会同时支持多个外部认证服务器：

```text
GitHub
某企业 OAuth
另一个企业 OAuth
```

现代 OAuth 安全建议要求防 Authorization Server Mix-Up。RFC 9207 为此定义了授权响应里的：

```text
iss
```

客户端应把它和预期 issuer 精确比较。

OIDC 天然有：

```text
issuer
ID Token iss
```

所以很好处理。

纯 Generic OAuth 如果上游：

```text
没有 RFC 8414 metadata
没有 RFC 9207 iss
```

就没有那么漂亮。

这也是为什么我更支持：

> 明确 Provider Adapter

而不是：

> 用户随便填三个 URL，Qualy 就宣布这是一个安全的 OAuth 登录方式。

对于支持 OAuth Authorization Server Metadata 的服务，可以使用 RFC 8414 metadata；其中 issuer 和 endpoint 都有标准定义。

---

# Access Token / Refresh Token 的原则仍然不变

无论：

```text
GitHub OAuth
OIDC
```

如果只是：

> 用它登录 Qualy

那么：

```text
authorization code
↓
access token
↓
拿身份
↓
创建 Qualy Session
↓
access token 丢弃
refresh token 丢弃
```

不要请求：

```text
offline_access
```

不要保存 refresh token。

只有以后出现：

> Qualy 要代表用户持续调用 Microsoft Graph / GitHub API

这种真实需求时才创建：

```text
session_auth_grants
```

加密保存 token。

**“登录”与“长期代表用户访问第三方资源”是两项不同能力。**

---

# 我现在会把 Auth Roadmap 定成这样

第一梯队：

```text
local
CAS
OIDC
GitHub
```

覆盖：

```text
Qualy 自有账号
高校/企业老 SSO
现代企业标准 SSO
典型第三方 OAuth 登录
```

第二梯队，有真实需求再做：

```text
OIDC RP-Initiated Logout
OIDC Back-Channel Logout
Generic OAuth 2.0
更多 provider-specific OAuth adapters
```

明确暂缓：

```text
OAuth token delegation
Dynamic Client Registration
FAPI
PAR/JAR/JARM
DPoP
Device Flow
CIBA
OIDC implicit/hybrid
任意属性映射脚本
自动建 User
登录同步组织目录
```

因此如果问我 Qualy 应该“做到什么程度”，我的边界是：

> **OIDC 做到足以被称为一个正规的企业 OIDC RP，而不是“能跳转回来就算支持”；OAuth 做到有安全、可靠的 Provider Adapter 机制，但暂时不要做 OneID 那种万能 OAuth 身份源构造器。**

而且研究完 OIDC 后我会对现有设计补两个裁决：**OIDC `issuer + clientId` 在产生任何 Binding 后都冻结；CAS/OIDC 的 SLO/Back-Channel Logout 将来统一通过 `session_auth_refs` 关联外部会话和 Qualy Session。** 这两个值得现在就写进 `docs/auth.md`，但都不需要阻塞当前 A–E。

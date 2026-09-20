# 租户设置与术语（Tenant Settings / Terminology）

状态：v1 已落地（2026-09-20）。设计讨论见 docs/refactor-temp.md（用户笔记，不入库）的术语部分；本文是落地后的定案。

## 一句话

**插件声明「租户可以覆盖哪些产品定义的设置」；定义决定类型与默认值；数据库只存租户的覆盖；术语是这套基础设施的第一个受约束消费者，不是第二套 i18n。**

## 分层

```text
@qualy/settings-contract        声明：SettingCategoryDefinition / LocalizedTextSettingDefinition / defineTerm
                                汇总：SettingDeclarations（prepare 相）→ compileSettingCatalog → SettingCatalog
                                解析：TenantSettings.resolveTerm(tenantId, term, locale)（服务端读取口）
@qualy/plugin-settings          tenant_setting_values 持久化、GET/PUT api、settings.terminology.manage、
                                审计 settings.term.update、术语设置页 /settings/terminology、
                                浏览器 useTerm / useTerminology（./client/terms 是唯一开放给其他插件的客户端表面）
@qualy/auth-contract/terms      authTerms.businessNumber（auth/business-number）：人员编号这一术语的唯一声明
```

## 定义的约束（compileSettingCatalog 在装配期拒绝）

- setting id 与分类 id 都是 `<namespace>/<name>`（两段 kebab-case），同一 id 只能有一个声明者；
- setting 必须指向某个插件声明过的分类；`order`、`maxLength` 非负；
- `defaults` 必须覆盖 `supportedLocales` 的每一种语言，且不超过 `maxLength`；
- v1 唯一的 kind 是 `localized-text`，唯一的 purpose 是 `term`；未来的 image/boolean 只需扩展 kind 联合类型，数据库不变。

## 存储

`tenant_setting_values (id, tenant_id, setting_id, value jsonb, version, created_at, updated_at)`，`(tenant_id, setting_id)` 唯一。

- 只存 delta：`{ "zh-CN": "统一编号" }` 表示只覆盖中文，英文沿用代码默认；默认值永不写入数据库，改默认值时未自定义的租户自动跟随。
- 恢复默认写 `{}` 而不是 DELETE，version 单调递增（0 = 从未写过；PUT 必须带回读到的 version，`SETTING_VERSION_CONFLICT` 拒绝过期写）。
- normalize：trim、空串与等于默认值的词一律丢弃、未知 locale 与超长拒绝（`SETTING_VALUE_INVALID`）。
- 不存 kind（kind 归代码），不建 updated_by 外键（谁改的归审计）。

## API

- `GET /tenant/terminology`：任何已登录用户；返回分类、每个术语的默认值 / 覆盖值 / version。
- `PUT /tenant/terminology/{namespace}/{name}`：`settings.terminology.manage`（租户级）；一个资源一个 PUT，`override: {}` 即恢复默认；写入与审计同一事务。

## 浏览器

- `useTerm(authTerms.businessNumber)` 读当前租户的词：整租户一次查询（TanStack Query，key `['settings','terminology']`），切换 locale 不重取；请求失败或未返回时用定义的默认值，屏幕不因术语而打不开。
- 句子仍归 i18n：`姓名或{businessNo}`、`未绑定{businessNo}` 由 catalog 决定语序，术语只作为参数注入；错误文案 `USER_CONFLICT` 改为中性的「该编号已被使用」。
- 术语设置页每个术语一段：标签、说明、每种语言一个输入框（placeholder 为默认值）、恢复默认、保存。

## 服务端

- assessment 的统一认定模板首列表头由 `TenantSettings.resolveTerm` 解出（`统一编号 *`）；解析器从不读回该表头，所以旧模板在术语改名后照常导入。
- assessment 通过 `Effect.serviceOption(TenantSettings)` 读取：装配里有 settings 插件时经它解析，测试 harness 没有时退回术语默认值。

## 门禁

- `tools/tests/terminology.test.ts`：生产源码里「学工号」只允许出现在 `packages/contracts/auth/src/terms.ts`。
- 路径进 `frozen-routes`，错误码进 `error-codes`，`@qualy/plugin-settings/client/terms` 进 plugin-isolation 的跨插件表面清单。

## 不做

Logo/品牌、boolean/select/image kind、任意 i18n 文案覆盖、环境变量式术语、按语言一行的存储、通用设置编辑器。

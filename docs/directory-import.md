# 用户批量导入（Directory Import）

状态：v1 已落地（2026-09-20）。设计讨论见 docs/refactor-temp.md（用户笔记，不入库）的用户导入部分；本文是落地后的定案。

## 一句话

**一次导入 = 一份 Excel + 一个工作表 + 一套字段映射 + 一条固定的组织类型链。** Import 是一次不可抹去的批量操作记录；Reverse 对它创建的用户执行正式删除语义；Node cleanup 对它创建、现在无人使用的组织节点做可重试的垃圾回收。

## 分层

```text
@qualy/spreadsheet                 xlsx 引擎：archive 守卫、限额、openWorkbook / sheetsOf / readTable / cellText、列号换算
                                   （从 assessment 的 administrative-import 抽出；统一认定的模板协议仍留在 assessment）
@qualy/org-contract/effect         OrgProvisioning 端口：rootNode / nodesById / childNamed / types / rules /
                                   createChild（调用方事务内，走 org 自己的 createNode 与审计）/ deleteUnused（各自事务）
@qualy/auth-contract/provisioning  UserProvisioning 端口：byBusinessNo / userType / placementAllowedAtType /
                                   createUsers（调用方事务内，逐节点验权、逐行判定、逐行审计）/ retireUsers（disable → deleted 全套后果）
@qualy/plugin-directory-import     编排：上传票据、inspect、mapping、preview、commit、记录、撤销、清理；页面与 users 页的「导入用户」按钮
```

directory-import 不自己判断组织规则、站位、权限；它经端口问 org / auth / rbac / storage，服务图仍是无环的。

## 组织链

- 映射 = `anchorNodeId`（每一行都归在它之下，缺省为租户根）+ 若干 `{orgTypeId, column}` 层级（顺序不限）。
- 服务端在所选类型诱导出的子图里求**唯一**顺序：每一步只允许一个「没有被其他所选类型作为子类型」且「当前类型可直接下挂」的类型；两个候选是分叉（`chain-ambiguous`），零个是缺层（`chain-broken`）。绝不借未选择的类型补路径。
- 类型链属于整个 Import：每一行都必须填满每一级（`org-level-required`），终点类型相同；节点按（父节点，名称）逐级复用或创建，同名异类型是冲突（`node-type-conflict`）。
- 固定前缀就是 anchor 的祖先链，来自节点自己的 parent 链，不读 Excel。

## 用户

- 编号（`authTerms.businessNumber` 所指的 `businessNo`）必填、文件内唯一；姓名必填；人员类型整批一个。
- 已存在且姓名 / 类型 / 组织一致 → `existing`，跳过；不一致 → `user-conflict`（列出不同的字段）；已删除 → `user-deleted`。**不做导入即更新，不做导入即恢复。**
- 有任一错误行整批拒绝（`USER_IMPORT_INVALID`），不做部分成功。

## 文件限额

由 `@qualy/spreadsheet` 统一执行，名录导入与统一认定导入共用：文件不超过 10 MiB；最多 8 个工作表；单表最多 2000 行数据、128 列，单元格不超过 4000 字。**单元格数按全部工作表合计**，不超过一张满表（2001 × 128）：读取器会为工作簿里的每个工作表建对象，与导入哪一张无关，所以这条上限管的是堆。超出时以 `too-many-cells` 拒绝，界面提示删除不需要导入的工作表和行，而不是笼统的「文件过大」。

## Preview / Commit

- 文件在事务外读取（`@qualy/spreadsheet`），判定在 `plan()` 中完成：先按 mapping 求链、验证列存在、人员类型可用且可站在链尾类型、`auth.user.manage` 覆盖 anchor（有节点要建时另需 `org.tree.manage`），再折叠期望树、逐级 childNamed、批量 byBusinessNo。最后按 commit 的写法逐个问将写到的节点：新建单位要求父节点在 `org.tree.manage` 范围内，新建人员要求落位节点在 `auth.user.manage` 范围内；尚未存在的节点只由最近已存在祖先上的 subtree 授权覆盖。够不到的节点列为 `unit-out-of-reach` / `placement-out-of-reach` 问题，而不是等到 commit 才 403。
- `planFingerprint` = attachment 内容 hash + sheet/headerRow/type/链/anchor + 将建节点 + 将建/已存在的编号集合 + 错误数。Commit 在 `lockTenant` 事务内重跑 plan，指纹不同即 `USER_IMPORT_PLAN_CHANGED`。
- Commit：父先子后 `createChild` → `createUsers` → `storage.bind` → 写 directory_imports / rows / nodes → 审计 `directory.import.commit`。任一失败整体回滚。`(tenant_id, source_attachment_id)` 唯一：同一份上传只能导入一次（`USER_IMPORT_SOURCE_USED`）。

## 记录与撤销

- 表：`directory_imports`（映射与链快照、计数、anchor）、`directory_import_rows`（行 → 用户，disposition created|existing）、`directory_import_nodes`（节点，disposition created|reused，orgNodeId 不设外键）、`directory_import_events`（reversed | nodes-cleaned）。不提供删除记录。
- 读取权限：记录本身（列表、概要）要求 anchor 在读者 `auth.user.manage` 范围内（列表用 `scopeCoverage` 下推，anchor 外连接）；anchor 被另一条导入的清理删掉的记录只有租户级读者可见，而不是对所有人消失；逐行明细再按每行落位节点（`primary_org_node_id_snapshot`）与读者范围求交，同样下推进 SQL——只在 anchor 本身持有 self 覆盖的读者看不到放进下级单位的人，落位节点已被清理的行只有租户级读者可见。详情里的组织单位同样按读者范围过滤（已被清理的单位只有租户级读者可见），概要计数仍是这次导入本身的事实；详情另带 `hidden: { rows, nodes }`，给出该读者看不到的行数与单位数，界面据此提示「另有若干不在你的管理范围内」，而不是让「新建 2 人」与空列表并排出现。
- Reverse：只处理 disposition=created 且仍在的用户，经 `retireUsers`（每人 disable → 撤销授权 → 撤销登录 → 结束会话 → deleted，逐人审计，最后 `assertTenantKeepsAdministrator`）；写 event 与审计 `directory.import.reverse`；已单独删除的跳过。需要 `auth.user.manage` + `auth.user.delete`（在 retireUsers 内逐人校验）；另按「管人边界」（2026-09-25 裁决 #1、#32）逐人要求此人当前持有的每一条有效授权（含对应角色暂时停用的，不含已撤销 / 过期的）操作者都能合法授出。任何一人不满足即整次撤销被拒（`ACCESS_DENIED`，reason 说明对方持有操作者授不出的授权），没有人被撤销——例如某人导入后被任命为批次工作人员，就需要能任命该岗位的人来撤销这次导入。
- Node cleanup：本次创建的节点按深度倒序，各自一个事务调用 org 的删除语义；有子节点 / 被引用的保留并列出原因；允许部分成功，可重复执行；写 event 与审计 `directory.import.clean-nodes`。

## API（冻结在 frozen-routes）

```text
GET  /iam/user-import-options
POST /iam/user-import-uploads
POST /iam/user-import-uploads/{reservationId}/complete
GET  /iam/user-import-uploads/{attachmentId}/workbook
POST /iam/user-import-previews
POST /iam/user-imports
GET  /iam/user-imports
GET  /iam/user-imports/{importId}
GET  /iam/user-imports/{importId}/rows
POST /iam/user-imports/{importId}/reversal-previews
POST /iam/user-imports/{importId}/reversals
POST /iam/user-imports/{importId}/node-cleanups
```

## 页面

- `/organization/users/import`（五步：文件 → 工作表 → 列对应 → 预检 → 完成，右侧导入记录列表）；users 页经 `usersPageActions` 槽位放「导入用户」按钮并带上当前单位。
- `/organization/users/imports/:importId`：概要、后续操作、组织单位、逐行（keyset 分页）、撤销（必填原因）、清理。

## v1 不做

原始文件下载与逐行脱敏投影、按行动态终点、多人员类型混导、导入即更新/同步、`OrgNode.externalKey`、删除导入记录、Excel 模板下载。

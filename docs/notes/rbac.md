# 角色与授权备忘

访问模型的总纲在 AGENTS.md「访问模型与授权」；这里记 rbac 插件里后来裁决的细则。

## 角色删除与授权历史（2026-09-25 裁决 #18）

- 授权是历史：撤销只置 `revoked_at` / `revoked_by`，行保留。**产生过任何授权行的角色只能停用**（在效、已撤销、
  已过期、批次限定的都算），删除只留给从未授予过任何人的角色；拒绝码 `ROLE_HAS_GRANT_HISTORY`（409）。它取代只数在效授权的
  `ROLE_IN_USE`：撤光了也删不掉，「仍有 N 个授权」会把人引向一条走不通的路。
- 库层兜底：`fk_role_grants_role` 由 `on delete cascade` 改为 `on delete restrict`（迁移
  `20260925085627_role-grant-history.sql`，与 `fk_role_grants_user` 同理），绕过服务的删除同样被拒（SQLSTATE 23001），
  历史授权永远解析得出当时的角色名称。
- 能力走服务端：角色投影带 `everGranted`，角色页据此禁用「删除角色」并提示只能停用；删除守卫在角色行锁内读同一个投影，
  界面与写入不会各说各话。
- 与「角色 draft → active → disabled」一致：disabled 就是用过的角色的终点，重新启用即恢复。

## 撤权与任命对称（2026-09-25 裁决 #23）

- 撤销**他人**的授予，问的是授予路径里关于授出者的同一套三问（`mayConfer`）：grant-manage 覆盖该锚点与 coverage、
  管理员角色只由管理员授撤、任命规则（有效、非资源限定的持有覆盖该锚点；canonical tenant-admin 豁免 rule）。
  能任命这条授予才能撤销它，否则 `GRANT_RULE_REFUSED`（403）。不问持有资格：那是持有人的事实，不合格的授予更应撤得掉。
- **本人自撤例外**：只要 grant-manage 覆盖与管理员角色保留，不要求任命权；仍受 `LAST_ADMINISTRATOR`（写后读终态）约束。
  恢复通道只看系统账户的登录凭据，撤销授予碰不到它。
- 列表的 `manageable` 与写入同源：任命判定是一个谓词（`appointmentHeld`），写入经 `ruleAllowsAppointment` 问单条，
  授予列表逐行下推进 SQL 问同一个谓词，本人与 canonical tenant-admin 的两个例外也与写入一致。
- 删除用户时的整体撤权由「管人边界」的 `mayConferHoldings` 把关（同一个 `mayConfer`，见 docs/notes/auth-security.md）。

## 资源限定授予的撤销（2026-09-25，撤权对称的补全）

- 资源限定授予（如批次任命）不走通用撤销（`GRANT_RESOURCE_BOUND`），只经资源拥有者调用 rbac 端口
  `revokeAssignment` 撤销。端口与 `grants.revoke` 共用同一个 `mayTakeBack`：撤他人的问 `mayConfer` 三问，
  撤自己的只问 grant-manage 覆盖与管理员角色保留；授权判定在租户行锁内（锁在 rbac 内取；调用方若持批次锁，则排在其后）。拒绝在端口上统一为
  `ACCESS_DENIED`，原因保留原拒绝码（`scoped revoke refused: GRANT_RULE_REFUSED` 等）。批次的 `removeStaff`
  因此要求操作者能任命被撤的这条授予：只有名册管理权、没有对应任命规则的人不能把别人从批次里撤下。
- 端口要求拥有者重新点名资源，授予不是限定在该资源上的（限定在别的对象上，或根本不限定）一律拒绝：组织授予只经通用撤销，
  那里还守着最后管理员。已过期（`valid_until` 已过）的授予不再授予任何东西，撤掉它不问任命权，只把它标记为已撤销，好让拥有者的记录能关闭；
  尚未生效（`valid_from` 在未来）的授予生效后照样授予，撤掉它与在效的一样问任命权。
- **只读判定与写入同源**：端口 `mayRevokeAssignments({tenantId, actor, resource, assignmentIds})` 回答其中哪些
  `revokeAssignment`（`appointment`）会撤而不会拒，供拥有者的页面决定给不给撤销按钮（批次工作人员页的逐来源 `removable`）。
  它与写入调用同一个 `mayTakeBackConfined`（资源点名、过期豁免、`mayTakeBack`），只是不取租户锁；同形状的授予（本人与否、角色、锚点、
  coverage、资源、是否过期）只问一次。已撤销或不存在的授予答可撤：写入对它没有可拒绝的东西。
- **两个豁免**（`authority: 'record-closing'`，不问任命权，撤销仍记在操作者名下、仍写审计）。**来源：施工中定，实现先行，待用户确认**
  （裁决 #23 只列了本人自撤一个例外；登记在 assessment-design.md §30 第 11 条，确认后去掉本注）：
  1. **删除草稿批次**：批次记录随批次删除，留下的授予此后没有任何人能撤（通用撤销拒绝资源限定授予），且在效授予会挡住持有人改类型。
     删除草稿本身已由名册管理权授权，收尾是删除的一部分，不是另一次撤权决定。
  2. **同步清除已被组织收回的接纳**（`applyAccessSync` 中 `lapsed` 清空了某条批次任命记录）：组织已经收回了批次接纳的全部权限，
     记录被清空后同样再无人能撤；这是组织侧已发生事实的收尾，不是批次管理员替组织做的新决定。
- 两个豁免都只作用于该批次自己的记录，拒绝它们只会让授予在记录消失后永久存活。

## 授予角色时列出的角色（2026-09-26 用户裁决 #5）

- `GET /iam/role-grant-options` 在 `roles`（此刻可授予的）之外带 `refused`：**读者能任命、但不适合这个人或这个组织**的角色，
  各附原因 `user-type`（用户类型不适用）、`org-type`（组织类型不适用）、`person-disabled`（该用户已停用）、`self-escalation`（自授会扩权）、
  `unavailable`（并发中被停用或删除）；以及**读者自己持有、却没有任命边**的角色，原因 `authority`（「你没有任命该角色的权限」）。
  「持有」按读者本人当前有效（未撤销、在有效期内）、非资源限定的授予算，服务端 `grants.options` 给每个候选带 `held`，处理器只放行
  `held` 的 `authority`（2026-09-27 按决定 5 字面修正：学院管理员在授予表单里找自己的「学院管理员」时，应看到它和原因，而不是它凭空消失）。
  既不持有、任命权也不在读者手里的角色不列：那不是读者的问题，全列出来只会让整个角色目录出现在每个人面前。
  草稿、停用角色不列（候选只取同 kind、active 的角色）。处理器层的这条过滤与 `grantable` 由
  `packages/plugins/base/rbac/tests/grant-handlers.test.ts` 经真实路由守住。
- **覆盖范围先于任命权**（2026-09-27 修订，W12 审查 major）：`authority` 只表示「此处可以授予、但你没有该角色的任命边」。
  「在该组织、按该覆盖范围根本不能授予」（`iam.grant.manage` 在该节点缺失，或只到 self 而问的是 subtree；租户范围缺
  `iam.tenant-grant.manage`）与角色无关，响应带 `reach`：`within` / `unit-only` / `outside`，不是 `within` 时 `roles`、`refused` 都为空，
  表单说「在该组织你只能按『仅该组织』授予」并给「改为仅该组织」一键改覆盖范围，或说「你不能在该组织授予角色，可改选其他组织」。
  此前 `mayAdministerGrantsAt` 失败时全部候选都标 `authority`、再放行 `held` 的那些，读者持有且确有任命边的角色也被说成「你没有任命该角色的权限」。
  判定与解释同源：`mayAdministerGrantsAt` 就是 `grants.reach` 的结果，写入被拒与表单说法不会分叉。
- **停止新增授权的角色**（`assignable = false`，2026-09-27 按决定 5 字面补全：决定只排除草稿与停用）：读者持有或能任命时列出，原因 `closed`
  （「已停止新增授权」）；两者都不是时不列。读者持有但没有任命边的停止授权角色也说 `closed`（谁来都授不了，这才是该说的原因）。
  对外端口 `Rbac.listGrantableRoles` 照旧不含这类角色（候选带 `assignable`，端口过滤），assessment 的角色选择器看不到变化。
- **停用的人压过其他原因**：只要 `refused` 里出现 `person-disabled`，总述就是「启用该用户后才能授予角色」且表单只留「关闭」——该人停用时每个
  可任命的角色都会给出这个原因，读者持有而不能任命的 `authority` 行只是附带（此前得出 mixed，丢了根因，还留着永远按不下去的「授予」）。
- `reach` 为 `within` 时响应带 `holder: { displayName }`，授予系统管理员前的确认写明接收人（「将系统管理员授予张三？」）。
- **探测的泄露面（已知限制）**：处理器先问 `reach` 再查人，读者在目标处不能授予时回 `outside`、不透露该用户是否存在（此前任何登录用户都能
  用 404 与否探测任意 id 是否存在）。能授予的读者经探测得知的——该用户存在、是否停用、用户类型是否适合、显示名——与写入路径同级：写入
  也按同序回同样的原因，授出后授予列表里也会出现姓名；区别是探测没有副作用、不留审计。真正按「读者能否读到该用户」判定需要 auth 经
  auth-contract 提供可读判定端口（rbac 运行时不能依赖 auth），列入下一轮。
- `roles` 每项带 `administrator`（canonical tenant-admin）：表单只在唯一可授角色**不是**管理员角色时代选，授予管理员角色前再确认一次
  （此前「整个租户」下常常只剩系统管理员一个可授角色，打开、切换、点「授予」两下就交出了租户里最大的权力）。
- **探测与写入同序**：逐角色先问任命权（`mayAdministerRole`、`mayAppointRole`），再问资格（`eligible`），最后是自授扩权，与 `grantRole`
  的 `mayConfer` → `eligible` → 自授检查一致。此前先问资格，一个读者本来就不能任命的角色会以「用户类型不适用」出现，读起来像是换个人就能授。
  `GRANT_NOT_ELIGIBLE` 按 reason 区分 `org-type` / `user-type` / `person-disabled`，不再一律说成用户类型。
- 对外端口 `Rbac.listGrantableRoles`（assessment 人员权限的角色选择器在用）**契约不变**：仍是四个值，`org-type` 与 `person-disabled` 在端口处
  映射回 `user-type`；assessment 若要说清组织类型，另起一轮扩契约。探测顺序的变化对端口同样生效。
- `GET /iam/users/{userId}/role-grants` 带 `grantable: { tenant, organization }`（读者是否在任何地方持有 `iam.tenant-grant.manage` /
  `iam.grant.manage`）：两者皆无时页面不给「授予角色」，只能授予一种范围时表单不给范围切换。

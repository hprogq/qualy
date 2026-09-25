# 角色与授权备忘

访问模型的总纲在 CLAUDE.md「访问模型与授权」；这里记 rbac 插件里后来裁决的细则。

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
- 不在此列：批次限定授权只经批次的 `removeStaff` 撤销（`GRANT_RESOURCE_BOUND`），由批次管理权决定；删除用户时的
  整体撤权由「管人边界」的 `mayConferHoldings` 把关（同一个 `mayConfer`，见 docs/notes/auth-security.md）。

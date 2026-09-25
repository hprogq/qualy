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

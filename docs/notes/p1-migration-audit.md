# P1 迁移审计表

来源:docs/p1-tutorial.md §0.8,路径已按真实旧仓库校对。旧代码克隆在仓库根 `legacy/`
(gitignored,只读参考):`legacy/qualy_old` = github.com/hprogq/qualy_old,
`legacy/algryth` = github.com/hprogq/algryth(RBAC 参考)。旧路径以各自仓库
`apps/api/src/` 为前缀。逐项记录迁移处置;每完成一项,把状态改为 migrated / adapted /
dropped 并补充实际落点。迁移顺序纪律:先测试与领域错误,再 schema,再 repo,再 service,
最后在当前项目重写 contract/router/index;禁止整目录复制后再修。

| 旧路径(apps/api/src/…)                          | 新插件 | 处理       | 备注                    | 状态    |
| ----------------------------------------------- | ------ | ---------- | ----------------------- | ------- |
| `db/schema/tenant.ts`                           | org    | 迁移并简化 | 不迁租户 CRUD           | 待迁    |
| `db/schema/org-type.ts` / `org-type-rule.ts`    | org    | 迁移       | 改复合 FK               | 待迁    |
| `db/schema/org-node.ts`                         | org    | 迁移       | ltree + 复合 FK         | 待迁    |
| `db/schema/org-type-role.ts` 等类型关联表       | —      | 不迁       | 裁决二:类型允许关系不迁 | dropped |
| `modules/org/errors.ts`                         | org    | 直接适配   | 保留错误语义            | 待迁    |
| `modules/org/repo.ts`                           | org    | 迁移       | 去掉全局 db             | 待迁    |
| `modules/org/service.ts`(含 service.test.ts)    | org    | 迁移       | 保留移动与规则验证      | 待迁    |
| `db/schema/user.ts`                             | auth   | 简化迁移   | 删除 userType           | 待迁    |
| `db/schema/user-type.ts`                        | —      | 不迁       | 角色即可表达            | dropped |
| `db/schema/user-identity.ts`                    | auth   | 迁移并加固 | credential 改 hash      | 待迁    |
| `db/schema/auth-provider.ts`                    | auth   | 迁移       | P1 只 local             | 待迁    |
| `db/schema/session.ts`                          | auth   | 重写       | 只存 token hash         | 待迁    |
| `modules/auth/*`(含 session-cookie.ts)          | auth   | 选择性迁移 | contract/router 重写    | 待迁    |
| `modules/iam/user/*`                            | auth   | 部分迁移   | 不迁 user type          | 待迁    |
| `db/schema/role.ts` / `user-role.ts`            | rbac   | 重构       | 删除 permissions 数组   | 待迁    |
| `modules/iam/role/*`                            | rbac   | 部分迁移   | 保留节点 scope          | 待迁    |
| Algryth `database/schema/permissions.ts`        | rbac   | 提炼       | 规范化权限目录          | 待迁    |
| Algryth `database/schema/role-permissions.ts`   | rbac   | 提炼       | 简化为硬删除            | 待迁    |
| Algryth `access-control/`(CASL/Guard/casl 目录) | —      | 不迁       | 直接 permission code    | dropped |
| 旧 Web dashboard(apps/web)                      | —      | 不迁       | 当前 manifest 壳重做    | dropped |

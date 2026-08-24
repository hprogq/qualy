import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { entities as authEntities } from '../../src/db/entities.ts'

// What the orm must know for a query to name a table.
//
// In production the host hands over the generated aggregate. These suites
// compose auth with the plugins it is composed with there - org, because auth's
// rows point at its nodes, and rbac, because auth's writes ask it whether a
// tenant keeps an administrator - so the set is the same one that assembly
// serves.
//
// One definition rather than one per file: every suite here builds the same
// stack, and when rbac's queries started naming tables through the orm, seven
// copies of this line all had to learn about it at once.
// audit rides along since the user lifecycle records events in the same
// transaction: without its table in the orm, every create dies mid-commit
export const authClosure = [
  ...orgEntities,
  ...authEntities,
  ...rbacEntities,
  ...auditEntities,
] as const

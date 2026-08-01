// stable pure-table entry: kit aggregation and cross-plugin imports both key
// off these named exports; helpers, custom types and future relations stay
// in their own modules and never leak through here
export { tenants } from './tables/tenants.ts'
export { orgTypes } from './tables/org-types.ts'
export { orgTypeRules } from './tables/org-type-rules.ts'
export { orgNodes } from './tables/org-nodes.ts'

// thunk table only: no top-level side effects, no heavy imports, so every
// component stays an independently code-split chunk
export const components = {
  'rbac/RolesPage': () => import('./RolesPage.tsx'),
}

export { catalogs, errorMessages } from './i18n.ts'

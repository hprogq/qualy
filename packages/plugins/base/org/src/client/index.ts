// thunk table only: no top-level side effects, no heavy imports, so every
// component stays an independently code-split chunk
export const components = {
  'org/OrgPage': () => import('./OrgPage.tsx'),
}

// localization assets the web host aggregates: the plugin owns the org/*
// message namespace and the display text for its own typed api errors
export { catalogs, errorMessages } from './i18n.ts'

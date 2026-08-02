// thunk table only: no top-level side effects, no heavy imports, so every
// component stays an independently code-split chunk
export const components = {
  'auth/LoginPage': () => import('./LoginPage.tsx'),
  'auth/UserMenu': () => import('./UserMenu.tsx'),
}

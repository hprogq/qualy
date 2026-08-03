// thunk table only: no top-level side effects, no heavy imports, so every
// component stays an independently code-split chunk
export const components = {
  'ping/PingPage': () => import('./PingPage.tsx'),
}

export { catalogs } from './i18n.ts'

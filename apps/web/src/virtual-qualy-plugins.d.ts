// The plugin aggregate `@qualy/web-build` generates and serves as a virtual
// module. Four tables of loaders, keyed by the surface each one implements -
// the same addresses the manifest names - plus the two tables of what is
// said by code rather than by the screen that says it: api failures by code,
// and the texts the server names by id.
declare module 'virtual:qualy/plugins' {
  import type { ComponentType } from 'react'
  import type { BrowserPlugin } from '@qualy/plugin-kit/browser'
  import type { ErrorMessageMap, Message } from '@qualy/i18n-contract'

  // the tables are heterogeneous by nature; the shell wraps every entry in
  // React.lazy, which is where the per-screen prop types stop mattering
  type Loader = () => Promise<{ readonly default: ComponentType<any> }>

  /** by page id */
  export const pageComponents: Record<string, Loader>
  /** by layout contract */
  export const layoutComponents: Record<string, Loader>
  /** by slot key, then by the id of the item filed under it */
  export const slotComponents: Record<string, Record<string, Loader>>
  /** by login driver type */
  export const loginComponents: Record<string, Loader>
  /** every active plugin's browser half, in the assembly's own order */
  export const browserPlugins: readonly BrowserPlugin[]
  export const wireMessages: Readonly<Record<string, Message>>
  export const errorMessages: ErrorMessageMap
}

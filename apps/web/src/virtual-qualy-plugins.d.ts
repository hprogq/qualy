// The plugin aggregate `@qualy/web-build` generates and serves as a virtual
// module. Four tables of loaders, keyed by the surface each one implements -
// the same addresses the manifest names - plus the localisation halves, typed
// off the provider that consumes them so this declaration cannot quietly
// drift from what I18nProvider accepts.
declare module 'virtual:qualy/plugins' {
  import type { ComponentType } from 'react'
  import type { I18nProviderProps } from '@qualy/web-i18n'

  // the tables are heterogeneous by nature; the shell wraps every entry in
  // React.lazy, which is where the per-screen prop types stop mattering
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Loader = () => Promise<{ readonly default: ComponentType<any> }>

  /** by page id */
  export const pageComponents: Record<string, Loader>
  /** by layout contract */
  export const layoutComponents: Record<string, Loader>
  /** by slot key, then by the id of the item filed under it */
  export const slotComponents: Record<string, Record<string, Loader>>
  /** by login driver type */
  export const loginComponents: Record<string, Loader>
  export const catalogs: NonNullable<I18nProviderProps['catalogs']>
  export const errorMessages: NonNullable<I18nProviderProps['errorMessages']>
}

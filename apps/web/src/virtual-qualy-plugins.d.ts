// The plugin aggregate the Vite plugin in scripts/lib/vite-qualy-plugins.ts
// serves as a virtual module. The shape mirrors what every plugin's ./client
// entry exports; the i18n halves are typed off the provider that consumes
// them, so this declaration cannot quietly drift from what I18nProvider
// accepts.
declare module 'virtual:qualy/plugins' {
  import type { ComponentType } from 'react'
  import type { I18nProviderProps } from '@qualy/web-i18n'

  // the registry is heterogeneous by nature; the shell wraps every entry in
  // React.lazy, which is where the per-page prop types stop mattering
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const components: Record<string, () => Promise<{ readonly default: ComponentType<any> }>>
  export const catalogs: NonNullable<I18nProviderProps['catalogs']>
  export const errorMessages: NonNullable<I18nProviderProps['errorMessages']>
}

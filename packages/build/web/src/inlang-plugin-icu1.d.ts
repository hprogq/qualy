// the ICU MessageFormat 1 storage plugin ships javascript only
declare module '@inlang/plugin-icu1' {
  import type { InlangPlugin } from '@inlang/sdk'

  const plugin: InlangPlugin
  export default plugin
}

// Dev-only virtual module served by @stylexjs/unplugin (devMode 'full'). The
// app never imports it - the plugin injects it into index.html itself - but
// the vitest browser page is not built from index.html, so the probe test
// imports it directly to pull the aggregated StyleX CSS into the page.
declare module 'virtual:stylex:runtime'

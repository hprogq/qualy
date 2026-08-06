// The plugin's entry: the layer, the config channel, and the raw routes the
// generated route table imports - the browser shell is a wildcard handler
// rather than an api endpoint, so it travels beside the layer, not inside it.
export { config, layer, routes } from './server/index.ts'

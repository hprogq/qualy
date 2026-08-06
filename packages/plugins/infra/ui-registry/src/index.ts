// The plugin's entry: what the assembly builds, and the handler its api
// group pairs with. Peers import the registry and authorizer through their
// own subpaths rather than through this file, which keeps a contributor from
// pulling the manifest projection into its graph.
export { appApiHandlers, layer } from './server/index.ts'

// The plugin's entry: the registry-and-manifest service the assembly builds,
// and the handlers behind its api group, exported under the one name every
// entry uses. The handlers are not folded into the layer: an api group's
// middleware is implemented by other plugins - the viewer arrives through
// auth's, which itself builds on this registry - so the host composes every
// plugin's handlers above every plugin's services, where the library expects
// middleware to be found. Peers import the registry and authorizer through
// their own subpaths rather than through this file.
export { appApiHandlers as apiHandlers, layer } from './server/index.ts'

// The plugin's entry: the layer the assembly builds and the config channel
// the manifest block arrives through. Peers reach the service helpers through
// ./server, the CLI reaches ./assembly and ./migrator - none of them through
// this file, which exists for the generated runtime module alone.
export { config, layer } from './server/index.ts'

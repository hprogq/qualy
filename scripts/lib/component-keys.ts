// plugin client components are namespaced "<plugin>/<Component>" so two
// plugins can never silently shadow each other in the merged registry
export function validateComponentKeys(pluginName: string, keys: string[]): void {
  const ns = pluginName
    .split('/')
    .pop()!
    .replace(/^plugin-/, '')
  for (const key of keys) {
    if (!key.startsWith(`${ns}/`)) {
      throw new Error(
        `${pluginName} exports component "${key}", expected the "${ns}/" namespace prefix`,
      )
    }
    if (key.length <= ns.length + 1) {
      throw new Error(`${pluginName} exports component "${key}" without a component name`)
    }
  }
}

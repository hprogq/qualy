// namespaced identifiers: <plugin>/<name>, lowercase kebab-case segments.
// Everything crossing the plugin boundary is named this way so a merged
// registry can never silently shadow another plugin's entry.
export type NamespacedId = `${string}/${string}`

export const NAMESPACED_ID = /^[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/

export const assertNamespacedId = (id: string, what: string) => {
  if (!NAMESPACED_ID.test(id)) {
    throw new Error(`${what} "${id}" must be a namespaced id like "plugin/name"`)
  }
}

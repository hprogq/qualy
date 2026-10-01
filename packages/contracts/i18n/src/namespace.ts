/** Stable identity shared by the message compiler and server references. */
export const namespaceOf = (packageName: string): string =>
  packageName
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

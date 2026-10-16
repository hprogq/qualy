/** Stable identity shared by the message compiler and server references. */
export const namespaceOf = (packageName: string): string =>
  packageName
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.join('-') ?? ''

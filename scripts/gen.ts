// single generator entry: both generators run in this process and read the
// same argv, so `--all` reaches every one of them. Chaining them in a
// package.json script would not work, pnpm appends passthrough args only to
// the tail command of the chain.
await import('./gen-contracts.ts')
await import('./gen-plugins.ts')

export {}

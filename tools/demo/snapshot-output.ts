import fs from 'node:fs'
import path from 'node:path'

/** Baselines contain private identifiers and password hashes, including when replaced. */
export const prepareSnapshotOutput = (directory: string) => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  const output = {
    dump: path.join(directory, 'qualy-demo.dump'),
    storage: path.join(directory, 'storage.tar.gz'),
  }
  for (const file of Object.values(output)) {
    const descriptor = fs.openSync(file, 'a', 0o600)
    try {
      fs.fchmodSync(descriptor, 0o600)
    } finally {
      fs.closeSync(descriptor)
    }
  }
  return output
}

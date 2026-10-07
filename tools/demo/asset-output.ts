import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Existing demonstration snapshots may hard-link an asset, so replace its inode. */
export const writeAsset = (destination: string, bytes: Uint8Array) => {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.tmp`,
  )
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' })
    fs.renameSync(temporary, destination)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

import fs from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// The shell's worker-src is 'self' and nothing more, and this provider adds
// nothing to the policy. That holds only while the widget build it loads
// starts no worker of its own: the default build inlines its worker and
// starts it from a blob: url, which is why the driver imports the external
// build and brings its worker as a file of this origin. An upgrade that put
// an inline worker back into the external build would be refused by the
// browser at the first challenge, so it is refused here first.

const require = createRequire(import.meta.url)
const external = fs.readFileSync(
  require
    .resolve('altcha/external', { paths: [new URL('..', import.meta.url).pathname] })
    .replace(/\.umd\.cjs$/, '.js'),
  'utf8',
)

describe('the widget build the driver loads', () => {
  it('starts no worker from a blob: url', () => {
    expect(external).not.toMatch(/createObjectURL|new Blob\(|["']blob:/)
  })
})

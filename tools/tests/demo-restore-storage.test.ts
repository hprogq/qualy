import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = path.resolve('deploy/demo/restore-storage.sh')
const key = 'attachments/0190a7a0-0000-7000-8000-000000000001/0190a7a0-0000-7000-8000-000000000002'
let temp: string
let root: string
let archive: string
let bin: string

const run = (operation: string, extra: Record<string, string> = {}) =>
  spawnSync('sh', [script, operation, root, archive], {
    env: {
      ...process.env,
      QUALY_KEEP_KEYS: key,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      ...extra,
    },
    encoding: 'utf8',
  })

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-restore-storage-'))
  root = path.join(temp, 'storage')
  bin = path.join(temp, 'bin')
  const baseline = path.join(temp, 'baseline')
  archive = path.join(temp, 'storage.tar.gz')
  fs.mkdirSync(path.dirname(path.join(root, key)), { recursive: true })
  fs.writeFileSync(path.join(root, key), 'original icon bytes')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(baseline, 'attachments'), { recursive: true })
  fs.writeFileSync(path.join(baseline, 'attachments', 'baseline'), 'baseline bytes')
  fs.writeFileSync(path.join(baseline, 'other'), 'other bytes')
  const tar = spawnSync('tar', ['-czf', archive, '-C', baseline, '.'], { encoding: 'utf8' })
  expect(tar.status, tar.stderr).toBe(0)
})
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }))

describe('demo restore storage', () => {
  it('rejects a missing local icon before a swap', () => {
    fs.unlinkSync(path.join(root, key))
    const result = run('prepare')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('missing')
    expect(fs.existsSync(path.join(root, '.qualy-restore-kept'))).toBe(false)
  })

  it.each(['after-delete', 'during-move'])(
    'preserves the icon after interruption %s and retry',
    (failure) => {
      expect(run('prepare').status).toBe(0)
      const find = spawnSync('which', ['find'], { encoding: 'utf8' }).stdout.trim()
      const mv = spawnSync('which', ['mv'], { encoding: 'utf8' }).stdout.trim()
      fs.writeFileSync(
        path.join(bin, 'find'),
        `#!/bin/sh\n"${find}" "$@"\nstatus=$?\ncase "$*" in *"! -name .incoming"*) [ "$FAIL_POINT" != after-delete ] || exit 71;; esac\nexit "$status"\n`,
        { mode: 0o755 },
      )
      fs.writeFileSync(
        path.join(bin, 'mv'),
        `#!/bin/sh\n"${mv}" "$@"\nstatus=$?\ncase "$1" in */.incoming/*) [ "$FAIL_POINT" != during-move ] || kill -TERM "$PPID";; esac\nexit "$status"\n`,
        { mode: 0o755 },
      )
      const interrupted = run('swap', { FAIL_POINT: failure })
      expect(interrupted.status).not.toBe(0)
      expect(fs.readFileSync(path.join(root, '.qualy-restore-kept', key), 'utf8')).toBe(
        'original icon bytes',
      )
      // The old location may have been removed. A fresh preparation must use
      // the persisted copy rather than discard it or rely on the old file.
      expect(run('prepare').status).toBe(0)
      const resumed = run('swap')
      expect(resumed.status, resumed.stderr).toBe(0)
      expect(fs.readFileSync(path.join(root, key), 'utf8')).toBe('original icon bytes')
      expect(fs.readFileSync(path.join(root, 'attachments', 'baseline'), 'utf8')).toBe(
        'baseline bytes',
      )
      expect(run('finish').status).toBe(0)
      expect(fs.existsSync(path.join(root, '.qualy-restore-kept'))).toBe(false)
    },
  )

  it('can prepare again after cleanup is interrupted following the atomic detach', () => {
    expect(run('prepare').status).toBe(0)
    expect(run('swap').status).toBe(0)
    const mv = spawnSync('which', ['mv'], { encoding: 'utf8' }).stdout.trim()
    fs.writeFileSync(
      path.join(bin, 'mv'),
      `#!/bin/sh
"${mv}" "$@"
status=$?
case "$1" in */.qualy-restore-kept) exit 71;; esac
exit "$status"
`,
      { mode: 0o755 },
    )
    expect(run('finish').status).not.toBe(0)
    expect(fs.existsSync(path.join(root, '.qualy-restore-kept'))).toBe(false)
    expect(fs.readFileSync(path.join(root, key), 'utf8')).toBe('original icon bytes')
    expect(run('prepare').status).toBe(0)
    expect(fs.readFileSync(path.join(root, '.qualy-restore-kept', key), 'utf8')).toBe(
      'original icon bytes',
    )
  })

  it('refuses a complete restore while an unfinished preserved copy exists', () => {
    expect(run('prepare').status).toBe(0)
    const result = run('check')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--keep-sign-in')
    expect(fs.readFileSync(path.join(root, key), 'utf8')).toBe('original icon bytes')
  })
})

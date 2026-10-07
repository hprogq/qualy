import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareSnapshotOutput } from '../snapshot-output.ts'

const directories: string[] = []
const temporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-demo-snapshot-'))
  directories.push(directory)
  return directory
}
const modeOf = (file: string) => fs.statSync(file).mode & 0o777
afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('private baseline output', () => {
  it('creates an owner-only directory and both owner-only output files', () => {
    const directory = path.join(temporaryDirectory(), 'baseline')
    const output = prepareSnapshotOutput(directory)
    expect(modeOf(directory)).toBe(0o700)
    expect(modeOf(output.dump)).toBe(0o600)
    expect(modeOf(output.storage)).toBe(0o600)
  })

  it('tightens an old baseline before replacement without destroying its contents', () => {
    const directory = temporaryDirectory()
    const dump = path.join(directory, 'qualy-demo.dump')
    const storage = path.join(directory, 'storage.tar.gz')
    fs.chmodSync(directory, 0o755)
    fs.writeFileSync(dump, 'previous dump')
    fs.writeFileSync(storage, 'previous attachments')
    fs.chmodSync(dump, 0o644)
    fs.chmodSync(storage, 0o644)
    const output = prepareSnapshotOutput(directory)
    expect(modeOf(directory)).toBe(0o700)
    for (const file of Object.values(output)) expect(modeOf(file)).toBe(0o600)
    expect(fs.readFileSync(dump, 'utf8')).toBe('previous dump')
    expect(fs.readFileSync(storage, 'utf8')).toBe('previous attachments')
    fs.writeFileSync(output.dump, 'replacement dump')
    fs.writeFileSync(output.storage, 'replacement attachments')
    expect(modeOf(output.dump)).toBe(0o600)
    expect(modeOf(output.storage)).toBe(0o600)
  })
})

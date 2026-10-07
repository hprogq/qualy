import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeAsset } from '../asset-output.ts'

const directories: string[] = []
const temporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-demo-assets-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('rendered asset replacement', () => {
  it('preserves the bytes and inode used by an existing snapshot hard link', () => {
    const directory = temporaryDirectory()
    const asset = path.join(directory, 'proof.jpg')
    const attachment = path.join(directory, 'old-attachment.jpg')
    fs.writeFileSync(asset, 'original proof')
    fs.linkSync(asset, attachment)
    const originalInode = fs.statSync(attachment).ino
    writeAsset(asset, Buffer.from('new proof'))
    expect(fs.readFileSync(attachment, 'utf8')).toBe('original proof')
    expect(fs.statSync(attachment).ino).toBe(originalInode)
    expect(fs.readFileSync(asset, 'utf8')).toBe('new proof')
    expect(fs.statSync(asset).ino).not.toBe(originalInode)
    expect(fs.readdirSync(directory).sort()).toEqual(['old-attachment.jpg', 'proof.jpg'])
  })

  it('removes its temporary output when replacing the destination fails', () => {
    const directory = temporaryDirectory()
    const destination = path.join(directory, 'occupied')
    fs.mkdirSync(destination)
    expect(() => writeAsset(destination, Buffer.from('new proof'))).toThrow()
    expect(fs.readdirSync(directory)).toEqual(['occupied'])
    expect(fs.statSync(destination).isDirectory()).toBe(true)
  })
})

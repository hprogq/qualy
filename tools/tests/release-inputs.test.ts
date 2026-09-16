import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// What a release is built on, named exactly.
//
// A release is meant to be a function of the commit: the same checkout and
// lock build the same three images. A base image named by a tag is not part
// of the commit - `node:24-bookworm-slim` today and next month are different
// bytes, and nothing in the repository would show that anything moved. So the
// bases are pinned by digest, and the node they carry is the one the rest of
// the toolchain runs: the version mise installs for development and CI sets
// up for the suite, so a test run and the image it vouches for use one node.
// The database is the same argument for the other half of a deployment.

const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const DOCKERFILES = [
  'Dockerfile',
  'apps/sandbox-runtime/Dockerfile',
  'apps/sandbox-authoring/Dockerfile',
] as const

const toolchainNode = () => {
  const version = /^node = "(\d+\.\d+\.\d+)"$/m.exec(read('mise.toml'))?.[1]
  if (version === undefined) throw new Error('mise.toml pins no exact node version')
  return version
}

describe('what a release is built on', () => {
  it('starts every image from the node the toolchain pins, by digest', () => {
    const node = toolchainNode()
    for (const dockerfile of DOCKERFILES) {
      const text = read(dockerfile)
      const pinned = /^ARG NODE_IMAGE=(\S+)$/m.exec(text)?.[1]
      expect(pinned, `${dockerfile} declares NODE_IMAGE`).toMatch(
        new RegExp(`^node:${node.replaceAll('.', '\\.')}-[\\w.-]+@sha256:[0-9a-f]{64}$`),
      )
      // every stage starts from that argument or from an earlier stage, so no
      // FROM can name a base the pin does not cover
      const stages = new Set([...text.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)$/gim)].map((m) => m[1]))
      for (const [, base] of text.matchAll(/^FROM\s+(\S+)/gm)) {
        expect(base === '${NODE_IMAGE}' || stages.has(base), `${dockerfile}: FROM ${base}`).toBe(
          true,
        )
      }
    }
  })

  it('runs the suite on that same node', () => {
    const versions = [...read('.github/workflows/ci.yml').matchAll(/node-version:\s*(\S+)/g)].map(
      (m) => m[1],
    )
    expect(versions.length).toBeGreaterThan(0)
    expect([...new Set(versions)]).toEqual([toolchainNode()])
  })

  it('runs one postgres, by digest, wherever a database is started', () => {
    const images = [
      'deploy/compose.yaml',
      'docker-compose.yml',
      '.github/workflows/ci.yml',
    ].flatMap((file) =>
      [...read(file).matchAll(/image:\s*(\S*postgres\S*|\S*pgvector\S*)/g)].map((m) => ({
        file,
        image: m[1]!,
      })),
    )
    // the release compose, the development stack's two clusters, and CI
    expect(images.length).toBe(4)
    for (const { file, image } of images) {
      expect(image, file).toMatch(/@sha256:[0-9a-f]{64}$/)
    }
    expect([...new Set(images.map((one) => one.image))]).toHaveLength(1)
  })
})

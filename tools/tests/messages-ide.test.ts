import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import YAML from 'yaml'
import { walkFiles } from '../lib/walk.ts'
import { repoRoot } from '../lib/manifest.ts'
import { ideProjectSettings } from '../../packages/build/messages/src/ide.ts'

it('keeps an isolated, pinned IDE project for every package owning messages', () => {
  const files = walkFiles(path.join(repoRoot, 'packages')).filter(
    (file) =>
      file.endsWith('/messages/en-US.json') &&
      !file.includes('/.qualy/') &&
      !file.includes('/node_modules/'),
  )
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    const settings = path.join(path.dirname(path.dirname(file)), 'project.inlang/settings.json')
    expect(JSON.parse(fs.readFileSync(settings, 'utf8')), settings).toEqual(ideProjectSettings)
  }
  const catalog = YAML.parse(
    fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
  ).catalog
  expect(ideProjectSettings.modules[0]).toContain(
    `@inlang/plugin-icu1@${catalog['@inlang/plugin-icu1']}/`,
  )
})

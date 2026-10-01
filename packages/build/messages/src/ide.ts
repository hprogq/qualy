import fs from 'node:fs'
import path from 'node:path'
import { supportedLocales } from '@qualy/i18n-contract'

/** IDE configuration; production compilation never reads or downloads these modules. */
export const ideProjectSettings = {
  $schema: 'https://inlang.com/schema/project-settings',
  baseLocale: 'en-US',
  locales: supportedLocales,
  modules: [
    'https://cdn.jsdelivr.net/npm/@inlang/plugin-icu1@1.1.0/dist/index.js',
    'https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@2.2.9/dist/index.js',
  ],
  'plugin.inlang.icu-messageformat-1': { pathPattern: './messages/{locale}.json' },
}

/** Initial setup only: authored configurations are never overwritten. */
export function ensureIdeProject(packageRoot: string): void {
  if (!fs.existsSync(path.join(packageRoot, 'messages'))) return
  const directory = path.join(packageRoot, 'project.inlang')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'settings.json')
  if (!fs.existsSync(file))
    fs.writeFileSync(file, JSON.stringify(ideProjectSettings, null, 2) + '\n', { flag: 'wx' })
}

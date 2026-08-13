import { Plugin } from '@qualy/plugin-kit'
import { ItemTypes } from '@qualy/plugin-assessment/plugin'
import { evidenceDriver } from './driver.ts'

// The evidence plugin, as a description: one item-type driver, contributed to
// the catalog the assessment core compiles. It owns no tables and runs no
// service; what a student uploads lives in core's entry rows, and this plugin
// only knows how to read the payloads its own fields produced.

const plugin = Plugin.define(
  '@qualy/plugin-assessment-evidence',
  { dependsOn: ['@qualy/plugin-assessment'] },
  ItemTypes.driver(evidenceDriver),
)

export default plugin

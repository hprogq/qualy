import { compileMessages } from '../../packages/build/messages/src/compile.ts'

// The node suite's global setup: code under test imports #messages, which is
// generated from the packages' messages/*.json. Keeps whichever module
// layout is there, so a dev server running beside the suite is left alone.
export default async function setup(): Promise<void> {
  await compileMessages({ all: true })
}

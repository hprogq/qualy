import { describe, expect, it } from 'vitest'
import { shutdownStartMessage } from '../src/shutdown.ts'

// The first line a stopping process writes, in the four situations it can be
// written in.
//
// It is one string, and it would not be worth a test except that the
// difference it encodes is easy to lose: the Ctrl+C hint is an instruction,
// and it is correct only when somebody is holding the key. Production is
// stopped by a supervisor, so the hint there is advice to a log file. A
// refactor that "unified" the two would read as a tidy-up and would put it
// back.

describe('what a stopping process says first', () => {
  it('offers the operator the second press only where there is one', () => {
    expect(shutdownStartMessage('development', 'SIGINT')).toBe(
      'shutting down; press Ctrl+C again to give up waiting',
    )
    expect(shutdownStartMessage('production', 'SIGINT')).toBe('SIGINT: shutting down')
  })

  it('names the signal, and nothing else, when nobody sent it by hand', () => {
    expect(shutdownStartMessage('development', 'SIGTERM')).toBe('SIGTERM: shutting down')
    expect(shutdownStartMessage('production', 'SIGTERM')).toBe('SIGTERM: shutting down')
  })

  it('never offers a second press to a supervisor', () => {
    // the property, rather than the three cells: whatever else changes, the
    // hint belongs to exactly one situation
    for (const mode of ['development', 'production'] as const) {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        const said = shutdownStartMessage(mode, signal)
        expect(said.includes('press Ctrl+C again')).toBe(
          mode === 'development' && signal === 'SIGINT',
        )
      }
    }
  })
})

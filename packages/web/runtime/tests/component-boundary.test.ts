import { describe, expect, it } from 'vitest'
import { PluginComponentBoundary } from '../src/component-boundary.tsx'

// A boundary outlives a route change: React keeps the instance where the
// element type and position match, so what it remembers has to belong to the
// surface that put it there. The state transition is the whole of that rule,
// and it is asserted here rather than in a browser because rendering a page
// that throws proves less about it than reading the rule directly.

const page = (id: string) => ({ kind: 'page' as const, id })

const derive = (
  props: { surface: ReturnType<typeof page> },
  state: { failed: boolean; surface: string | null },
) =>
  (
    PluginComponentBoundary as unknown as {
      getDerivedStateFromProps: (
        props: unknown,
        state: unknown,
      ) => { failed: boolean; surface: string | null } | null
    }
  ).getDerivedStateFromProps(props, state)

describe('what a failed plugin surface is remembered as', () => {
  it('records which surface the failure belonged to', () => {
    expect(derive({ surface: page('a') }, { failed: false, surface: null })).toEqual({
      failed: false,
      surface: 'page:a',
    })
  })

  it('lets a different surface draw, rather than the last one’s error screen', () => {
    const failed = { failed: true, surface: 'page:a' }
    expect(derive({ surface: page('b') }, failed)).toEqual({ failed: false, surface: null })
  })

  it('holds the failure while the same surface is still on screen', () => {
    const failed = { failed: true, surface: 'page:a' }
    expect(derive({ surface: page('a') }, failed)).toBeNull()
  })
})
